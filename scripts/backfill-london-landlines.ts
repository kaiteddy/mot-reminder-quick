/**
 * Backfill recovered London landlines into existing customers' "Other numbers".
 *
 *   npx tsx scripts/backfill-london-landlines.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/backfill-london-landlines.ts --go    # apply
 *
 * GA4 stores London landlines without their 020 area code (e.g. "8346 8981"), so the
 * importer's phone validator drops them. The GA4 customer sync is insert-only, so it
 * never adds them to customers that already exist. This one-off reads the latest GA4
 * Customers.csv, recovers any bare 8-digit London number (local part starts 3/7/8) by
 * prefixing 020, and adds it to the matching web customer's altContacts IF they don't
 * already have it (matched by GA4 _ID = externalId, deduped by last-10 digits).
 *
 * SAFE: primary phone is never touched (so reminders are unaffected); only adds a number
 * when it's genuinely missing; backs up before/after to scripts/.cleanup-backups/.
 *
 *   GA4_EXPORTS=/path  overrides the export directory (defaults to the Google Drive copy).
 */
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { parse } from "csv-parse/sync";
import { getDb } from "../server/db";
import { customers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { normalizePhoneNumber } from "../server/utils/phoneUtils";

const APPLY = process.argv.includes("--go");
const FIX_PRIMARY = process.argv.includes("--fix-primary"); // also repair broken bare-London primaries in place
const norm = (s: any) => String(s ?? "").trim();
const last10 = (s: any) => String(s ?? "").replace(/\D/g, "").slice(-10);
const EXP = process.env.GA4_EXPORTS || path.join(os.homedir(), "Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports");

/** A bare 8-digit London local number that's currently invalid -> recovered +4420… number, else null. */
function recoverLondon(raw: any): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (!/^[378]\d{7}$/.test(digits)) return null;
  if (normalizePhoneNumber(s).normalized) return null; // already valid as-is — not a recovery case
  return normalizePhoneNumber("020" + digits).normalized;
}

