/**
 * First-MOT reminders: bring new cars into the MOT reminder list before their first MOT falls due.
 *
 * Adam, 11/09/2026: "we would like to catch those customers they are the ones most likely to miss
 * their MOT deadline."
 *
 * A car needs its first MOT by the third anniversary of registration. Until then it has no MOT
 * expiry, and every reminder list keys on vehicles.motExpiryDate, so new cars were never reminded.
 *
 * The due date comes from DVSA's MOT history, which gives an untested car's exact `motTestDueDate`.
 * Not from our own dateOfRegistration: checked 11/09/2026 against DVSA for all 48 candidates —
 *   - most of ours are the 1st of the month (DVLA only gives the month), so a reminder built on them
 *     would go out up to a month early;
 *   - N4MAJ was stored as a 2021 car but is a 2025 one (the plate moved); GH9999 was stored as 2026
 *     but is a 1996 car; MV11CTF had seven MOT tests and a pass valid to 01/04/2027 we never held;
 *   - BL23XYB's first MOT was due 22/06/2026 and it still has not had one — exactly the customer.
 *
 * Stored on vehicles.firstMotDue. The reminder lists read the MOT expiry first and fall back to it
 * (`reminderMotDate`), so once a car's first MOT is recorded its real expiry takes over. A car DVSA
 * shows as already tested gets that expiry written into a BLANK motExpiryDate, never over one held.
 * DVSA is free; the check runs daily (/api/cron/first-mot-dates) and on demand from
 * scripts/fill-first-mot-dates.ts.
 */
import type { Query } from "./staleCarReminders";

/** Only cars registered within this many years are asked about, unless DVLA already found them. */
export const NEW_CAR_YEARS = 4;
/** A car asked about is asked again after this long… */
export const RECHECK_DAYS = 30;
/** …or, once its first MOT is this close (or past), every few days, to see the test land. */
export const NEAR_DUE_DAYS = 45;
export const NEAR_DUE_RECHECK_DAYS = 3;

const DAY_MS = 86_400_000;

export type MotHistoryLike = {
  motTestDueDate?: string | null;
  motTests?: Array<{ testResult?: string | null; expiryDate?: string | null; completedDate?: string | null }> | null;
} | null;

export type FirstMotFinding =
  | { kind: "awaiting_first"; due: Date }
  | { kind: "tested"; expiry: Date | null }
  | { kind: "no_record" };

/** DVSA writes dates as "2026-06-22", "2026.06.22", "22.06.2026" or a full timestamp. UTC midnight, or null. */
export function dvsaDate(s?: string | null): Date | null {
  const t = String(s ?? "").trim();
  const ymd = t.match(/^(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (ymd) return new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]));
  const dmy = t.match(/^(\d{2})[-.](\d{2})[-.](\d{4})/);
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
  return null;
}

/** What DVSA's MOT history says about a car we hold no MOT expiry for. Pure. */
export function firstMotFinding(history: MotHistoryLike): FirstMotFinding {
  if (!history) return { kind: "no_record" };
  const tests = Array.isArray(history.motTests) ? history.motTests : [];
  if (tests.length) {
    // Latest pass by expiry; a car that has only failed is tested but still has no MOT.
    const expiries = tests
      .filter((t) => String(t?.testResult || "").toUpperCase() === "PASSED")
      .map((t) => dvsaDate(t?.expiryDate))
      .filter((d): d is Date => !!d);
    return { kind: "tested", expiry: expiries.length ? new Date(Math.max(...expiries.map((d) => d.getTime()))) : null };
  }
  const due = dvsaDate(history.motTestDueDate);
  return due ? { kind: "awaiting_first", due } : { kind: "no_record" };
}

/**
 * A first MOT missed by more than this is a car off the road, not a late one. The first DVSA pass on
 * 11/09/2026 found 37 never-tested cars past their first MOT, most by years (EK08HYR's was due in
 * 2011). Same horizon as the off-road rule: a car that went this long past its due date without a
 * test is not reminded.
 */
export const FIRST_MOT_OVERDUE_LIMIT_YEARS = 2;

/** The date a reminder list works from: the MOT expiry, or for a car never tested, its first MOT due date. */
export function reminderMotDate(
  v: { motExpiryDate?: Date | string | null; firstMotDue?: Date | string | null },
  now: Date = new Date(),
): { motExpiryDate: Date | null; firstMot: boolean } {
  if (v.motExpiryDate) return { motExpiryDate: new Date(v.motExpiryDate), firstMot: false };
  if (v.firstMotDue) {
    const due = new Date(v.firstMotDue);
    if (due.getTime() >= now.getTime() - FIRST_MOT_OVERDUE_LIMIT_YEARS * 365.25 * DAY_MS) return { motExpiryDate: due, firstMot: true };
  }
  return { motExpiryDate: null, firstMot: false };
}

export type FirstMotCandidate = { id: number; registration: string; customerId: number | null; firstMotDue: Date | string | null };

