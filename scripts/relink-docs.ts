import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (s:string)=>{const [r]=await c.query(s); return r as any[];};
const before = (await q("SELECT SUM(customerId IS NOT NULL) cust, SUM(vehicleId IS NOT NULL) veh, COUNT(*) total FROM serviceHistory"))[0];
console.log("BEFORE:", before);
await q(`UPDATE serviceHistory sh JOIN vehicles v
   ON REPLACE(UPPER(sh.registration),' ','') = REPLACE(UPPER(v.registration),' ','')
   SET sh.vehicleId = v.id
   WHERE sh.vehicleId IS NULL AND sh.registration IS NOT NULL AND sh.registration <> ''`);
await q(`UPDATE serviceHistory sh JOIN vehicles v ON sh.vehicleId = v.id
   SET sh.customerId = v.customerId
   WHERE sh.customerId IS NULL AND v.customerId IS NOT NULL`);
const after = (await q("SELECT SUM(customerId IS NOT NULL) cust, SUM(vehicleId IS NOT NULL) veh, COUNT(*) total FROM serviceHistory"))[0];
console.log("AFTER: ", after);
console.log(`vehicle +${after.veh-before.veh}, customer +${after.cust-before.cust}`);
console.log(`coverage: vehicle ${(100*after.veh/after.total).toFixed(1)}%  customer ${(100*after.cust/after.total).toFixed(1)}%`);
await c.end();
