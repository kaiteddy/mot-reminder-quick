/**
 * plan-customer-split.ts — for each fused web customer, work out exactly what a split moves.
 *
 * A "fusion" is one web `customers` row holding account/address/externalId from GA4 account A
 * while wearing the NAME of GA4 account B, because A and B share a phone number. See the
 * Berry/Segal repair. This prints, per case: both GA4 records, which cars GA4 says belong to
 * which, and every web vehicle / document / payment / reminder that would move to the new record.
 *
 * Usage:  npx tsx scripts/plan-customer-split.ts <webCustomerId> [<webCustomerId> ...]
 *
 * Read-only. Prints a plan; applies nothing.
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
const esc = (s: string) => String(s).replace(/'/g, "''");
const nat = (p: string) => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("44")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 9 ? d : "";
};
const gname = (g: any) => ((`${g.nameForename ?? ""} ${g.nameSurname ?? ""}`).trim() || g.nameCompany || "").trim();
const addr = (g: any) =>
  [g.addressHouseNo, g.addressRoad, g.addressLocality, g.addressTown, g.addressPostCode]
    .map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");
const norm = (r: string) => String(r || "").toUpperCase().replace(/\s+/g, "");

(async () => {
  const { getDb } = await import("../server/db");
  const db = await getDb();
  if (!db) throw new Error("no database");
  const run = (sql: string) => db.execute(sql as any).then((r: any) => r.rows ?? r);

  for (const id of ids) {
    const [web]: any = await run(`SELECT id, name, phone, address, postcode, "accountNumber", "externalId",
                                         "optedOut", "optedOutAt" FROM customers WHERE id = ${id}`);
    if (!web) { console.log(`\n#${id}: no such web customer`); continue; }

    const [A] = q(`SELECT * FROM Customers WHERE _ID = '${esc(web.externalId)}';`);
    if (!A) { console.log(`\n#${id}: externalId not in the GA4 snapshot`); continue; }

    // Account B = the other GA4 record on the same phone whose name this row is wearing.
    const key = nat(A.contactMobile) || nat(A.contactTelephone);
    const sharers = key
      ? q(`SELECT * FROM Customers WHERE _ID <> '${esc(A._ID)}' AND (
             replace(replace(replace(contactMobile,' ',''),'+',''),'-','') LIKE '%${key}'
          OR replace(replace(replace(contactTelephone,' ',''),'+',''),'-','') LIKE '%${key}');`)
      : [];
    const wn = String(web.name).toLowerCase().replace(/[^a-z]/g, "");
    const B = sharers.find((x: any) => {
      const s = String(x.nameSurname || "").toLowerCase().replace(/[^a-z]/g, "");
      const c = String(x.nameCompany || "").toLowerCase().replace(/[^a-z]/g, "");
      return (s && wn.includes(s)) || (c && wn.includes(c));
    });

    console.log(`\n${"=".repeat(78)}\n#${id}  "${web.name}"   web acct ${web.accountNumber || "-"}   optedOut=${web.optedOut}`);
    console.log(`  A (this record's real identity) ${A.AccountNumber}  ${gname(A)}  ${addr(A)}  ${A.contactMobile || A.contactTelephone}`);
    if (!B) { console.log(`  B: no phone-sharing GA4 account explains the name — REVIEW BY HAND, do not auto-split`); continue; }
    console.log(`  B (whose name it wears)         ${B.AccountNumber}  ${gname(B)}  ${addr(B)}  ${B.contactMobile || B.contactTelephone}`);

    const carsA = new Set(q(`SELECT Registration FROM Vehicles WHERE _ID_Customer='${esc(A._ID)}';`).map((r: any) => norm(r.Registration)));
    const carsB = new Set(q(`SELECT Registration FROM Vehicles WHERE _ID_Customer='${esc(B._ID)}';`).map((r: any) => norm(r.Registration)));
    console.log(`  GA4 says  A owns [${[...carsA].join(" ") || "-"}]   B owns [${[...carsB].join(" ") || "-"}]`);

    const [existing]: any = await run(
      `SELECT id, name FROM customers WHERE "externalId" = '${esc(B._ID)}' OR "accountNumber" = '${esc(B.AccountNumber)}' LIMIT 1`);
    console.log(existing
      ? `  NOTE: B already has web record #${existing.id} "${existing.name}" — move onto it, do NOT insert`
      : `  B has no web record — the split must create one (carry optedOut across)`);

    const veh: any[] = await run(`SELECT id, registration FROM vehicles WHERE "customerId" = ${id}`);
    const toB = veh.filter((v) => carsB.has(norm(v.registration)));
    const stay = veh.filter((v) => !carsB.has(norm(v.registration)));
    console.log(`  vehicles on the web record: ${veh.length}`);
    console.log(`     stays with A : ${stay.map((v) => `${v.registration}(${v.id})`).join(" ") || "-"}`);
    console.log(`     MOVES to B   : ${toB.map((v) => `${v.registration}(${v.id})`).join(" ") || "-"}`);
    const unknown = veh.filter((v) => !carsA.has(norm(v.registration)) && !carsB.has(norm(v.registration)));
    if (unknown.length) console.log(`     ⚠ on neither GA4 account: ${unknown.map((v) => v.registration).join(" ")} — decide by hand`);

    for (const [label, sql] of [
      ["documents", `SELECT id, "docNo", "accountNumber", registration FROM "serviceHistory" WHERE "customerId" = ${id} ORDER BY id`],
      ["payments", `SELECT p.id, s."docNo", s."accountNumber", s.registration FROM payments p LEFT JOIN "serviceHistory" s ON s.id = p."documentId" WHERE p."customerId" = ${id} ORDER BY p.id`],
      ["reminders", `SELECT r.id, v.registration, r.status FROM reminders r LEFT JOIN vehicles v ON v.id = r."vehicleId" WHERE r."customerId" = ${id} ORDER BY r.id`],
    ] as const) {
      const rows: any[] = await run(sql);
      const mv = rows.filter((r) => r.accountNumber === B.AccountNumber || carsB.has(norm(r.registration)));
      console.log(`  ${label}: ${rows.length} total, ${mv.length} move -> [${mv.map((r) => r.id).join(",") || "-"}]`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
