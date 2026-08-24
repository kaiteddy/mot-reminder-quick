/**
 * Cleanup: decode GA4's embedded reg-change annotation ("M10HAK*(10/07/2019)") into a clean,
 * non-colliding registration, and cross-reference the current holder of that plate if we have one.
 *
 *   npx tsx scripts/decode-reg-change-annotations.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/decode-reg-change-annotations.ts --go   # apply (backs up each row first)
 *
 * Also runs automatically as a step of scripts/sync-ga4.ts, so future occurrences (a plate that
 * gets reassigned tomorrow will presumably get the same GA4 annotation) keep getting cleaned up
 * without anyone needing to remember to run this by hand.
 *
 * Root cause: for some retired/superseded vehicle records, GA4's own CSV export puts the reg's
 * change date directly in the Registration field itself (`{reg}*({DD/MM/YYYY})`) instead of using
 * the dedicated VRM_Change columns it uses elsewhere — see [[registration-reuse-across-vehicles]]
 * for the S3OCT/Ford Fiesta case this same pattern produced. It reads like a bad import ("there's
 * already a clean M10HAK, why does this other one look broken?") but it's real GA4 data: this IS
 * a genuinely different, older vehicle that held the plate before it moved on.
 *
 * Match rule: registration matches `{base}*({DD/MM/YYYY})` (optionally with a trailing stray `*`
 * seen on a couple of rows). Renames to the compact `{base} ({DD/MM/YY})` form (fits the 20-char
 * column even for a 7-character plate), falling back to a `#2`/`#3` suffix on the rare chance that
 * collides too. Never touches serviceHistory — its own `registration` text is untouched, so old
 * invoices keep reading exactly as they did. If a clean, currently-held version of the same plate
 * exists as a separate vehicle row, notes are added on BOTH records cross-referencing each other.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const PATTERN = /^(.+?)\*\((\d{2})\/(\d{2})\/(\d{4})\)\*?$/;

export async function decodeRegChangeAnnotations(c: pg.Client, apply: boolean, backupDir: string) {
  const rows = (await c.query(`SELECT id, registration, make, model, vin, "customerId" FROM vehicles WHERE registration LIKE '%*(%'`)).rows as any[];
  const parsed = rows
    .map((r) => { const m = r.registration.match(PATTERN); return m ? { ...r, base: m[1].toUpperCase().replace(/\s+/g, ""), dd: m[2], mm: m[3], yyyy: m[4] } : null; })
    .filter(Boolean) as any[];

  console.log(`\n===== DECODE REG-CHANGE ANNOTATIONS ${apply ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`Vehicles with an embedded change-date annotation: ${parsed.length}`);

  const backup: any[] = [];
  for (const v of parsed) {
    const yy = v.yyyy.slice(2);
    const wantReg = `${v.base} (${v.dd}/${v.mm}/${yy})`.slice(0, 20);
    const current = (await c.query(
      `SELECT id, make, model, vin FROM vehicles WHERE REPLACE(UPPER(registration), ' ', '') = $1 AND id <> $2`,
      [v.base, v.id]
    )).rows[0];
    // Same VIN as the "current holder" means this isn't a reused plate at all — it's the same
    // physical car duplicated across a customer/ownership change (see the duplicate-customer
    // pattern this session already found for Meshulam/Hakkimian). Framing it as "a different
    // vehicle held this" would be factually wrong, so these get a distinct, honest note instead.
    const sameVehicle = !!(current?.vin && v.vin && String(current.vin).toLowerCase() === String(v.vin).toLowerCase());

    console.log(`  ${apply ? "RENAME" : "would rename"} #${v.id} "${v.registration}" -> "${wantReg}"`
      + (current ? (sameVehicle ? ` (SAME VEHICLE as #${current.id} — matching VIN, likely a duplicate record)` : ` (current holder: #${current.id} ${current.make} ${current.model})`) : " (no current clean holder on file)"));
    if (!apply) continue;

    let finalReg = wantReg, suffix = 1;
    while ((await c.query(`SELECT 1 FROM vehicles WHERE registration = $1 AND id <> $2`, [finalReg, v.id])).rows.length) {
      suffix++;
      finalReg = `${wantReg.slice(0, 20 - String(suffix).length - 1)}#${suffix}`;
    }

    const changeDate = `${v.dd}/${v.mm}/${v.yyyy}`;
    const note = sameVehicle
      ? `This record shares its VIN with vehicle #${current.id} (${current.make} ${current.model}) — it's the SAME physical car, not a different one, likely duplicated across a customer change around ${changeDate}. Not auto-merged (that needs a human decision, like the Meshulam/Hakkimian duplicate-customer cases). Reg text decoded from GA4's own embedded annotation ("${v.registration}") ${new Date().toISOString().slice(0, 10)}.`
      : `Registration ${v.base} was reassigned to a different vehicle on ${changeDate}`
        + (current ? ` (vehicle #${current.id}, ${current.make} ${current.model})` : "")
        + `. This record is the earlier vehicle that held it — decoded from GA4's own embedded change-date annotation ("${v.registration}"). Cleaned up ${new Date().toISOString().slice(0, 10)}.`;
    backup.push({ before: v, after: finalReg, sameVehicle });
    await c.query(`UPDATE vehicles SET registration = $1, notes = COALESCE(notes || E'\n\n', '') || $2 WHERE id = $3`, [finalReg, note, v.id]);

    if (current && !sameVehicle) {
      const xnote = `Registration ${v.base} was previously held by a different vehicle (vehicle #${v.id}, ${v.make} ${v.model}) until ${changeDate}. Noted ${new Date().toISOString().slice(0, 10)}.`;
      await c.query(`UPDATE vehicles SET notes = COALESCE(notes || E'\n\n', '') || $1 WHERE id = $2`, [xnote, current.id]);
    } else if (current && sameVehicle) {
      const xnote = `This record shares its VIN with vehicle #${v.id} — the SAME physical car recorded twice (see that record's notes for detail), not a different vehicle. Noted ${new Date().toISOString().slice(0, 10)}.`;
      await c.query(`UPDATE vehicles SET notes = COALESCE(notes || E'\n\n', '') || $1 WHERE id = $2`, [xnote, current.id]);
    }
  }

  if (apply && backup.length) {
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `decode-reg-change-annotations-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ cleaned up ${backup.length} vehicle(s); backed up to ${file}`);
  } else if (!apply && parsed.length) {
    console.log(`\nDry run only — re-run with --go to apply (each is backed up to scripts/.cleanup-backups/ first).`);
  }
  return { found: parsed.length, cleaned: apply ? backup.length : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await c.connect();
  await decodeRegChangeAnnotations(c, process.argv.includes("--go"), path.join(process.cwd(), "scripts", ".cleanup-backups"));
  await c.end();
  process.exit(0);
}
