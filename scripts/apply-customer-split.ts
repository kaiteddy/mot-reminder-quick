/**
 * apply-customer-split.ts — un-fuse a web customer that holds two GA4 people.
 *
 * The webapp fuses two GA4 customers who share a phone number, keeping one person's NAME on the
 * other's account and piling both people's cars onto one row (see the Berry/Segal repair). GA4 is
 * authoritative for identity, so this recomputes the split from GA4 and moves only what belongs
 * to the second person.
 *
 * Attribution rules, in order of trust:
 *   vehicles  — GA4 says which account owns the registration
 *   documents — the document's own accountNumber (GA4 stamped it); only if blank do we fall back
 *               to which account owns the car. A doc stamped for A never moves.
 *   payments  — follow their document. A payment whose document did not move does not move.
 *   reminders — follow their vehicle.
 *
 * Usage:  npx tsx scripts/apply-customer-split.ts <webCustomerId> [...]   (add --apply to write)
 * Without --apply it prints the plan and changes nothing.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DB = path.join(os.homedir(), "Downloads", "ga4.sqlite");
const APPLY = process.argv.includes("--apply");
// "<id>" infers the counterpart from the name (works when the record wears the other person's
// name, the Berry/Segal shape). "<id>:<ACCT>" names it explicitly — needed when the name is
// correct and it is the CARS and DOCUMENTS that belong to someone else, which is what
// scan-fused-customers.ts turns up.
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => {
  const [i, acct] = a.split(":");
  return { id: Number(i), acct: acct || null };
}).filter((t) => t.id);
if (!targets.length) throw new Error("give at least one web customer id (or id:ACCOUNT)");

const q = <T = any>(sql: string): T[] => {
  const out = execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
};
const esc = (s: any) => String(s ?? "").replace(/'/g, "''");
const nat = (p: any) => {
  let d = String(p ?? "").replace(/\D/g, "");
  if (d.startsWith("44")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 9 ? d : "";
};
const norm = (r: any) => String(r ?? "").toUpperCase().replace(/\s+/g, "");
const gname = (g: any) => ((`${g.nameForename ?? ""} ${g.nameSurname ?? ""}`).trim() || g.nameCompany || "").trim();
const gaddr = (g: any) =>
  [g.addressHouseNo, g.addressRoad, g.addressLocality, g.addressTown].map((x) => String(x ?? "").trim())
    .filter(Boolean).join(", ");

(async () => {
  const { getDb } = await import("../server/db");
  const db = await getDb();
  if (!db) throw new Error("no database");
  const run = (sql: string): Promise<any[]> => db.execute(sql as any).then((r: any) => r.rows ?? r);

  for (const { id, acct } of targets) {
    const [web]: any = await run(`SELECT * FROM customers WHERE id = ${id}`);
    if (!web) { console.log(`#${id}: no such customer`); continue; }
    const [A] = q(`SELECT * FROM Customers WHERE _ID = '${esc(web.externalId)}';`);
    if (!A) { console.log(`#${id}: externalId not in GA4 snapshot — skipped`); continue; }

    const key = nat(A.contactMobile) || nat(A.contactTelephone);
    const wn = String(web.name).toLowerCase().replace(/[^a-z]/g, "");
    const B = acct
      ? q(`SELECT * FROM Customers WHERE AccountNumber = '${esc(acct)}';`)[0]
      : (key
      ? q(`SELECT * FROM Customers WHERE _ID <> '${esc(A._ID)}' AND (
             replace(replace(replace(contactMobile,' ',''),'+',''),'-','') LIKE '%${key}'
          OR replace(replace(replace(contactTelephone,' ',''),'+',''),'-','') LIKE '%${key}');`)
      : []
      ).find((x: any) => {
        const s = String(x.nameSurname ?? "").toLowerCase().replace(/[^a-z]/g, "");
        const c = String(x.nameCompany ?? "").toLowerCase().replace(/[^a-z]/g, "");
        return (s && wn.includes(s)) || (c && wn.includes(c));
      });
    if (!B) { console.log(`#${id}: no counterpart account${acct ? ` ${acct}` : " explains the name"} — skipped`); continue; }
    if (B._ID === A._ID) { console.log(`#${id}: counterpart is the record's own account — skipped`); continue; }
    // A GA4 row with no name AND no address is a junk account (XZZ005 "X"), not a second person.
    if (!String(B.nameSurname ?? "").trim() && !String(B.nameCompany ?? "").trim() && !String(B.addressRoad ?? "").trim()) {
      console.log(`#${id}: counterpart ${B.AccountNumber} has no name or address — junk, not a person — skipped`); continue;
    }

    const carsB = new Set(q(`SELECT Registration FROM Vehicles WHERE _ID_Customer='${esc(B._ID)}';`).map((r: any) => norm(r.Registration)));

    // --- decide what moves -------------------------------------------------
    const vehAll = await run(`SELECT id, registration FROM vehicles WHERE "customerId" = ${id}`);
    const vehMove = vehAll.filter((v) => carsB.has(norm(v.registration)));
    const vehMoveIds = new Set(vehMove.map((v) => v.id));

    const docAll = await run(`SELECT id, "docNo", "accountNumber", registration, "totalGross" FROM "serviceHistory" WHERE "customerId" = ${id}`);
    const docMove = docAll.filter((d) => {
      const acct = String(d.accountNumber ?? "").trim();
      if (acct) return acct === B.AccountNumber;          // GA4 stamped it — trust that
      return carsB.has(norm(d.registration));             // unstamped: fall back to the car
    });
    const docMoveIds = new Set(docMove.map((d) => d.id));

    const payAll = await run(`SELECT id, "documentId" FROM payments WHERE "customerId" = ${id}`);
    const payMove = payAll.filter((p) => p.documentId != null && docMoveIds.has(p.documentId));

    const remAll = await run(`SELECT id, "vehicleId" FROM reminders WHERE "customerId" = ${id}`);
    const remMove = remAll.filter((r) => r.vehicleId != null && vehMoveIds.has(r.vehicleId));

    const [existing]: any = await run(
      `SELECT id, name FROM customers WHERE "externalId" = '${esc(B._ID)}' OR "accountNumber" = '${esc(B.AccountNumber)}' LIMIT 1`);

    console.log(`\n${"=".repeat(74)}`);
    console.log(`#${id} "${web.name}"  ->  ${A.AccountNumber} ${gname(A)}   |   split out ${B.AccountNumber} ${gname(B)}`);
    console.log(`  vehicles ${vehMove.length}/${vehAll.length}  docs ${docMove.length}/${docAll.length}  payments ${payMove.length}/${payAll.length}  reminders ${remMove.length}/${remAll.length}`);
    console.log(`  target: ${existing ? `existing web #${existing.id}` : "new record (opt-out carried across)"}`);
    if (!APPLY) { console.log(`  (dry run — pass --apply to write)`); continue; }

    const beforeDocs = docAll.length;
    const beforeGross = docAll.reduce((a, d) => a + Number(d.totalGross || 0), 0);

    const nameB = [B.nameTitle, gname(B)].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
    const sql: string[] = ["BEGIN"];
    // A's own name, straight from GA4 — this row was wearing B's.
    const nameA = [A.nameTitle, gname(A)].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
    sql.push(`UPDATE customers SET name = '${esc(nameA)}', "updatedAt" = now() WHERE id = ${id}`);
    let target: string;
    if (existing) {
      target = String(existing.id);
    } else {
      sql.push(`INSERT INTO customers (name, phone, address, postcode, "accountNumber", "externalId", notes, "optedOut", "optedOutAt")
        SELECT '${esc(nameB)}', ${B.contactMobile || B.contactTelephone ? `'${esc(B.contactMobile || B.contactTelephone)}'` : "c.phone"},
               '${esc(gaddr(B))}', '${esc(B.addressPostCode)}', '${esc(B.AccountNumber)}', '${esc(B._ID)}',
               'Split out of customer #${id} on 01/09/2026 — had been merged onto ${esc(A.AccountNumber)} because both share a phone number.',
               c."optedOut", c."optedOutAt"
          FROM customers c WHERE c.id = ${id}`);
      target = `(SELECT id FROM customers WHERE "externalId" = '${esc(B._ID)}')`;
    }
    if (vehMove.length) sql.push(`UPDATE vehicles SET "customerId" = ${target} WHERE id IN (${vehMove.map((v) => v.id).join(",")})`);
    if (docMove.length) sql.push(`UPDATE "serviceHistory" SET "customerId" = ${target} WHERE id IN (${docMove.map((d) => d.id).join(",")})`);
    if (payMove.length) sql.push(`UPDATE payments SET "customerId" = ${target} WHERE id IN (${payMove.map((p) => p.id).join(",")})`);
    if (remMove.length) sql.push(`UPDATE reminders SET "customerId" = ${target} WHERE id IN (${remMove.map((r) => r.id).join(",")})`);
    sql.push("COMMIT");
    for (const s of sql) await db.execute(s as any);

    // --- prove nothing was lost or misfiled --------------------------------
    const after: any[] = await run(
      `SELECT count(*)::int AS docs, COALESCE(sum("totalGross"),0)::float AS gross FROM "serviceHistory"
        WHERE "customerId" IN (${id}, (SELECT id FROM customers WHERE "externalId" = '${esc(B._ID)}'))`);
    const stray: any[] = await run(
      `SELECT count(*)::int AS n FROM "serviceHistory" s JOIN customers c ON c.id = s."customerId"
        WHERE s."customerId" IN (${id}, (SELECT id FROM customers WHERE "externalId" = '${esc(B._ID)}'))
          AND s."accountNumber" <> '' AND s."accountNumber" IS NOT NULL AND s."accountNumber" <> c."accountNumber"`);
    const ok = after[0].docs === beforeDocs && Math.abs(after[0].gross - beforeGross) < 0.005;
    console.log(`  ${ok ? "OK" : "MISMATCH"}: ${beforeDocs} docs / £${beforeGross.toFixed(2)} -> ${after[0].docs} docs / £${Number(after[0].gross).toFixed(2)}`);
    if (Number(stray[0].n) > 0) console.log(`  WARNING: ${stray[0].n} document(s) still on an account that doesn't match their stamp`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
