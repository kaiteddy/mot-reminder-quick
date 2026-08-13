/**
 * Issue the 8 MOT job sheets that were genuinely never billed, per Adam 11/08/2026.
 *
 * These are the survivors of the scan: MOT done and confirmed against DVLA, no invoice anywhere
 * for that car (the five that DID have one — including two invoiced weeks later — were deleted
 * as duplicates). Each is priced at £45, the rate at the time.
 *
 * Two steps per job sheet, because issueDocument only acts on invoice types:
 *   convertDocument(JS -> SI)  then  issueDocument(newId)
 * The convert copies the lines, the vehicle and the customer; issuing stamps the date, sets the
 * status and pops a real GA4 number from the pool.
 *
 * Run with --apply to write; without it, this is a dry run.
 */
import { getDb, convertDocument, issueDocument } from "../server/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const DOC_NOS = ["93117", "93099", "93027", "93014", "92958", "92901", "92876", "92867"];

/** None of the 8 had a customer attached — they'd have issued to nobody. Five are identified by
 *  the same customer having been invoiced for that car before; the other three by the mobile on
 *  the job sheet matching an existing record. 93027's number is shared with #450711 "Cash Cash
 *  Cash", so the exact name match wins (see the duplicate-phone hazard). */
const OWNERS: Record<string, { customerId: number; name: string; via: string }> = {
  "93117": { customerId: 6517,   name: "Mr Aviv Sidis",          via: "invoiced for this car before" },
  "93099": { customerId: 450420, name: "Mr Holder",              via: "invoiced for this car before" },
  "93014": { customerId: 573,    name: "Mr Paul Goldring",       via: "invoiced for this car before" },
  "92876": { customerId: 540750, name: "Mrs Claire Pater",       via: "invoiced for this car before" },
  "92867": { customerId: 6973,   name: "Mr Ricky",               via: "invoiced for this car before" },
  "92901": { customerId: 450748, name: "Ms Dalia",               via: "mobile on the job sheet" },
  "92958": { customerId: 450757, name: "Mr Simon Daniels",       via: "mobile on the job sheet" },
  "93027": { customerId: 420009, name: "Mr Jiorel Sergiu Cretu", via: "mobile on the job sheet" },
};

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) throw new Error("no db");

  const docs: any = await db.execute(sql`
    SELECT id, "docNo", registration, "customerName", to_char("dateCreated",'DD/MM/YYYY') dt,
           "totalGross" g, description, "docStatus"
    FROM "serviceHistory"
    WHERE "docNo" IN (${sql.join(DOC_NOS.map((n) => sql`${n}`), sql`, `)}) AND "docType" = 'JS'
    ORDER BY "dateCreated"`);

  console.log(`TO ISSUE: ${docs.rows.length} job sheets`);
  let total = 0;
  for (const d of docs.rows) {
    total += Number(d.g || 0);
    console.log(`  ${d.docNo}  ${String(d.registration || "-").padEnd(9)} ${d.dt}  £${Number(d.g || 0).toFixed(2).padStart(7)}  ${String(d.customerName || "-").slice(0, 22)}`);
  }
  console.log(`  total £${total.toFixed(2)}`);

  if (docs.rows.length !== DOC_NOS.length) throw new Error(`expected ${DOC_NOS.length}, found ${docs.rows.length}`);
  // Never issue a £0 invoice — that was the state they were all in before the MOT was priced.
  const unpriced = docs.rows.filter((d: any) => Number(d.g || 0) <= 0);
  if (unpriced.length) throw new Error(`ABORT: ${unpriced.length} are still at £0`);

  const pool: any = await db.execute(sql`SELECT COUNT(*) n FROM "ga4NumberPool" WHERE status = 'available'`);
  console.log(`  GA4 numbers available: ${pool.rows[0].n}`);
  if (Number(pool.rows[0].n) < docs.rows.length) throw new Error("ABORT: not enough GA4 numbers in the pool");

  if (!apply) { console.log("\nDRY RUN — re-run with --apply to write."); process.exit(0); }

  const dir = join(process.cwd(), "scripts", ".cleanup-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `issue-mot-jobsheets-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(docs.rows, null, 2));
  console.log(`\nBACKUP  ${file}\n`);

  // Link the owner FIRST — convertDocument copies the customer across, so a job sheet with no
  // customer would produce an invoice belonging to nobody.
  for (const d of docs.rows) {
    const o = OWNERS[String(d.docNo)];
    if (!o) throw new Error(`ABORT: no owner resolved for ${d.docNo}`);
    await db.execute(sql`
      UPDATE "serviceHistory" SET "customerId" = ${o.customerId}, "customerName" = ${o.name}
      WHERE id = ${d.id}`);
    console.log(`  ${d.docNo} linked to #${o.customerId} ${o.name}  (${o.via})`);
  }

  const results: any[] = [];
  for (const d of docs.rows) {
    const created: any = await convertDocument(d.id, "SI");
    const issued: any = await issueDocument(created.id);
    results.push({ from: d.docNo, reg: d.registration, newId: created.id, ...issued });
    console.log(`  ${d.docNo} -> invoice id ${created.id}  status ${issued.status}  GA4 ${issued.ga4Number ?? "(pool empty — will backfill)"}`);
  }

  const check: any = await db.execute(sql`
    SELECT "docNo", "ga4Number", "docType", "docStatus", "totalGross" g, registration r
    FROM "serviceHistory" WHERE id IN (${sql.join(results.map((r) => sql`${r.newId}`), sql`, `)}) ORDER BY id`);
  console.log("\nISSUED INVOICES:");
  for (const x of check.rows) {
    console.log(`   ${x.docType} docNo ${String(x.docNo).padEnd(7)} GA4 ${String(x.ga4Number ?? "-").padEnd(7)} ${String(x.r || "-").padEnd(9)} £${Number(x.g).toFixed(2)}  ${x.docStatus}`);
  }
  process.exit(0);
}

main();
