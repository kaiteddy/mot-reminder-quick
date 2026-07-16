/**
 * Transition helper: retire web-created INVOICES once their real GA4 invoice has
 * been imported, so the same invoice isn't recorded twice while GA4 + web run in
 * parallel.
 *
 *   npx tsx scripts/retire-superseded-web-invoices.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/retire-superseded-web-invoices.ts --go   # delete matches (backs up each first)
 *
 * Also runs automatically as a step of scripts/sync-ga4.ts (dry-run / --go follow the sync).
 *
 * Match rule: a web invoice (docType SI, externalId WEB-%) is a duplicate once GA4 has an
 * invoice (docType SI, GA4-sourced) whose docNo equals the web doc's `ga4Number` — i.e. the
 * real number the web app was assigned when the invoice was issued in GA4 — AND the same
 * registration AND the same total (within a penny of rounding). We match on ga4Number, NOT
 * the web doc's own `docNo`, because that is only a guess-ahead placeholder and collides with
 * unrelated GA4 numbers. Never touches GA4 docs. A web copy that carries a payment is SKIPPED
 * and flagged (we never auto-delete a doc with money attached — re-point the payment first).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const norm = (r: any) => String(r || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const money = (v: any) => (v == null ? "-" : `£${Number(v).toFixed(2)}`);
const TOL = 0.02; // total tolerance (pence-level VAT rounding between web and GA4)

export async function retireSupersededWebInvoices(c: pg.Client, apply: boolean, backupDir: string) {
  const webSI = (await c.query(
    `SELECT * FROM "serviceHistory" WHERE "docType"='SI' AND "externalId" LIKE 'WEB-%' AND "ga4Number" IS NOT NULL`
  )).rows as any[];
  const ga4Inv = (await c.query(
    `SELECT id, "docNo", registration, "totalGross" FROM "serviceHistory"
       WHERE "docType"='SI' AND ("externalId" NOT LIKE 'WEB-%' OR "externalId" IS NULL) AND "docNo" IS NOT NULL`
  )).rows as any[];
  const ga4ByNo = new Map<string, any>();
  for (const g of ga4Inv) ga4ByNo.set(String(g.docNo), g); // docNo is unique per issued GA4 invoice

  const matched: { web: any; ga4: any }[] = [];
  let notImportedYet = 0, mismatchFlag: { web: any; ga4: any }[] = [];
  for (const w of webSI) {
    const g = ga4ByNo.get(String(w.ga4Number));
    if (!g) { notImportedYet++; continue; }                                  // GA4 hasn't imported it yet — keep
    const sameReg = norm(w.registration) === norm(g.registration);
    const sameTotal = Math.abs(Number(w.totalGross || 0) - Number(g.totalGross || 0)) < TOL;
    if (sameReg && sameTotal) matched.push({ web: w, ga4: g });
    else mismatchFlag.push({ web: w, ga4: g });                              // ga4Number matches but reg/total differs — DON'T auto-delete
  }

  const withPayments = new Set<number>();
  if (matched.length) {
    const ids = matched.map((m) => m.web.id); const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    for (const r of (await c.query(`SELECT DISTINCT "documentId" FROM payments WHERE "documentId" IN (${ph})`, ids)).rows) withPayments.add(r.documentId);
  }
  const toDelete = matched.filter((m) => !withPayments.has(m.web.id));
  const skipped = matched.filter((m) => withPayments.has(m.web.id));

  console.log(`\n===== RETIRE SUPERSEDED WEB INVOICES ${apply ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`web-created invoices with a GA4 number (SI, WEB-%):  ${webSI.length}`);
  console.log(`  GA4 original imported + reg & total match:         ${matched.length}`);
  console.log(`    → will delete (no payment):                      ${toDelete.length}`);
  console.log(`    → SKIPPED, has payment (re-point first):         ${skipped.length}`);
  console.log(`  ga4Number matches but reg/total differ (kept):     ${mismatchFlag.length}`);
  console.log(`  GA4 original not imported yet (kept):              ${notImportedYet}`);
  for (const m of toDelete.slice(0, 30))
    console.log(`  ${apply ? "DELETE" : "would delete"} web SI #${m.web.id} ${norm(m.web.registration)} ${money(m.web.totalGross)} (docNo ${m.web.docNo}) → GA4 invoice ${m.ga4.docNo}`);
  for (const m of skipped)
    console.log(`  ⚠ SKIP web SI #${m.web.id} ${norm(m.web.registration)} — has a payment; superseded by GA4 invoice ${m.ga4.docNo}`);
  for (const m of mismatchFlag)
    console.log(`  ⚠ REVIEW web SI #${m.web.id} ${norm(m.web.registration)} ${money(m.web.totalGross)} vs GA4 ${m.ga4.docNo} ${norm(m.ga4.registration)} ${money(m.ga4.totalGross)}`);

  if (apply && toDelete.length) {
    const ids = toDelete.map((m) => m.web.id);
    const backup: any[] = [];
    for (const m of toDelete) {
      const li = (await c.query(`SELECT * FROM "serviceLineItems" WHERE "documentId"=$1`, [m.web.id])).rows;
      backup.push({ doc: m.web, lineItems: li, supersededBy: { id: m.ga4.id, docNo: m.ga4.docNo } });
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `retire-web-invoices-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    await c.query("BEGIN");
    await c.query(`DELETE FROM "serviceLineItems" WHERE "documentId" IN (${ph})`, ids);
    await c.query(`UPDATE "serviceHistory" SET "relatedDocId"=NULL, "relatedDocNo"=NULL WHERE "relatedDocId" IN (${ph})`, ids);
    await c.query(`DELETE FROM "serviceHistory" WHERE id IN (${ph})`, ids);
    await c.query("COMMIT");
    console.log(`\n✓ deleted ${ids.length} superseded web invoice(s); backed up to ${file}`);
  } else if (!apply) {
    console.log(`\nDry run only — re-run with --go to delete (each is backed up to scripts/.cleanup-backups/ first).`);
  }
  return { webSI: webSI.length, matched: matched.length, deleted: apply ? toDelete.length : 0, skipped: skipped.length, review: mismatchFlag.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await c.connect();
  await retireSupersededWebInvoices(c, process.argv.includes("--go"), path.join(process.cwd(), "scripts", ".cleanup-backups"));
  await c.end();
  process.exit(0);
}
