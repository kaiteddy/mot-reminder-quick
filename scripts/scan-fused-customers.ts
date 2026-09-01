/**
 * scan-fused-customers.ts — find every web customer that holds more than one PERSON.
 *
 * Structural detector, independent of names on the web side. Two signatures:
 *   1. the customer's documents are stamped with GA4 account numbers belonging to different
 *      surnames (GA4 stamps each document with its own account, so this is GA4's own evidence)
 *   2. the customer's vehicles are owned, per GA4, by GA4 customers with different surnames
 *
 * Spanning several accounts is NOT by itself a fault — a household or company legitimately has
 * several GA4 codes (SIX001..SIX005) and the dedup folds those on purpose. Only a span across
 * different SURNAMES suggests two people were fused on a shared phone number.
 *
 * Usage:  npx tsx scripts/scan-fused-customers.ts [--all]     (--all lists same-surname spans too)
 * Read-only.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DB = path.join(os.homedir(), "Downloads", "ga4.sqlite");
const ALL = process.argv.includes("--all");
const q = <T = any>(sql: string): T[] => {
  const out = execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
};
const key = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** GA4 spells the same person several ways across accounts ("Hakimian"/"Hakkimian",
 *  "Pomerantz"/"Pomeranc"), so exact surname comparison reports one person as two. Cluster the
 *  identities by similarity instead and only call it a fusion if more than one cluster survives. */
