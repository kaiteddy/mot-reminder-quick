/**
 * A "mixed" record is one vehicle row holding invoices from two different cars — the odometer
 * on its own history falls away by tens of thousands of miles, which no single car does.
 *
 * How they happen: a customer's private plate moves from car A to car B. Staff type the plate,
 * the app finds the record it already has for that plate, and car B's jobs are filed onto car A's
 * record. So one record ends up with two mileage tracks, and often two different plates written
 * across its own invoices.
 *
 * This walks each record's invoices in date order, cuts the history where the mileage falls, and
 * looks for somewhere the second track belongs — normally the twin record that shares the chassis
 * number, matched by the plate written on the invoices at the time.
 *
 *   npx tsx scripts/split-mixed-vehicle-records.ts report.csv         # report only
 *   npx tsx scripts/split-mixed-vehicle-records.ts report.csv --go    # move the invoices
 *
 * Only ever moves invoices between EXISTING records, never deletes one, and never touches a
 * record whose tracks cannot be told apart by the plate written on the invoice. Vehicle rows
 * themselves come from GA4 and are re-created by the nightly sync if deleted, so they are left
 * alone here by design.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

const GO = process.argv.includes("--go");
/** A fall of at least this many miles between consecutive jobs means a different car. */
const BREAK = 5000;

type Doc = { id: number; docNo: string; date: string; miles: number | null; plate: string; work: string };

const normPlate = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").split("*")[0];

