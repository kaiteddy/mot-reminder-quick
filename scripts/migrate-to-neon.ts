/**
 * One-off data migration: US TiDB/MySQL (DATABASE_URL) -> Neon Postgres (DATABASE_URL_NEON).
 * Preserves primary-key ids, converts JSON->JSONB and zero-dates->null, then resets each
 * serial sequence to MAX(id). Idempotent: truncates each target table before loading.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import pg from "pg";

const TABLES = [
  "users", "customers", "vehicles", "reminders", "reminderLogs", "customerMessages",
  "serviceHistory", "serviceLineItems", "appointments", "appSettings", "autodataRequests",
  "descriptionPresets", "customerLogs", "payments", "addressLookups", "salesStock",
];

// jsonb columns that must be JSON-stringified before insert (pg would otherwise mangle JS arrays)
const JSONB: Record<string, string[]> = {
  customers: ["altContacts", "mergedExternalIds"],
  vehicles: ["comprehensiveTechnicalData"],
  appSettings: ["value"],
  autodataRequests: ["resultData"],
};

async function main() {
  const my = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
  const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON! });
  await pgClient.connect();

  let grandSrc = 0, grandDst = 0;
  for (const table of TABLES) {
    const [rows] = await my.query<any[]>(`SELECT * FROM \`${table}\``);
    await pgClient.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY`);
    if (!rows.length) { console.log(`${table.padEnd(20)} 0`); continue; }

    // Only migrate columns present in BOTH databases. MySQL-only columns are schema
    // drift the app's Drizzle schema doesn't know about (so the app never reads them).
    const pgColsRes = await pgClient.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]
    );
    const pgCols = new Set(pgColsRes.rows.map((r) => r.column_name));
    const allMyCols = Object.keys(rows[0]);
    const cols = allMyCols.filter((c) => pgCols.has(c));
    const dropped = allMyCols.filter((c) => !pgCols.has(c));
    if (dropped.length) console.log(`  ⚠ ${table}: dropping non-schema cols -> ${dropped.join(", ")}`);
    const jsonCols = JSONB[table] || [];
    const colSql = cols.map((c) => `"${c}"`).join(",");
    const batchSize = Math.max(1, Math.min(1000, Math.floor(60000 / cols.length)));

    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const params: any[] = [];
      const tuples = slice.map((row) => {
        const ph = cols.map((c) => {
          let v = (row as any)[c];
          if (v instanceof Date && isNaN(v.getTime())) v = null;
          // mysql2 returns JSON columns already parsed (object/array/string/number), so
          // always re-stringify to valid JSON text for the jsonb column (a bare JWT string
          // would otherwise fail json parsing).
          if (jsonCols.includes(c) && v != null) v = JSON.stringify(v);
          params.push(v);
          return `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      });
      // ON CONFLICT DO NOTHING skips rows that violate a unique constraint — e.g. the
      // ~240 junk duplicate openId='admin' rows in the source users table.
      await pgClient.query(`INSERT INTO "${table}" (${colSql}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`, params);
    }

    // realign the serial sequence so new inserts don't collide with migrated ids
    await pgClient.query(
      `SELECT setval(pg_get_serial_sequence('"${table}"','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM "${table}"),1))`
    );

    const dst = Number((await pgClient.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
    grandSrc += rows.length; grandDst += dst;
    const skipped = rows.length - dst;
    const flag = skipped === 0 ? "✓" : `(${skipped} skipped — dup/dirty rows)`;
    console.log(`${table.padEnd(20)} src=${rows.length}  ->  neon=${dst}  ${flag}`);
  }

  console.log(`\nTOTAL  src=${grandSrc}  neon=${grandDst}  ${grandSrc === grandDst ? "✓ ALL MATCH" : "✗ MISMATCH"}`);
  await my.end();
  await pgClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
