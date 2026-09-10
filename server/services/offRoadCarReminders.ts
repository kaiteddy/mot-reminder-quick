/**
 * Stop MOT reminders for cars that are off the road, and start them again if the car comes back.
 *
 * Adam, 10/09/2026: "if someone hasn't had their MOT in the last 3 years remove them from
 * reminders or turn it off, because it is more than likely the car is not on the road, you should
 * be able to check SORN status as well."
 *
 * Two DVLA facts, both already on every car (the daily DVLA check is free and keeps them fresh):
 *   - SORN: the keeper has declared the car off the road. It cannot legally be driven, so a
 *     reminder about its MOT is noise.
 *   - No MOT pass in three years. DVLA holds the MOT EXPIRY, and a pass lasts a year, so an expiry
 *     more than two years ago means the last pass was more than three years ago. Such a car can
 *     be neither taxed nor driven; none of them shows as taxed.
 *
 * Unlike the stale-car rule these are facts about today that can change, so the switch lifts
 * itself: when DVLA shows the car taxed with a valid MOT again, reminders come back on, with a
 * note. Everything else is as for stale cars — owner and history untouched, the reason written on
 * the car, and a car turned back on by hand is never switched off again by a check.
 *
 * Only data DVLA confirmed within the last 45 days is acted on — by `dvlaAnsweredAt`, which moves
 * only when DVLA really answered, not `lastChecked`, which used to move even when it had not.
 *
 * Widened 10/09/2026 after scanning the whole database ("Can we scan the entire database"):
 *   - every car, not only those currently being reminded. 257 off-road cars had no owner, and GA4's
 *     nightly import attaches owners, so they would have walked back into the reminder list; trade
 *     and opted-out cars are covered too, so the car's own record is right whoever owns it.
 *   - a third fact: DVLA has no record of the plate at all (scrapped, exported, or the plate has
 *     gone to another car).
 */
import { KEPT_ON_MARKER, type Query } from "./staleCarReminders";

export const NO_PASS_YEARS = 3;
export const DVLA_FRESH_DAYS = 45;
/** Stable phrase in every reason this check writes; the auto-lift finds its own cars by it. */
export const OFF_ROAD_TAG = "Off the road:";
export const AUTO_ON_MARKER = "Switched back on automatically";

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const ukDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/London" });

export type OffRoadKind = "not_found" | "sorn_and_no_mot" | "no_mot" | "sorn";
export type OffRoadVerdict = { kind: OffRoadKind; label: string; reason: string };

/** Is this car off the road, and how do we say so? Pure. Null means keep reminding. */
export function offRoadVerdict(
  v: { taxStatus?: string | null; motExpiryDate?: Date | string | null; dvlaStatus?: string | null },
  now: Date = new Date(),
): OffRoadVerdict | null {
  const tail0 = ` Owner and history unchanged. Reminders switch back on by themselves if DVLA shows it taxed with a valid MOT again.`;
  if (v.dvlaStatus === "not_found") {
    return { kind: "not_found", label: "DVLA has no record of the plate", reason: `Reminders stopped ${ukDate(now)}. ${OFF_ROAD_TAG} DVLA has no record of this registration, so the car has been scrapped or exported, or the plate has moved to another vehicle.${tail0}` };
  }
  if (!v.motExpiryDate) {
    return String(v.taxStatus || "").trim().toUpperCase() === "SORN"
      ? { kind: "sorn", label: "SORN, MOT more recent", reason: `Reminders stopped ${ukDate(now)}. ${OFF_ROAD_TAG} DVLA shows it declared SORN, off the road. It has not needed an MOT yet.${tail0}` }
      : null;
  }
  const expiry = new Date(v.motExpiryDate);
  const sorn = String(v.taxStatus || "").trim().toUpperCase() === "SORN";
  // A pass lasts a year: expiry more than (3 - 1) years ago means no pass for over 3 years.
  const noMot = expiry.getTime() < now.getTime() - (NO_PASS_YEARS - 1) * YEAR_MS;
  if (!sorn && !noMot) return null;

  const sincePass = Math.floor((now.getTime() - expiry.getTime()) / YEAR_MS) + 1;
  const head = `Reminders stopped ${ukDate(now)}. ${OFF_ROAD_TAG}`;
  const mot = `its last MOT ran out on ${ukDate(expiry)}, so it has not passed one in over ${sincePass} years`;
  const tail = ` Owner and history unchanged. Reminders switch back on by themselves if DVLA shows it taxed with a valid MOT again.`;

  if (sorn && noMot) return { kind: "sorn_and_no_mot", label: "SORN and no MOT in 3+ years", reason: `${head} DVLA shows it declared SORN, and ${mot}.${tail}` };
  if (noMot) return { kind: "no_mot", label: "no MOT pass in 3+ years", reason: `${head} ${mot[0].toUpperCase()}${mot.slice(1)}${v.taxStatus ? `, and DVLA shows it ${String(v.taxStatus).toLowerCase()}` : ""}.${tail}` };
  return { kind: "sorn", label: "SORN, MOT more recent", reason: `${head} DVLA shows it declared SORN, off the road. Its MOT ${expiry.getTime() >= now.getTime() ? "is valid until" : "ran out on"} ${ukDate(expiry)}.${tail}` };
}

export type OffRoadCar = {
  id: number; registration: string; customerId: number | null; customerName: string | null;
  motExpiryDate: Date | string | null; taxStatus: string | null; dvlaStatus: string | null;
  lastJob: Date | string | null; verdict: OffRoadVerdict;
};

