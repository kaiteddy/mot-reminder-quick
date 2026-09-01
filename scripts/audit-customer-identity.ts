/**
 * audit-customer-identity.ts — find web customers wearing the wrong person's name.
 *
 * The webapp fuses two customers who merely share a phone number, keeping one person's NAME on
 * the other's account (see the Berry/Segal and Shah/Rosenfelder repairs). GA4 is authoritative
 * for customer identity, so this joins customers.externalId -> GA4 Customers._ID and reports
 * every row whose name disagrees, split into "spelt differently" (benign) and "different person".
 *
 * Refresh the snapshot first or the answers are stale:  ~/Downloads/ga4-refresh.sh
 * Then:  npx tsx scripts/audit-customer-identity.ts [--full] [--db <path to ga4.sqlite>]
 *
 * Read-only. Changes nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
const DB = (() => {
  const i = argv.indexOf("--db");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : path.join(os.homedir(), "Downloads", "ga4.sqlite");
})();

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "messrs"]);
const alpha = (s: string) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
const words = (s: string) =>
  new Set((s || "").toLowerCase().match(/[a-z]+/g)?.filter((t) => t.length > 1 && !TITLES.has(t)) ?? []);

/** Crude edit-distance similarity — enough to tell "Rubenstein"/"Rubinstein" (same person,
 *  spelt differently) from "Berry"/"Segal" (two different people fused by a shared phone). */
