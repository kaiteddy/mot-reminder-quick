/**
 * Merge the two duplicate "Mr Jonathan Perl" customer records into
 * #271 Sixtrees Limited (SIX003), per Adam 05/08/2026.
 *
 *   #140    SIX001  Mr Jonathan Perl   (8 docs, 0 cars)   ┐
 *   #540436 CHU004  Mr Jonathan Perl   (45 docs, 4 cars)  ┘ → #271 Sixtrees Limited
 *
 * NOT touched: #230 Mr Perl (B Perl), #450562 Mrs Perl, #377 Mr David Allen.
 *
 * Run with --apply to write; without it, this is a dry run.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const SOURCES = [140, 540436];
const TARGET = 271;

// Every table carrying a customerId (no FKs are declared, so these are found by name).
const TABLES = [
  "appointments",
  "customerLogs",
  "customerMessages",
  "payments",
  "reminderLogs",
  "reminders",
  "serviceHistory",
  "vehicleSaleInvoices",
  "vehicles",
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();

  const backup: Record<string, unknown> = {};
  const target: any = await db.execute(
    sql`SELECT * FROM customers WHERE id = ${TARGET}`,
  );
  const sources: any = await db.execute(
    sql`SELECT * FROM customers WHERE id IN (140, 540436)`,
  );
  backup.customers = [...target.rows, ...sources.rows];

  console.log(`TARGET  #${TARGET} ${target.rows[0]?.accountNumber} ${target.rows[0]?.name}`);
  for (const s of sources.rows) console.log(`SOURCE  #${s.id} ${s.accountNumber} ${s.name}`);
  console.log("");

  let moved = 0;
  for (const t of TABLES) {
    const rows: any = await db.execute(
      sql.raw(`SELECT * FROM "${t}" WHERE "customerId" IN (140, 540436)`),
    );
    backup[t] = rows.rows;
    if (!rows.rows.length) continue;
    moved += rows.rows.length;
    console.log(`  ${t.padEnd(20)} ${String(rows.rows.length).padStart(4)} rows`);
  }
  console.log(`\n  TOTAL ${moved} rows to repoint\n`);

  if (!apply) {
    console.log("DRY RUN — re-run with --apply to write.");
    process.exit(0);
  }

  const dir = join(process.cwd(), "scripts", ".cleanup-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `merge-perl-sixtrees-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`BACKUP  ${file}\n`);

  for (const t of TABLES) {
    const r: any = await db.execute(
      sql.raw(
        `UPDATE "${t}" SET "customerId" = ${TARGET} WHERE "customerId" IN (140, 540436)`,
      ),
    );
    if (r.rowCount) console.log(`  repointed ${t}: ${r.rowCount}`);
  }

  // Sixtrees Ltd has no phone of its own — carry Jonathan's across so reminders reach him.
  const phone = sources.rows.find((s: any) => s.id === 540436)?.phone;
  if (phone && !/^\+?\d/.test(String(target.rows[0]?.phone || ""))) {
    await db.execute(sql`UPDATE customers SET phone = ${phone} WHERE id = ${TARGET}`);
    console.log(`  set Sixtrees phone: ${phone}`);
  }

  await db.execute(sql`DELETE FROM customers WHERE id IN (140, 540436)`);
  console.log("  deleted #140, #540436");

  const after: any = await db.execute(sql`
    SELECT (SELECT COUNT(*) FROM "serviceHistory" WHERE "customerId" = ${TARGET}) docs,
           (SELECT COUNT(*) FROM vehicles      WHERE "customerId" = ${TARGET}) cars,
           (SELECT COUNT(*) FROM customers WHERE id IN (140, 540436)) leftover`);
  console.log("\nAFTER:", after.rows[0]);
  process.exit(0);
}

main();
