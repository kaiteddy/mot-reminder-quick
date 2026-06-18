/**
 * Clean customer phone fields where a contact NAME is mashed onto the number,
 * e.g. "07846653685MARIA" -> phone "+447846653685" + additional contact "Maria".
 *
 *   npx tsx scripts/clean-phone-names.ts          # DRY RUN — reports, writes nothing
 *   npx tsx scripts/clean-phone-names.ts --go     # apply (backs up every original first)
 *
 * Web app ONLY — never touches GA4 (one-way mirror). Keyed on customer id.
 * Existing customers are insert-only in the GA4 sync, so these fixes are never
 * overwritten by a future import.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";
import { normalizePhoneNumber } from "../server/utils/phoneUtils";
import { splitPhoneName, titleCase, last10, TITLES, LABELS } from "../server/services/contactCleanup";

const GO = process.argv.includes("--go");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
await c.connect();

// Candidates = phone field contains any letter (the "number+name" pattern).
const rows = (await c.query(
  `SELECT id, name, phone, "altContacts" FROM customers WHERE phone ~ '[A-Za-z]' ORDER BY id`
)).rows as { id: number; name: string | null; phone: string; altContacts: any }[];

// TITLES / LABELS / titleCase / last10 / splitPhoneName are imported from
// ../server/services/contactCleanup so this script and the GA4 importer share one rule.

type Plan = {
  id: number; name: string | null; oldPhone: string;
  newPhone: string | null; contactName: string | null;
  action: "clean+name" | "clean-only" | "name-only-title-record" | "needs-manual";
};

const plans: Plan[] = [];
for (const r of rows) {
  const split = splitPhoneName(r.phone);
  if (!split) { plans.push({ id: r.id, name: r.name, oldPhone: r.phone, newPhone: null, contactName: null, action: "needs-manual" }); continue; }

  const v = normalizePhoneNumber(split.num);
  if (!v.isValid || !v.normalized) { plans.push({ id: r.id, name: r.name, oldPhone: r.phone, newPhone: null, contactName: null, action: "needs-manual" }); continue; }

  const newPhone = v.normalized;
  const nameLc = split.alpha.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const custLc = (r.name || "").toLowerCase();
  const custIsBareTitle = TITLES.has(custLc.replace(/[^a-z]/g, ""));

  if (!nameLc || TITLES.has(nameLc) || LABELS.has(nameLc) || nameLc.length < 2) {
    plans.push({ id: r.id, name: r.name, oldPhone: r.phone, newPhone, contactName: null, action: "clean-only" });
  } else if (custLc.includes(nameLc)) {
    plans.push({ id: r.id, name: r.name, oldPhone: r.phone, newPhone, contactName: null, action: "clean-only" }); // name already on record
  } else if (custIsBareTitle) {
    // customer.name is just "Mr"/"Mrs" and the real name is in the phone — flag, don't guess
    plans.push({ id: r.id, name: r.name, oldPhone: r.phone, newPhone, contactName: titleCase(split.alpha), action: "name-only-title-record" });
  } else {
    plans.push({ id: r.id, name: r.name, oldPhone: r.phone, newPhone, contactName: titleCase(split.alpha), action: "clean+name" });
  }
}

const by = (a: Plan["action"]) => plans.filter((p) => p.action === a);
console.log(`\n===== PHONE "number+name" CLEANUP ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
console.log(`candidates (phone contains letters): ${rows.length}\n`);
console.log(`  clean number + save appended name as a contact:  ${by("clean+name").length}`);
console.log(`  clean number only (name was redundant/a title):  ${by("clean-only").length}`);
console.log(`  record name is just a title — appended text looks like the REAL name (review): ${by("name-only-title-record").length}`);
console.log(`  couldn't parse a valid number (needs manual):    ${by("needs-manual").length}`);

const show = (title: string, list: Plan[]) => {
  if (!list.length) return;
  console.log(`\n${title} (first 15):`);
  for (const p of list.slice(0, 15)) {
    if (p.action === "needs-manual") console.log(`  #${p.id} [MANUAL] name=${JSON.stringify(p.name)} phone=${JSON.stringify(p.oldPhone)}`);
    else console.log(`  #${p.id} ${JSON.stringify(p.oldPhone)} -> ${p.newPhone}${p.contactName ? `  + contact "${p.contactName}"` : ""}${p.action === "name-only-title-record" ? `   (record name = ${JSON.stringify(p.name)})` : ""}`);
  }
};
show("CLEAN + SAVE NAME", by("clean+name"));
show("CLEAN ONLY", by("clean-only"));
show("REVIEW — bare-title records", by("name-only-title-record"));
show("NEEDS MANUAL", by("needs-manual"));

if (GO) {
  const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `clean-phone-names-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`\nbacked up ${rows.length} originals -> ${file}`);

  let phones = 0, names = 0;
  for (const p of plans) {
    if (!p.newPhone || p.action === "needs-manual") continue;
    if (p.contactName) {
      const orig = rows.find((r) => r.id === p.id)!;
      const existing = Array.isArray(orig.altContacts) ? orig.altContacts : [];
      const dup = existing.some((x: any) => last10(String(x?.phone || "")) === last10(p.newPhone!));
      const alt = dup ? existing : [...existing, { name: p.contactName, phone: p.newPhone }];
      await c.query(`UPDATE customers SET phone=$1, "altContacts"=$2 WHERE id=$3`, [p.newPhone, JSON.stringify(alt), p.id]);
      names++;
    } else {
      await c.query(`UPDATE customers SET phone=$1 WHERE id=$2`, [p.newPhone, p.id]);
    }
    phones++;
  }
  console.log(`\n✓ applied: ${phones} phones cleaned, ${names} contact names saved.`);
} else {
  console.log(`\nDry run only — re-run with --go to apply (every original is backed up to scripts/.cleanup-backups/ first).`);
}

await c.end();
process.exit(0);