function ratio(a: string, b: string): number {
  if (a === b) return 1;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (!l.length) return 0;
  let prev = Array.from({ length: l.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= l.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === l[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[l.length] / l.length;
}

/** sqlite3 -json keeps us out of delimiter trouble: GA4 fields contain commas and apostrophes. */
function sqlite<T = Record<string, string>>(sql: string): T[] {
  const out = execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return out.trim() ? (JSON.parse(out) as T[]) : [];
}

(async () => {
  if (!existsSync(DB)) throw new Error(`No GA4 snapshot at ${DB} — run ~/Downloads/ga4-refresh.sh first`);
  const ageDays = (Date.now() - statSync(DB).mtimeMs) / 86_400_000;
  console.log(`GA4 snapshot: ${DB}  (${ageDays.toFixed(1)} days old)`);
  if (ageDays > 2)
    console.log(`  WARNING: stale — re-run ~/Downloads/ga4-refresh.sh before repairing anything\n`);

  const { getDb } = await import("../server/db");
  const db = await getDb();
  if (!db) throw new Error("No database connection");

  const ga4 = new Map<string, any>();
  for (const r of sqlite<any>(
    `SELECT _ID, AccountNumber, nameForename, nameSurname, nameCompany, contactMobile, contactTelephone FROM Customers;`,
  ))
    ga4.set(r._ID, r);

  // Cars per GA4 customer, so a flagged row shows whose vehicles are actually involved.
  const cars = new Map<string, string[]>();
  for (const r of sqlite<any>(`SELECT _ID_Customer, Registration FROM Vehicles WHERE _ID_Customer <> '';`)) {
    const list = cars.get(r._ID_Customer) ?? [];
    list.push(String(r.Registration || "").replace(/\s+/g, ""));
    cars.set(r._ID_Customer, list);
  }

  // The shared phone is the thing that fuses two people — index GA4 by national number so a
  // flagged row can name the other GA4 account it was probably merged with.
  const nat = (p: string) => {
    let d = String(p || "").replace(/\D/g, "");
    if (d.startsWith("44")) d = d.slice(2);
    else if (d.startsWith("0")) d = d.slice(1);
    return d.length >= 9 ? d : "";
  };
  const byPhone = new Map<string, any[]>();
  for (const g of ga4.values())
    for (const p of [g.contactMobile, g.contactTelephone]) {
      const k = nat(p);
      if (!k) continue;
      if (!byPhone.has(k)) byPhone.set(k, []);
      if (!byPhone.get(k)!.some((x) => x._ID === g._ID)) byPhone.get(k)!.push(g);
    }

  const rows: any[] = await db
    .execute(`SELECT id, name, "externalId", COALESCE("accountNumber",'') acct, COALESCE(phone,'') phone
                FROM customers WHERE "externalId" IS NOT NULL AND "externalId" <> ''` as any)
    .then((r: any) => r.rows ?? r);

  let agree = 0,
    unresolved = 0;
  const spelling: any[] = [];
  const crossed: any[] = [];
  for (const c of rows) {
    const g = ga4.get(c.externalId);
    if (!g) {
      unresolved++;
      continue;
    }
    const gname = ((`${g.nameForename} ${g.nameSurname}`).trim() || g.nameCompany || "").trim();
    const sur = alpha(g.nameSurname), co = alpha(g.nameCompany), wn = alpha(c.name);
    if (!sur && !co) continue;
    if ((sur && wn.includes(sur)) || (co && wn.includes(co))) {
      agree++;
      continue;
    }
    const wt = words(c.name), gt = words(gname);
    if (!wt.size || !gt.size) continue;
    let near = false;
    for (const a of wt) for (const b of gt) if (ratio(a, b) >= 0.72) near = true;

    // Who else in GA4 shares this record's phone, and does the web name match THEM? That is the
    // signature of a fuse: the name belongs to the other account on the same number.
    const sharers = (byPhone.get(nat(g.contactMobile) || nat(g.contactTelephone)) ?? []).filter(
      (x: any) => x._ID !== g._ID,
    );
    const culprit = sharers.find((x: any) => {
      const s = alpha(x.nameSurname), k = alpha(x.nameCompany);
      return (s && wn.includes(s)) || (k && wn.includes(k));
    });

    (near ? spelling : crossed).push({
      ...c,
      ga4Name: gname,
      ga4Acct: g.AccountNumber ?? "",
      cars: (cars.get(c.externalId) ?? []).join(" "),
      culprit: culprit ? `${culprit.AccountNumber} ${(`${culprit.nameForename} ${culprit.nameSurname}`).trim() || culprit.nameCompany}` : "",
    });
  }

  console.log(`web rows whose GA4 id resolves  : ${agree + spelling.length + crossed.length}`);
  console.log(`  name agrees with GA4          : ${agree}`);
  console.log(`  same person, spelt differently: ${spelling.length}`);
  console.log(`  DIFFERENT NAME ENTIRELY       : ${crossed.length}`);
  if (unresolved) console.log(`  externalIds not in snapshot   : ${unresolved}`);

  console.log(`\n-- needs review: web name vs the GA4 account it sits on --`);
  for (const m of crossed.sort((a, b) => a.id - b.id)) {
    console.log(
      `  #${String(m.id).padEnd(7)} ${String(m.name).slice(0, 26).padEnd(27)} web:${(m.acct || "-").padEnd(7)} -> GA4 ${String(m.ga4Acct).padEnd(7)} ${m.ga4Name}${m.cars ? `   [${m.cars}]` : ""}`,
    );
    if (m.culprit) console.log(`${" ".repeat(11)}name actually belongs to ${m.culprit} — same phone, so these two were fused`);
  }

  if (FULL && spelling.length) {
    console.log(`\n-- spelling variants (usually fine, no action) --`);
    for (const m of spelling.sort((a, b) => a.id - b.id))
      console.log(`  #${String(m.id).padEnd(7)} ${String(m.name).slice(0, 26).padEnd(27)} -> GA4 ${String(m.ga4Acct).padEnd(7)} ${m.ga4Name}`);
  }

  console.log(`\nGA4 is authoritative for identity. Before repairing one, confirm the two GA4 records`);
  console.log(`share a phone (that shared number is what fuses them) and carry any opt-out across the`);
  console.log(`split, or the new record starts messaging a number that asked you to stop.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
