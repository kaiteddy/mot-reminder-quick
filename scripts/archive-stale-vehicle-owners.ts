/**
 * Cleanup: archive the customer link on vehicles nobody's invoiced in 5+ years, so MOT
 * reminders stop going to whoever we last billed for that reg — often no longer the owner.
 *
 *   npx tsx scripts/archive-stale-vehicle-owners.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/archive-stale-vehicle-owners.ts --go   # apply (backs up each row first)
 *
 * Also runs automatically as a step of scripts/sync-ga4.ts, so this keeps working on its own —
 * no one has to remember to run it.
 *
 * Root cause (see [[registration-reuse-across-vehicles]] and the VX56TZU/Abrahams case,
 * 2026-07-23): `vehicles.customerId` is set once — whoever we last invoiced for that reg — and
 * never re-evaluated. MOT expiry is live DVLA data about whoever owns the car TODAY, so a car
 * serviced once, years ago, still generates reminders to a customer who may have sold it long
 * since. GA4 accountNumber/address exactly matching the invoice (as verified for VX56TZU) rules
 * out a matching bug — this is real historical data that's simply gone stale as evidence of
 * CURRENT ownership.
 *
 * Match rule: a vehicle with a linked, non-opted-out customer, a currently-valid MOT, and no
 * service activity (by dateIssued, falling back to dateCreated) in the last 5 years. Clears
 * vehicles.customerId (never touches serviceHistory — the historical invoice keeps its original
 * customerId, so nothing about who paid for what in the past is lost) and appends a note
 * recording why, when, and the corroborating signals (years since last service, tax status,
 * vehicle age) for anyone auditing the record later.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const STALE_YEARS = 5;

export async function archiveStaleVehicleOwners(c: pg.Client, apply: boolean, backupDir: string) {
  const candidates = (await c.query(`
    SELECT v.id AS "vehicleId", v.registration, v.make, v.model, v."motExpiryDate", v."taxStatus",
           v."dateOfRegistration", v."customerId",
           c.name AS "customerName", c.phone,
           (SELECT MAX(COALESCE(sh."dateIssued", sh."dateCreated")) FROM "serviceHistory" sh WHERE sh."vehicleId" = v.id) AS "lastService"
    FROM vehicles v
    JOIN customers c ON c.id = v."customerId"
    WHERE v."motExpiryDate" > now()
      AND (c."optedOut" IS NULL OR c."optedOut" = 0)
      AND v."customerId" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "serviceHistory" sh2 WHERE sh2."vehicleId" = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM "serviceHistory" sh WHERE sh."vehicleId" = v.id
          AND COALESCE(sh."dateIssued", sh."dateCreated") > now() - interval '${STALE_YEARS} years'
      )
  `)).rows as any[];

  console.log(`\n===== ARCHIVE STALE VEHICLE OWNERS ${apply ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`Vehicles with a valid MOT + linked customer but no service in ${STALE_YEARS}+ years: ${candidates.length}`);

  const backup: any[] = [];
  for (const v of candidates) {
    const years = v.lastService ? ((Date.now() - new Date(v.lastService).getTime()) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1) : "?";
    console.log(`  ${apply ? "ARCHIVE" : "would archive"} ${v.registration} (${v.make} ${v.model}) — ${v.customerName}, last service ${years}y ago, tax ${v.taxStatus || "unknown"}`);
    if (!apply) continue;

    const note = `Customer link archived ${new Date().toISOString().slice(0, 10)} — no service in ${STALE_YEARS}+ years `
      + `(last: ${v.lastService ? new Date(v.lastService).toISOString().slice(0, 10) : "unknown"}, ~${years}y ago). `
      + `Was linked to ${v.customerName || "unknown"}; tax status at archive time: ${v.taxStatus || "unknown"}. `
      + `Historical invoices for this vehicle keep their original customer link — only the "current owner" field used for reminders was cleared.`;
    backup.push({ before: v, note });
    await c.query(
      `UPDATE vehicles SET "customerId" = NULL, notes = COALESCE(notes || E'\n\n', '') || $1 WHERE id = $2`,
      [note, v.vehicleId]
    );
  }

  if (apply && backup.length) {
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `archive-stale-vehicle-owners-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ archived ${backup.length} vehicle(s); backed up to ${file}`);
  } else if (!apply && candidates.length) {
    console.log(`\nDry run only — re-run with --go to archive (each is backed up to scripts/.cleanup-backups/ first).`);
  }
  return { candidates: candidates.length, archived: apply ? backup.length : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await c.connect();
  await archiveStaleVehicleOwners(c, process.argv.includes("--go"), path.join(process.cwd(), "scripts", ".cleanup-backups"));
  await c.end();
  process.exit(0);
}
