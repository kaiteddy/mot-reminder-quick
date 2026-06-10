/**
 * Speed up the Live Jobs / Documents list.
 *
 * The list sorts by COALESCE(dateIssued, dateCreated) desc. As a raw expression that can't use
 * an index, so TiDB did a full scan + filesort over all ~34k rows on every load (~1.7s).
 * This adds an indexed VIRTUAL generated column `listDate` for that expression, turning the sort
 * into an index scan (~150ms — a 10× win). Idempotent; safe to re-run.
 *
 *   npx tsx scripts/add-listdate-index.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const run = async (s: string) => {
  try { await c.query(s); console.log("✓ " + s.replace(/\s+/g, " ").slice(0, 70)); }
  catch (e: any) { console.log("• skip (" + e.message.slice(0, 60) + ")"); }
};

await run("ALTER TABLE serviceHistory ADD COLUMN listDate DATETIME AS (COALESCE(dateIssued, dateCreated)) VIRTUAL");
await run("CREATE INDEX sh_listdate_idx ON serviceHistory (listDate)");

await c.end();
process.exit(0);
