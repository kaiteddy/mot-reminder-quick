/**
 * Stop MOT reminders for cars that are almost certainly no longer the customer's.
 *
 * Why this exists. `vehicles.customerId` is whoever we last invoiced for that car, set once and
 * never re-checked, while the MOT date is live DVLA data about whoever owns the car TODAY. So a
 * car we saw once in 2015 keeps producing reminders to a person who sold it years ago. Mr Abrahams
 * replied "Not mine" to exactly that in July 2026.
 *
 * Why it does not clear the owner. The first fix (July 2026) cleared `customerId` on 2,151 such
 * cars. It did not hold: the nightly GA4 import fills any empty owner straight back in from GA4's
 * own vehicle record (ga4-sync/neon/sync-master.sh, `customerId = COALESCE(v."customerId", ...)`),
 * and a later sync step re-linked the rest. By September 1,675 of them had an owner again and were
 * back in the reminder list. So, as Adam chose for replaced cars on 08/09/2026: keep the owner and
 * the history exactly as they are, switch reminders off for the car, and write down why. One click
 * on the vehicle page turns it back on, and a car switched back on by hand is never touched again.
 *
 * The rule. A car whose owner is not opted out or a trade account, with at least one job on file,
 * and no work in the last five years — counting a job linked to the car OR written up under its
 * registration, because 2,611 jobs carry a plate but no link and ignoring them makes a regular look
 * like a stranger. The evidence is graded and written into the reason, strongest first:
 *   1. the owner has replied to a reminder saying a car was not theirs;
 *   2. the same phone number came back with a different car two or more years later;
 *   3. reminded twice or more in three years and never came;
 *   4. reminded once in three years and never came;
 *   5. nothing beyond the five years of silence.
 */

/** Minimal query surface shared by a pg Client (scripts) and the server's pg Pool. */
export type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export const STALE_YEARS = 5;
/** How much later the same phone must return with another car before we believe this one went. */
export const REPLACED_GAP_YEARS = 2;
/** Marker written when someone turns reminders back on by hand; such a car is never re-flagged. */
export const KEPT_ON_MARKER = "Switched back on by hand";

const NOT_THEIRS = "(not (my|mine)|sold (it|the car|that)|no longer (own|have)|don.?t (own|have) (it|that|this))";

export type StaleEvidence = {
  lastActivity: Date | string;
  otherReg?: string | null;
  otherDate?: Date | string | null;
  remindedCount: number;
  saidNotTheirs: boolean;
};

export type StaleVerdict = { tier: 1 | 2 | 3 | 4 | 5; label: string; reason: string };

const ukDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/London" });

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Grade the evidence and write the sentence Adam sees when he hovers "Reminders off". Pure. */
export function staleCarVerdict(e: StaleEvidence, now: Date = new Date()): StaleVerdict {
  const last = new Date(e.lastActivity);
  const years = Math.floor((now.getTime() - last.getTime()) / YEAR_MS);
  const head = `Reminders stopped ${ukDate(now)}. No work on this car since ${ukDate(last)}, over ${years} years ago.`;
  const tail = ` Owner and history unchanged; switch reminders back on here if it is still theirs.`;
  const replaced = !!(e.otherDate && e.otherReg
    && new Date(e.otherDate).getTime() > last.getTime() + REPLACED_GAP_YEARS * YEAR_MS);

  if (e.saidNotTheirs) return { tier: 1, label: "owner said a car was not theirs", reason: `${head} The owner has replied to a reminder saying a car was not theirs.${tail}` };
  if (replaced) return { tier: 2, label: "same phone back with another car", reason: `${head} The same phone number was back with ${e.otherReg} on ${ukDate(e.otherDate!)}, so this car has probably been replaced.${tail}` };
  if (e.remindedCount >= 2) return { tier: 3, label: "reminded 2+ times, never came", reason: `${head} Reminded ${e.remindedCount} times in the last 3 years without a booking.${tail}` };
  if (e.remindedCount === 1) return { tier: 4, label: "reminded once, never came", reason: `${head} Reminded once in the last 3 years without a booking.${tail}` };
  return { tier: 5, label: "no work in 5+ years", reason: `${head} Nothing since suggests it is still theirs.${tail}` };
}

export type StaleCar = StaleEvidence & {
  id: number; registration: string; customerId: number; customerName: string | null;
  motExpiryDate: Date | string; verdict: StaleVerdict;
};

