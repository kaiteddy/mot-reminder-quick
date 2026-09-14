/**
 * The morning follow-up check, 06:00 London. Adam, 14/09/2026: the Follow up list should look after itself.
 *
 * The midnight check (motExpiryCheck.ts) only asks DVSA about a car on the night its MOT runs out, so a car in
 * "Reminded, not done" that was tested early somewhere else stayed listed until then. Each morning this asks about:
 *  - every reminded car whose MOT runs out in the next DUE_AHEAD_DAYS days and hasn't been checked today;
 *  - every car whose follow-up went CALL_AFTER_DAYS or more ago and hasn't been checked since, so the "Call" step
 *    (shared/motFollowUp.ts) only ever asks for a phone call to someone still without an MOT.
 *
 * Scheduled at both UTC hours (vercel.json); only the one that is 06:00 in London acts. DVSA and DVLA are free.
 */
import type { Query } from "./staleCarReminders";
import type { PlateResult } from "./motRefreshRun";
import { MAX_PLATES, ukClock } from "./motExpiryCheck";
import { CALL_AFTER_DAYS, DUE_AHEAD_DAYS, MISSED_KEEP_DAYS, REMINDER_LEAD_DAYS } from "../../shared/motFollowUp";

/** True only in the quarter hour from 06:00 in London; the other of the pair of UTC runs skips. */
export function isFollowUpRecheckTime(now: Date): boolean {
  const { hour, minute } = ukClock(now);
  return hour === 6 && minute <= 15;
}

const ukDate = (column: string) => `(${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date`;
const MOT_DAY = ukDate(`COALESCE(v."motExpiryDate", v."firstMotDue")`);
const CHECKED_DAY = ukDate(`v."lastChecked"`);

/** Plates to ask about this morning, with the MOT date on file before asking. */
export async function findFollowUpRecheckPlates(query: Query, now: Date): Promise<{ registration: string; mot: string }[]> {
  const { rows } = await query(`
    SELECT v.registration, MAX(${MOT_DAY})::text AS mot
      FROM vehicles v
      JOIN customers cu ON cu.id = v."customerId"
     WHERE COALESCE(v."motExpiryDate", v."firstMotDue") IS NOT NULL
       AND v.registration !~ '[*(]'
       AND COALESCE(v."remindersOff", 0) = 0
       AND COALESCE(cu."optedOut", 0) = 0
       AND COALESCE(cu."noVehicleReminders", 0) = 0
       AND ${MOT_DAY} BETWEEN $1::date - $2::int AND $1::date + $3::int
       -- Sent the MOT reminder for this MOT (not a follow-up, not a rescue text).
       AND EXISTS (SELECT 1 FROM "reminderLogs" r
                    WHERE r."vehicleId" = v.id AND r."messageType" = 'MOT'
                      AND COALESCE(r."templateUsed", '') NOT LIKE 'urgent%'
                      AND COALESCE(r."templateUsed", '') NOT LIKE 'rescue-sms%'
                      AND ${ukDate(`r."sentAt"`)} >= ${MOT_DAY} - $4::int)
       AND (
         -- Reminded, not done: ask every morning until the MOT runs out.
         (${MOT_DAY} >= $1::date AND (v."lastChecked" IS NULL OR ${CHECKED_DAY} < $1::date))
         -- Followed up CALL_AFTER_DAYS ago or more and not checked since: ask before the page says "Call".
         OR EXISTS (SELECT 1 FROM "reminderLogs" f
                     WHERE f."vehicleId" = v.id AND f."templateUsed" LIKE 'urgent%'
                       AND ${ukDate(`f."sentAt"`)} >= ${MOT_DAY} - $4::int
                       AND ${ukDate(`f."sentAt"`)} + $5::int <= $1::date
                       AND (v."lastChecked" IS NULL OR ${CHECKED_DAY} < ${ukDate(`f."sentAt"`)} + $5::int))
       )
     GROUP BY v.registration
     ORDER BY mot
     LIMIT $6`, [ukClock(now).day, MISSED_KEEP_DAYS, DUE_AHEAD_DAYS, REMINDER_LEAD_DAYS, CALL_AFTER_DAYS, MAX_PLATES]);
  return rows.map((r) => ({ registration: r.registration, mot: String(r.mot).slice(0, 10) }));
}

export type FollowUpRecheckSummary = {
  day: string;
  plates: string[];
  checked: number;
  /** Came back with a later MOT than the one on file: tested, here or elsewhere. */
  renewed: number;
  stillOut: number;
  notAnswered: number;
  results: PlateResult[];
};

export async function runFollowUpRecheck(
  query: Query,
  refresh: (registrations: string[]) => Promise<PlateResult[]>,
  opts: { apply: boolean; now?: Date },
): Promise<FollowUpRecheckSummary> {
  const now = opts.now ?? new Date();
  const cars = await findFollowUpRecheckPlates(query, now);
  const summary: FollowUpRecheckSummary = {
    day: ukClock(now).day, plates: cars.map((c) => c.registration), checked: 0, renewed: 0, stillOut: 0, notAnswered: 0, results: [],
  };
  if (!opts.apply || cars.length === 0) return summary;

  const before = new Map<string, string>(cars.map((c) => [c.registration, c.mot]));
  summary.results = await refresh(summary.plates);
  for (const r of summary.results) {
    summary.checked++;
    if (!r.success || !r.motExpiryDate) summary.notAnswered++;
    else if (r.motExpiryDate.slice(0, 10) > (before.get(r.registration) ?? "")) summary.renewed++;
    else summary.stillOut++;
  }
  return summary;
}
