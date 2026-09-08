/**
 * Stop MOT reminders for cars the customer has almost certainly replaced.
 *
 *   npx tsx scripts/stop-reminders-replaced-cars.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/stop-reminders-replaced-cars.ts --go   # apply (backs up every row first)
 *
 * The signal is Adam's, and it is sharper than "we have not seen this car lately": the same
 * person came BACK, years later, with a DIFFERENT car. On 08/09/2026 three of the eight replies
 * to the morning's reminders were customers saying they no longer had the car — one of them
 * about a car last worked on in 2015.
 *
 * "The same person" is keyed on their PHONE, not their customer record, because a person is
 * routinely split across several records (677 numbers are shared). Mrs Weiss is exactly that:
 * her 2015 car sits under one record and the car she drives today under another, so grouping by
 * record alone cannot see that she replaced it.
 *
 * What this does NOT do: guess at ownership. The customer link and the full history stay exactly
 * as they are — only `vehicles.remindersOff` is set, with the evidence written into
 * `remindersOffReason`, and one click on the vehicle page turns it back on. That is the whole
 * point of the flag over clearing the owner: we believe they replaced the car, we do not know it.
 *
 * Two things are deliberately excluded:
 *   - cars with no history at all, whose "gap" is meaningless (they were never seen, and some
 *     are mistyped plates — seven such phantoms were deleted on 08/09/2026);
 *   - anything already switched off, opted out, or on a trade account.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

const GO = process.argv.includes("--go");
/** Reminders due inside this window. Matches the batch Adam reviewed. */
const DUE_WITHIN_DAYS = Number(process.env.DUE_WITHIN_DAYS || 60);
/** How much later they must have come back with another car for us to believe this one is gone. */
const GAP_YEARS = Number(process.env.GAP_YEARS || 2);

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  const c = new Client({ connectionString: url });
  await c.connect();

  // Last activity per car, by BOTH the vehicle link and the registration: 2,611 documents carry
  // a registration but no vehicle link, and counting only the link makes a regular look like a
  // stranger. Ignore the epoch sentinel — that means "never seen", not "seen long ago".
  // Neon's pooler hands back a session that may already hold this table from a previous run.
  await c.query(`DROP TABLE IF EXISTS act`);
  await c.query(`CREATE TEMP TABLE act AS
    SELECT v.id,
           regexp_replace(regexp_replace(COALESCE(cu.phone,''),'[^0-9]','','g'),'^(44|0)','') AS pkey,
           v.registration, v.make, v.model, v."customerId", v."motExpiryDate", cu.name AS "customerName",
           GREATEST(
             COALESCE((SELECT MAX(GREATEST(COALESCE(s."dateIssued",'1900-01-01'::timestamp), COALESCE(s."dateCreated",'1900-01-01'::timestamp)))
                         FROM "serviceHistory" s WHERE s."vehicleId" = v.id), '1900-01-01'::timestamp),
             COALESCE((SELECT MAX(GREATEST(COALESCE(s2."dateIssued",'1900-01-01'::timestamp), COALESCE(s2."dateCreated",'1900-01-01'::timestamp)))
                         FROM "serviceHistory" s2 WHERE REPLACE(UPPER(s2.registration),' ','') = REPLACE(UPPER(v.registration),' ','')), '1900-01-01'::timestamp)
           ) AS last_act
      FROM vehicles v
      JOIN customers cu ON cu.id = v."customerId"
     WHERE COALESCE(cu."optedOut",0) = 0
       AND COALESCE(cu."noVehicleReminders",0) = 0
       AND COALESCE(v."remindersOff",0) = 0
       AND length(regexp_replace(regexp_replace(COALESCE(cu.phone,''),'[^0-9]','','g'),'^(44|0)','')) >= 7`);
  await c.query(`CREATE INDEX ON act(pkey)`);

  const { rows } = await c.query(
    `SELECT a.id, a.registration, a.make, a.model, a."customerId", a."customerName", a.last_act,
            a."motExpiryDate", n.registration AS newer_reg, n.last_act AS newer_last
       FROM act a
       JOIN LATERAL (SELECT x.registration, x.last_act FROM act x
                      WHERE x.pkey = a.pkey AND x.id <> a.id
                      ORDER BY x.last_act DESC LIMIT 1) n ON true
      WHERE a."motExpiryDate" BETWEEN now() AND now() + ($1 || ' days')::interval
        AND a.last_act > '1900-01-01'
        AND n.last_act > a.last_act + ($2 || ' years')::interval
      ORDER BY a."motExpiryDate"`,
    [String(DUE_WITHIN_DAYS), String(GAP_YEARS)],
  );

  const d = (v: any) => new Date(v).toISOString().slice(0, 10);
  console.log(`\n===== STOP REMINDERS: REPLACED CARS ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`Due within ${DUE_WITHIN_DAYS} days, owner back with another car ${GAP_YEARS}+ years later: ${rows.length}`);

  const backup: any[] = [];
  for (const v of rows) {
    const reason =
      `Reminders stopped ${d(Date.now())} — no work on this car since ${d(v.last_act)}, and the same number was ` +
      `back with ${v.newer_reg} on ${d(v.newer_last)}, so this car has probably been replaced. ` +
      `Owner and history unchanged; switch reminders back on from the vehicle page if it is still theirs.`;
    console.log(`  ${GO ? "STOP" : "would stop"} ${v.registration} (${v.make} ${v.model}) — ${v.customerName}: last seen ${d(v.last_act)}, back with ${v.newer_reg} ${d(v.newer_last)}`);
    if (!GO) continue;
    backup.push({ vehicleId: v.id, registration: v.registration, customerId: v.customerId, customerName: v.customerName, lastSeen: v.last_act, newerCar: v.newer_reg, reason });
    await c.query(
      `UPDATE vehicles SET "remindersOff" = 1, "remindersOffAt" = now(), "remindersOffReason" = $1 WHERE id = $2 AND COALESCE("remindersOff",0) = 0`,
      [reason, v.id],
    );
  }

  if (GO && backup.length) {
    const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `stop-reminders-replaced-cars-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ stopped reminders on ${backup.length} car(s); backed up to ${file}`);
  } else if (!GO && rows.length) {
    console.log(`\nDry run only — re-run with --go to apply.`);
  }
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
