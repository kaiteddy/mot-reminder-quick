/**
 * Cleanup: archive estimates (docType "ES") older than 3 months so they stop cluttering the
 * live Estimates tab — a quote nobody's actioned in that long is effectively dead. Soft/reversible:
 * sets serviceHistory.archived=1 + archivedAt, never deletes. Documents.tsx's "Archive" tab shows
 * archived docs; documents.unarchive (server/db.ts) restores one if archived by mistake.
 *
 *   npx tsx scripts/archive-old-estimates.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/archive-old-estimates.ts --go   # apply (backs up each row first)
 *
 * Also runs automatically as a step of scripts/sync-ga4.ts, so any estimate that ages past
 * 3 months keeps getting archived on its own — no one has to remember to run this.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const STALE_MONTHS = 3;

export async function archiveOldEstimates(c: pg.Client, apply: boolean, backupDir: string) {
  const candidates = (await c.query(`
    SELECT id, "docNo", "ga4Number", registration, "customerName", "totalGross",
           COALESCE("dateIssued", "dateCreated") AS "effectiveDate"
    FROM "serviceHistory"
    WHERE "docType" = 'ES'
      AND (archived IS NULL OR archived = 0)
      AND COALESCE("dateIssued", "dateCreated") < now() - interval '${STALE_MONTHS} months'
    ORDER BY COALESCE("dateIssued", "dateCreated") ASC
  `)).rows as any[];

  console.log(`\n===== ARCHIVE OLD ESTIMATES ${apply ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`Estimates older than ${STALE_MONTHS} months, not yet archived: ${candidates.length}`);

  const backup: any[] = [];
  for (const d of candidates) {
    const label = d.ga4Number || d.docNo || d.id;
    console.log(`  ${apply ? "ARCHIVE" : "would archive"} ${label} — ${d.registration || "no reg"} — ${d.customerName || "unknown"} — ${d.effectiveDate ? new Date(d.effectiveDate).toISOString().slice(0, 10) : "undated"}`);
    if (!apply) continue;
    backup.push({ before: d });
    await c.query(`UPDATE "serviceHistory" SET archived = 1, "archivedAt" = now() WHERE id = $1`, [d.id]);
  }

  if (apply && backup.length) {
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `archive-old-estimates-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ archived ${backup.length} estimate(s); backed up to ${file}`);
  } else if (!apply && candidates.length) {
    console.log(`\nDry run only — re-run with --go to archive (each is backed up to scripts/.cleanup-backups/ first).`);
  }
  return { candidates: candidates.length, archived: apply ? backup.length : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await c.connect();
  await archiveOldEstimates(c, process.argv.includes("--go"), path.join(process.cwd(), "scripts", ".cleanup-backups"));
  await c.end();
  process.exit(0);
}
