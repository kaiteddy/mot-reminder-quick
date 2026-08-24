/**
 * The 15/01/2026 14:36 import: 122 customer records, none of which has ever been used.
 *
 * None has a document, vehicle, reminder, payment, message or appointment against it, and none
 * has an account number, external id, address or email. They are names and phone numbers —
 * evidently a phone contacts export mapped into the wrong columns, since several have a label
 * ("work", "office", "nita") sitting in the phone field where the last digits should be.
 *
 * The instinct is to delete all 122, but 83 of them carry a mobile that appears NOWHERE else in
 * the customer base. Those are the only copy of that number we hold, so they stay. What goes is
 * only what cannot be of use:
 *
 *   31  name only, no phone — and 30 of the 31 share a name with an existing customer
 *    6  phone truncated to 10 digits with a text label glued on; the missing digit is gone
 *    1  phone already on a real customer (#60664 "Rogers" -> #540880 "Mr Daniel Rogers")
 *   --
 *   38  deleted, 84 kept
 *
 * NOT deleted: #60114 "Neville Levy" +31639466978 — unparseable only because it's a
 * Netherlands number, not a broken UK one.
 *
 * Run with --apply to write; without it, this is a dry run.
 */
import { getDb, normPhoneKey } from "../server/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const FROM = "2026-01-15 14:36:00";
const TO = "2026-01-15 14:37:00";
/** A phone that's only unparseable because it isn't British. */
const looksForeign = (p: string) => /^\+(?!44)\d{7,15}$/.test(String(p || "").replace(/\s+/g, ""));

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) throw new Error("no db");

  const batch: any = await db.execute(sql`
    SELECT * FROM customers WHERE "createdAt" BETWEEN ${FROM} AND ${TO} ORDER BY id`);
  const others: any = await db.execute(sql`
    SELECT id, name, phone FROM customers
    WHERE NOT ("createdAt" BETWEEN ${FROM} AND ${TO}) AND phone IS NOT NULL`);

  const known = new Map<string, any>();
  for (const o of others.rows) {
    const k = normPhoneKey(o.phone);
    if (k && !known.has(k)) known.set(k, o);
  }

  const del: any[] = [], keep: any[] = [];
  for (const r of batch.rows) {
    const phone = String(r.phone || "").trim();
    const key = phone ? normPhoneKey(phone) : null;
    let reason: string | null = null;
    if (!phone) reason = "name only, no phone";
    else if (!key && !looksForeign(phone)) reason = "phone truncated by a text label";
    else if (key && known.has(key)) reason = `phone already on #${known.get(key).id} ${known.get(key).name}`;
    if (reason) del.push({ ...r, reason }); else keep.push(r);
  }

  console.log(`BATCH ${batch.rows.length}  ->  delete ${del.length}, keep ${keep.length}`);
  const byReason: Record<string, number> = {};
  for (const d of del) {
    const k = d.reason.startsWith("phone already") ? "phone already on a real customer" : d.reason;
    byReason[k] = (byReason[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(byReason)) console.log(`   ${String(n).padStart(3)}  ${k}`);

  // Anything attached would make a record real; verified empty before this runs, and re-checked
  // here so the script can never delete something that has since been used.
  const ids = del.map((d) => d.id);
  if (ids.length) {
    const used: any = await db.execute(sql`
      SELECT COUNT(*) n FROM (
        SELECT "customerId" FROM "serviceHistory" WHERE "customerId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        UNION ALL SELECT "customerId" FROM vehicles WHERE "customerId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        UNION ALL SELECT "customerId" FROM reminders WHERE "customerId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        UNION ALL SELECT "customerId" FROM payments WHERE "customerId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        UNION ALL SELECT "customerId" FROM appointments WHERE "customerId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      ) t`);
    console.log(`\n   safety check — rows attached to anything being deleted: ${used.rows[0].n}`);
    if (Number(used.rows[0].n) > 0) throw new Error("ABORT: something is attached; not deleting");
  }

  if (!apply) { console.log("\nDRY RUN — re-run with --apply to write."); process.exit(0); }

  const dir = join(process.cwd(), "scripts", ".cleanup-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `jan-import-cleanup-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ deleted: del, kept: keep.map((k) => ({ id: k.id, name: k.name, phone: k.phone })) }, null, 2));
  console.log(`\nBACKUP  ${file}`);

  await db.execute(sql`DELETE FROM "customerLogs" WHERE "customerId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM customers WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);

  // Trailing junk on a kept number ("+447956242185**") — the digits are sound, the tail isn't.
  let tidied = 0;
  for (const k of keep) {
    const raw = String(k.phone || "");
    const cleaned = raw.replace(/[^\d+]+$/g, "").trim();
    if (cleaned && cleaned !== raw) {
      await db.execute(sql`UPDATE customers SET phone = ${cleaned} WHERE id = ${k.id}`);
      tidied++;
    }
  }

  const left: any = await db.execute(sql`SELECT COUNT(*) n FROM customers WHERE "createdAt" BETWEEN ${FROM} AND ${TO}`);
  console.log(`DELETED ${ids.length} · tidied ${tidied} phone numbers · ${left.rows[0].n} of the batch remain`);
  process.exit(0);
}

main();
