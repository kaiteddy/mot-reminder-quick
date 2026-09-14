/**
 * A customer who answers a reminder with "sold it" or "that's not my car" has told us the car is not
 * theirs, so it comes off the reminder list there and then.
 *
 * Reply triage (./replyTriage) already recognised these replies as `not_owner`, but that only stopped
 * the alerts chasing them: switching the car off was left for someone to remember. On 11/09/2026 twelve
 * cars were still being reminded weeks after their customers said they had gone, and three of those had
 * been sent another MOT reminder since (DL21UCP, SH59WJF, AY04GWP).
 *
 * The car is the one the reminder was about: the last MOT or service reminder sent to that phone in the
 * 60 days before the reply. Only reminders count. Mr E Abraham's "this car was sold 2 years ago" came
 * after two chat messages about WR18MLY, the car he still has, but it answered that morning's YP60AWG
 * MOT reminder. When several cars were reminded together, the reply could mean any of them, so nothing
 * is switched off. Owner and history stay as they are, the customer's own words go into the reason, and
 * a car someone switched back on by hand is left alone.
 *
 * Reply and reminder times are compared inside the database, row against row. Passing the reply time
 * in from JavaScript went wrong on a Mac on BST: stored times came back an hour out, so a reply sent
 * within the hour of its reminder missed it and could fall back to an older reminder about another car.
 */
import { KEPT_ON_MARKER, type Query } from "./staleCarReminders";

/** Messages a customer might answer with "not my car". Car-ready and chat messages are not. */
const REMINDER_TYPES = ["MOT", "Service", "UrgentFollowUp"];

/** How far back the reminder being answered may have been sent. */
export const REPLY_WINDOW_DAYS = 60;

/** Reminders to one phone this close together went out as one batch. */
const SAME_BATCH_SECONDS = 10 * 60;

/** A stored reply: by row id, or by Twilio's message SID when the webhook has only just written it. */
export type ReplyRef = { id: number } | { messageSid: string };

const refParams = (ref: ReplyRef): [number, string] => ("id" in ref ? [Number(ref.id) || 0, ""] : [0, String(ref.messageSid ?? "")]);

const plateKey = (reg: unknown) => String(reg ?? "").toUpperCase().replace(/\s+/g, "");

/** The reason shown on the car: the customer's own words, and how to undo it. `repliedOn` is DD/MM/YYYY. Pure. */
export function notOwnerReason(body: string | null | undefined, repliedOn: string, now: Date = new Date()): string {
  const words = String(body ?? "").replace(/\s+/g, " ").trim();
  const quote = words.length > 300 ? `${words.slice(0, 299)}…` : words;
  const today = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/London" });
  return `Reminders stopped ${today}. The customer replied on ${repliedOn}: "${quote}". Owner and history unchanged; switch reminders back on here if it is still theirs.`;
}

/**
 * Which car a stored "not the owner" reply is about, as a vehicle id. Null when no reminder went to that
 * phone in the window, when the last one went out alongside reminders about other cars, or when its
 * plate matches no single car. Reads only.
 */
export async function findCarForNotOwnerReply(query: Query, ref: ReplyRef): Promise<number | null> {
  const [id, sid] = refParams(ref);
  const { rows } = await query(`
    WITH m AS (
      SELECT right(regexp_replace(COALESCE("fromNumber", ''), '[^0-9]', '', 'g'), 10) AS phone, "receivedAt"
        FROM "customerMessages"
       WHERE id = $1 OR ($2 <> '' AND "messageSid" = $2)
       LIMIT 1)
    SELECT l."vehicleId", l.registration,
           extract(epoch FROM (max(l."sentAt") OVER () - l."sentAt")) AS secs_before_latest
      FROM m
      JOIN "reminderLogs" l ON right(regexp_replace(COALESCE(l.recipient, ''), '[^0-9]', '', 'g'), 10) = m.phone
     WHERE length(m.phone) = 10
       AND l."messageType" = ANY($3::text[])
       AND l."sentAt" <= m."receivedAt"
       AND l."sentAt" > m."receivedAt" - make_interval(days => $4::int)
     ORDER BY l."sentAt" DESC
     LIMIT 10`, [id, sid, REMINDER_TYPES, REPLY_WINDOW_DAYS]);
  if (!rows.length) return null;

  const latest = rows[0];
  const carOf = (l: any) => (l.vehicleId != null ? `id:${l.vehicleId}` : `plate:${plateKey(l.registration)}`);
  const batch = rows.filter((l: any) => Number(l.secs_before_latest) <= SAME_BATCH_SECONDS);
  if (new Set(batch.map(carOf)).size > 1) return null;

  // The reminder names its car. If that record has since gone (merged into another, or deleted),
  // find the car by the plate the reminder was about instead.
  if (latest.vehicleId != null) {
    const { rows: still } = await query(`SELECT id FROM vehicles WHERE id = $1`, [latest.vehicleId]);
    if (still.length) return Number(latest.vehicleId);
  }
  const plate = plateKey(latest.registration);
  if (!plate) return null;
  const { rows: cars } = await query(`
    SELECT id FROM vehicles
     WHERE REPLACE(UPPER(registration), ' ', '') = $1 AND registration NOT LIKE '%*%'
     LIMIT 2`, [plate]);
  return cars.length === 1 ? Number(cars[0].id) : null;
}

export type SwitchedOffCar = { vehicleId: number; registration: string; reason: string };

/**
 * Switch off the car a stored "not the owner" reply is about. Returns that car, or null when there is
 * nothing to switch off: no car can be pinned down, it is already off, or someone switched it back on
 * by hand.
 */
export async function switchOffCarForNotOwnerReply(query: Query, ref: ReplyRef, now: Date = new Date()): Promise<SwitchedOffCar | null> {
  const vehicleId = await findCarForNotOwnerReply(query, ref);
  if (vehicleId == null) return null;
  const [id, sid] = refParams(ref);
  const { rows: msg } = await query(`
    SELECT "messageBody" AS body,
           to_char(("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'DD/MM/YYYY') AS replied_on
      FROM "customerMessages"
     WHERE id = $1 OR ($2 <> '' AND "messageSid" = $2)
     LIMIT 1`, [id, sid]);
  if (!msg.length) return null;
  const reason = notOwnerReason(msg[0].body, msg[0].replied_on, now);
  const { rows } = await query(`
    UPDATE vehicles SET "remindersOff" = 1, "remindersOffAt" = now(), "remindersOffReason" = $2
     WHERE id = $1 AND COALESCE("remindersOff", 0) = 0 AND COALESCE("remindersOffReason", '') NOT ILIKE $3
    RETURNING id, registration`, [vehicleId, reason, `${KEPT_ON_MARKER}%`]);
  return rows[0] ? { vehicleId: Number(rows[0].id), registration: String(rows[0].registration), reason } : null;
}
