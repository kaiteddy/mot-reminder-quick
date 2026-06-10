/**
 * Merge duplicate customer records into one (GA4 holds multiple _IDs for the same person).
 *
 *   npx tsx scripts/merge-customers.ts <primaryId> <secondaryId> [<secondaryId2> ...]
 *
 * Re-points every reference (docs, vehicles, reminders, payments, logs, messages, appointments)
 * from the secondaries to the primary, unions their alt-contacts, keeps the best identity fields,
 * and records each secondary's GA4 externalId in the primary's `mergedExternalIds` so a later CSV
 * sync maps the dead id to the survivor instead of re-creating the duplicate. Then deletes the
 * secondaries. Idempotent-ish: safe to re-run (already-merged ids just won't exist).
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const [primaryId, ...secondaryIds] = process.argv.slice(2).map((x) => parseInt(x, 10));
if (!primaryId || secondaryIds.some((x) => !x)) { console.error("usage: merge-customers <primaryId> <secondaryId> [more...]"); process.exit(1); }

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (s: string, p?: any[]) => (await c.query(s, p))[0] as any;

// tables that reference customers.id
const FK_TABLES = ["serviceHistory", "vehicles", "reminders", "reminderLogs", "payments", "customerLogs", "customerMessages", "appointments"];

try { await q("ALTER TABLE customers ADD COLUMN mergedExternalIds JSON"); } catch { /* exists */ }

const all = await q(`SELECT * FROM customers WHERE id IN (${[primaryId, ...secondaryIds].join(",")})`);
const primary = all.find((r: any) => r.id === primaryId);
const secondaries = secondaryIds.map((id) => all.find((r: any) => r.id === id)).filter(Boolean);
if (!primary) { console.error(`primary ${primaryId} not found`); process.exit(1); }
if (!secondaries.length) { console.error("no valid secondaries found"); process.exit(1); }

const hasTitle = (n: string) => /^(mr|mrs|ms|miss|dr|prof)\b/i.test(String(n || "").trim());
const fresher = (a: any, b: any) => (new Date(a.createdAt || 0) >= new Date(b.createdAt || 0) ? a : b);
const parseJson = (x: any) => { try { return typeof x === "string" ? JSON.parse(x) : (x || []); } catch { return []; } };

// 1) re-point every FK reference to the primary
let moved = 0;
for (const t of FK_TABLES) {
  const r = await q(`UPDATE ${t} SET customerId=? WHERE customerId IN (${secondaryIds.join(",")})`, [primaryId]);
  if (r.affectedRows) { console.log(`  ${t}: moved ${r.affectedRows}`); moved += r.affectedRows; }
}

// 2) best identity fields across primary + secondaries
const records = [primary, ...secondaries];
const best = <T,>(pick: (r: any) => T, score: (v: T) => number) => records.map(pick).filter(Boolean).sort((a, b) => score(b as T) - score(a as T))[0];
const name = best((r) => r.name, (n: any) => (hasTitle(n) ? 1000 : 0) + String(n).length) || primary.name;
const phone = primary.phone || secondaries.map((s: any) => s.phone).find(Boolean) || null;
const email = primary.email || secondaries.map((s: any) => s.email).find(Boolean) || null;
const freshest = records.reduce(fresher);
const address = freshest.address || primary.address || secondaries.map((s: any) => s.address).find(Boolean) || null;
const postcode = freshest.postcode || primary.postcode || secondaries.map((s: any) => s.postcode).find(Boolean) || null;

// 3) union alt-contacts (dedupe by phone, else name)
const seen = new Set<string>(); const altContacts: any[] = [];
for (const r of records) for (const ct of parseJson(r.altContacts)) {
  const k = String(ct.phone || ct.name || "").replace(/\s+/g, "").toLowerCase();
  if (k && !seen.has(k)) { seen.add(k); altContacts.push({ name: ct.name || "", phone: ct.phone || "" }); }
}

// 4) record the merged-away GA4 ids as aliases on the primary
const aliases = new Set<string>(parseJson(primary.mergedExternalIds));
for (const s of secondaries) { for (const a of parseJson(s.mergedExternalIds)) aliases.add(a); if (s.externalId && !String(s.externalId).startsWith("WEB-")) aliases.add(s.externalId); }

await q("UPDATE customers SET name=?, phone=?, email=?, address=?, postcode=?, altContacts=?, mergedExternalIds=? WHERE id=?",
  [name, phone, email, address, postcode, altContacts.length ? JSON.stringify(altContacts) : null, aliases.size ? JSON.stringify([...aliases]) : null, primaryId]);

// 5) delete the now-empty secondaries
await q(`DELETE FROM customers WHERE id IN (${secondaryIds.join(",")})`);

console.log(`\n✓ Merged ${secondaryIds.join(", ")} → ${primaryId} (${moved} references moved)`);
console.log(`  name="${name}"  phone=${phone}  ${postcode || ""}`);
console.log(`  alt-contacts: ${altContacts.length}  aliases: ${[...aliases].join(", ") || "none"}`);
await c.end();
process.exit(0);
