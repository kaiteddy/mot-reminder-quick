/**
 * Cleanup: link a vehicle to its owner when the vehicle itself has no customerId but every one
 * of its serviceHistory rows agrees on exactly one customer. Root cause (found via LL16VZF/Ms Chaja
 * Green, 2026-07-28): saveDocument's vehicle-upsert only ever set vehicles.customerId when a BRAND
 * NEW customer was created alongside a new vehicle — a new vehicle attached to an EXISTING customer
 * (picked from search) never got the link written at all, so every downstream "who owns this car"
 * lookup (Appointments booking dialog, MOT reminders, VehicleDetails) came back empty despite the
 * job itself clearly naming a customer. Fixed in saveDocument (see server/db.ts); this backfills
 * the ~1,700 vehicles already affected — many share one exact timestamp, suggesting most trace back
 * to the June Neon migration rather than the web app itself.
 *
 *   npx tsx scripts/link-orphaned-vehicle-owners.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/link-orphaned-vehicle-owners.ts --go   # apply (backs up each row first)
 *
 * Match rule: vehicles.customerId IS NULL, and every serviceHistory row for that vehicle with a
 * non-null customerId names exactly the SAME customer. Never touches a vehicle that already has an
 * owner, and never guesses when a vehicle's history shows more than one distinct customer (that's
 * genuine reg-reuse/ownership-change territory, not a missing link — leave those for manual review).
 *
 * Also runs automatically as a step of scripts/sync-ga4.ts, so this keeps working on its own.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

export async function linkOrphanedVehicleOwners(c: pg.Client, apply: boolean, backupDir: string) {
  const candidates = (await c.query(`
    SELECT v.id AS "vehicleId", v.registration, v.make, v.model,
           (SELECT sh."customerId" FROM "serviceHistory" sh WHERE sh."vehicleId" = v.id AND sh."customerId" IS NOT NULL LIMIT 1) AS "customerId",
           (SELECT MAX(sh."dateCreated") FROM "serviceHistory" sh WHERE sh."vehicleId" = v.id) AS "lastDoc"
    FROM vehicles v
    WHERE v."customerId" IS NULL
      AND (SELECT COUNT(DISTINCT sh."customerId") FROM "serviceHistory" sh WHERE sh."vehicleId" = v.id AND sh."customerId" IS NOT NULL) = 1
    ORDER BY v.id ASC
  `)).rows as any[];

  console.log(`\n===== LINK ORPHANED VEHICLE OWNERS ${apply ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`Vehicles with no owner but exactly one customer via history: ${candidates.length}`);

  const backup: any[] = [];
  for (const v of candidates) {
    if (apply) {
      backup.push({ before: { vehicleId: v.vehicleId, registration: v.registration, customerId: null }, after: { customerId: v.customerId } });
      await c.query(`UPDATE vehicles SET "customerId" = $1 WHERE id = $2`, [v.customerId, v.vehicleId]);
    }
  }

  if (apply && backup.length) {
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `link-orphaned-vehicle-owners-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ linked ${backup.length} vehicle(s); backed up to ${file}`);
  } else if (!apply && candidates.length) {
    console.log(`\nDry run only — re-run with --go to link (each is backed up to scripts/.cleanup-backups/ first).`);
  }
  return { candidates: candidates.length, linked: apply ? backup.length : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await c.connect();
  await linkOrphanedVehicleOwners(c, process.argv.includes("--go"), path.join(process.cwd(), "scripts", ".cleanup-backups"));
  await c.end();
  process.exit(0);
}
