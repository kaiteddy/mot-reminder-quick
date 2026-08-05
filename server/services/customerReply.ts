/**
 * Replying to a customer, reliably.
 *
 * WhatsApp only permits a free-form business message within 24 hours of the customer's last
 * inbound message ("the customer service window"). Outside it, Twilio rejects the send with
 * error 63016 and the reply silently doesn't happen — which had already caught this account
 * once. Anything else would need a Meta-approved template, and every template here is a
 * customer-facing MOT reminder with fixed variables, useless for a conversational answer.
 *
 * So: try WhatsApp; if the window has closed, deliver the same words as an SMS instead. The
 * customer gets the reply either way and the sender never has to think about it.
 */

/** Twilio codes that mean "the WhatsApp window is shut", not "this message was bad". */
const WINDOW_CLOSED_CODES = new Set([63016, 63051]);

export type ReplyChannel = "whatsapp" | "sms";
export type ReplyResult = {
  success: boolean;
  channel?: ReplyChannel;
  messageId?: string;
  error?: string;
};

export type ReplyWindow = {
  isOpen: boolean;
  /** When the 24-hour window shuts. Null when the customer has never messaged in. */
  openUntil: string | null;
  hoursLeft: number | null;
};

/**
 * How long is left to answer on WhatsApp, measured from the customer's most recent inbound
 * message. Drives the hint above the reply box so the channel is never a surprise.
 */
export async function getReplyWindow(customerId: number): Promise<ReplyWindow> {
  const { getDb } = await import("../db");
  const { customerMessages } = await import("../../drizzle/schema");
  const { eq, desc } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { isOpen: false, openUntil: null, hoursLeft: null };

  const [last] = await db.select({ receivedAt: customerMessages.receivedAt })
    .from(customerMessages)
    .where(eq(customerMessages.customerId, customerId))
    .orderBy(desc(customerMessages.receivedAt))
    .limit(1);

  if (!last?.receivedAt) return { isOpen: false, openUntil: null, hoursLeft: null };
  const closesAt = new Date(new Date(last.receivedAt).getTime() + 24 * 3600_000);
  const msLeft = closesAt.getTime() - Date.now();
  return {
    isOpen: msLeft > 0,
    openUntil: closesAt.toISOString(),
    hoursLeft: msLeft > 0 ? Math.max(0, Math.round((msLeft / 3600_000) * 10) / 10) : 0,
  };
}

function twilioAuth() {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  return { accountSid, authToken, header: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` };
}

async function postMessage(params: Record<string, string>): Promise<{ ok: boolean; sid?: string; code?: number; message?: string }> {
  const { accountSid, header } = twilioAuth();
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: header, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, code: json?.code, message: json?.message || `HTTP ${res.status}` };
  return { ok: true, sid: json?.sid };
}

/** The SMS-capable Twilio number, shared with the staff alert settings. */
async function smsSender(): Promise<string> {
  const { getAppSetting } = await import("../db");
  const s: any = (await getAppSetting("staff_alerts")) || {};
  return (s.fromNumber || process.env.TWILIO_SMS_NUMBER || "").trim();
}

/**
 * Send a reply, falling back from WhatsApp to SMS when the 24-hour window has closed.
 * Returns which channel actually carried it so the thread can show it.
 */
export async function sendCustomerReply(input: { to: string; body: string; customerId?: number }): Promise<ReplyResult> {
  const { accountSid, authToken } = twilioAuth();
  const waFrom = (process.env.TWILIO_WHATSAPP_NUMBER || "").trim();
  if (!accountSid || !authToken || !waFrom) return { success: false, error: "Twilio is not configured" };

  const to = input.to.replace(/^whatsapp:/, "");

  // Decide BEFORE sending. Twilio accepts an out-of-window WhatsApp message with a 201 and only
  // reports 63016 later on the status callback, so inspecting the send response can't catch it —
  // by then the reply has already been reported as sent and nobody is waiting to retry it.
  if (input.customerId != null) {
    const w = await getReplyWindow(input.customerId);
    if (!w.isOpen) return sendAsSms(to, input.body, "the 24-hour WhatsApp window has closed");
  }

  const wa = await postMessage({
    To: `whatsapp:${to}`,
    From: waFrom.startsWith("whatsapp:") ? waFrom : `whatsapp:${waFrom}`,
    Body: input.body,
  });
  if (wa.ok) return { success: true, channel: "whatsapp", messageId: wa.sid };

  // Some rejections do come back synchronously; still handle those.
  if (!WINDOW_CLOSED_CODES.has(wa.code ?? -1)) {
    return { success: false, error: wa.message || "WhatsApp send failed" };
  }
  return sendAsSms(to, input.body, "WhatsApp refused the message");
}

/** Deliver the same words by text. Shared by the pre-flight check and the async retry. */
export async function sendAsSms(to: string, body: string, why: string): Promise<ReplyResult> {
  const from = await smsSender();
  if (!from) {
    return {
      success: false,
      error: `Can't send this — ${why}, and no SMS sender number is set. `
        + "Add your Twilio number under Text messages in Email Settings and replies will go by text automatically.",
    };
  }
  const sms = await postMessage({ To: to.replace(/^whatsapp:/, ""), From: from, Body: body });
  if (sms.ok) {
    console.log(`[Reply] ${why} for ${to} — delivered as SMS instead`);
    return { success: true, channel: "sms", messageId: sms.sid };
  }
  return { success: false, error: sms.message || "Both WhatsApp and SMS failed" };
}
