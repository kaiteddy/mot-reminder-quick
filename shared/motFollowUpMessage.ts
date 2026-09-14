/**
 * The follow-up WhatsApp for a car that was sent its MOT reminder and still hasn't had the MOT. Pure.
 *
 * Two templates approved by Meta as UTILITY on 14/09/2026, each with a "Call us" button. They take exactly
 * three variables — name, registration, date. The older mot_expired / mot_expiring templates were MARKETING
 * and the expiring one took a fourth (days left); never pass one here. New wording means a new template
 * approved by Meta first, then its SID and body change here together.
 */
import { ukDay } from "./motFollowUp";

export const FOLLOW_UP_TEMPLATES = {
  expired: {
    name: "mot_follow_up_expired",
    sid: "HX36f48c99eba3501ad28bc4f9099e0436",
    body: "Hi {{1}}, this is ELI MOTORS in Hendon. Our records show the MOT on {{2}} ran out on {{3}}.\n\nIf it has had its MOT somewhere else, or you no longer have the car, just reply and we will update our records.\n\nIf it still needs one, reply or call us on 020 8203 6449 and we will book it in. Driving without a valid MOT can lead to a fine of up to £1,000.",
  },
  due: {
    name: "mot_follow_up_due",
    sid: "HXbf1e19394b0dc8d6fe590914431e5cf0",
    body: "Hi {{1}}, this is ELI MOTORS in Hendon. Just checking in: the MOT on {{2}} runs out on {{3}} and we have not seen it booked yet.\n\nIf it is already booked or done elsewhere, or you no longer have the car, just reply and we will update our records.\n\nTo book it in, reply or call us on 020 8203 6449.",
  },
} as const;

export type FollowUpMessage = {
  isExpired: boolean;
  templateName: string;
  templateSid: string;
  variables: { "1": string; "2": string; "3": string };
  /** The message as the customer reads it, for the preview and the log. */
  text: string;
};

/** "24 September 2026", on the UK calendar. */
export const followUpDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

export function followUpMessage(
  p: { customerName: string; registration: string; motExpiryDate: Date | string },
  now: Date = new Date(),
): FollowUpMessage {
  // Expired once the UK day it ran out on has passed; on the day itself it still "runs out".
  const isExpired = ukDay(p.motExpiryDate) < ukDay(now);
  const t = isExpired ? FOLLOW_UP_TEMPLATES.expired : FOLLOW_UP_TEMPLATES.due;
  const variables = { "1": p.customerName, "2": p.registration, "3": followUpDate(p.motExpiryDate) };
  const text = t.body.replace(/\{\{([123])\}\}/g, (_, k: "1" | "2" | "3") => variables[k]);
  return { isExpired, templateName: t.name, templateSid: t.sid, variables, text };
}
