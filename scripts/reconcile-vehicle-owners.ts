/**
 * Reconcile vehicle→customer ownership from GA4's fresh "Vehicles" General CSV Export.
 *
 *   npx tsx scripts/reconcile-vehicle-owners.ts "<path/to/Vehicles Exports ….csv>"        # DRY RUN
 *   npx tsx scripts/reconcile-vehicle-owners.ts "<path>" --go                              # apply
 *
 * The export carries, per vehicle: ID Vehicle, ID Customer (the owner's GA4 _ID), and the
 * full owner details. We treat it as GA4's CURRENT truth:
 *   - owner present + customer in our DB        → relink the vehicle to it
 *   - owner present + customer NOT in our DB    → create the customer (insert-only) then link
 *   - owner EMPTY (you cleared it in GA4)       → null our link (mirrors the removal)
 *
 * SAFE: matches strictly on GA4 _ID. Customers are INSERT-ONLY (existing rows never modified).
 * Vehicles: only the customerId link is touched, always to match GA4's current ID Customer —
 * so it can never re-add an owner you removed (empty stays empty). Never deletes anything.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";

const GO = process.argv.includes("--go");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const VM = path.join(os.homedir(), "Library/Parallels/Windows Disks/{0765f06c-a42d-40cf-af9b-4068ce38b6ee}/[C] Win11Manual.hidden/GA4 User Data/Data Exports");
function resolveCsv(): string {
  if (fileArg) return fileArg;
  const f = fs.readdirSync(VM).filter((x) => /^Vehicles Exports.*\.csv$/i.test(x)).sort();
  if (!f.length) { console.error('Pass the Vehicles export path.'); process.exit(1); }
  return path.join(VM, f[f.length - 1]);
}

const norm = (s: any) => String(s ?? "").trim();
const cap = (s: any, n: number) => (s == null ? null : String(s).slice(0, n));
const G = (r: any, k: string) => norm(r[k] ?? r[k + " "] ?? r[" " + k]); // tolerate stray spaces in headers

const csv = resolveCsv();
console.log(`\nVehicle→customer reconciliation ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"}\nsource: ${path.basename(csv)}\n`);
const rows: any[] = parse(fs.readFileSync(csv), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
console.log(`${rows.length} vehicles in export\n`);

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (s: string, p?: any[]) => (await c.query(s, p))[0] as any[];

const custByExt = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM customers WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'")) custByExt.set(r.externalId, r.id);
const vehByExt = new Map<string, { id: number; customerId: number | null }>();
for (const r of await q("SELECT id, externalId, customerId FROM vehicles WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'")) vehByExt.set(r.externalId, { id: r.id, customerId: r.customerId });

// ---- 1) customers to create (owner present in export but not in our DB) ----
const custName = (r: any) => [G(r, "Owner Forename"), G(r, "Owner Surname")].filter(Boolean).join(" ").trim() || G(r, "Owner Company Name") || null;
const custAddr = (r: any) => ["Owner House No", "Owner Road", "Owner Locality", "Owner Town", "Owner County", "Owner Postcode"].map((k) => G(r, k)).filter(Boolean).join(", ") || null;
const newCust = new Map<string, any[]>();
for (const r of rows) {
  const cext = G(r, "ID Customer");
  if (!cext || custByExt.has(cext) || newCust.has(cext)) continue;
  const name = custName(r); if (!name) continue;
  newCust.set(cext, [cext, cap(name, 255), cap(G(r, "Owner Mobile") || G(r, "Owner Telephone"), 50), cap(G(r, "Owner Email"), 320) || null, cap(G(r, "Owner Postcode"), 20) || null, cap(custAddr(r), 500)]);
}
console.log(`Customers: +${newCust.size} to create (insert-only)`);
if (GO && newCust.size) {
  const vals = [...newCust.values()];
  for (let i = 0; i < vals.length; i += 500) await c.query("INSERT INTO customers (externalId, name, phone, email, postcode, address) VALUES ?", [vals.slice(i, i + 500)]);
  for (const r of await q("SELECT id, externalId FROM customers WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'")) custByExt.set(r.externalId, r.id);
}

// ---- 2) classify each existing vehicle's link vs GA4's current owner ----
let correct = 0, relink = 0, fill = 0, nullify = 0, notOurs = 0;
const updates: { id: number; to: number | null }[] = [];
const nullSamples: string[] = [], relinkSamples: string[] = [];
for (const r of rows) {
  const vext = G(r, "ID Vehicle"); if (!vext) continue;
  const veh = vehByExt.get(vext);
  if (!veh) { notOurs++; continue; }                       // vehicle not in our DB (separate import gap)
  const cext = G(r, "ID Customer");
  const target = cext ? (custByExt.get(cext) ?? (newCust.has(cext) ? -1 : null)) : null; // -1 = will-be-created
  const cur = veh.customerId;
  if (target === -1) { if (cur == null) { fill++; relinkSamples.push(`${G(r, "Registration")} → ${custName(r)} (new)`); } else { relink++; } updates.push({ id: veh.id, to: -1 }); }
  else if (cur === target) correct++;
  else if (target == null) { nullify++; updates.push({ id: veh.id, to: null }); if (nullSamples.length < 8) nullSamples.push(`${G(r, "Registration")} (was cust ${cur})`); }
  else if (cur == null) { fill++; updates.push({ id: veh.id, to: target }); }
  else { relink++; updates.push({ id: veh.id, to: target }); if (relinkSamples.length < 8) relinkSamples.push(`${G(r, "Registration")}: cust ${cur} → ${target}`); }
}
console.log(`\nOf ${rows.length} export vehicles (${notOurs} not in our DB, skipped):`);
console.log(`  ✓ already correct:                 ${correct}`);
console.log(`  ~ relink to different owner:        ${relink}`);
console.log(`  + fill missing owner:               ${fill}`);
console.log(`  ∅ null (you cleared it in GA4):     ${nullify}`);
console.log(`\nrelink samples:`); relinkSamples.slice(0, 8).forEach((s) => console.log("   " + s));
console.log(`null (removal) samples:`); nullSamples.forEach((s) => console.log("   " + s));

if (GO) {
  // resolve will-be-created (-1) to real ids now that customers are inserted
  let n = 0;
  for (const u of updates) {
    let to = u.to;
    if (to === -1) {
      const row = rows.find((r) => vehByExt.get(G(r, "ID Vehicle"))?.id === u.id);
      to = row ? custByExt.get(G(row, "ID Customer")) ?? null : null;
    }
    await c.query("UPDATE vehicles SET customerId=? WHERE id=?", [to, u.id]);
    n++;
  }
  console.log(`\n✓ Applied ${n} vehicle link updates + ${newCust.size} new customers.`);
} else {
  console.log(`\nDry run complete — ${updates.length} vehicle links would change. Re-run with --go to apply.`);
}
await c.end();
process.exit(0);
