/**
 * One-time (but safe to re-run) cleanup: merge `vehicles` rows that represent the same
 * physical car but got split by registration spacing/case — e.g. "PE59OFH" vs "PE59 OFH".
 * See the "Reg format split matching" fix: the sync script and several lookup sites now
 * prevent NEW splits, but rows that were already split need merging by hand.
 *
 *   npx tsx scripts/merge-duplicate-vehicles.ts         # DRY RUN — reports only, writes nothing
 *   npx tsx scripts/merge-duplicate-vehicles.ts --go    # apply
 *
 * For each group of vehicle rows sharing a normalized registration:
 *  - canonical = the row with the most linked serviceHistory rows (tie-break: has a GA4
 *    externalId, then lower id)
 *  - backfills any NULL field on canonical from the orphan row(s)
 *  - repoints every vehicleId reference (reminders, reminderLogs, serviceHistory,
 *    appointments, customerLogs) from the orphan(s) to canonical
 *  - deletes each orphan row only after confirming ZERO references to it remain
 *  - each group is one transaction — a failure rolls back that group only
 */
import "dotenv/config";
import pg from "pg";

const GO = process.argv.includes("--go");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const q = async (sql: string, p?: any[]) => (await c.query(sql, p)).rows as any[];

console.log(`\nMerge duplicate vehicles ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"}\n`);

const REPOINT_TABLES = ["reminders", "reminderLogs", "serviceHistory", "appointments", "customerLogs"];
const MERGE_FIELDS = [
  "make", "model", "motExpiryDate", "taxStatus", "taxDueDate", "lastChecked", "motBookedDate",
  "customerId", "externalId", "colour", "fuelType", "dateOfRegistration", "vin", "engineCC",
  "engineNo", "engineCode", "derivative", "paintCode", "keyCode", "radioCode", "notes",
  "comprehensiveTechnicalData", "swsLastUpdated", "autodataMid",
];

const groups = await q(`
  SELECT REPLACE(UPPER(registration), ' ', '') AS normreg, array_agg(id) AS ids
  FROM vehicles
  GROUP BY normreg
  HAVING COUNT(*) > 1
`);

console.log(`Found ${groups.length} duplicate-registration group(s)\n`);

let totalRepointed = 0, totalDeleted = 0, failures = 0;

for (const g of groups) {
  const ids: number[] = g.ids;
  const counts = await q(`SELECT "vehicleId", COUNT(*) AS n FROM "serviceHistory" WHERE "vehicleId" = ANY($1) GROUP BY "vehicleId"`, [ids]);
  const countMap = new Map(counts.map((r: any) => [r.vehicleId, Number(r.n)]));
  const rows = await q(`SELECT * FROM vehicles WHERE id = ANY($1)`, [ids]);

  rows.sort((a: any, b: any) => {
    const da = countMap.get(a.id) || 0, db = countMap.get(b.id) || 0;
    if (db !== da) return db - da;
    const ea = a.externalId ? 1 : 0, eb = b.externalId ? 1 : 0;
    if (eb !== ea) return eb - ea;
    return a.id - b.id;
  });
  const canonical = rows[0];
  const orphans = rows.slice(1);

  console.log(`Group ${g.normreg} ("${canonical.registration}"): canonical=${canonical.id} (${countMap.get(canonical.id) || 0} docs${canonical.externalId ? ", has externalId" : ", NO externalId"}), orphan(s)=${orphans.map((o: any) => `${o.id} (${countMap.get(o.id) || 0} docs${o.externalId ? ", has externalId" : ""})`).join(", ")}`);

  const updates: Record<string, any> = {};
  for (const f of MERGE_FIELDS) {
    if (canonical[f] == null) {
      for (const o of orphans) { if (o[f] != null) { updates[f] = o[f]; break; } }
    }
  }
  if (Object.keys(updates).length) console.log(`  backfill canonical fields: ${Object.keys(updates).join(", ")}`);

  const repointPlan: { table: string; orphanId: number; count: number }[] = [];
  for (const o of orphans) {
    for (const t of REPOINT_TABLES) {
      const cnt = Number((await q(`SELECT COUNT(*) AS n FROM "${t}" WHERE "vehicleId" = $1`, [o.id]))[0].n);
      if (cnt > 0) { repointPlan.push({ table: t, orphanId: o.id, count: cnt }); totalRepointed += cnt; }
    }
  }
  for (const p of repointPlan) console.log(`  repoint ${p.count} row(s) in ${p.table}: vehicleId ${p.orphanId} -> ${canonical.id}`);
  totalDeleted += orphans.length;

  if (GO) {
    await c.query("BEGIN");
    try {
      if (Object.keys(updates).length) {
        const setSql = Object.keys(updates).map((k, i) => `"${k}" = $${i + 1}`).join(", ");
        await c.query(`UPDATE vehicles SET ${setSql} WHERE id = $${Object.keys(updates).length + 1}`, [...Object.values(updates), canonical.id]);
      }
      for (const o of orphans) {
        for (const t of REPOINT_TABLES) await c.query(`UPDATE "${t}" SET "vehicleId" = $1 WHERE "vehicleId" = $2`, [canonical.id, o.id]);
        let remaining = 0;
        for (const t of REPOINT_TABLES) remaining += Number((await c.query(`SELECT COUNT(*) AS n FROM "${t}" WHERE "vehicleId" = $1`, [o.id])).rows[0].n);
        if (remaining > 0) throw new Error(`refusing to delete vehicle ${o.id}: ${remaining} reference(s) still remain after repoint`);
        await c.query(`DELETE FROM vehicles WHERE id = $1`, [o.id]);
      }
      await c.query("COMMIT");
      console.log(`  ✓ merged`);
    } catch (e: any) {
      await c.query("ROLLBACK");
      failures++;
      console.error(`  ✗ FAILED, rolled back: ${e.message}`);
    }
  }
  console.log();
}

console.log(`\n${GO ? "Applied" : "Would apply"}: ${totalRepointed} row(s) repointed, ${totalDeleted} orphan vehicle row(s) ${GO ? "deleted" : "would be deleted"}${failures ? `, ${failures} group(s) FAILED` : ""}.`);
await c.end();
