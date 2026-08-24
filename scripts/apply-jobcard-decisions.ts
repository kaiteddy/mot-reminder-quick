/**
 * Apply Adam's decisions from the review sheet (14/08/2026).
 *
 *   DELETE       13 — bin the card, nothing to bill and no record wanted
 *   ISSUE BLANK   4 — £0 invoice so the visit stays on the customer's history
 *   CHASE         9 — left exactly as they are; they're live work
 *
 * Only 4 of the 13 deletes can actually be honoured here: the other 9 are GA4-mirrored and
 * sync-ga4 re-inserts anything missing by externalId, so removing them would achieve nothing
 * beyond a temporary tidy. Those need closing in GA4 itself.
 *
 * Run with --apply to write; without it, this is a dry run.
 */
import { getDb, convertDocument, issueDocument } from "../server/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const DELETE = ["92464", "92857", "92979", "93017", "93025", "93022", "93053", "93063", "93105", "93142", "93148", "93300", "93348"];
const BLANK = ["92726", "93010", "93231", "93377"];

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) throw new Error("no db");

  const load = async (nos: string[]) => (await db.execute(sql`
    SELECT * FROM "serviceHistory"
    WHERE "docNo" IN (${sql.join(nos.map((n) => sql`${n}`), sql`, `)}) AND "docType" = 'JS'`) as any).rows;

  const toDelete = await load(DELETE);
  const toBlank = await load(BLANK);
  const isWeb = (d: any) => !d.externalId || String(d.externalId).startsWith("WEB-");
  const deletable = toDelete.filter(isWeb);
  const mirrored = toDelete.filter((d: any) => !isWeb(d));

  console.log(`DELETE:      ${deletable.length} deletable, ${mirrored.length} GA4-mirrored (left alone)`);
  console.log(`ISSUE BLANK: ${toBlank.length}`);

  // A card with money against it isn't a "nothing to bill" card — stop rather than guess.
  for (const d of [...deletable, ...toBlank]) {
    const p: any = await db.execute(sql`SELECT COUNT(*) n FROM payments WHERE "documentId" = ${d.id}`);
    if (Number(p.rows[0].n) > 0) throw new Error(`ABORT: ${d.docNo} has payments attached`);
  }
  for (const d of toBlank) {
    if (!d.customerId) throw new Error(`ABORT: ${d.docNo} has no customer — a £0 invoice would belong to nobody`);
  }
  const pool: any = await db.execute(sql`SELECT COUNT(*) n FROM "ga4NumberPool" WHERE status = 'available'`);
  console.log(`GA4 numbers available: ${pool.rows[0].n}`);

  if (!apply) { console.log("\nDRY RUN — re-run with --apply to write."); process.exit(0); }

  const dir = join(process.cwd(), "scripts", ".cleanup-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `jobcard-decisions-${Date.now()}.json`);
  const lines: any = await db.execute(sql`
    SELECT * FROM "serviceLineItems"
    WHERE "documentId" IN (${sql.join([...toDelete, ...toBlank].map((d: any) => sql`${d.id}`), sql`, `)})`);
  writeFileSync(file, JSON.stringify({ toDelete, toBlank, lineItems: lines.rows }, null, 2));
  console.log(`\nBACKUP  ${file}\n`);

  for (const d of deletable) {
    await db.execute(sql`DELETE FROM "serviceLineItems" WHERE "documentId" = ${d.id}`);
    await db.execute(sql`DELETE FROM "serviceHistory" WHERE id = ${d.id}`);
    console.log(`  deleted  ${d.docNo}  ${d.registration}`);
  }

  for (const d of toBlank) {
    // Convert then issue: the invoice carries the car, the customer and the write-up at £0, so
    // the visit shows on their history with nothing to pay.
    const created: any = await convertDocument(d.id, "SI");
    const issued: any = await issueDocument(created.id);
    console.log(`  blank    ${d.docNo}  ${d.registration}  -> invoice ${created.id}  GA4 ${issued.ga4Number ?? "(pool empty)"}  ${issued.status}`);
  }

  const left: any = await db.execute(sql`
    SELECT COUNT(*) n FROM "serviceHistory" WHERE "docType" = 'JS' AND "dateCreated" < now() - interval '14 days'`);
  console.log(`\nOPEN > 14 DAYS NOW: ${left.rows[0].n}`);
  console.log(`STILL NEEDING GA4: ${mirrored.map((d: any) => d.docNo).join(", ")}`);
  process.exit(0);
}

main();