/** Cars with no MOT expiry that are due a DVSA question today, longest-unasked first. */
export async function findFirstMotCandidates(query: Query, now: Date, limit: number): Promise<FirstMotCandidate[]> {
  const { rows } = await query(`
    SELECT v.id, v.registration, v."customerId", v."firstMotDue"
      FROM vehicles v
     WHERE v."motExpiryDate" IS NULL
       AND v.registration !~ '[*(]'
       AND COALESCE(v."dvlaStatus", '') NOT IN ('invalid_plate', 'superseded')
       AND (v."dvlaStatus" = 'found' OR v."firstMotDue" IS NOT NULL
            OR v."dateOfRegistration" > ($1::timestamptz AT TIME ZONE 'UTC') - make_interval(years => $3))
       AND (v."firstMotCheckedAt" IS NULL
            OR v."firstMotCheckedAt" < ($1::timestamptz AT TIME ZONE 'UTC') - make_interval(days => $4)
            OR (v."firstMotDue" < ($1::timestamptz AT TIME ZONE 'UTC') + make_interval(days => $5)
                AND v."firstMotCheckedAt" < ($1::timestamptz AT TIME ZONE 'UTC') - make_interval(days => $6)))
     ORDER BY v."firstMotCheckedAt" ASC NULLS FIRST, v.id
     LIMIT $2`, [now.toISOString(), limit, NEW_CAR_YEARS, RECHECK_DAYS, NEAR_DUE_DAYS, NEAR_DUE_RECHECK_DAYS]);
  return rows;
}

/** Ask DVSA about one plate: the history, or null when DVSA has no record. Throws on an outage or a refused key. */
export type MotLookup = (registration: string) => Promise<MotHistoryLike>;

export type FirstMotCar = { id: number; registration: string; customerId: number | null; finding: FirstMotFinding };

export type FirstMotRunSummary = {
  checked: number;
  awaitingFirst: number;
  overdue: number;
  dueWithin60Days: number;
  tested: number;
  expiryFilled: number;
  noRecord: number;
  errors: number;
  /** First-MOT dates dropped because the car's real MOT expiry has since been recorded. */
  cleared: number;
  stopped?: string;
  cars: FirstMotCar[];
};

const AUTH_FAILURE = /access token|credentials|unauthori[sz]ed|forbidden|\b40[13]\b/i;

export async function runFirstMotCheck(
  query: Query,
  lookup: MotLookup,
  opts: { apply: boolean; max?: number; paceMs?: number; now?: Date },
): Promise<FirstMotRunSummary> {
  const now = opts.now ?? new Date();
  const stamp = now.toISOString();
  const s: FirstMotRunSummary = { checked: 0, awaitingFirst: 0, overdue: 0, dueWithin60Days: 0, tested: 0, expiryFilled: 0, noRecord: 0, errors: 0, cleared: 0, cars: [] };

  if (opts.apply) {
    const r: any = await query(`UPDATE vehicles SET "firstMotDue" = NULL WHERE "motExpiryDate" IS NOT NULL AND "firstMotDue" IS NOT NULL`);
    s.cleared = Number(r?.rowCount ?? 0);
  }

  const cars = await findFirstMotCandidates(query, now, opts.max ?? 100);
  let failuresInARow = 0;
  for (const car of cars) {
    let history: MotHistoryLike;
    try {
      history = await lookup(car.registration);
      failuresInARow = 0;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (AUTH_FAILURE.test(msg)) { s.stopped = `DVSA refused our key, nothing more asked: ${msg}`; break; }
      s.errors++;
      if (++failuresInARow >= 5) { s.stopped = `DVSA failed 5 times in a row, last: ${msg}`; break; }
      continue;
    }

    const finding = firstMotFinding(history);
    s.checked++;
    s.cars.push({ id: car.id, registration: car.registration, customerId: car.customerId, finding });

    if (finding.kind === "awaiting_first") {
      s.awaitingFirst++;
      const days = (finding.due.getTime() - now.getTime()) / DAY_MS;
      if (days < 0) s.overdue++;
      else if (days <= 60) s.dueWithin60Days++;
      if (opts.apply) await query(
        `UPDATE vehicles SET "firstMotDue" = $2::timestamptz AT TIME ZONE 'UTC', "firstMotCheckedAt" = $3::timestamptz AT TIME ZONE 'UTC' WHERE id = $1`,
        [car.id, finding.due.toISOString(), stamp]);
    } else if (finding.kind === "tested" && finding.expiry) {
      s.tested++;
      s.expiryFilled++;
      if (opts.apply) await query(
        `UPDATE vehicles SET "motExpiryDate" = COALESCE("motExpiryDate", $2::timestamptz AT TIME ZONE 'UTC'), "firstMotDue" = NULL,
                "firstMotCheckedAt" = $3::timestamptz AT TIME ZONE 'UTC' WHERE id = $1`,
        [car.id, finding.expiry.toISOString(), stamp]);
    } else {
      // Tested but never passed (still due, keep any first-MOT date), or no DVSA record: note the question only.
      if (finding.kind === "tested") s.tested++;
      else s.noRecord++;
      if (opts.apply) await query(`UPDATE vehicles SET "firstMotCheckedAt" = $2::timestamptz AT TIME ZONE 'UTC' WHERE id = $1`, [car.id, stamp]);
    }
    if (opts.paceMs) await new Promise((r) => setTimeout(r, opts.paceMs));
  }
  return s;
}
