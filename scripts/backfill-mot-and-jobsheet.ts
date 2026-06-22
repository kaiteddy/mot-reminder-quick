/**
 * Backfill motStatus / motClass / origJobSheetNo onto existing GA4 documents from the
 * latest export. The GA4 sync didn't previously import these, and its change-detector
 * won't pick them up, so this one-off fills them in (matched on externalId = GA4 _ID).
 *
 *   npx tsx scripts/backfill-mot-and-jobsheet.ts         # DRY RUN
 *   npx tsx scripts/backfill-mot-and-jobsheet.ts --go     # apply
 *
 *   GA4_EXPORTS=/path  overrides the export directory.
 */
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { parse } from "csv-parse/sync";
import { getDb } from "../server/db";
import { serviceHistory } from "../drizzle/schema";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--go");
const norm = (s: any) => String(s ?? "").trim();
const EXP = process.env.GA4_EXPORTS || path.join(os.homedir(), "Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports");

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const rows: any[] = parse(fs.readFileSync(path.join(EXP, "Documents.csv")), {
    columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true,
  });
  // _ID -> { motStatus, motClass, origJS }
  const want = new Map<string, { motStatus: string | null; motClass: string | null; origJS: number | null }>();
  for (const r of rows) {
    const ext = norm(r._ID);
    if (!ext) continue;
    const ojs = parseInt(norm(r.docNumber_Orig_JS).replace(/\D/g, ""), 10);
    want.set(ext, {
      motStatus: norm(r.motStatus) || null,
      motClass: norm(r.motClass) || null,
      origJS: Number.isFinite(ojs) && ojs > 0 ? ojs : null,
    });
  }
  console.log(`GA4 export: ${rows.length} documents (${path.join(EXP, "Documents.csv")})`);

  const web = await db.select({ id: serviceHistory.id, externalId: serviceHistory.externalId, docType: serviceHistory.docType, docNo: serviceHistory.docNo, motStatus: serviceHistory.motStatus, motClass: serviceHistory.motClass, origJobSheetNo: serviceHistory.origJobSheetNo }).from(serviceHistory);

  // Each update carries the desired value (or null = leave unchanged) for all three fields,
  // so the bulk UPDATE can COALESCE and never clobber an existing value with null.
  const updates: { id: number; docNo: any; origJS: number | null; motStatus: string | null; motClass: string | null }[] = [];
  for (const row of web) {
    if (!row.externalId) continue;
    const w = want.get(norm(row.externalId));
    if (!w) continue;
    const motStatus = w.motStatus && norm(row.motStatus) !== w.motStatus ? w.motStatus : null;
    const motClass = w.motClass && norm(row.motClass) !== w.motClass ? w.motClass : null;
    const origJS = w.origJS && row.origJobSheetNo !== w.origJS ? w.origJS : null;
    if (motStatus || motClass || origJS) updates.push({ id: row.id, docNo: row.docNo, origJS, motStatus, motClass });
  }

  const withMot = updates.filter((u) => u.motStatus).length;
  const withJS = updates.filter((u) => u.origJS).length;
  console.log(`\nDocuments to update : ${updates.length}`);
  console.log(`  …with MOT status   : ${withMot}`);
  console.log(`  …with job-sheet link: ${withJS}`);
  console.log(`\nSample (first 12):`);
  for (const u of updates.slice(0, 12)) {
    console.log(`  #${u.docNo}  ${JSON.stringify({ origJobSheetNo: u.origJS, motStatus: u.motStatus, motClass: u.motClass })}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --go to apply.`);
    process.exit(0);
  }

  // Bulk UPDATE in chunks via a VALUES join (parameterised) — far fewer round-trips than per-row.
  const CHUNK = 500;
  let applied = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const values = sql.join(chunk.map((u) => sql`(${u.id}::int, ${u.origJS}::int, ${u.motStatus}::text, ${u.motClass}::text)`), sql`, `);
    await db.execute(sql`
      UPDATE "serviceHistory" AS s SET
        "origJobSheetNo" = COALESCE(v.ojs, s."origJobSheetNo"),
        "motStatus" = COALESCE(v.ms, s."motStatus"),
        "motClass" = COALESCE(v.mc, s."motClass")
      FROM (VALUES ${values}) AS v(id, ojs, ms, mc)
      WHERE s.id = v.id
    `);
    applied += chunk.length;
    if (i % (CHUNK * 10) === 0) console.log(`  …${applied}/${updates.length}`);
  }
  console.log(`\nAPPLIED to ${applied} documents.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
