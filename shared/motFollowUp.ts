/**
 * Who needs chasing after their MOT reminder. Pure; used by the MOT Reminders page's "Follow up" tab.
 *
 * Adam, 14/09/2026: we send one MOT reminder within 14 days of expiry "and that's it", but nobody is
 * following up the people who genuinely missed it or forgot. A car belongs on the follow-up list when
 * it was sent a reminder about the MOT it is on now, and that MOT has not been renewed.
 *
 * "Not renewed" is only believed once the car has been checked AFTER its MOT ran out: DVSA and DVLA are
 * asked at 23:59 on the last day and again at 00:01 the day after (server/services/motExpiryCheck.ts),
 * so a car tested somewhere else that day gets its new date and drops off rather than being chased by
 * mistake. Until that check has happened the car shows as "Expired, checking".
 */
import type { Delivery } from "./messageDelivery";

/** Reminded cars whose MOT runs out within this many days show as "Reminded, not done". */
export const DUE_AHEAD_DAYS = 14;
/** A missed MOT stays on the list this long; after that the off-road check takes over. */
export const MISSED_KEEP_DAYS = 60;
/** A reminder belongs to this MOT if it was sent no more than this many days before it ran out. */
export const REMINDER_LEAD_DAYS = 60;
/**
 * One follow-up message per MOT; after that it's a phone call (Adam, 14/09/2026). A follow-up that reached them
 * comes back as "Call" this many days on, once a check since then still shows no new MOT. The morning check
 * (server/services/followUpRecheck.ts) asks DVSA about those cars on the day they fall due.
 */
export const CALL_AFTER_DAYS = 14;
/**
 * The follow-up is asked for this many days after the reminder, so the customer has a chance to book first, or as
 * soon as the MOT has run out if that comes sooner. Until then the car is "Waiting". Adam, 14/09/2026: cars sent
 * their reminder that morning were already asking for a follow-up.
 */
export const FOLLOW_UP_AFTER_DAYS = 7;

export type FollowUpStage = "missed" | "expired_unchecked" | "due";

export type FollowUpCar = {
  motExpiryDate?: Date | string | null;
  lastMotReminderAt?: Date | string | null;
  lastMotReminderStatus?: string | null;
  lastFollowUpAt?: Date | string | null;
  lastFollowUpHow?: "message" | "call" | null;
  /** How the last MOT reminder and the last follow-up message arrived (shared/messageDelivery.ts). */
  lastMotReminderDelivery?: Delivery | null;
  lastFollowUpDelivery?: Delivery | null;
  motBookedDate?: Date | string | null;
  lastChecked?: Date | string | null;
};

export type FollowUp = {
  stage: FollowUpStage;
  /** Days until the MOT runs out, on the UK calendar: 0 = today is its last day, -1 = it ran out yesterday. */
  daysLeft: number;
  remindedAt: Date;
  reminderStatus: string | null;
  /** When the car was checked after its MOT ran out and still had no new one. */
  checkedAfterExpiry: Date | null;
  followedUpAt: Date | null;
  followedUpHow: "message" | "call" | null;
  /** How the reminder arrived, and the follow-up message if there was one (not for a call). */
  reminderDelivery: Delivery | null;
  followUpDelivery: Delivery | null;
  bookedFor: Date | null;
  /** The UK day (YYYY-MM-DD) the follow-up falls due: FOLLOW_UP_AFTER_DAYS after the reminder, or sooner once the MOT has run out. */
  followUpFrom: string;
  /**
   * What to do now: send the follow-up message, wait (reminded too recently), phone them, or nothing (null). A call
   * is due when the follow-up never arrived, or when it went CALL_AFTER_DAYS or more ago and a check since shows no
   * new MOT.
   */
  todo: "message" | "wait" | "call" | null;
  /** Nothing to do for now: booked in, called, or sent a follow-up that arrived less than CALL_AFTER_DAYS ago. */
  handled: boolean;
};

/** A moment's calendar date in the UK, as YYYY-MM-DD. */
export const ukDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

const daysBetween = (later: string, earlier: string) =>
  Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Whole UK calendar days from a moment until now: 0 = today, 1 = yesterday. */
export const daysSince = (d: Date | string, now: Date = new Date()) => daysBetween(ukDay(now), ukDay(d));

/**
 * How long ago, in plain words: "today", "yesterday", "3 days ago", "last week", "2 weeks ago",
 * "last month", "3 months ago", "last year", "11 years ago". Adam, 14/09/2026, on "reminded 08/09":
 * "make this easier like last 3 days, 2 weeks, month".
 */
