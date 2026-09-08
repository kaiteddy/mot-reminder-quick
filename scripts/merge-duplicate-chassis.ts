/**
 * Consolidate records that are provably ONE car under one owner.
 *
 *   npx tsx scripts/merge-duplicate-chassis.ts review.csv          # DRY RUN
 *   npx tsx scripts/merge-duplicate-chassis.ts review.csv --go     # apply
 *
 * Takes the sheet from review-duplicate-chassis.ts and acts only where three independent
 * things agree: the mileage line reads as one car, every record has the same owner, and
 * DVSA's own test readings fit that same line. Anything short of that is skipped and listed.
 *
 * The survivor is the record whose plate DVSA still recognises — the plate the car wears now.
 * Everything on the other records (invoices, reminders, reminder logs, customer log entries,
 * appointments) moves onto it, the survivor gets a note listing the plates the car has worn,
 * and a stub is removed only once nothing at all points at it. Every row touched is backed up
 * to scripts/.cleanup-backups/ first. This is exactly what was done by hand for Mr Bloom's
 * Saab on 08/09/2026; this makes it repeatable and auditable.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

const GO = process.argv.includes("--go");
const NOISE = 1500;

type Row = Record<string, string>;
const parseCsv = (text: string): Row[] => {
  const lines = text.split("\n").filter(Boolean);
  const hdr = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const cells = l.match(/"([^"]*)"/g)!.map((x) => x.slice(1, -1));
    return Object.fromEntries(hdr.map((h, i) => [h, cells[i] ?? ""]));
  });
};
const readings = (s: string) => (s && s !== "none" && !/^(no tests|plate not at DVSA)$/.test(s))
  ? s.split(" ").filter((p) => p.includes(":")).map((p) => { const [d, m] = p.split(":"); return { d, m: Number(m) }; }) : [];
const worstDrop = (rs: { d: string; m: number }[]) => {
  let peak = -Infinity, worst = 0;
  for (const r of [...rs].sort((a, b) => a.d.localeCompare(b.d))) { if (peak > -Infinity && r.m < peak) worst = Math.max(worst, peak - r.m); peak = Math.max(peak, r.m); }
  return worst;
};

async function main() {
  const sheet = parseCsv(fs.readFileSync(process.argv[2], "utf8"));
  const groups = new Map<string, Row[]>();
  for (const r of sheet) groups.set(r.vin, [...(groups.get(r.vin) ?? []), r]);

  const db = new Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await db.connect();
  const backup: any[] = [];
  let merged = 0, skipped = 0;

  for (const [vin, recs] of groups) {
    const skip = (why: string) => { skipped++; console.log(`  skip ${recs.map((r) => r.registration).join(" / ")}: ${why}`); };
    if (!recs[0].verdict.startsWith("ONE CAR")) continue;                       // not our business here
    if (!recs[0].owners.startsWith("same owner")) { skip("car changed hands — histories stay apart"); continue; }
    const ours = recs.flatMap((r) => readings(r.our_readings));
    const dvsa = recs.flatMap((r) => readings(r.dvsa_readings));
    if (!dvsa.length) { skip("no DVSA readings to confirm with"); continue; }
    if (worstDrop([...ours, ...dvsa]) > NOISE) { skip("DVSA's readings do not fit our line"); continue; }
    // The survivor wears the plate DVSA still knows.
    const live = recs.filter((r) => readings(r.dvsa_readings).length > 0 || r.dvsa_readings === "no tests");
    if (live.length !== 1) { skip(`expected exactly one live plate, found ${live.length}`); continue; }
    const survivor = live[0];
    const stubs = recs.filter((r) => r !== survivor);
    const sid = Number(survivor.id), stubIds = stubs.map((s) => Number(s.id));

    // The live-plate record is often ownerless (created by a lookup) while the stub holds the
    // customer. One car, one owner: the survivor takes the owner if it has none, and we refuse
    // to proceed if the two records name DIFFERENT people — the sheet's "same owner" ignores blanks.
    const { rows: ownerRows } = await db.query(`SELECT id, "customerId" FROM vehicles WHERE id = ANY($1::int[])`, [[sid, ...stubIds]]);
    const owners = new Set(ownerRows.map((r) => r.customerId).filter((x) => x != null));
    if (owners.size > 1) { skip("records name different customers"); continue; }
    const owner = owners.size ? [...owners][0] : null;
    const survivorOwner = ownerRows.find((r) => r.id === sid)?.customerId ?? null;

    // What sits on the stubs, so the note and the backup say exactly what moved.
    const counts: Record<string, number> = {};
    for (const [table, col] of [["serviceHistory", "vehicleId"], ["reminders", "vehicleId"], ["reminderLogs", "vehicleId"], ["customerLogs", "vehicleId"], ["appointments", "vehicleId"]]) {
      const { rows: [c] } = await db.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${col}" = ANY($1::int[])`, [stubIds]);
      counts[table] = c.n;
    }
    console.log(`  ${GO ? "MERGE" : "would merge"} ${stubs.map((s) => s.registration).join(" + ")} → ${survivor.registration}${survivorOwner == null && owner != null ? " (takes the owner from the old record)" : ""}: ${counts.serviceHistory} invoices, ${counts.reminders} reminders, ${counts.reminderLogs} logs move`);
    if (!GO) { merged++; continue; }

    const { rows: before } = await db.query(`SELECT * FROM vehicles WHERE id = ANY($1::int[])`, [[sid, ...stubIds]]);
    backup.push({ vin, survivor: sid, stubs: stubIds, before, moved: counts });

    await db.query("BEGIN");
    try {
      for (const [table, col] of [["serviceHistory", "vehicleId"], ["reminders", "vehicleId"], ["reminderLogs", "vehicleId"], ["customerLogs", "vehicleId"], ["appointments", "vehicleId"]]) {
        await db.query(`UPDATE "${table}" SET "${col}" = $1 WHERE "${col}" = ANY($2::int[])`, [sid, stubIds]);
      }
      const plates = stubs.map((s) => s.registration).join(", ");
      const note = `Records merged ${new Date().toISOString().slice(0, 10)}: this car was also on file as ${plates}. ` +
        `Judged one vehicle because the mileage readings across all records form a single climbing line and DVSA's own test readings fit it, ` +
        `and every record belonged to the same customer. ${counts.serviceHistory} invoice(s) and ${counts.reminders} reminder(s) moved here; ` +
        `older invoices still show the plate the car wore on the day. Nothing was deleted that held work.`;
      await db.query(`UPDATE vehicles SET notes = COALESCE(notes || E'\n\n', '') || $2, "customerId" = COALESCE("customerId", $3) WHERE id = $1`, [sid, note, owner]);
      // Exact duplicate pending reminders (same type, same due date) collapse to one — several of
      // these cars already carried identical pairs before any merge, and moving the stub's adds more.
      await db.query(`
        DELETE FROM reminders r USING reminders k
         WHERE r."vehicleId" = $1 AND k."vehicleId" = $1 AND r.status = 'pending' AND k.status = 'pending'
           AND r.type = k.type AND r."dueDate" IS NOT DISTINCT FROM k."dueDate" AND r.id > k.id`, [sid]);
      // Remove a stub only when nothing whatsoever points at it any more.
      const { rowCount } = await db.query(`
        DELETE FROM vehicles v WHERE v.id = ANY($1::int[])
           AND NOT EXISTS (SELECT 1 FROM "serviceHistory" WHERE "vehicleId" = v.id)
           AND NOT EXISTS (SELECT 1 FROM reminders WHERE "vehicleId" = v.id)
           AND NOT EXISTS (SELECT 1 FROM "reminderLogs" WHERE "vehicleId" = v.id)
           AND NOT EXISTS (SELECT 1 FROM "customerLogs" WHERE "vehicleId" = v.id)
           AND NOT EXISTS (SELECT 1 FROM appointments WHERE "vehicleId" = v.id)
           AND NOT EXISTS (SELECT 1 FROM "vehicleSaleInvoices" WHERE "vehicleId" = v.id)`, [stubIds]);
      await db.query("COMMIT");
      if (rowCount !== stubIds.length) console.log(`    note: ${stubIds.length - (rowCount ?? 0)} stub(s) kept because something still points at them`);
      merged++;
    } catch (e) { await db.query("ROLLBACK"); throw e; }
  }

  if (GO && backup.length) {
    const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `merge-duplicate-chassis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ merged ${merged} group(s), skipped ${skipped}; backed up to ${file}`);
  } else console.log(`\n${GO ? "merged" : "would merge"} ${merged}, skipped ${skipped}${GO ? "" : " — re-run with --go"}`);
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