function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let prev = Array.from({ length: l.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= l.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === l[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[l.length] / l.length >= 0.72;
}
function distinctPeople(idents: string[]): string[][] {
  const groups: string[][] = [];
  for (const i of idents) {
    const g = groups.find((grp) => grp.some((x) => similar(x, i)));
    if (g) g.push(i); else groups.push([i]);
  }
  return groups;
}
/** ELI's own pre-sales account and the M&Y trade account legitimately hold many people's cars. */
const TRADE_ACCOUNTS = new Set([87, 540952]);
const norm = (r: any) => String(r ?? "").toUpperCase().replace(/\s+/g, "");

(async () => {
  const { getDb } = await import("../server/db");
  const db = await getDb();
  if (!db) throw new Error("no database");
  const run = (sql: string): Promise<any[]> => db.execute(sql as any).then((r: any) => r.rows ?? r);

  // GA4 account -> identity, and registration -> owning account
  const byAcct = new Map<string, any>();
  for (const g of q<any>(`SELECT AccountNumber, nameForename, nameSurname, nameCompany, contactMobile, contactTelephone FROM Customers;`))
    if (g.AccountNumber) byAcct.set(g.AccountNumber, g);
  const idty = (acct: string) => {
    const g = byAcct.get(acct);
    if (!g) return "";
    return key(g.nameSurname) || key(g.nameCompany);
  };
  const label = (acct: string) => {
    const g = byAcct.get(acct);
    if (!g) return `${acct}(not in GA4)`;
    return `${acct}:${((`${g.nameForename ?? ""} ${g.nameSurname ?? ""}`).trim() || g.nameCompany || "?").trim()}`;
  };

  const rows = await run(`
    SELECT s."customerId" AS cid, c.name, c."accountNumber" AS racct,
           array_agg(DISTINCT s."accountNumber") AS accts, count(*)::int AS docs
      FROM "serviceHistory" s JOIN customers c ON c.id = s."customerId"
     WHERE s."accountNumber" IS NOT NULL AND s."accountNumber" <> ''
     GROUP BY 1,2,3 HAVING count(DISTINCT s."accountNumber") > 1`);

  const crossed: any[] = [], sameFamily: any[] = [];
  for (const r of rows) {
    const accts: string[] = (Array.isArray(r.accts) ? r.accts : String(r.accts).replace(/[{}]/g, "").split(","))
      .map((a: string) => a.trim()).filter(Boolean);
    if (TRADE_ACCOUNTS.has(Number(r.cid))) continue;
    const idents = [...new Set(accts.map(idty).filter(Boolean))];
    const groups = distinctPeople(idents);
    (groups.length > 1 ? crossed : sameFamily).push({ ...r, accts, idents, groups });
  }

  console.log(`customers whose documents span >1 GA4 account : ${rows.length}`);
  console.log(`  one person (household, multi-account, or spelling variant): ${sameFamily.length}`);
  console.log(`  DIFFERENT SURNAMES — two people on one record             : ${crossed.length}`);

  // Do the crossed ones share a phone in GA4? That is the mechanism that fuses them.
  const nat = (p: any) => {
    let d = String(p ?? "").replace(/\D/g, "");
    if (d.startsWith("44")) d = d.slice(2); else if (d.startsWith("0")) d = d.slice(1);
    return d.length >= 9 ? d : "";
  };
  console.log(`\n-- two people on one web record --`);
  for (const c of crossed.sort((a, b) => b.docs - a.docs)) {
    const phones = new Set(c.accts.map((a: string) => {
      const g = byAcct.get(a); return g ? nat(g.contactMobile) || nat(g.contactTelephone) : "";
    }).filter(Boolean));
    console.log(`  #${String(c.cid).padEnd(7)} ${String(c.name).slice(0, 24).padEnd(25)} rec:${String(c.racct ?? "-").padEnd(7)} ${c.docs} docs  ${c.accts.map(label).join("  ")}${phones.size === 1 ? "   [one shared phone]" : ""}`);
  }

  if (ALL && sameFamily.length) {
    console.log(`\n-- same surname across several GA4 accounts (no action) --`);
    for (const c of sameFamily.sort((a, b) => b.docs - a.docs).slice(0, 40))
      console.log(`  #${String(c.cid).padEnd(7)} ${String(c.name).slice(0, 24).padEnd(25)} ${c.docs} docs  ${c.accts.join(" ")}`);
  }

  // Signature 2: vehicles whose GA4 owners are different people.
  const owner = new Map<string, string>();
  for (const v of q<any>(`SELECT Registration, _ID_Customer FROM Vehicles WHERE _ID_Customer <> '';`))
    owner.set(norm(v.Registration), v._ID_Customer);
  const byId = new Map<string, any>();
  for (const g of q<any>(`SELECT _ID, AccountNumber, nameSurname, nameCompany FROM Customers;`)) byId.set(g._ID, g);

  const veh = await run(`SELECT v."customerId" AS cid, c.name, v.registration
                           FROM vehicles v JOIN customers c ON c.id = v."customerId" WHERE v."customerId" IS NOT NULL`);
  const perCust = new Map<number, { name: string; ids: Set<string> }>();
  for (const v of veh) {
    const oid = owner.get(norm(v.registration));
    if (!oid) continue;
    if (!perCust.has(v.cid)) perCust.set(v.cid, { name: v.name, ids: new Set() });
    perCust.get(v.cid)!.ids.add(oid);
  }
  const vehCrossed = [...perCust.entries()].filter(([cid, v]) => {
    if (TRADE_ACCOUNTS.has(Number(cid))) return false;
    const idents = [...new Set([...v.ids].map((i) => { const g = byId.get(i); return g ? key(g.nameSurname) || key(g.nameCompany) : ""; }).filter(Boolean))];
    return distinctPeople(idents).length > 1;
  });
  console.log(`\ncustomers whose VEHICLES belong to different people in GA4 : ${vehCrossed.length}`);
  for (const [cid, v] of vehCrossed.slice(0, 40)) {
    const who = [...v.ids].map((i) => { const g = byId.get(i); return g ? `${g.AccountNumber}:${(g.nameSurname || g.nameCompany || "?")}` : i.slice(0, 8); });
    console.log(`  #${String(cid).padEnd(7)} ${String(v.name).slice(0, 24).padEnd(25)} ${who.join("  ")}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
