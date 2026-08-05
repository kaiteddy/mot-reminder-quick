/**
 * Generic customer merge: fold one or more customer records into a survivor.
 *
 *   npx tsx --env-file=.env scripts/merge-customer-into.ts --into 271 --from 450562 [--apply]
 *
 * Goes through the app's own mergeCustomerRecords so the absorbed GA4 _IDs land in
 * mergedExternalIds — without that the nightly sync re-creates the merged-away records as empty
 * shells (it happened on 05/08/2026 when the first Perl merge was done by hand).
 *
 * --force is implied: different GA4 account numbers trip the anti-mis-merge guard by design, and
 * every use of this script is an explicitly confirmed, human-reviewed merge.
 *
 * --keep-name preserves the survivor's name/account, because the merge's name-picker prefers a
 * titled personal name ("Mrs Perl") over a company one and would rename the company.
 */
import { getDb, mergeCustomerRecords } from "../server/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const TABLES = ["appointments", "customerLogs", "customerMessages", "payments",
  "reminderLogs", "reminders", "serviceHistory", "vehicleSaleInvoices", "vehicles"];

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const into = Number(arg("--into"));
  const from = String(arg("--from") || "").split(",").map((s) => Number(s.trim())).filter(Boolean);
  const apply = process.argv.includes("--apply");
  const keepName = process.argv.includes("--keep-name");
  if (!into || !from.length) throw new Error("usage: --into <id> --from <id[,id]> [--keep-name] [--apply]");

  const db = await getDb();
  if (!db) throw new Error("no db");

  const ids = [into, ...from];
  const before: any = await db.execute(sql`
    SELECT id, name, "accountNumber" acc, phone, email,
      (SELECT COUNT(*) FROM "serviceHistory" s WHERE s."customerId" = c.id) docs,
      (SELECT COUNT(*) FROM vehicles v WHERE v."customerId" = c.id) cars
    FROM customers c WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY id`);
  for (const r of before.rows) {
    console.log(`${r.id === into ? "KEEP  " : "MERGE "} #${r.id} ${r.acc || "-"} ${r.name} | ${r.phone || "-"} | ${r.email || "-"} | ${r.docs} docs, ${r.cars} cars`);
  }
  const survivor = before.rows.find((r: any) => r.id === into);
  if (!survivor) throw new Error(`survivor #${into} not found`);

  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    process.exit(0);
  }

  const backup: Record<string, unknown> = { customers: before.rows };
  for (const t of TABLES) {
    const rows: any = await db.execute(sql.raw(`SELECT * FROM "${t}" WHERE "customerId" IN (${from.join(",")})`));
    backup[t] = rows.rows;
  }
  const dir = join(process.cwd(), "scripts", ".cleanup-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `merge-${from.join("-")}-into-${into}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nBACKUP  ${file}`);

  console.log("MERGED  ", await mergeCustomerRecords(into, from, true));

  if (keepName) {
    await db.execute(sql`UPDATE customers SET name = ${survivor.name}, "accountNumber" = ${survivor.acc} WHERE id = ${into}`);
    console.log(`PINNED  name="${survivor.name}" account=${survivor.acc}`);
  }

  const after: any = await db.execute(sql`
    SELECT name, "accountNumber" acc, "altContacts" alt, "mergedExternalIds" aliases,
      (SELECT COUNT(*) FROM "serviceHistory" s WHERE s."customerId" = ${into}) docs,
      (SELECT COUNT(*) FROM vehicles v WHERE v."customerId" = ${into}) cars,
      (SELECT COUNT(*) FROM customers WHERE id IN (${sql.join(from.map((i) => sql`${i}`), sql`, `)})) leftover
    FROM customers WHERE id = ${into}`);
  console.log("\nAFTER:", JSON.stringify(after.rows[0], null, 2));
  process.exit(0);
}

main();
