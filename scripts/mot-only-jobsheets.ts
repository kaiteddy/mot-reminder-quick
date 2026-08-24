/**
 * The 13 MOT-only job sheets left open for more than a fortnight: set the description to
 * "Carry out MOT" and put the MOT charge on at £45 — the rate that applied when they were done,
 * not today's £50.
 *
 * Goes through saveDocument so the totals are recomputed the same way the app does it. That
 * function REPLACES the line items with whatever it's given, so every existing line is read and
 * passed back through alongside the new MOT one.
 *
 * MOT is zero-rated, so the line carries 0% VAT and £45 net is £45 gross.
 *
 * Run with --apply to write; without it, this is a dry run.
 */
import { getDb, saveDocument } from "../server/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const DOC_NOS = ["93383", "93350", "93315", "93193", "93117", "93099", "93027", "93014",
  "92958", "92901", "92876", "92867", "92849"];
const MOT_RATE = 45;
const DESCRIPTION = "Carry out MOT";

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) throw new Error("no db");

  const docs: any = await db.execute(sql`
    SELECT id, "docNo", registration, description, "totalGross", "docType"
    FROM "serviceHistory" WHERE "docNo" IN (${sql.join(DOC_NOS.map((n) => sql`${n}`), sql`, `)}) AND "docType" = 'JS' ORDER BY "docNo"`);

  const backup: any[] = [];
  let willChange = 0;

  for (const d of docs.rows) {
    const items: any = await db.execute(sql`SELECT * FROM "serviceLineItems" WHERE "documentId" = ${d.id} ORDER BY id`);
    backup.push({ doc: d, lineItems: items.rows });

    const hasMot = items.rows.some((i: any) => String(i.itemType) === "MOT" && Number(i.subNet) > 0);
    // 92849 already carried a £45 MOT line but still showed a £0.00 total — its totals were
    // never recomputed. So a doc that already has the charge is RE-SAVED rather than skipped:
    // saveDocument recomputes from the line items and puts the total right.
    const stale = hasMot && Number(d.totalGross || 0) <= 0;
    const note = hasMot
      ? (stale ? "has the MOT line but a £0 total — recompute" : "already priced — leave alone")
      : `add MOT £${MOT_RATE.toFixed(2)}`;
    console.log(`  ${d.docNo}  ${String(d.registration || "-").padEnd(9)} £${Number(d.totalGross || 0).toFixed(2).padStart(7)}  ${String(items.rows.length).padStart(2)} lines  ->  ${note}`);
    if (!hasMot || stale) willChange++;
  }

  console.log(`\n  ${docs.rows.length} job sheets, ${willChange} to change`);
  if (!apply) { console.log("\nDRY RUN — re-run with --apply to write."); process.exit(0); }

  const dir = join(process.cwd(), "scripts", ".cleanup-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `mot-only-jobsheets-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nBACKUP  ${file}\n`);

  for (const entry of backup) {
    const d = entry.doc;
    const existing = entry.lineItems;
    const alreadyPriced = existing.some((i: any) => String(i.itemType) === "MOT" && Number(i.subNet) > 0);
    if (alreadyPriced && Number(d.totalGross || 0) > 0) continue;   // nothing to do

    const lineItems = [
      ...existing.map((i: any) => ({
        itemType: i.itemType, description: i.description, partNumber: i.partNumber,
        quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0,
        vatRate: i.vatRate == null ? 20 : Number(i.vatRate),
        subNet: Number(i.subNet) || 0, taxAmount: Number(i.taxAmount) || 0,
      })),
      // Zero-rated: an MOT test isn't a vatable supply, so net and gross are both £45. Only
      // added when there isn't one already — a stale-total doc keeps its existing line.
      ...(alreadyPriced ? [] : [{ itemType: "MOT", description: "MOT Test", quantity: 1, unitPrice: MOT_RATE, vatRate: 0, subNet: MOT_RATE, taxAmount: 0 }]),
    ];

    await saveDocument({ id: d.id, docType: "JS", description: DESCRIPTION, lineItems } as any);
  }

  const after: any = await db.execute(sql`
    SELECT "docNo", registration, description, "totalNet", "totalTax", "totalGross"
    FROM "serviceHistory" WHERE "docNo" IN (${sql.join(DOC_NOS.map((n) => sql`${n}`), sql`, `)}) AND "docType" = 'JS' ORDER BY "docNo"`);
  console.log("AFTER:");
  for (const x of after.rows) {
    console.log(`  ${x.docNo}  ${String(x.registration || "-").padEnd(9)} net £${Number(x.totalNet).toFixed(2)}  vat £${Number(x.totalTax).toFixed(2)}  gross £${Number(x.totalGross).toFixed(2)}  | ${x.description}`);
  }
  process.exit(0);
}

main();
