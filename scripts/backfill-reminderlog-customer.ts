/**
 * Give every sent reminder a customer.
 *
 * The reminder screens send by VEHICLE and never passed a customer, so `reminderLogs.customerId`
 * was left null on 3,283 rows. A message filed against nobody never appears in that customer's
 * conversation thread — on 08/09/2026 Mrs Duboff's thread showed only her "STOP" reply, with the
 * MOT reminder she was actually answering nowhere to be seen. (The send path now resolves the
 * customer itself; this repairs the history.)
 *
 * Attribution, in order:
 *   1. The number we actually texted, matched on the national core ("+4478…" == "078…"). A phone
 *      shared by duplicate records is ambiguous, so a multi-way match is only resolved when the
 *      vehicle's owner is one of them.
 *   2. Failing that, the owner of the vehicle the reminder was about.
 * Anything still ambiguous is left alone — a wrong thread is worse than a missing one.
 *
 *   npx tsx scripts/backfill-reminderlog-customer.ts        # report only
 *   npx tsx scripts/backfill-reminderlog-customer.ts --go   # write
 */
import { config } from "dotenv";
config();
import { Client } from "pg";

const GO = process.argv.includes("--go");

const core = (v: unknown) => {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("44")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d;
};

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  const db = new Client({ connectionString: url });
  await db.connect();

  // Every customer, keyed by the national core of their phone. One core can hold several
  // customers (duplicate records sharing a number) — that is exactly the ambiguous case.
  const byPhone = new Map<string, number[]>();
  const { rows: custs } = await db.query(`SELECT id, phone FROM customers WHERE COALESCE(phone,'') <> ''`);
  for (const c of custs) {
    const k = core(c.phone);
    if (k.length < 7) continue;
    byPhone.set(k, [...(byPhone.get(k) ?? []), Number(c.id)]);
  }

  const { rows: owners } = await db.query(`SELECT id, "customerId" FROM vehicles WHERE "customerId" IS NOT NULL`);
  const vehicleOwner = new Map<number, number>(owners.map((v: any) => [Number(v.id), Number(v.customerId)]));

  const { rows: logs } = await db.query(
    `SELECT id, recipient, "vehicleId" FROM "reminderLogs" WHERE "customerId" IS NULL ORDER BY id`,
  );

  const updates: { id: number; customerId: number }[] = [];
  const stats = { phone: 0, vehicle: 0, ambiguous: 0, unknown: 0 };

  for (const log of logs) {
    const owner = log.vehicleId != null ? vehicleOwner.get(Number(log.vehicleId)) : undefined;
    const matches = byPhone.get(core(log.recipient)) ?? [];

    let customerId: number | undefined;
    if (matches.length === 1) { customerId = matches[0]; stats.phone++; }
    else if (matches.length > 1 && owner && matches.includes(owner)) { customerId = owner; stats.phone++; }
    else if (matches.length > 1) { stats.ambiguous++; }
    else if (owner) { customerId = owner; stats.vehicle++; }
    else { stats.unknown++; }

    if (customerId) updates.push({ id: Number(log.id), customerId });
  }

  console.log(
    `${logs.length} unattributed reminder logs — matched by phone ${stats.phone}, by vehicle owner ${stats.vehicle}; ` +
    `left alone: ${stats.ambiguous} ambiguous (shared phone), ${stats.unknown} unknown number`,
  );
  if (!GO) { console.log("Report only — re-run with --go to write."); await db.end(); return; }

  await db.query("BEGIN");
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    await db.query(
      `UPDATE "reminderLogs" AS r SET "customerId" = v.cid
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS cid) AS v
        WHERE r.id = v.id AND r."customerId" IS NULL`,
      [batch.map((u) => u.id), batch.map((u) => u.customerId)],
    );
  }
  await db.query("COMMIT");
  console.log(`Updated ${updates.length} rows.`);
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
