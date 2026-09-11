/**
 * Fill in the first-MOT due date for new cars from DVSA, so they come into the MOT reminder list.
 *
 *   npx tsx scripts/fill-first-mot-dates.ts          # DRY RUN — asks DVSA (free), writes nothing
 *   npx tsx scripts/fill-first-mot-dates.ts --go     # apply (backs up every candidate row first)
 *
 * Rule: server/services/firstMotReminders.ts, also run daily by /api/cron/first-mot-dates.
 * DVSA credentials come from the environment (DVSA_*): see the dvsa-mot-history-recipe note on
 * which secret is live.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { findFirstMotCandidates, runFirstMotCheck } from "../server/services/firstMotReminders";
import { getMOTHistory } from "../server/motApi";

const GO = process.argv.includes("--go");
const MAX = 2000;

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  const c = new Client({ connectionString: url });
  await c.connect();
  const query = (t: string, p?: unknown[]) => c.query(t, p as any[]);
  const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

  console.log(`\n===== FIRST-MOT DATES FROM DVSA ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  const now = new Date();
  if (GO) {
    const candidates = await findFirstMotCandidates(query, now, MAX);
    if (candidates.length) {
      const { rows } = await query(`SELECT id, registration, "motExpiryDate", "firstMotDue", "firstMotCheckedAt" FROM vehicles WHERE id = ANY($1::int[])`, [candidates.map((x) => x.id)]);
      const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `fill-first-mot-dates-${now.toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(file, JSON.stringify(rows, null, 2));
      console.log(`backed up ${rows.length} row(s) to ${file}`);
    }
  }

  const s = await runFirstMotCheck(query, (reg) => getMOTHistory(reg), { apply: GO, max: MAX, paceMs: 200, now });
  for (const car of s.cars) {
    const f = car.finding;
    const what = f.kind === "awaiting_first" ? `first MOT due ${d(f.due)}${f.due < now ? "  ← OVERDUE" : ""}`
      : f.kind === "tested" ? (f.expiry ? `already tested, MOT expiry ${d(f.expiry)} (was blank)` : "tested, never passed")
      : "no DVSA record";
    console.log(`  ${String(car.registration).padEnd(10)} ${car.customerId ? "owner   " : "no owner"}  ${what}`);
  }
  console.log(`\nasked DVSA about ${s.checked}: awaiting first MOT ${s.awaitingFirst} (overdue ${s.overdue}, due within 60 days ${s.dueWithin60Days}), already tested ${s.tested} (blank MOT expiry filled ${s.expiryFilled}), no record ${s.noRecord}, errors ${s.errors}`);
  if (s.stopped) console.log(`STOPPED: ${s.stopped}`);
  console.log(GO ? `\n✓ applied (first-MOT dates cleared on cars since tested: ${s.cleared})` : `\nDry run only — re-run with --go to apply.`);
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
