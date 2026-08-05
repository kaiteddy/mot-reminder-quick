/**
 * Staff alerts — text somebody at the garage the moment a customer replies.
 *
 * Deliberately SMS, not WhatsApp: a business-initiated WhatsApp outside the 24-hour customer
 * service window needs a Meta-approved template, and every template on the account is
 * customer-facing (MOT reminders, order updates). SMS needs no approval, lands on any phone
 * regardless of app state, and at a handful of replies a day the cost is negligible.
 *
 * Configured through appSettings so the number can change without a redeploy:
 *   { enabled: boolean, phone: string, fromNumber?: string, cooldownMinutes?: number }
 */

export type StaffAlertSettings = {
  enabled: boolean;
  /** Where to text — the person who should answer customers. */
  phone: string;
  /** Twilio number to send from; defaults to TWILIO_SMS_NUMBER. Must be SMS-capable. */
  fromNumber?: string;
  /** Don't re-text about the same customer more often than this. Default 15. */
  cooldownMinutes?: number;
};

const SETTINGS_KEY = "staff_alerts";

/** Last alert per customer, to stop a chatty thread firing a text per message. */
const lastAlertAt = new Map<number, number>();

export async function getStaffAlertSettings(): Promise<StaffAlertSettings | null> {
  const { getAppSetting } = await import("../db");
  const s = (await getAppSetting(SETTINGS_KEY)) as StaffAlertSettings | null;
  if (!s || !s.enabled || !s.phone) return null;
  return s;
}

/** Where the app lives, for the deep link in the text. */
function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "https://mot-reminder-quick.vercel.app").replace(/\/$/, "");
}

/** SMS keeps to one segment where it can — 160 chars including the link. */
function buildAlert(customerName: string, body: string, reg: string | null, url: string): string {
  const head = `${customerName}${reg ? ` (${reg})` : ""}:`;
  const room = 160 - head.length - url.length - 3; // spaces + ellipsis budget
  const text = (body || "").replace(/\s+/g, " ").trim();
  const clipped = room > 12 && text.length > room ? `${text.slice(0, room - 1)}…` : text.slice(0, Math.max(0, room));
  return `${head} ${clipped} ${url}`.trim();
}

/**
 * Text the on-call number about an inbound customer message. Never throws and never blocks the
 * webhook's reply to Twilio — a failed alert must not cause Twilio to retry the message.
 */
export async function notifyInboundMessage(input: {
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  body: string;
  registration?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const settings = await getStaffAlertSettings();
    if (!settings) return { sent: false, reason: "not configured" };

    const cooldownMs = (settings.cooldownMinutes ?? 15) * 60_000;
    if (input.customerId != null) {
      const last = lastAlertAt.get(input.customerId);
      if (last && Date.now() - last < cooldownMs) return { sent: false, reason: "within cooldown" };
    }

    const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    const from = (settings.fromNumber || process.env.TWILIO_SMS_NUMBER || "").trim();
    if (!accountSid || !authToken || !from) return { sent: false, reason: "twilio SMS not configured" };

    const link = input.customerId != null
      ? `${appBaseUrl()}/conversations?customer=${input.customerId}`
      : `${appBaseUrl()}/conversations`;
    const message = buildAlert(input.customerName, input.body, input.registration ?? null, link);

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: settings.phone, From: from, Body: message }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[Staff Alert] Twilio ${res.status}: ${detail.slice(0, 200)}`);
      return { sent: false, reason: `twilio ${res.status}` };
    }
    if (input.customerId != null) lastAlertAt.set(input.customerId, Date.now());
    console.log(`[Staff Alert] Texted ${settings.phone} about ${input.customerName}`);
    return { sent: true };
  } catch (e: any) {
    console.error("[Staff Alert] failed:", e?.message);
    return { sent: false, reason: e?.message };
  }
}
