import "dotenv/config";
import fs from "fs";
import { parse } from "csv-parse/sync";
import mysql from "mysql2/promise";

const VEH = process.argv[2];
const APPLY = process.argv.includes("--go");
const clean = (s: any) => String(s ?? "").replace(/[\x0B\r\n]+/g, " ").trim().slice(0, 50);
const norm = (s: any) => String(s ?? "").toUpperCase().replace(/\s/g, "");

const rows: any[] = parse(fs.readFileSync(VEH), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
const data = rows
  .map(r => ({ extId: String(r._ID || "").trim(), reg: norm(r.Registration), eng: clean(r.EngineNo) }))
  .filter(r => r.eng && (r.extId || r.reg));
console.log("GA4 rows with an engine number:", data.length, APPLY ? "(APPLYING)" : "(dry-run)");

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const [before]: any = await c.query("SELECT SUM(engineNo IS NULL OR engineNo='') empty, COUNT(*) n FROM vehicles");
console.log("vehicles empty engineNo before:", before[0].empty, "/", before[0].n);

if (!APPLY) { console.log("dry-run; re-run with --go to apply"); await c.end(); process.exit(0); }

await c.query("DROP TABLE IF EXISTS _eng_backfill");
await c.query("CREATE TABLE _eng_backfill (extId VARCHAR(255), reg VARCHAR(50), eng VARCHAR(50), INDEX(extId), INDEX(reg))");
for (let i = 0; i < data.length; i += 1000) {
  const chunk = data.slice(i, i + 1000);
  await c.query("INSERT INTO _eng_backfill (extId, reg, eng) VALUES ?", [chunk.map(r => [r.extId, r.reg, r.eng])]);
}
// 1) match by GA4 _ID → externalId
const [r1]: any = await c.query(
  "UPDATE vehicles v JOIN _eng_backfill t ON v.externalId = t.extId SET v.engineNo = t.eng WHERE (v.engineNo IS NULL OR v.engineNo='') AND t.eng<>''"
);
console.log("updated by externalId:", r1.affectedRows);
// 2) fallback by normalized registration for any still empty
const [r2]: any = await c.query(
  "UPDATE vehicles v JOIN _eng_backfill t ON REPLACE(UPPER(v.registration),' ','') = t.reg SET v.engineNo = t.eng WHERE (v.engineNo IS NULL OR v.engineNo='') AND t.eng<>''"
);
console.log("updated by registration fallback:", r2.affectedRows);
await c.query("DROP TABLE _eng_backfill");

const [after]: any = await c.query("SELECT SUM(engineNo IS NULL OR engineNo='') empty, COUNT(*) n FROM vehicles");
console.log("vehicles empty engineNo after:", after[0].empty, "/", after[0].n);
const [fkt]: any = await c.query("SELECT registration, engineNo FROM vehicles WHERE REPLACE(UPPER(registration),' ','')='FKT350'");
console.log("FKT350 now:", JSON.stringify(fkt[0]));
await c.end();
process.exit(0);
