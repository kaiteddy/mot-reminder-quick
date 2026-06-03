/**
 * Add GA4-parity columns and populate them from the CSV exports — incrementally
 * (UPSERT by externalId / UPDATE JOIN by externalId), preserving existing links.
 *   npx tsx scripts/apply-parity-fields.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { mapGA4Document } from "../server/services/csv-import";

const DIR = "/Users/service/Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports";
const load = (f: string): Record<string, string>[] =>
  parse(iconv.decode(readFileSync(`${DIR}/${f}`), "ISO-8859-1"), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
const cap = (v: any, n: number) => (v == null ? null : String(v).slice(0, n));

const url = process.env.DATABASE_URL!;
const dbName = new URL(url).pathname.slice(1);
const c = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const exists = async (t: string, col: string) =>
  ((await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?", [dbName, t, col]))[0] as any[]).length > 0;
const addCol = async (t: string, col: string, type: string) => {
  if (await exists(t, col)) return;
  await c.query(`ALTER TABLE \`${t}\` ADD \`${col}\` ${type}`);
  console.log(`+ ${t}.${col}`);
};

// ---- 1. columns ----
const SH: [string, string, number | null][] = [
  ["accountNumber", "varchar(50)", 50], ["accountHeld", "varchar(20)", 20], ["company", "varchar(255)", 255],
  ["custHouseNo", "varchar(50)", 50], ["custRoad", "varchar(255)", 255], ["custLocality", "varchar(100)", 100],
  ["custTown", "varchar(100)", 100], ["custCounty", "varchar(100)", 100], ["custPostcode", "varchar(20)", 20],
  ["custTelephone", "varchar(50)", 50], ["custMobile", "varchar(50)", 50],
  ["staffSalesPerson", "varchar(100)", 100], ["staffTechnician", "varchar(100)", 100],
  ["staffRoadTester", "varchar(100)", 100], ["staffMotTester", "varchar(100)", 100],
  ["motClass", "varchar(50)", 50], ["motStatus", "varchar(50)", 50],
  ["excessNet", "decimal(10,2)", null], ["excessTax", "decimal(10,2)", null], ["excessGross", "decimal(10,2)", null],
  ["terms", "varchar(255)", 255],
];
for (const [col, type] of SH) await addCol("serviceHistory", col, type);
for (const [col] of [["paintCode"], ["keyCode"], ["radioCode"]]) await addCol("vehicles", col, "varchar(50)");

// ---- 2. populate serviceHistory (upsert by externalId) ----
console.log("Loading Documents.csv…");
const docs = load("Documents.csv");
const SH_COLS = SH.map(s => s[0]);
const seen = new Map<string, any[]>();
for (const r of docs) {
  const m: any = mapGA4Document(r);
  if (!m.externalId) continue;
  seen.set(m.externalId, [m.externalId, ...SH.map(([k, , n]) => (n ? cap(m[k], n) : (m[k] ?? null)))]);
}
const rows = [...seen.values()];
const updateClause = SH_COLS.map(k => `\`${k}\`=VALUES(\`${k}\`)`).join(",");
console.log(`Updating ${rows.length} serviceHistory rows…`);
for (let i = 0; i < rows.length; i += 1000) {
  await c.query(`INSERT INTO serviceHistory (externalId,${SH_COLS.join(",")}) VALUES ? ON DUPLICATE KEY UPDATE ${updateClause}`, [rows.slice(i, i + 1000)]);
  process.stdout.write(`\r  ${Math.min(i + 1000, rows.length)}/${rows.length}`);
}
process.stdout.write("\n");

// ---- 3. populate vehicles (paint/key/radio) via temp table UPDATE JOIN by externalId ----
console.log("Loading Vehicles.csv…");
const veh = load("Vehicles.csv");
const vrows = veh.filter(v => v["_ID"]).map(v => [v["_ID"], cap(v["Paintcode"], 50), cap(v["KeyCode"], 50), cap(v["RadioCode"], 50)]);
await c.query("CREATE TEMPORARY TABLE veh_tmp (externalId varchar(255), paintCode varchar(50), keyCode varchar(50), radioCode varchar(50), INDEX(externalId))");
for (let i = 0; i < vrows.length; i += 1000) await c.query("INSERT INTO veh_tmp (externalId,paintCode,keyCode,radioCode) VALUES ?", [vrows.slice(i, i + 1000)]);
const [res]: any = await c.query("UPDATE vehicles v JOIN veh_tmp t ON v.externalId=t.externalId SET v.paintCode=t.paintCode, v.keyCode=t.keyCode, v.radioCode=t.radioCode");
console.log(`vehicles updated: ${res.affectedRows}`);

// ---- verify ----
const chk = (await c.query("SELECT SUM(accountNumber IS NOT NULL) acc, SUM(staffTechnician IS NOT NULL) tech, SUM(custRoad IS NOT NULL) road, SUM(motClass IS NOT NULL) mot FROM serviceHistory"))[0] as any[];
console.log("serviceHistory populated:", chk[0]);
console.log("✅ Done.");
await c.end();