async function main() {
  const outFile = process.argv[2] || "mixed-vehicle-records.csv";
  const db = new Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await db.connect();

  // Every record sharing a chassis number, with its own invoices.
  const { rows: vehicles } = await db.query(`
    SELECT v.id, v.registration, v.make, v.model, v."customerId", c.name AS customer,
           upper(regexp_replace(v.vin,'[^A-Za-z0-9]','','g')) AS vinkey
      FROM vehicles v LEFT JOIN customers c ON c.id = v."customerId"
     WHERE upper(regexp_replace(v.vin,'[^A-Za-z0-9]','','g')) IN (
       SELECT upper(regexp_replace(vin,'[^A-Za-z0-9]','','g')) FROM vehicles
        WHERE COALESCE(vin,'') <> '' GROUP BY 1 HAVING COUNT(*) > 1)`);

  const { rows: docs } = await db.query(`
    SELECT id, "docNo", "vehicleId", COALESCE("dateIssued","dateCreated") AS d, mileage, registration,
           left(regexp_replace(COALESCE(description,''),'\\s+',' ','g'), 40) AS work
      FROM "serviceHistory" WHERE "vehicleId" IS NOT NULL ORDER BY d`);
  const byVehicle = new Map<number, Doc[]>();
  for (const r of docs) {
    const list = byVehicle.get(r.vehicleId) ?? [];
    list.push({ id: r.id, docNo: r.docNo, date: new Date(r.d).toISOString().slice(0, 10), miles: r.mileage, plate: r.registration || "", work: r.work });
    byVehicle.set(r.vehicleId, list);
  }

  const byVin = new Map<string, any[]>();
  for (const v of vehicles) byVin.set(v.vinkey, [...(byVin.get(v.vinkey) ?? []), v]);

  const report: any[] = [];
  const plans: { from: any; to: any; docs: Doc[]; plate: string }[] = [];

  for (const [vin, members] of byVin) {
    for (const v of members) {
      const own = (byVehicle.get(v.id) ?? []).filter((d) => d.miles && d.miles > 0);
      if (own.length < 2) continue;
      // Where does the odometer fall away?
      let worst = 0, peak = -Infinity;
      for (const d of own) { if (peak > -Infinity && d.miles! < peak) worst = Math.max(worst, peak - d.miles!); peak = Math.max(peak, d.miles!); }
      if (worst < BREAK) continue;                      // this record is internally consistent

      // Split into tracks: a job starts a new track when it reads far below the running peak.
      const tracks: Doc[][] = [];
      let cur: Doc[] = [], curPeak = -Infinity;
      for (const d of own) {
        if (curPeak > -Infinity && d.miles! < curPeak - BREAK) { tracks.push(cur); cur = []; curPeak = -Infinity; }
        cur.push(d); curPeak = Math.max(curPeak, d.miles!);
      }
      tracks.push(cur);

      // Which plate was written on each track's invoices? A clean split has one plate per track.
      const trackPlates = tracks.map((t) => [...new Set(t.map((d) => normPlate(d.plate)).filter(Boolean))]);
      const clean = trackPlates.every((p) => p.length === 1) && new Set(trackPlates.flat()).size === tracks.length;

      // The biggest track stays; the others should go wherever their plate belongs.
      const home = tracks.reduce((a, b) => (b.length > a.length ? b : a));
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i] === home) continue;
        const plate = trackPlates[i][0] ?? "";
        const target = members.find((m: any) => m.id !== v.id && normPlate(m.registration) === plate)
          ?? vehicles.find((m: any) => m.id !== v.id && normPlate(m.registration) === plate);
        report.push({
          record: v.registration, car: `${v.make ?? ""} ${v.model ?? ""}`.trim(), customer: v.customer ?? "",
          vehicleId: v.id, vin,
          drop_miles: worst,
          stays: `${home.length} invoices ${home[0].date}→${home[home.length - 1].date} (${home[0].miles}→${home[home.length - 1].miles} mi)`,
          moves: `${tracks[i].length} invoices ${tracks[i][0].date}→${tracks[i][tracks[i].length - 1].date} (${tracks[i][0].miles}→${tracks[i][tracks[i].length - 1].miles} mi)`,
          plate_on_those_invoices: plate || "(blank)",
          goes_to: target ? `${target.registration} — ${(target.make ?? "") + " " + (target.model ?? "")}`.trim() : "NO RECORD FOUND for that plate",
          docNos: tracks[i].map((d) => d.docNo).join(" "),
          confident: clean && target ? "yes" : "no",
        });
        if (clean && target) plans.push({ from: v, to: target, docs: tracks[i], plate });
      }
    }
  }

  const header = Object.keys(report[0] ?? { record: "" });
  fs.writeFileSync(outFile, [header.join(","), ...report.map((r) => header.map((h) => `"${String(r[h] ?? "").replace(/"/g, "'")}"`).join(","))].join("\n"));

  console.log(`mixed records found: ${new Set(report.map((r) => r.vehicleId)).size}, blocks of invoices to move: ${report.length}`);
  console.log(`  confident (plate identifies where they belong): ${plans.length}`);
  console.log(`  needs a person: ${report.length - plans.length}`);
  for (const r of report) {
    console.log(`  ${r.confident === "yes" ? "MOVE" : "hold"}  ${String(r.record).padEnd(22)} ${r.moves.padEnd(46)} as ${r.plate_on_those_invoices.padEnd(9)} → ${r.goes_to}`);
  }

  if (GO && plans.length) {
    const backup = plans.map((p) => ({ from: p.from.id, fromReg: p.from.registration, to: p.to.id, toReg: p.to.registration, docs: p.docs.map((d) => ({ id: d.id, docNo: d.docNo, date: d.date, miles: d.miles })) }));
    const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `split-mixed-vehicle-records-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));

    for (const p of plans) {
      await db.query("BEGIN");
      try {
        await db.query(`UPDATE "serviceHistory" SET "vehicleId" = $1 WHERE id = ANY($2::int[])`, [p.to.id, p.docs.map((d) => d.id)]);
        const note = `${p.docs.length} invoice(s) moved here ${new Date().toISOString().slice(0, 10)} from the ${p.from.registration} record, where they had been filed by mistake. ` +
          `They were written up as ${p.plate}, they read ${p.docs[0].miles}–${p.docs[p.docs.length - 1].miles} miles, and that record's own odometer fell away by thousands of miles across them, which one car cannot do. Docs: ${p.docs.map((d) => d.docNo).join(", ")}.`;
        await db.query(`UPDATE vehicles SET notes = COALESCE(notes || E'\n\n','') || $2 WHERE id = $1`, [p.to.id, note]);
        await db.query(`UPDATE vehicles SET notes = COALESCE(notes || E'\n\n','') || $2 WHERE id = $1`,
          [p.from.id, `${p.docs.length} invoice(s) (${p.docs.map((d) => d.docNo).join(", ")}) moved off this record ${new Date().toISOString().slice(0, 10)} to ${p.to.registration} — they were another car's work, filed here because the plate had moved.`]);
        await db.query("COMMIT");
      } catch (e) { await db.query("ROLLBACK"); throw e; }
    }
    console.log(`\n✓ moved ${plans.reduce((n, p) => n + p.docs.length, 0)} invoice(s) across ${plans.length} block(s); backed up to ${file}`);
  } else if (plans.length) {
    console.log(`\nReport only — re-run with --go to move the confident ones.`);
  }
  console.log(`written to ${outFile}`);
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
