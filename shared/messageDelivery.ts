/**
 * Did the customer get it? A message's delivery in the words the MOT Reminders page shows beside it:
 * Read, Delivered, Sent, Not received, Sent as SMS, SMS delivered. Pure.
 *
 * Adam, 14/09/2026: "a little status update next to these so we know if delivered, read, not received, sent as SMS".
 *
 * How a text is recognised in reminderLogs:
 * - A WhatsApp that fails after Twilio accepted it (63016 outside the 24h window, 63024 not on WhatsApp) is re-sent
 *   as a text by the status webhook (server/webhooks/twilio.ts). The original row becomes `rescued` (a repeated
 *   callback can turn it back to `failed`) and the text gets its own row, templateUsed `rescue-sms:<original SID>`.
 *   That row is how the original arrived, never a message of its own.
 * - A template WhatsApp refused outright goes as a text straight away (smsService.sendSMS) and is logged under the
 *   template's name with the text's SID. Template WhatsApps always have an MM… SID and texts SM…, so that is the tell.
 * - Free-form messages are SM… on both channels; `freeform-sms` marks the texts.
 */
export type DeliveryState = "read" | "delivered" | "sent" | "not_received" | "sms_sent" | "sms_delivered";
export type Delivery = { state: DeliveryState; note: string };

export type SentLog = {
  vehicleId: number | null;
  sentAt: Date;
  status: string | null;
  messageType: string | null;
  templateUsed: string | null;
  messageSid: string | null;
};

export type SentMessage = { at: Date; status: string | null; delivery: Delivery };

const RESCUE = /^rescue-sms(?::(.+))?$/;
const didFail = (status: string | null) => status === "failed" || status === "undelivered";

function asText(status: string | null, how: string): Delivery {
  if (didFail(status)) return { state: "not_received", note: `${how}, and the text didn't arrive.` };
  if (status === "delivered" || status === "read") return { state: "sms_delivered", note: `${how}, and the text arrived.` };
  return { state: "sms_sent", note: `${how}; no word yet that the text arrived.` };
}

export function deliveryOf(
  log: Pick<SentLog, "status" | "templateUsed" | "messageSid">,
  rescue?: { status: string | null } | null,
): Delivery {
  if (rescue) return asText(rescue.status, "WhatsApp couldn't deliver it, so it went as a text");
  if (log.status === "rescued") return { state: "sms_sent", note: "WhatsApp couldn't deliver it, so it went as a text." };
  const template = log.templateUsed ?? "";
  if (template === "freeform-sms" || RESCUE.test(template)) return asText(log.status, "Sent as a text");
  if (template && !template.startsWith("freeform") && /^SM/.test(log.messageSid ?? "")) {
    return asText(log.status, "WhatsApp refused it, so it went as a text");
  }
  switch (log.status) {
    case "read": return { state: "read", note: "Read on WhatsApp." };
    case "delivered": return { state: "delivered", note: "Delivered on WhatsApp, not opened yet." };
    case "failed":
    case "undelivered": return { state: "not_received", note: "WhatsApp couldn't deliver it, and no text went instead." };
    default: return { state: "sent", note: "WhatsApp has it; not on their phone yet." };
  }
}

const isFollowUp = (log: SentLog) => /^urgent/i.test(log.templateUsed || "") || log.messageType === "UrgentFollowUp";

/**
 * Logs newest first → each car's last message, last MOT reminder and last follow-up message, each with how it
 * arrived. A rescue text is folded into the message it rescued: filed on its own it looked like a brand-new MOT
 * reminder, which put a car already followed up back on the Follow up list.
 */
export function summariseReminderLogs(logs: SentLog[]) {
  const rescues = new Map<string, { status: string | null }>();
  for (const log of logs) {
    const original = RESCUE.exec(log.templateUsed ?? "")?.[1];
    if (original && !rescues.has(original)) rescues.set(original, { status: log.status });
  }

  const last = new Map<number, SentMessage>();
  const lastMot = new Map<number, SentMessage>();
  const lastFollowUp = new Map<number, SentMessage>();
  for (const log of logs) {
    if (log.vehicleId == null || RESCUE.test(log.templateUsed ?? "")) continue;
    const id = log.vehicleId;
    const message = (): SentMessage => ({
      at: log.sentAt,
      status: log.status,
      delivery: deliveryOf(log, log.messageSid ? rescues.get(log.messageSid) : null),
    });
    if (!last.has(id)) last.set(id, message());
    if (isFollowUp(log)) {
      if (!lastFollowUp.has(id)) lastFollowUp.set(id, message());
    } else if (log.messageType === "MOT" && !lastMot.has(id)) {
      lastMot.set(id, message());
    }
  }
  return { last, lastMot, lastFollowUp };
}

/** The MOT Reminders page's Message filter: both kinds of text are one choice, "By SMS". */
export type MessageGroup = "read" | "delivered" | "sent" | "sms" | "not_received" | "none";
export const deliveryGroup = (d: Delivery | null | undefined): MessageGroup =>
  !d ? "none" : d.state === "sms_sent" || d.state === "sms_delivered" ? "sms" : d.state;
