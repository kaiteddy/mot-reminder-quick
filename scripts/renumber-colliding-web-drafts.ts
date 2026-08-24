/**
 * Transition helper: renumber web-created documents whose docNo collides with an
 * unrelated GA4-sourced document that has since synced in under the same number.
 *
 *   npx tsx scripts/renumber-colliding-web-drafts.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/renumber-colliding-web-drafts.ts --go   # apply
 *
 * Also runs automatically as the last step of scripts/sync-ga4.ts, after
 * retireSupersededWebInvoices (which handles the case where the web doc IS the same job,
 * later re-keyed into GA4 for real — that one gets deleted, not renumbered). What's left
 * after that pass is genuine number collisions: getNextDocNo() reserves numbers ahead of
 * GA4 based on what it can see, but GA4 mints its own numbers independently, so a web draft
 * can land on a number GA4 later uses for a *completely unrelated* job (different reg,
 * customer, total). Renaming, not deleting: the web doc is real, unrelated work, so it's
 * never safe to remove — it just needs a docNo GA4 hasn't already claimed. GA4 keeps its
 * number; it's always the authority once a real doc exists under a given number.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const money = (v: any) => (v == null ? "-" : `£${Number(v).toFixed(2)}`);

export async function renumberCollidingWebDrafts(c: pg.Client, apply: boolean, backupDir: string) {
  const collisions = (await c.query(`
    SELECT w.id AS web_id, w."docNo", w."docType", w.registration AS web_reg, w."totalGross" AS web_total,
           g.id AS ga4_id, g.registration AS ga4_reg, g."totalGross" AS ga4_total
    FROM "serviceHistory" w
    JOIN "serviceHistory" g
      ON g."docType" = w."docType" AND g."docNo" = w."docNo" AND g.id <> w.id
     AND (g."externalId" IS NULL OR g."externalId" NOT LIKE 'WEB-%')
    WHERE w."externalId" LIKE 'WEB-%'
  `)).rows as any[];

  console.log(`\n===== RENUMBER COLLIDING WEB DRAFTS ${apply ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`docNo collisions between a web draft and a real GA4 doc: ${collisions.length}`);

  const backup: any[] = [];
  for (const col of collisions) {
    console.log(`  ${apply ? "RENUMBER" : "would renumber"} web ${col.docType} #${col.web_id} (${col.web_reg}, ${money(col.web_total)}) off docNo ${col.docNo} — taken by GA4 doc #${col.ga4_id} (${col.ga4_reg}, ${money(col.ga4_total)})`);
    if (!apply) continue;

    // Pick a fresh number above every known number for this docType (web + GA4), then
    // double-check it's actually clear (same collision-avoidance loop as getNextDocNo).
    const maxRow = (await c.query(`
      SELECT MAX((NULLIF(regexp_replace("docNo", '[^0-9]', '', 'g'), ''))::bigint) AS m
      FROM "serviceHistory" WHERE "docType" = $1`, [col.docType])).rows[0];
    let next = (Number(maxRow?.m) || 0) + 1;
    for (;;) {
      const taken = await c.query(
        `SELECT 1 FROM "serviceHistory" WHERE "docNo" = $1 OR "ga4Number" = $1
         UNION SELECT 1 FROM "ga4NumberPool" WHERE "ga4Number" = $1`,
        [String(next)]
      );
      if (!taken.rows.length) break;
      next++;
    }

    const before = (await c.query(`SELECT * FROM "serviceHistory" WHERE id = $1`, [col.web_id])).rows[0];
    backup.push({ before, renumberedTo: String(next), collidedWith: { id: col.ga4_id, docNo: col.docNo } });
    await c.query(`UPDATE "serviceHistory" SET "docNo" = $1 WHERE id = $2`, [String(next), col.web_id]);
    console.log(`    -> web #${col.web_id} is now docNo ${next}`);
  }

  if (apply && backup.length) {
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `renumber-web-drafts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ renumbered ${backup.length} colliding web draft(s); backed up to ${file}`);
  } else if (!apply && collisions.length) {
    console.log(`\nDry run only — re-run with --go to renumber (each is backed up to scripts/.cleanup-backups/ first).`);
  }
  return { collisions: collisions.length, renumbered: apply ? backup.length : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await c.connect();
  await renumberCollidingWebDrafts(c, process.argv.includes("--go"), path.join(process.cwd(), "scripts", ".cleanup-backups"));
  await c.end();
  process.exit(0);
}
