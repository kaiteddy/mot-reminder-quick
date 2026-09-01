/**
 * classify-fused-customers.ts — decide whether a flagged customer is really two people.
 *
 * scan-fused-customers.ts finds records whose documents/vehicles span GA4 accounts with different
 * surnames. That is a good detector but it over-flags: GA4 routinely holds ONE person under
 * several accounts (a house move, a marriage, a misspelling, a personal account beside their
 * company). Splitting those would shatter a real customer.
 *
 * The evidence that separates the two cases is the ADDRESS, not the name:
 *   different surname + different address  -> two people fused on a shared phone   (SPLIT)
 *   same address, or same forename         -> one person / one household           (LEAVE)
 *
 * Usage:  npx tsx scripts/classify-fused-customers.ts <webCustomerId> [...]
 * Read-only.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DB = path.join(os.homedir(), "Downloads", "ga4.sqlite");
const ids = process.argv.slice(2).map(Number).filter(Boolean);
if (!ids.length) throw new Error("give at least one web customer id");

const q = <T = any>(sql: string): T[] => {
  const out = execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
};
const esc = (s: any) => String(s ?? "").replace(/'/g, "''");
const key = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pc = (s: any) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const gname = (g: any) => ((`${g.nameForename ?? ""} ${g.nameSurname ?? ""}`).trim() || g.nameCompany || "?").trim();
const road = (g: any) => key(g.addressRoad);
const COMPANYISH = /\b(ltd|limited|plc|llp|autos?|cars?|services|company|co|invitations|bakery|plumbing|heating|travel|washing|valeting|consultants)\b/i;

(async () => {
  const { getDb } = await import("../server/db");
  const db = await getDb();
  if (!db) throw new Error("no database");
  const run = (sql: string): Promise<any[]> => db.execute(sql as any).then((r: any) => r.rows ?? r);

  const verdicts: Record<string, string[]> = { SPLIT: [], LEAVE: [], BUSINESS: [], REVIEW: [] };

  for (const id of ids) {
    const [web]: any = await run(`SELECT id, name, "accountNumber" FROM customers WHERE id = ${id}`);
    if (!web) continue;
    // Every GA4 account this record touches, via its documents and its vehicles.
    const accts = new Set<string>();
    for (const r of await run(
      `SELECT DISTINCT "accountNumber" a FROM "serviceHistory" WHERE "customerId" = ${id} AND "accountNumber" <> ''`))
      accts.add(r.a);
    const regs = (await run(`SELECT registration r FROM vehicles WHERE "customerId" = ${id}`))
      .map((v) => String(v.r).toUpperCase().replace(/\s+/g, ""));
    for (const r of regs) {
      const [v] = q(`SELECT c.AccountNumber a FROM Vehicles v JOIN Customers c ON c._ID = v._ID_Customer
                      WHERE replace(upper(v.Registration),' ','') = '${esc(r)}';`);
      if (v?.a) accts.add(v.a);
    }
    const list = [...accts].filter(Boolean);
    if (list.length < 2) continue;
    const gs = q<any>(`SELECT * FROM Customers WHERE AccountNumber IN (${list.map((a) => `'${esc(a)}'`).join(",")});`);

    // Cluster: same road, or same forename, or one name contained in the other => one identity.
    const groups: any[][] = [];
    for (const g of gs) {
      const hit = groups.find((grp) => grp.some((x) => {
        if (road(x) && road(x) === road(g)) return true;
        if (key(x.nameForename) && key(x.nameForename) === key(g.nameForename)) return true;
        const a = key(x.nameSurname) || key(x.nameCompany), b = key(g.nameSurname) || key(g.nameCompany);
        return !!a && !!b && (a.includes(b) || b.includes(a));
      }));
      if (hit) hit.push(g); else groups.push([g]);
    }
    const anyCompany = gs.some((g) => g.nameCompany || COMPANYISH.test(gname(g)));
    const verdict = groups.length < 2 ? "LEAVE" : anyCompany ? "BUSINESS" : "SPLIT";

    console.log(`\n#${id} "${web.name}"  ->  ${verdict}`);
    for (const g of gs)
      console.log(`   ${String(g.AccountNumber).padEnd(8)} ${gname(g).slice(0, 26).padEnd(27)} ${[g.addressHouseNo, g.addressRoad].filter(Boolean).join(" ").slice(0, 28).padEnd(29)} ${pc(g.addressPostCode).padEnd(8)} ${g.contactMobile || g.contactTelephone || ""}`);
    if (groups.length < 2) console.log(`   -> one identity (shared address / forename / name) — do not split`);
    else if (anyCompany) console.log(`   -> a person and a business — legitimate pairing unless you say otherwise`);
    else console.log(`   -> ${groups.length} distinct people, different addresses — genuine fusion`);
    verdicts[verdict].push(String(id));
  }

  console.log(`\n${"=".repeat(70)}`);
  for (const [k, v] of Object.entries(verdicts)) if (v.length) console.log(`${k.padEnd(9)} ${v.length}: ${v.join(" ")}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
