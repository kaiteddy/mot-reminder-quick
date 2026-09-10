/**
 * Ask DVLA about every vehicle in the database and record exactly what it says.
 *
 *   npx tsx scripts/scan-dvla-all-vehicles.ts                 # DRY RUN: asks DVLA, writes nothing
 *   npx tsx scripts/scan-dvla-all-vehicles.ts --go            # record the answers
 *   npx tsx scripts/scan-dvla-all-vehicles.ts --go --limit 20 # a trial on 20 cars
 *
 * Resumable: a car DVLA answered in the last 24 hours is skipped, so stopping and starting again
 * picks up where it left off. Free (DVLA's Vehicle Enquiry Service costs nothing), paced at one
 * request every 1.5 seconds like the hourly refresh, so all ~11,500 cars take about five hours.
 * Stops at once if DVLA rejects the key; waits a minute and retries if it rate-limits us.
 *
 * Records written by server/services/dvlaRecord.ts — see there for what changed and why. GA4's
 * renamed records ("241DK (05/11/18)") are never looked up: their plate is on another car now.
 */
import "dotenv/config";
import { Client } from "pg";
import { lookupVehicle } from "../server/dvlaApi";
import { dvlaUpdateFor, isSupersededRegistration, type DvlaUpdate } from "../server/services/dvlaRecord";

const GO = process.argv.includes("--go");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const PACE_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function write(c: Client, id: number, u: DvlaUpdate) {
  const keys = Object.keys(u) as (keyof DvlaUpdate)[];
  if (!keys.length) return;
  const sets = keys.map((k, i) => `"${k}" = $${i + 2}`).join(", ");
  await c.query(`UPDATE vehicles SET ${sets} WHERE id = $1`, [id, ...keys.map((k) => u[k])]);
}

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  if (!process.env.DVLA_API_KEY) throw new Error("DVLA_API_KEY is not set");
  const c = new Client({ connectionString: url });
  await c.connect();

  const { rows: cars } = await c.query(`
    SELECT id, registration, make, colour, "fuelType", "dateOfRegistration"
      FROM vehicles
     WHERE "dvlaAnsweredAt" IS NULL OR "dvlaAnsweredAt" < now() - interval '24 hours'
     ORDER BY id`);
  const todo = cars.slice(0, Number.isFinite(LIMIT) ? LIMIT : cars.length);
  console.log(`\n===== DVLA SCAN ${GO ? "(RECORDING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`${cars.length} vehicle(s) not answered in the last 24h; scanning ${todo.length}. Started ${new Date().toISOString()}`);

  const n: Record<string, number> = {};
  const bump = (k: string) => { n[k] = (n[k] ?? 0) + 1; };
  const started = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const v = todo[i];
    if (isSupersededRegistration(v.registration)) {
      bump("superseded");
      if (GO) await write(c, v.id, { dvlaStatus: "superseded" });
      continue;
    }
    let r = await lookupVehicle(v.registration);
    for (let tries = 0; r.outcome === "rate_limited" && tries < 5; tries++) {
      console.log(`  rate limited at ${v.registration}; waiting 60s`);
      await sleep(60_000);
      r = await lookupVehicle(v.registration);
    }
    if (r.outcome === "auth_failed" || r.outcome === "no_key") {
      console.error(`\nDVLA rejected the API key (HTTP ${r.httpStatus ?? "-"}) at ${v.registration}. Stopping; nothing further written.`);
      break;
    }
    bump(r.outcome === "found" ? `found: ${r.data?.taxStatus ?? "no tax status"}` : r.outcome);
    if (GO) await write(c, v.id, dvlaUpdateFor(v, r).update);

    if ((i + 1) % 250 === 0) {
      const mins = (Date.now() - started) / 60000;
      const left = ((todo.length - i - 1) * mins) / (i + 1);
      console.log(`  ${i + 1}/${todo.length} after ${mins.toFixed(0)} min, ~${left.toFixed(0)} min left  ${JSON.stringify(n)}`);
    }
    if (r.outcome !== "invalid_plate") await sleep(PACE_MS);
  }

  console.log(`\nDone ${new Date().toISOString()}:`, n);
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
