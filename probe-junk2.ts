import { getDb, normPhoneKey } from "./server/db";
import { sql } from "drizzle-orm";
async function main() {
  const db = await getDb(); if (!db) throw new Error("no db");
  const batch: any = await db.execute(sql`
    SELECT id, name, phone FROM customers
    WHERE "createdAt" BETWEEN '2026-01-15 14:36:00' AND '2026-01-15 14:37:00' ORDER BY id`);
  const others: any = await db.execute(sql`
    SELECT id, name, phone FROM customers
    WHERE NOT ("createdAt" BETWEEN '2026-01-15 14:36:00' AND '2026-01-15 14:37:00') AND phone IS NOT NULL`);
  const byPhone = new Map<string, any[]>();
  for (const o of others.rows) {
    const k = normPhoneKey(o.phone); if (!k) continue;
    if (!byPhone.has(k)) byPhone.set(k, []); byPhone.get(k)!.push(o);
  }
  let dupe = 0, unique = 0, unusable = 0;
  const uniques: any[] = [], dupes: any[] = [];
  for (const r of batch.rows) {
    const k = r.phone ? normPhoneKey(r.phone) : null;
    if (!k) { unusable++; continue; }
    const hit = byPhone.get(k);
    if (hit?.length) { dupe++; dupes.push({ ...r, match: hit[0] }); } else { unique++; uniques.push(r); }
  }
  console.log("OF THE 122:");
  console.log("  no usable phone (nothing to keep) :", unusable);
  console.log("  phone ALREADY on a real customer  :", dupe);
  console.log("  phone found nowhere else          :", unique);
  console.log("\nEXAMPLES — phone already on a real customer (the batch row adds nothing):");
  for (const x of dupes.slice(0, 6)) console.log(`   #${x.id} "${x.name}" ${x.phone}  ->  already #${x.match.id} "${x.match.name}"`);
  console.log("\nEXAMPLES — phone found nowhere else (a genuinely new contact):");
  for (const x of uniques.slice(0, 8)) console.log(`   #${x.id} "${x.name}" ${x.phone}`);
  process.exit(0);
}
main();
