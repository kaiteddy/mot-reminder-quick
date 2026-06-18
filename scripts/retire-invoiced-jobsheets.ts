/**
 * Transition helper: retire web-created JOB SHEETS that have since been INVOICED in GA4,
 * so the web app stays clean while GA4 + web run in parallel.
 *
 *   npx tsx scripts/retire-invoiced-jobsheets.ts         # DRY RUN — reports, writes nothing
 *   npx tsx scripts/retire-invoiced-jobsheets.ts --go    # delete matches (backs up each first)
 *
 * Also runs automatically as the last step of scripts/sync-ga4.ts (dry-run / --go follow the sync).
 *
 * Match rule: a web job sheet (docType JS, externalId WEB-%) is superseded if GA4 has an
 * INVOICE (docType SI, GA4-sourced) for the SAME registration dated on/after the job sheet
 * was opened. Never touches GA4 docs/invoices. Job sheets that carry receipts are SKIPPED
 * (flagged for manual handling) — we never auto-delete a doc with money attached.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const norm = (r: any) => String(r || "").replace(/\s+/g, "").toUpperCase();
const money = (v: any) => (v == null ? "-" : `£${Number(v).toFixed(2)}`);
const d = (x: any) => (x ? new Date(x).toISOString().slice(0, 10) : "—");

export async function retireInvoicedJobSheets(c: pg.Client, apply: boolean, backupDir: string) {
  const webJS = (await c.query(
    `SELECT * FROM "serviceHistory" WHERE "docType"='JS' AND "externalId" LIKE 'WEB-%'`
  )).rows as any[];
  const ga4Inv = (await c.query(
    `SELECT id, registration, COALESCE("dateIssued","dateCreated") AS d, "docNo", "docStatus", "totalGross"
       FROM "serviceHistory" WHERE "docType"='SI' AND ("externalId" NOT LIKE 'WEB-%' OR "externalId" IS NULL)`
  )).rows as any[];

  const invByReg = new Map<string, any[]>();
  for (const inv of ga4Inv) { const k = norm(inv.registration); if (!k) continue; (invByReg.get(k) || invByReg.set(k, []).get(k))!.push(inv); }

  const matched: { js: any; inv: any }[] = [];
  let regOnlyKept = 0, noInvoiceKept = 0;
  for (const js of webJS) {
    const cands = invByReg.get(norm(js.registration)) || [];
    if (!cands.length) { noInvoiceKept++; continue; }
    const onAfter = js.dateCreated ? cands.filter((i) => i.d && new Date(i.d) >= new Date(js.dateCreated)) : [];
    if (!onAfter.length) { regOnlyKept++; continue; }
    onAfter.sort((a, b) => +new Date(a.d) - +new Date(b.d));
    matched.push({ js, inv: onAfter[0] });
  }

  // Never auto-delete a job sheet with receipts — skip + flag those.
  const withPayments = new Set<number>();
  if (matched.length) {
    const ids = matched.map((m) => m.js.id); const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    for (const r of (await c.query(`SELECT DISTINCT "documentId" FROM payments WHERE "documentId" IN (${ph})`, ids)).rows) withPayments.add(r.documentId);
  }
  const toDelete = matched.filter((m) => !withPayments.has(m.js.id));
  const skipped = matched.filter((m) => withPayments.has(m.js.id));

  console.log(`\n===== RETIRE INVOICED JOB SHEETS ${apply ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`web-created job sheets (JS, WEB-%):           ${webJS.length}`);
  console.log(`  superseded by a GA4 invoice (on/after):     ${matched.length}`);
  console.log(`    → will delete (no receipts):              ${toDelete.length}`);
  console.log(`    → SKIPPED, has receipts (handle manual):  ${skipped.length}`);
  console.log(`  reg matches but invoice pre-dates JS (kept): ${regOnlyKept}`);
  console.log(`  no GA4 invoice for that reg (kept):          ${noInvoiceKept}`);
  for (const m of toDelete.slice(0, 25))
    console.log(`  ${apply ? "DELETE" : "would delete"} JS #${m.js.id} ${norm(m.js.registration)} (${d(m.js.dateCreated)}, ${money(m.js.totalGross)}) → GA4 invoice ${m.inv.docNo} ${d(m.inv.d)} ${money(m.inv.totalGross)}`);
  for (const m of skipped.slice(0, 25))
    console.log(`  ⚠ SKIP JS #${m.js.id} ${norm(m.js.registration)} — has receipts; superseded by invoice ${m.inv.docNo}`);

  if (apply && toDelete.length) {
    const ids = toDelete.map((m) => m.js.id);
    // back up full doc + its line items first
    const backup: any[] = [];
    for (const m of toDelete) {
      const li = (await c.query(`SELECT * FROM "serviceLineItems" WHERE "documentId"=$1`, [m.js.id])).rows;
      backup.push({ doc: m.js, lineItems: li, supersededBy: { id: m.inv.id, docNo: m.inv.docNo, date: m.inv.d } });
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `retire-jobsheets-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    // delete in a transaction, mirroring deleteDocuments() (line items, dangling links, then the doc)
    const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    await c.query("BEGIN");
    await c.query(`DELETE FROM "serviceLineItems" WHERE "documentId" IN (${ph})`, ids);
    await c.query(`UPDATE "serviceHistory" SET "relatedDocId"=NULL, "relatedDocNo"=NULL WHERE "relatedDocId" IN (${ph})`, ids);
    await c.query(`DELETE FROM "serviceHistory" WHERE id IN (${ph})`, ids);
    await c.query("COMMIT");
    console.log(`\n✓ deleted ${ids.length} job sheet(s); backed up to ${file}`);
  } else if (!apply) {
    console.log(`\nDry run only — re-run with --go to delete (each is backed up to scripts/.cleanup-backups/ first).`);
  }
  return { webJS: webJS.length, matched: matched.length, deleted: apply ? toDelete.length : 0, skipped: skipped.length };
}

// CLI entry — only when run directly (not when imported by sync-ga4.ts)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await c.connect();
  await retireInvoicedJobSheets(c, process.argv.includes("--go"), path.join(process.cwd(), "scripts", ".cleanup-backups"));
  await c.end();
  process.exit(0);
}
