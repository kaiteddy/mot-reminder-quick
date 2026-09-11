/**
 * Switch MOT reminders off for cars with no work in four years, keeping owner and history intact.
 *
 *   npx tsx scripts/stop-reminders-stale-cars.ts          # DRY RUN — reports, writes nothing
 *   npx tsx scripts/stop-reminders-stale-cars.ts --go     # apply (backs up every row first)
 *
 * The rule, the evidence grades and why the owner is no longer cleared all live in
 * server/services/staleCarReminders.ts, which the daily /api/cron/stale-car-reminders job and
 * scripts/sync-ga4.ts also use. This replaces scripts/archive-stale-vehicle-owners.ts.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { findStaleCars, stopStaleCarReminders } from "../server/services/staleCarReminders";

const GO = process.argv.includes("--go");

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  const c = new Client({ connectionString: url });
  await c.connect();
  const query = (t: string, p?: unknown[]) => c.query(t, p as any[]);

  console.log(`\n===== STOP REMINDERS: STALE CARS ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  const preview = await findStaleCars(query);
  const d = (v: any) => new Date(v).toISOString().slice(0, 10);
  preview.slice(0, 15).forEach((v) =>
    console.log(`  ${v.registration.padEnd(10)} MOT ${d(v.motExpiryDate)}  last work ${d(v.lastActivity)}  tier ${v.verdict.tier} (${v.verdict.label}) — ${v.customerName ?? ""}`));
  if (preview.length > 15) console.log(`  … and ${preview.length - 15} more`);

  if (GO && preview.length) {
    const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `stop-reminders-stale-cars-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(preview.map((v) => ({
      vehicleId: v.id, registration: v.registration, customerId: v.customerId, customerName: v.customerName,
      before: { remindersOff: 0, remindersOffReason: null }, tier: v.verdict.tier, reason: v.verdict.reason,
    })), null, 2));
    console.log(`\nbacked up ${preview.length} row(s) to ${file}`);
  }

  const s = await stopStaleCarReminders(query, { apply: GO });
  console.log(`\nqualifying cars: ${s.found} (MOT due within 60 days: ${s.dueWithin60Days})`);
  Object.keys(s.byTier).sort().forEach((k) => console.log(`  tier ${k}: ${s.byTier[k]}`));
  console.log(GO ? `\n✓ reminders switched off on ${s.stopped} car(s)` : `\nDry run only — re-run with --go to apply.`);
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