export async function findOffRoadCars(query: Query, now: Date = new Date()): Promise<OffRoadCar[]> {
  const { rows } = await query(`
    SELECT v.id, v.registration, v."customerId", cu.name "customerName", v."motExpiryDate", v."taxStatus", v."dvlaStatus",
           (SELECT MAX(COALESCE(s."dateIssued",s."dateCreated")) FROM "serviceHistory" s WHERE s."vehicleId" = v.id) "lastJob"
      FROM vehicles v
      LEFT JOIN customers cu ON cu.id = v."customerId"
     WHERE COALESCE(v."remindersOff",0) = 0
       AND COALESCE(v."remindersOffReason",'') NOT ILIKE $1
       AND v."dvlaAnsweredAt" > $2::timestamptz - interval '${DVLA_FRESH_DAYS} days'
       AND (v."dvlaStatus" = 'not_found'
            OR (v."dvlaStatus" = 'found' AND (UPPER(TRIM(COALESCE(v."taxStatus",''))) = 'SORN'
                 OR v."motExpiryDate" < $2::timestamptz - interval '${NO_PASS_YEARS - 1} years')))
     ORDER BY v."motExpiryDate" DESC`, [`${KEPT_ON_MARKER}%`, now.toISOString()]);
  return rows
    .map((r) => ({ ...r, verdict: offRoadVerdict(r, now) }))
    .filter((r): r is OffRoadCar => r.verdict !== null);
}

/** Cars this check switched off that DVLA now shows back on the road: taxed, MOT valid. */
export async function findBackOnRoad(query: Query, now: Date = new Date()) {
  const { rows } = await query(`
    SELECT id, registration, "motExpiryDate" FROM vehicles
     WHERE COALESCE("remindersOff",0) = 1
       AND "remindersOffReason" ILIKE $1
       AND "dvlaStatus" = 'found'
       AND UPPER(TRIM(COALESCE("taxStatus",''))) = 'TAXED'
       AND "motExpiryDate" > $2::timestamptz
       AND "dvlaAnsweredAt" > $2::timestamptz - interval '${DVLA_FRESH_DAYS} days'`, [`%${OFF_ROAD_TAG}%`, now.toISOString()]);
  return rows as { id: number; registration: string; motExpiryDate: Date | string }[];
}

export type OffRoadRunSummary = {
  found: number; stopped: number; backOnRoad: number; restarted: number;
  byKind: Record<string, number>; recentCustomers: number; refused?: string; cars: OffRoadCar[];
};

/** Switch reminders off for off-road cars and back on for returned ones. `maxPerRun` is a tripwire. */
export async function runOffRoadCheck(query: Query, opts: { apply: boolean; maxPerRun?: number; now?: Date }): Promise<OffRoadRunSummary> {
  const now = opts.now ?? new Date();
  const cars = await findOffRoadCars(query, now);
  const back = await findBackOnRoad(query, now);
  const byKind: Record<string, number> = {};
  let recentCustomers = 0;
  cars.forEach((c) => {
    byKind[c.verdict.label] = (byKind[c.verdict.label] ?? 0) + 1;
    if (c.lastJob && new Date(c.lastJob).getTime() > now.getTime() - YEAR_MS) recentCustomers++;
  });
  const s: OffRoadRunSummary = { found: cars.length, stopped: 0, backOnRoad: back.length, restarted: 0, byKind, recentCustomers, cars };
  if (!opts.apply) return s;

  const cap = opts.maxPerRun ?? Infinity;
  if (cars.length > cap || back.length > cap) {
    s.refused = `${cars.length} to switch off and ${back.length} to switch on, over the ${cap} limit for one run; nothing changed`;
    return s;
  }
  // Back on first, so a car cannot be switched off and on in the same run.
  if (back.length) {
    const batch = back.map((b) => ({ id: b.id, reason: `${AUTO_ON_MARKER} ${ukDate(now)}: DVLA shows it taxed with an MOT valid until ${ukDate(b.motExpiryDate)}.` }));
    const r: any = await query(`
      UPDATE vehicles v SET "remindersOff" = 0, "remindersOffAt" = NULL, "remindersOffReason" = x.reason
        FROM jsonb_to_recordset($1::jsonb) AS x(id int, reason text)
       WHERE v.id = x.id AND COALESCE(v."remindersOff",0) = 1 AND v."remindersOffReason" ILIKE $2`, [JSON.stringify(batch), `%${OFF_ROAD_TAG}%`]);
    s.restarted = Number(r.rowCount ?? batch.length);
  }
  for (let i = 0; i < cars.length; i += 500) {
    const batch = cars.slice(i, i + 500).map((c) => ({ id: c.id, reason: c.verdict.reason }));
    const r: any = await query(`
      UPDATE vehicles v SET "remindersOff" = 1, "remindersOffAt" = now(), "remindersOffReason" = x.reason
        FROM jsonb_to_recordset($1::jsonb) AS x(id int, reason text)
       WHERE v.id = x.id AND COALESCE(v."remindersOff",0) = 0
         AND COALESCE(v."remindersOffReason",'') NOT ILIKE $2`, [JSON.stringify(batch), `${KEPT_ON_MARKER}%`]);
    s.stopped += Number(r.rowCount ?? batch.length);
  }
  return s;
}
