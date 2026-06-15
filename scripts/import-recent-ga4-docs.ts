/**
 * Import recent GA4 documents from the "friendly" export (ID Doc / ID Customer / ID Vehicle +
 * aggregate totals — NO itemised line items). Bounded, idempotent, non-destructive:
 *   npx tsx scripts/import-recent-ga4-docs.ts "<path to All Documents...csv>"          # DRY RUN
 *   npx tsx scripts/import-recent-ga4-docs.ts "<path>" --go                            # apply
 *
 * Matches everything by GA4 _ID (externalId), so re-running is safe and a later FULL export
 * (with a LineItems file) run through sync-ga4.ts will match these docs and add the real line
 * items. Customers are insert-only (never overwrites your edits); vehicles match by ID then reg
 * (adopting a web-lookup vehicle rather than duplicating it).
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";

const GO = process.argv.includes("--go");
const FILE = process.argv.find((a) => a.endsWith(".csv"));
if (!FILE) { console.error("Pass the Documents CSV path."); process.exit(1); }

const norm = (s: any) => String(s ?? "").trim();
const numOrNull = (s: any) => { const n = parseFloat(String(s ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; };
const money = (s: any) => { const n = numOrNull(s); return n == null ? null : n.toFixed(2); };
const dt = (s: any) => { const m = norm(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]} 00:00:00` : null; };
const cap = (s: any, n: number) => { const v = norm(s); return v ? v.slice(0, n) : null; };

const rows: any[] = parse(fs.readFileSync(FILE), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
console.log(`\nImport recent GA4 docs ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"}\nfile: ${FILE}\ndocs in file: ${rows.length}\n`);

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (sql: string, p?: any[]) => (await c.query(sql, p))[0] as any[];

let newCust = 0, newVeh = 0, adoptedVeh = 0, newDoc = 0, updDoc = 0;
const log: string[] = [];

for (const r of rows) {
  const docExt = norm(r["ID Doc"]); if (!docExt) continue;
  const custExt = norm(r["ID Customer"]);
  const vehExt = norm(r["ID Vehicle"]);
  const reg = norm(r["Registration"]).toUpperCase();
  const name = [norm(r["Title"]), norm(r["Forename"]), norm(r["Surname"])].filter(Boolean).join(" ");
  const addr = [r["House No"], r["Road"], r["Locality"], r["Town"], r["County"]].map(norm).filter(Boolean).join(", ");
  const phone = norm(r["Mobile"]) || norm(r["Telephone"]) || null;

  // 1) customer (insert-only by externalId)
  let customerId: number | null = null;
  if (custExt) {
    const ex = await q("SELECT id FROM customers WHERE externalId=? LIMIT 1", [custExt]);
    if (ex[0]) customerId = ex[0].id;
    else {
      newCust++; log.push(`+cust ${name || custExt}`);
      if (GO) { const [res]: any = await c.query("INSERT INTO customers (externalId, name, phone, postcode, address) VALUES (?,?,?,?,?)", [custExt, cap(name, 255) || "Unknown", cap(phone, 50), cap(norm(r["Postcode"]), 20), cap(addr, 500)]); customerId = res.insertId; }
    }
  }

  // 2) vehicle: by externalId, then by reg (adopt), else create
  let vehicleId: number | null = null;
  if (vehExt) { const ex = await q("SELECT id FROM vehicles WHERE externalId=? LIMIT 1", [vehExt]); if (ex[0]) vehicleId = ex[0].id; }
  if (!vehicleId && reg) {
    const byReg = await q("SELECT id, externalId, customerId FROM vehicles WHERE REPLACE(UPPER(registration),' ','')=? LIMIT 1", [reg.replace(/\s/g, "")]);
    if (byReg[0]) {
      vehicleId = byReg[0].id; adoptedVeh++; log.push(`~veh ${reg} (adopt #${vehicleId})`);
      if (GO) await c.query("UPDATE vehicles SET externalId=COALESCE(externalId,?), customerId=COALESCE(customerId,?), make=COALESCE(NULLIF(make,''),?), model=COALESCE(NULLIF(model,''),?), vin=COALESCE(NULLIF(vin,''),?) WHERE id=?",
        [vehExt || null, customerId, cap(norm(r["Make"]), 100), cap(norm(r["Model"]), 100), cap(norm(r["VIN"]), 50), vehicleId]);
    }
  }
  if (!vehicleId && reg) {
    newVeh++; log.push(`+veh ${reg}`);
    if (GO) { const [res]: any = await c.query("INSERT INTO vehicles (externalId, registration, make, model, vin, customerId) VALUES (?,?,?,?,?,?)", [vehExt || null, cap(reg, 20), cap(norm(r["Make"]), 100), cap(norm(r["Model"]), 100), cap(norm(r["VIN"]), 50), customerId]); vehicleId = res.insertId; }
  }

  // 3) document (upsert by externalId) — totals only, NO line items (forward-compatible with full sync)
  const tg = numOrNull(r["Total Gross"]) || 0, rec = numOrNull(r["Total Receipts"]) || 0;
  const fields: any = {
    docType: cap(r["Doc Type"], 20), docNo: cap(r["Doc No"], 50), customerId, vehicleId,
    dateCreated: dt(r["Date Created"]), dateIssued: dt(r["Date Issued"]), datePaid: dt(r["Date Paid"]),
    registration: cap(reg, 20), customerName: cap(name, 255), accountNumber: cap(r["Account No"], 50), company: cap(r["Company Name"], 255),
    custTitle: cap(r["Title"], 20), custForename: cap(r["Forename"], 100), custSurname: cap(r["Surname"], 100),
    custHouseNo: cap(r["House No"], 50), custRoad: cap(r["Road"], 255), custLocality: cap(r["Locality"], 255), custTown: cap(r["Town"], 100),
    custCounty: cap(r["County"], 100), custPostcode: cap(r["Postcode"], 20), custTelephone: cap(r["Telephone"], 50), custMobile: cap(r["Mobile"], 50),
    mileage: numOrNull(r["Mileage"]), totalNet: money(r["Total Net"]), totalTax: money(r["Total Tax"]), totalGross: money(r["Total Gross"]),
    totalReceipts: money(r["Total Receipts"]), balance: (tg - rec).toFixed(2),
    subPartsNet: money(r["Sub Parts Net"]), subPartsTax: money(r["Sub Parts Tax"]), subLabourNet: money(r["Sub Labour Net"]), subLabourTax: money(r["Sub Labour Tax"]),
    subMotNet: money(r["Sub MOT Net"]), docStatus: norm(r["Date Issued"]) ? "Issued" : "New",
  };
  const ex = await q("SELECT id FROM serviceHistory WHERE externalId=? LIMIT 1", [docExt]);
  if (ex[0]) {
    updDoc++; log.push(`~doc ${fields.docType} ${fields.docNo} (${name})`);
    if (GO) { const sets = Object.keys(fields); await c.query(`UPDATE serviceHistory SET ${sets.map((k) => `${k}=?`).join(",")} WHERE id=?`, [...sets.map((k) => fields[k]), ex[0].id]); }
  } else {
    newDoc++; log.push(`+doc ${fields.docType} ${fields.docNo} (${name}) £${fields.totalGross}`);
    if (GO) { const sets = Object.keys(fields); await c.query(`INSERT INTO serviceHistory (externalId, ${sets.join(",")}) VALUES (?, ${sets.map(() => "?").join(",")})`, [docExt, ...sets.map((k) => fields[k])]); }
  }
}

console.log(log.join("\n"));
console.log(`\nSummary: +${newCust} customers, +${newVeh} vehicles, ${adoptedVeh} vehicles adopted, +${newDoc} docs new, ${updDoc} docs updated`);
console.log(GO ? "\n✓ Applied." : "\nDry run — re-run with --go to apply.");
await c.end();
process.exit(0);
