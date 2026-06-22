/**
 * Backfill serviceHistory.description from Document_Extras ("Labour Description" + docNotes),
 * keyed on externalId (GA4 _ID). Only fills documents whose description is currently empty —
 * never overwrites an existing narrative. The main sync didn't import these for newer docs,
 * which left invoices like #90571/#90560 blank even though GA4 has the work narrative.
 *
 *   npx tsx scripts/backfill-descriptions.ts         # DRY RUN
 *   npx tsx scripts/backfill-descriptions.ts --go     # apply
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
const clean = (s: any) => String(s ?? "").replace(/\x0B/g, "\n").replace(/\r/g, "").trim(); // GA4 vertical-tab -> newline
const EXP = process.env.GA4_EXPORTS || path.join(os.homedir(), "Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports");

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const rows: any[] = parse(fs.readFileSync(path.join(EXP, "Document_Extras.csv")), {
    columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true,
  });
  const descById = new Map<string, string>();
  for (const e of rows) {
    const desc = clean([e["Labour Description"], e["docNotes"]].filter(Boolean).join("\n")).slice(0, 65000);
    if (norm(e["_ID"]) && desc) descById.set(norm(e["_ID"]), desc);
  }
  console.log(`Document_Extras: ${rows.length} rows, ${descById.size} with narrative text`);

  const web = await db.select({ id: serviceHistory.id, externalId: serviceHistory.externalId, docNo: serviceHistory.docNo, description: serviceHistory.description }).from(serviceHistory);

  const updates: { id: number; docNo: any; description: string }[] = [];
  for (const row of web) {
    if (!row.externalId) continue;
    if (norm(row.description)) continue; // only fill blanks
    const d = descById.get(norm(row.externalId));
    if (d) updates.push({ id: row.id, docNo: row.docNo, description: d });
  }

  console.log(`\nDocuments to fill with a narrative: ${updates.length}`);
  console.log(`\nSample (first 8):`);
  for (const u of updates.slice(0, 8)) {
    console.log(`  #${u.docNo}: ${u.description.replace(/\n/g, " / ").slice(0, 90)}…`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --go to apply.`);
    process.exit(0);
  }

  const CHUNK = 500;
  let applied = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const values = sql.join(chunk.map((u) => sql`(${u.id}::int, ${u.description}::text)`), sql`, `);
    await db.execute(sql`
      UPDATE "serviceHistory" AS s SET "description" = v.d
      FROM (VALUES ${values}) AS v(id, d)
      WHERE s.id = v.id
    `);
    applied += chunk.length;
    if (i % (CHUNK * 10) === 0) console.log(`  …${applied}/${updates.length}`);
  }
  console.log(`\nAPPLIED to ${applied} documents.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
