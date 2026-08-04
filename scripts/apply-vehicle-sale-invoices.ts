/**
 * Create the vehicleSaleInvoices table on Neon (additive — CREATE TABLE IF NOT EXISTS).
 *   node_modules/.bin/tsx scripts/apply-vehicle-sale-invoices.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "../drizzle/0026_vehicle_sale_invoices.sql"), "utf8");

const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_NEON / DATABASE_URL is required");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicleSaleInvoices' ORDER BY ordinal_position`,
  );
  console.log(`vehicleSaleInvoices ready — ${r.rowCount} columns`);
  const n = await client.query(`SELECT COUNT(*)::int AS n FROM "vehicleSaleInvoices"`);
  console.log(`rows: ${n.rows[0].n}`);
} finally {
  await client.end();
}
