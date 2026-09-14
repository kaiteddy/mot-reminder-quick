/**
 * The midnight MOT check. Adam, 14/09/2026: cars whose MOT runs out should be "checked 11:59pm and then
 * 00:01am the next day to check if they had the MOT elsewhere", so the MOT Reminders "Follow up" tab
 * (shared/motFollowUp.ts) never chases a car that was tested somewhere else on its last day.
 *
 *  - 23:59 in London ("last_day"): cars whose MOT runs out today.
 *  - 00:01 in London ("day_after"): cars whose MOT ran out yesterday, plus any car whose MOT ran out in
 *    the 14 days before that and has not been checked since, in case a night was missed.
 *
 * Vercel's clock is UTC and the UK's moves twice a year, so each run is scheduled at both possible UTC
 * hours (vercel.json) and only acts when it really is 23:59 or 00:01 in London; the other one skips.
 * Only cars that could be reminded are asked about. DVSA and DVLA are free.
 */
import type { Query } from "./staleCarReminders";
import type { PlateResult } from "./motRefreshRun";

export type ExpiryCheckMode = "last_day" | "day_after";
export const CATCH_UP_DAYS = 14;
export const MAX_PLATES = 150;

/** The date, hour and minute in London at a given moment. */
export function ukClock(now: Date): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")), minute: Number(part("minute")) };
}

/** Which run this is by the clock in London, or null when it is the other of the pair of UTC hours. */
export function expiryCheckModeAt(now: Date): ExpiryCheckMode | null {
  const { hour, minute } = ukClock(now);
  if (hour === 23 && minute >= 45) return "last_day";
  if (hour === 0 && minute <= 15) return "day_after";
  return null;
}

/** The UK calendar day a run is about: today for the 23:59 run, yesterday for the 00:01 run. */
export function expiryDayFor(mode: ExpiryCheckMode, now: Date): string {
  const today = ukClock(now).day;
  if (mode === "last_day") return today;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const UK_MOT_DAY = `(COALESCE(v."motExpiryDate", v."firstMotDue") AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date`;

/** Plates to ask about on this run. */
export async function findExpiryCheckPlates(query: Query, mode: ExpiryCheckMode, now: Date): Promise<string[]> {
  const { rows } = await query(`
    SELECT v.registration, MAX(COALESCE(v."motExpiryDate", v."firstMotDue")) AS mot
      FROM vehicles v
      JOIN customers cu ON cu.id = v."customerId"
     WHERE COALESCE(v."motExpiryDate", v."firstMotDue") IS NOT NULL
       AND v.registration !~ '[*(]'
       AND COALESCE(v."remindersOff", 0) = 0
       AND COALESCE(cu."optedOut", 0) = 0
       AND COALESCE(cu."noVehicleReminders", 0) = 0
       AND (${UK_MOT_DAY} = $1::date
            OR ($2::boolean
                AND ${UK_MOT_DAY} BETWEEN $1::date - $3::int AND $1::date - 1
                AND (v."lastChecked" IS NULL
                     OR (v."lastChecked" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date <= ${UK_MOT_DAY})))
     GROUP BY v.registration
     ORDER BY mot DESC
     LIMIT $4`, [expiryDayFor(mode, now), mode === "day_after", CATCH_UP_DAYS, MAX_PLATES]);
  return rows.map((r) => r.registration);
}

export type ExpiryCheckSummary = {
  mode: ExpiryCheckMode;
  day: string;
  plates: string[];
  checked: number;
  /** Came back with an MOT running past the day being checked: tested, here or elsewhere. */
  renewed: number;
  stillOut: number;
  notAnswered: number;
  results: PlateResult[];
};

export async function runExpiryCheck(
  query: Query,
  refresh: (registrations: string[]) => Promise<PlateResult[]>,
  opts: { mode: ExpiryCheckMode; apply: boolean; now?: Date },
): Promise<ExpiryCheckSummary> {
  const now = opts.now ?? new Date();
  const day = expiryDayFor(opts.mode, now);
  const plates = await findExpiryCheckPlates(query, opts.mode, now);
  const summary: ExpiryCheckSummary = { mode: opts.mode, day, plates, checked: 0, renewed: 0, stillOut: 0, notAnswered: 0, results: [] };
  if (!opts.apply || plates.length === 0) return summary;

  summary.results = await refresh(plates);
  for (const r of summary.results) {
    summary.checked++;
    if (!r.success || !r.motExpiryDate) summary.notAnswered++;
    else if (r.motExpiryDate.slice(0, 10) > day) summary.renewed++;
    else summary.stillOut++;
  }
  return summary;
}