/** Every car that meets the rule and is not already switched off. One statement, no temp tables. */
export async function findStaleCars(query: Query, now: Date = new Date()): Promise<StaleCar[]> {
  const { rows } = await query(`
    WITH by_link AS (
      SELECT "vehicleId" vid, MAX(COALESCE("dateIssued","dateCreated")) d
        FROM "serviceHistory" WHERE "vehicleId" IS NOT NULL GROUP BY 1),
    by_reg AS (
      SELECT REPLACE(UPPER(registration),' ','') rk, MAX(COALESCE("dateIssued","dateCreated")) d
        FROM "serviceHistory" WHERE COALESCE(registration,'') <> '' GROUP BY 1),
    base AS (
      SELECT v.id, v.registration, v."customerId" cid, v."motExpiryDate" mot, cu.name,
             regexp_replace(regexp_replace(COALESCE(cu.phone,''),'[^0-9]','','g'),'^(44|0)','') pkey,
             GREATEST(COALESCE(bl.d,'1900-01-01'), COALESCE(br.d,'1900-01-01')) last_act,
             COALESCE(v."remindersOff",0) <> 0 is_off,
             COALESCE(v."remindersOffReason",'') ILIKE $2 kept_on,
             (COALESCE(cu."optedOut",0) <> 0 OR COALESCE(cu."noVehicleReminders",0) <> 0) excluded
        FROM vehicles v
        JOIN customers cu ON cu.id = v."customerId"
        LEFT JOIN by_link bl ON bl.vid = v.id
        LEFT JOIN by_reg br ON br.rk = REPLACE(UPPER(v.registration),' ','')
       WHERE v."motExpiryDate" IS NOT NULL),
    ranked AS (
      SELECT id, registration, pkey, last_act,
             ROW_NUMBER() OVER (PARTITION BY pkey ORDER BY last_act DESC, id) rn
        FROM base WHERE length(pkey) >= 7 AND last_act > '1900-01-01'),
    top2 AS (
      SELECT pkey,
             MAX(CASE WHEN rn=1 THEN id END) id1, MAX(CASE WHEN rn=1 THEN registration END) reg1, MAX(CASE WHEN rn=1 THEN last_act END) d1,
             MAX(CASE WHEN rn=2 THEN registration END) reg2, MAX(CASE WHEN rn=2 THEN last_act END) d2
        FROM ranked WHERE rn <= 2 GROUP BY pkey),
    logs AS (
      SELECT "vehicleId" vid, COUNT(*)::int n FROM "reminderLogs"
       WHERE "sentAt" > $3::timestamptz - interval '3 years' AND COALESCE(status,'') NOT IN ('failed','undelivered')
       GROUP BY 1),
    denied AS (
      SELECT "customerId" cid,
             regexp_replace(regexp_replace(COALESCE("fromNumber",''),'[^0-9]','','g'),'^(44|0)','') pk
        FROM "customerMessages"
       WHERE "triageKind" = 'not_owner' OR "messageBody" ~* $1)
    SELECT s.id, s.registration, s.cid "customerId", s.name "customerName", s.mot "motExpiryDate",
           s.last_act "lastActivity",
           CASE WHEN t.id1 IS DISTINCT FROM s.id THEN t.reg1 ELSE t.reg2 END "otherReg",
           CASE WHEN t.id1 IS DISTINCT FROM s.id THEN t.d1 ELSE t.d2 END "otherDate",
           COALESCE(l.n,0) "remindedCount",
           EXISTS (SELECT 1 FROM denied d WHERE d.cid = s.cid OR (length(s.pkey) >= 7 AND d.pk = s.pkey)) "saidNotTheirs"
      FROM base s
      LEFT JOIN top2 t ON t.pkey = s.pkey AND length(s.pkey) >= 7
      LEFT JOIN logs l ON l.vid = s.id
     WHERE NOT s.is_off AND NOT s.kept_on AND NOT s.excluded
       AND s.last_act > '1900-01-01'
       AND s.last_act < $3::timestamptz - interval '${STALE_YEARS} years'
     ORDER BY s.mot`, [NOT_THEIRS, `${KEPT_ON_MARKER}%`, now.toISOString()]);

  return rows.map((r) => ({ ...r, remindedCount: Number(r.remindedCount), verdict: staleCarVerdict(r, now) }));
}

export type StaleRunSummary = {
  found: number; stopped: number; dueWithin60Days: number;
  byTier: Record<string, number>; refused?: string; cars: StaleCar[];
};

/**
 * Find and (when `apply`) switch reminders off. `maxPerRun` is a tripwire for the daily job: on a
 * normal day a handful of cars cross the five-year line, so thousands at once means something
 * upstream is wrong (history missing, a bad import) and the run refuses rather than silence them.
 */
export async function stopStaleCarReminders(
  query: Query,
  opts: { apply: boolean; maxPerRun?: number; now?: Date },
): Promise<StaleRunSummary> {
  const now = opts.now ?? new Date();
  const cars = await findStaleCars(query, now);
  const byTier: Record<string, number> = {};
  let dueWithin60Days = 0;
  const soon = now.getTime() + 60 * 24 * 60 * 60 * 1000;
  cars.forEach((c) => {
    const k = `${c.verdict.tier} ${c.verdict.label}`;
    byTier[k] = (byTier[k] ?? 0) + 1;
    const t = new Date(c.motExpiryDate).getTime();
    if (t >= now.getTime() && t <= soon) dueWithin60Days++;
  });
  const summary: StaleRunSummary = { found: cars.length, stopped: 0, dueWithin60Days, byTier, cars };
  if (!opts.apply || !cars.length) return summary;

  const cap = opts.maxPerRun ?? Infinity;
  if (cars.length > cap) {
    summary.refused = `${cars.length} cars qualified, over the ${cap} limit for one run; nothing was switched off`;
    return summary;
  }

  for (let i = 0; i < cars.length; i += 500) {
    const batch = cars.slice(i, i + 500).map((c) => ({ id: c.id, reason: c.verdict.reason }));
    const res: any = await query(`
      UPDATE vehicles v
         SET "remindersOff" = 1, "remindersOffAt" = now(), "remindersOffReason" = x.reason
        FROM jsonb_to_recordset($1::jsonb) AS x(id int, reason text)
       WHERE v.id = x.id
         AND COALESCE(v."remindersOff",0) = 0
         AND COALESCE(v."remindersOffReason",'') NOT ILIKE $2`, [JSON.stringify(batch), `${KEPT_ON_MARKER}%`]);
    summary.stopped += Number(res.rowCount ?? batch.length);
  }
  return summary;
}