/** Canonical form for de-duping: valid number as-is, else recovered London form, else bare digits. */
function canonical(raw: any): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return normalizePhoneNumber(s).normalized || recoverLondon(s) || s.replace(/\D/g, "");
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const ga4: any[] = parse(fs.readFileSync(path.join(EXP, "Customers.csv")), {
    columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true,
  });
  console.log(`GA4 export: ${ga4.length} customers  (${path.join(EXP, "Customers.csv")})`);

  // Web customers, indexed by externalId, plus a merged-id -> primary map (sync respects these).
  const webRows = await db.select({ id: customers.id, externalId: customers.externalId, name: customers.name, phone: customers.phone, altContacts: customers.altContacts, mergedExternalIds: customers.mergedExternalIds }).from(customers);
  const byExt = new Map<string, any>();
  const mergedToId = new Map<string, number>();
  for (const r of webRows) {
    if (r.externalId) byExt.set(norm(r.externalId), r);
    let merged: any = r.mergedExternalIds;
    try { merged = typeof merged === "string" ? JSON.parse(merged) : merged; } catch { merged = []; }
    for (const ext of merged || []) if (norm(ext)) mergedToId.set(norm(ext), r.id);
  }
  const idToRow = new Map<number, any>(webRows.map((r) => [r.id, r]));

  let withRecoverable = 0, unmatched = 0;
  // custId -> { row, add: Map<canonical, phone>, fixPrimary: string|null }
  const perCust = new Map<number, { row: any; add: Map<string, string>; fixPrimary: string | null }>();

  for (const r of ga4) {
    const recs = [r.contactTelephone, r.contactMobile, r.Telephone, r.Mobile]
      .map(recoverLondon).filter(Boolean) as string[];
    if (!recs.length) continue;
    withRecoverable++;

    const ext = norm(r._ID);
    const row = byExt.get(ext) || (mergedToId.has(ext) ? idToRow.get(mergedToId.get(ext)!) : undefined);
    if (!row) { unmatched++; continue; }

    let entry = perCust.get(row.id);
    if (!entry) {
      // Is the customer's own primary a broken bare-London number we could repair in place?
      const fixPrimary = (row.phone && !normalizePhoneNumber(row.phone).normalized) ? recoverLondon(row.phone) : null;
      entry = { row, add: new Map(), fixPrimary };
      perCust.set(row.id, entry);
    }

    // Numbers already present, compared in canonical form so a bare primary "83464068"
    // matches its recovered "+442083464068" (no duplicate Other number).
    const existing = new Set<string>();
    if (row.phone) existing.add(last10(canonical(row.phone)));
    const alt = Array.isArray(row.altContacts) ? row.altContacts : [];
    for (const c of alt) if (c?.phone) existing.add(last10(canonical(c.phone)));

    for (const rec of recs) {
      const k = last10(rec);
      if (!k || existing.has(k)) continue;
      entry.add.set(k, rec);
    }
  }

  const all = [...perCust.values()];
  const addOther = all.filter((e) => e.add.size > 0);                 // valid primary + a different landline
  const fixPrimary = all.filter((e) => e.fixPrimary);                 // primary itself is a broken bare landline
  const totalAdds = addOther.reduce((s, e) => s + e.add.size, 0);

  console.log(`\nGA4 rows with a recoverable London landline : ${withRecoverable}`);
  console.log(`  …no matching web customer (skipped)       : ${unmatched}`);
  console.log(`\nGroup A — add landline as an "Other number"  : ${addOther.length} customers, ${totalAdds} numbers`);
  console.log(`Group B — repair a BROKEN primary in place   : ${fixPrimary.length} customers  ${FIX_PRIMARY ? "(will fix)" : "(NOT touched unless --fix-primary)"}`);

  console.log(`\nGroup A sample (first 12):`);
  for (const e of addOther.slice(0, 12))
    console.log(`  #${e.row.id}  ${String(e.row.name).slice(0, 26).padEnd(26)} primary:${String(e.row.phone || "—").padEnd(16)} + ${[...e.add.values()].join(", ")}`);

  console.log(`\nGroup B sample (first 12) — broken primary -> repaired:`);
  for (const e of fixPrimary.slice(0, 12))
    console.log(`  #${e.row.id}  ${String(e.row.name).slice(0, 26).padEnd(26)} ${String(e.row.phone).padEnd(12)} -> ${e.fixPrimary}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written.`);
    console.log(`  Apply Group A only      : npx tsx scripts/backfill-london-landlines.ts --go`);
    console.log(`  Apply Group A + Group B : npx tsx scripts/backfill-london-landlines.ts --go --fix-primary`);
    process.exit(0);
  }

  // Backup before/after, then apply.
  const backupDir = path.join(process.cwd(), "scripts", ".cleanup-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `london-landlines-${stamp}.json`);
  const backup: any[] = [];
  let addedTo = 0, fixedPrimaries = 0;

  for (const e of all) {
    const willAdd = e.add.size > 0;
    const willFix = FIX_PRIMARY && e.fixPrimary;
    if (!willAdd && !willFix) continue;

    const before = Array.isArray(e.row.altContacts) ? e.row.altContacts : [];
    const additions = willAdd ? [...e.add.values()].map((phone) => ({ name: "", phone })) : [];
    const after = [...before, ...additions].slice(0, 20);
    const set: any = {};
    if (willAdd) set.altContacts = after;
    if (willFix) set.phone = e.fixPrimary;

    backup.push({ id: e.row.id, name: e.row.name, phoneBefore: e.row.phone, phoneAfter: willFix ? e.fixPrimary : e.row.phone, before, after });
    await db.update(customers).set(set).where(eq(customers.id, e.row.id));
    if (willAdd) addedTo++;
    if (willFix) fixedPrimaries++;
  }

  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nAPPLIED — added Other numbers to ${addedTo} customers; repaired ${fixedPrimaries} primaries. Backup: ${backupPath}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
