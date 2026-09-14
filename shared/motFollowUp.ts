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

/** Reminded cars whose MOT runs out within this many days show as "Reminded, not done". */
export const DUE_AHEAD_DAYS = 14;
/** A missed MOT stays on the list this long; after that the off-road check takes over. */
export const MISSED_KEEP_DAYS = 60;
/** A reminder belongs to this MOT if it was sent no more than this many days before it ran out. */
export const REMINDER_LEAD_DAYS = 60;

export type FollowUpStage = "missed" | "expired_unchecked" | "due";

export type FollowUpCar = {
  motExpiryDate?: Date | string | null;
  lastMotReminderAt?: Date | string | null;
  lastMotReminderStatus?: string | null;
  lastFollowUpAt?: Date | string | null;
  lastFollowUpHow?: "message" | "call" | null;
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
  bookedFor: Date | null;
  /** Nothing left to do: followed up since the reminder, or booked in. */
  handled: boolean;
};

/** A moment's calendar date in the UK, as YYYY-MM-DD. */
export const ukDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

const daysBetween = (later: string, earlier: string) =>
  Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);

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
  return {
    stage,
    daysLeft,
    remindedAt,
    reminderStatus: car.lastMotReminderStatus ?? null,
    checkedAfterExpiry,
    followedUpAt,
    followedUpHow: followedUpAt ? (car.lastFollowUpHow ?? "message") : null,
    bookedFor,
    handled: !!(followedUpAt || bookedFor),
  };
}