export function whenAgo(d: Date | string, now: Date = new Date()): string {
  const days = daysSince(d, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 28) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "last year" : `${years} years ago`;
}

export function followUpFor(car: FollowUpCar, now: Date = new Date()): FollowUp | null {
  if (!car.motExpiryDate || !car.lastMotReminderAt) return null;
  const expiry = ukDay(car.motExpiryDate);
  const daysLeft = daysBetween(expiry, ukDay(now));
  if (daysLeft > DUE_AHEAD_DAYS || daysLeft < -MISSED_KEEP_DAYS) return null;

  const remindedDay = ukDay(car.lastMotReminderAt);
  // Only a reminder about THIS MOT counts. A car renewed since has a date about a year on, which puts
  // its old reminder far more than 60 days before it, so it drops off here.
  if (daysBetween(expiry, remindedDay) > REMINDER_LEAD_DAYS) return null;

  let stage: FollowUpStage;
  let checkedAfterExpiry: Date | null = null;
  if (daysLeft >= 0) {
    stage = "due";
  } else if (car.lastChecked && ukDay(car.lastChecked) > expiry) {
    stage = "missed";
    checkedAfterExpiry = new Date(car.lastChecked);
  } else {
    stage = "expired_unchecked";
  }

  const remindedAt = new Date(car.lastMotReminderAt);
  const followedUpAt = car.lastFollowUpAt && new Date(car.lastFollowUpAt) > remindedAt ? new Date(car.lastFollowUpAt) : null;
  const bookedFor = car.motBookedDate && ukDay(car.motBookedDate) >= remindedDay ? new Date(car.motBookedDate) : null;
  const followedUpHow = followedUpAt ? (car.lastFollowUpHow ?? "message") : null;
  const followUpDelivery = followedUpHow === "message" ? car.lastFollowUpDelivery ?? null : null;
  // Give them time to act on the reminder: the follow-up is due FOLLOW_UP_AFTER_DAYS after it, or the day after
  // the MOT runs out if that is sooner.
  const followUpFrom = [addDays(remindedDay, FOLLOW_UP_AFTER_DAYS), addDays(expiry, 1)].sort()[0];
  let todo: FollowUp["todo"];
  if (bookedFor || followedUpHow === "call") todo = null;
  else if (!followedUpAt) todo = ukDay(now) >= followUpFrom ? "message" : "wait";
  // A follow-up message that never arrived hasn't reached them: phone instead (or fix the number and resend).
  else if (followUpDelivery?.state === "not_received") todo = "call";
  else {
    // It reached them. CALL_AFTER_DAYS on, if a check since then still shows no new MOT, phone them.
    const callDay = addDays(ukDay(followedUpAt), CALL_AFTER_DAYS);
    todo = ukDay(now) >= callDay && !!car.lastChecked && ukDay(car.lastChecked) >= callDay ? "call" : null;
  }
  return {
    stage,
    daysLeft,
    remindedAt,
    reminderStatus: car.lastMotReminderStatus ?? null,
    checkedAfterExpiry,
    followedUpAt,
    followedUpHow,
    reminderDelivery: car.lastMotReminderDelivery ?? null,
    followUpDelivery,
    bookedFor,
    followUpFrom,
    todo,
    handled: todo === null,
  };
}

/**
 * Why another follow-up message for this MOT is refused, or null when it may go. One follow-up message per MOT,
 * then a phone call. Another is allowed only when the last one never arrived (a wrong number, since fixed).
 */
export function repeatFollowUpBlock(
  last: { at: Date | string; delivery: Delivery } | null | undefined,
  motExpiryDate: Date | string | null | undefined,
  registration: string,
): string | null {
  if (!last || !motExpiryDate) return null;
  if (last.delivery.state === "not_received") return null;
  // Sent long before this MOT's reminder window: that follow-up was about an earlier MOT.
  if (daysBetween(ukDay(motExpiryDate), ukDay(last.at)) > REMINDER_LEAD_DAYS) return null;
  const when = new Date(last.at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/London" });
  return `${registration} was already sent a follow-up for this MOT on ${when} (${last.delivery.note.replace(/\.$/, "")}). Give them a call instead.`;
}

/** The message a Follow up row's status is about: the follow-up if one went, else the reminder (none once booked). */
export const followUpShownDelivery = (fu: FollowUp): Delivery | null =>
  fu.followedUpAt ? fu.followUpDelivery : fu.bookedFor ? null : fu.reminderDelivery;
