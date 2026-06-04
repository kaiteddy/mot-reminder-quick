import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
for (const [name, type] of [["insuranceCompany", "VARCHAR(255)"], ["invoiceTo", "VARCHAR(20)"]] as [string,string][]) {
  try { await c.query(`ALTER TABLE serviceHistory ADD COLUMN ${name} ${type}`); console.log("added", name); }
  catch (e: any) { if (/Duplicate column/i.test(e.message)) console.log("exists", name); else throw e; }
}
await c.end();
