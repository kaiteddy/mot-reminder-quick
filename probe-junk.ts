import { getDb, normPhoneKey } from "./server/db";
import { sql } from "drizzle-orm";
async function main() {
  const db = await getDb(); if (!db) throw new Error("no db");
  const rows: any = await db.execute(sql`
    SELECT c.id, c.name, c.phone, c.email, c.address, c.postcode, c."accountNumber" acc, c."externalId" ext,
      (SELECT COUNT(*) FROM "serviceHistory" WHERE "customerId"=c.id) docs,
      (SELECT COUNT(*) FROM vehicles WHERE "customerId"=c.id) cars,
      (SELECT COUNT(*) FROM reminders WHERE "customerId"=c.id) rem,
      (SELECT COUNT(*) FROM "reminderLogs" WHERE "customerId"=c.id) rlog,
      (SELECT COUNT(*) FROM payments WHERE "customerId"=c.id) pay,
      (SELECT COUNT(*) FROM "customerMessages" WHERE "customerId"=c.id) msg,
      (SELECT COUNT(*) FROM appointments WHERE "customerId"=c.id) appt,
      (SELECT COUNT(*) FROM "customerLogs" WHERE "customerId"=c.id) logs
    FROM customers c
    WHERE c."createdAt" BETWEEN '2026-01-15 14:36:00' AND '2026-01-15 14:37:00'
    ORDER BY c.id`);
  const all = rows.rows;
  const active = (r: any) => Number(r.docs) + Number(r.cars) + Number(r.rem) + Number(r.rlog) + Number(r.pay) + Number(r.msg) + Number(r.appt) > 0;
  const withActivity = all.filter(active);
  const empty = all.filter((r: any) => !active(r));
  const badPhone = all.filter((r: any) => r.phone && !normPhoneKey(r.phone));
  const noPhone = all.filter((r: any) => !r.phone);
  const anyAcct = all.filter((r: any) => r.acc);
  const anyExt = all.filter((r: any) => r.ext);
  const anyAddr = all.filter((r: any) => r.address || r.postcode);
  const anyEmail = all.filter((r: any) => r.email);
  console.log("BATCH SIZE:", all.length);
  console.log("  with any activity      :", withActivity.length);
  console.log("  completely empty       :", empty.length);
  console.log("  unparseable phone      :", badPhone.length);
  console.log("  no phone at all        :", noPhone.length);
  console.log("  has account number     :", anyAcct.length);
  console.log("  has externalId (GA4)   :", anyExt.length);
  console.log("  has address/postcode   :", anyAddr.length);
  console.log("  has email              :", anyEmail.length);
  console.log("  customerLogs only      :", all.filter((r: any) => !active(r) && Number(r.logs) > 0).length);
  process.exit(0);
}
main();
