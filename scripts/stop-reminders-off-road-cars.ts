/**
 * Switch MOT reminders off for cars that are off the road: SORN, or no MOT pass in three years.
 *
 *   npx tsx scripts/stop-reminders-off-road-cars.ts          # DRY RUN — reports, writes nothing
 *   npx tsx scripts/stop-reminders-off-road-cars.ts --go     # apply (backs up every row first)
 *
 * Rule and wording: server/services/offRoadCarReminders.ts, also run daily by
 * /api/cron/off-road-car-reminders, which additionally switches reminders back on when DVLA shows
 * a car taxed with a valid MOT again.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { findOffRoadCars, runOffRoadCheck } from "../server/services/offRoadCarReminders";

const GO = process.argv.includes("--go");

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  const c = new Client({ connectionString: url });
  await c.connect();
  const query = (t: string, p?: unknown[]) => c.query(t, p as any[]);
  const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

  console.log(`\n===== STOP REMINDERS: OFF-ROAD CARS ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  const preview = await findOffRoadCars(query);
  preview.forEach((v) =>
    console.log(`  ${String(v.registration).padEnd(10)} ${String(v.taxStatus ?? "").padEnd(8)} MOT ${d(v.motExpiryDate)}  last job ${d(v.lastJob)}  ${v.verdict.label} — ${v.customerName ?? ""}`));

  if (GO && preview.length) {
    const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `stop-reminders-off-road-cars-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(preview.map((v) => ({
      vehicleId: v.id, registration: v.registration, customerId: v.customerId, customerName: v.customerName,
      taxStatus: v.taxStatus, motExpiryDate: v.motExpiryDate, before: { remindersOff: 0 }, kind: v.verdict.kind, reason: v.verdict.reason,
    })), null, 2));
    console.log(`\nbacked up ${preview.length} row(s) to ${file}`);
  }

  const s = await runOffRoadCheck(query, { apply: GO });
  console.log(`\noff-road cars: ${s.found} (of which had a job with us in the last 12 months: ${s.recentCustomers})`);
  Object.keys(s.byKind).sort().forEach((k) => console.log(`  ${k}: ${s.byKind[k]}`));
  console.log(`back on the road since being switched off: ${s.backOnRoad}`);
  console.log(GO ? `\n✓ switched off ${s.stopped}, switched back on ${s.restarted}` : `\nDry run only — re-run with --go to apply.`);
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
