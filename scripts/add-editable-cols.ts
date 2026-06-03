import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const db = new URL(process.env.DATABASE_URL!).pathname.slice(1);
const ex = async (t:string,col:string)=>((await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?",[db,t,col]))[0] as any[]).length>0;
for (const [t,col,type] of [["serviceHistory","customerName","varchar(255)"],["serviceHistory","custEmail","varchar(320)"]] as [string,string,string][]) {
  if (await ex(t,col)) { console.log("skip",col); continue; }
  await c.query(`ALTER TABLE \`${t}\` ADD \`${col}\` ${type}`); console.log("+",col);
}
await c.end();
