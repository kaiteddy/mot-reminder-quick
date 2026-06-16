/**
 * After migrate-to-neon: the source had 9 duplicate-registration vehicle groups. Only one row
 * per registration survived the unique constraint; the others' ids were skipped. Their child
 * rows (documents, reminders, etc.) were migrated with the now-missing vehicleId, so re-point
 * them onto the surviving vehicle for that registration. Consolidates, loses no history.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import pg from "pg";

const CHILD_TABLES = ["serviceHistory", "reminders", "appointments", "customerLogs", "reminderLogs"];

async function main() {
  const my = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON! });
  await pgc.connect();

  const [groups] = await my.query<any[]>(`
    SELECT MAX(registration) registration, GROUP_CONCAT(id ORDER BY id) ids
    FROM vehicles GROUP BY BINARY registration HAVING COUNT(*) > 1`);

  let totalRepointed = 0;
  for (const g of groups) {
    const ids: number[] = String(g.ids).split(",").map(Number);
    // which id survived into Neon?
    const present = (await pgc.query(`SELECT id FROM vehicles WHERE id = ANY($1::int[])`, [ids])).rows.map((r) => r.id);
    if (present.length !== 1) { console.log(`  ? reg ${g.registration}: ${present.length} present in Neon (ids ${ids}) — skipping`); continue; }
    const keep = present[0];
    const drop = ids.filter((i) => i !== keep);
    let repointed = 0;
    for (const t of CHILD_TABLES) {
      const res = await pgc.query(`UPDATE "${t}" SET "vehicleId" = $1 WHERE "vehicleId" = ANY($2::int[])`, [keep, drop]);
      repointed += res.rowCount || 0;
    }
    totalRepointed += repointed;
    console.log(`  reg ${g.registration}: keep ${keep}, re-pointed ${repointed} child rows from [${drop}]`);
  }

  // sanity: any child rows still pointing at a non-existent vehicle?
  const orphans = (await pgc.query(`
    SELECT count(*)::int n FROM "serviceHistory" sh
    WHERE sh."vehicleId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = sh."vehicleId")`)).rows[0].n;
  console.log(`\nTotal child rows re-pointed: ${totalRepointed}`);
  console.log(`Orphaned serviceHistory rows (vehicleId with no vehicle): ${orphans}`);

  await my.end();
  await pgc.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
