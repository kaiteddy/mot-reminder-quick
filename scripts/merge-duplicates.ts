/**
 * Batch-merge duplicate customers that SHARE A PHONE NUMBER and the SAME SURNAME — the import
 * created ~512 such dupes (mostly #450xxx records from the vehicles reconcile). Same logic as
 * scripts/merge-customers.ts, applied to every safe group. Mixed-surname groups (two people /
 * spouses on one number) are written to a review file and NEVER auto-merged.
 *
 *   npx tsx scripts/merge-duplicates.ts          # DRY RUN: writes the plan to /tmp, no DB changes
 *   npx tsx scripts/merge-duplicates.ts --go     # apply the safe merges
 */
import "dotenv/config"; import fs from "fs"; import mysql from "mysql2/promise";
const GO = process.argv.includes("--go");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (s: string, p?: any[]) => (await c.query(s, p))[0] as any[];
const FK = ["serviceHistory", "vehicles", "reminders", "reminderLogs", "payments", "customerLogs", "customerMessages", "appointments"];

const TITLES = /^(mr|mrs|ms|miss|dr|prof)\.?$/i;
const COMPANY = /\b(ltd|limited|plc|llp|centre|center|trade|parts|services|company|consultants|garage|motors|cars|valeting|bodywork|deli|conditioning|prestige)\b/i;
const CATCHALL = /\b(cash|account|sundry|misc|unknown|test|sale|estimate)\b/i;
const hasTitle = (n: string) => TITLES.test(String(n || "").trim().split(/\s+/)[0] || "");
const surnameKey = (name: string) => { const w = String(name || "").trim().split(/\s+/).filter(x => !TITLES.test(x)); return (w[w.length - 1] || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 5); };
function normPhone(raw: any) { if (!raw) return null; const s = String(raw).replace(/\s+/g, ""); const m = s.match(/(?:\+?44|0)\d{9,10}/) || s.match(/\d{10,11}/); if (!m) return null; let d = m[0].replace(/\D/g, ""); if (d.startsWith("44")) d = "0" + d.slice(2); if (d.length === 10 && d.startsWith("7")) d = "0" + d; return (d.length === 11 && d[0] === "0") ? d : null; }
const parseJson = (x: any) => { try { return typeof x === "string" ? JSON.parse(x) : (x || []); } catch { return []; } };

const custs = await q("SELECT id, name, phone, email, address, postcode, altContacts, mergedExternalIds, externalId, createdAt FROM customers");
const docCnt = new Map<number, number>();
for (const r of await q("SELECT customerId, COUNT(*) n FROM serviceHistory WHERE customerId IS NOT NULL GROUP BY customerId")) docCnt.set(r.customerId, r.n);

const byPhone = new Map<string, any[]>();
for (const cu of custs) { const p = normPhone(cu.phone); if (!p) continue; if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p)!.push(cu); }

const safe: { primary: any; secondaries: any[] }[] = [];
const review: string[] = [];
for (const [phone, g] of byPhone) {
  if (g.length < 2) continue;
  if (g.some(x => COMPANY.test(x.name || "") || CATCHALL.test(x.name || ""))) { review.push(`[company/catch-all] ${phone}: ${g.map(x => `#${x.id} ${x.name}`).join(" | ")}`); continue; }
  const keys = new Set(g.map(x => surnameKey(x.name)).filter(Boolean));
  if (keys.size !== 1 || ![...keys][0]) { review.push(`${phone}: ${g.map(x => `#${x.id} ${x.name} [${docCnt.get(x.id) || 0}d]`).join(" | ")}`); continue; }
  const sorted = [...g].sort((a, b) => (docCnt.get(b.id) || 0) - (docCnt.get(a.id) || 0) || a.id - b.id);
  safe.push({ primary: sorted[0], secondaries: sorted.slice(1) });
}

const planLines = safe.map(s => `#${s.primary.id} "${s.primary.name}" ← ${s.secondaries.map(x => `#${x.id} "${x.name}"`).join(", ")}`);
fs.writeFileSync("/tmp/safe-merges.txt", planLines.join("\n"));
fs.writeFileSync("/tmp/review-merges.txt", review.join("\n"));
console.log(`SAFE merges: ${safe.length} groups, ${safe.reduce((s, x) => s + x.secondaries.length, 0)} records folded in → /tmp/safe-merges.txt`);
console.log(`REVIEW (not touched): ${review.length} groups → /tmp/review-merges.txt`);
console.log("\nfirst 15 planned safe merges:");
planLines.slice(0, 15).forEach(l => console.log("  " + l));

if (!GO) { console.log("\nDRY RUN — re-run with --go to apply the safe merges."); await c.end(); process.exit(0); }

console.log("\nApplying…");
let done = 0, movedTotal = 0;
for (const { primary, secondaries } of safe) {
  const secIds = secondaries.map(s => s.id);
  for (const t of FK) { const r = await q(`UPDATE ${t} SET customerId=? WHERE customerId IN (${secIds.join(",")})`, [primary.id]); movedTotal += r.affectedRows || 0; }
  const recs = [primary, ...secondaries];
  const name = recs.map(r => r.name).filter(Boolean).sort((a, b) => ((hasTitle(b) ? 1000 : 0) + b.length) - ((hasTitle(a) ? 1000 : 0) + a.length))[0] || primary.name;
  const pick = (f: string) => primary[f] || secondaries.map(s => s[f]).find(Boolean) || null;
  const seen = new Set<string>(); const alt: any[] = [];
  for (const r of recs) for (const ct of parseJson(r.altContacts)) { const k = String(ct.phone || ct.name || "").replace(/\s+/g, "").toLowerCase(); if (k && !seen.has(k)) { seen.add(k); alt.push({ name: ct.name || "", phone: ct.phone || "" }); } }
  const aliases = new Set<string>(parseJson(primary.mergedExternalIds));
  for (const s of secondaries) { for (const a of parseJson(s.mergedExternalIds)) aliases.add(a); if (s.externalId && !String(s.externalId).startsWith("WEB-")) aliases.add(s.externalId); }
  await q("UPDATE customers SET name=?, phone=?, email=?, address=?, postcode=?, altContacts=?, mergedExternalIds=? WHERE id=?",
    [name, pick("phone"), pick("email"), pick("address"), pick("postcode"), alt.length ? JSON.stringify(alt) : null, aliases.size ? JSON.stringify([...aliases]) : null, primary.id]);
  await q(`DELETE FROM customers WHERE id IN (${secIds.join(",")})`);
  done++;
  if (done % 50 === 0) console.log(`  …${done}/${safe.length}`);
}
console.log(`\n✓ Merged ${safe.length} groups (${movedTotal} references moved).`);
await c.end();
process.exit(0);
