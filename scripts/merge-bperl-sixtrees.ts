/**
 * Fold Benjamin Perl (#230 "Mr Perl", SIX002) into #271 Sixtrees Limited, per Adam 05/08/2026:
 * "Benjamin Perl, Mr Perl, Jonathan Perl are all under SIXTREES". This also brings the Volvo
 * XC40 S8BEP under the company, as asked.
 *
 * Uses the app's own mergeCustomerRecords (force=true — SIX002 ≠ SIX003 trips the
 * different-account guard by design) so the survivor keeps every alias and now inherits the
 * losing record's phone/email as an additional contact instead of losing them.
 *
 * The name/account are pinned back afterwards: the merge's name-picker prefers a titled
 * personal name ("Mr Perl") over a company name, which would have renamed Sixtrees Limited.
 *
 * Run with --apply to write; without it, this is a dry run.
 */
import { getDb, mergeCustomerRecords } from "../server/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const SOURCE = 230;
const TARGET = 271;
const KEEP_NAME = "Sixtrees Limited";
const KEEP_ACCT = "SIX003";

const TABLES = ["appointments", "customerLogs", "customerMessages", "payments",
  "reminderLogs", "reminders", "serviceHistory", "vehicleSaleInvoices", "vehicles"];

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) throw new Error("no db");

  const before: any = await db.execute(sql`
    SELECT id, name, "accountNumber" acc, phone, email,
      (SELECT COUNT(*) FROM "serviceHistory" s WHERE s."customerId" = c.id) docs,
      (SELECT COUNT(*) FROM vehicles v WHERE v."customerId" = c.id) cars
    FROM customers c WHERE id IN (${SOURCE}, ${TARGET}) ORDER BY id`);
  for (const r of before.rows) console.log(`#${r.id} ${r.acc} ${r.name} | ${r.phone} | ${r.email} | ${r.docs} docs, ${r.cars} cars`);

  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    process.exit(0);
  }

  const backup: Record<string, unknown> = { customers: before.rows };
  for (const t of TABLES) {
    const rows: any = await db.execute(sql.raw(`SELECT * FROM "${t}" WHERE "customerId" = ${SOURCE}`));
    backup[t] = rows.rows;
  }
  const dir = join(process.cwd(), "scripts", ".cleanup-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `merge-bperl-sixtrees-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nBACKUP  ${file}`);

  const res = await mergeCustomerRecords(TARGET, [SOURCE], true);
  console.log("MERGED  ", res);

  await db.execute(sql`UPDATE customers SET name = ${KEEP_NAME}, "accountNumber" = ${KEEP_ACCT} WHERE id = ${TARGET}`);
  console.log(`PINNED  name="${KEEP_NAME}" account=${KEEP_ACCT}`);

  const after: any = await db.execute(sql`
    SELECT name, "accountNumber" acc, phone, email, "altContacts" alt,
      (SELECT COUNT(*) FROM "serviceHistory" s WHERE s."customerId" = ${TARGET}) docs,
      (SELECT COUNT(*) FROM vehicles v WHERE v."customerId" = ${TARGET}) cars,
      (SELECT COUNT(*) FROM customers WHERE id = ${SOURCE}) leftover
    FROM customers WHERE id = ${TARGET}`);
  console.log("\nAFTER:", JSON.stringify(after.rows[0], null, 2));
  process.exit(0);
}

main();
