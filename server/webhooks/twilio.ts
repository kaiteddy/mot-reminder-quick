/**
 * Twilio WhatsApp Webhook Handler
 * Handles incoming WhatsApp messages and status updates from Twilio
 */

import type { Request, Response } from "express";
import {
  createCustomerMessage,
  findCustomerByPhone,
  setCustomerOptOut,
  setCustomerOptIn,
  createCustomer,
  updateReminderLogStatus
} from "../db";

interface TwilioWebhookBody {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MessageStatus?: string;
  SmsStatus?: string;
  SmsSid?: string;
  ButtonText?: string;    // present when the customer tapped a quick-reply button
  ButtonPayload?: string; // the button's id (if set in the template)
}

/** Map a tapped reminder button to an appointment-response action. */
function buttonToResponse(text: string): "confirmed" | "cancel" | "reschedule" | null {
  const t = (text || "").trim().toLowerCase();
  if (/confirm/.test(t)) return "confirmed";
  if (/cancel/.test(t)) return "cancel";
  if (/reschedul|rearrang/.test(t)) return "reschedule";
  return null;
}

/** Record a customer's reminder button reply against their most recently-reminded appointment. */
async function recordAppointmentResponse(fromPhone: string, action: "confirmed" | "cancel" | "reschedule"): Promise<boolean> {
  const { getDb, findCustomerByPhone } = await import("../db");
  const { appointments } = await import("../../drizzle/schema");
  const { eq, and, isNotNull, desc } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return false;
  const customer = await findCustomerByPhone(fromPhone);
  if (!customer) return false;
  const [appt] = await db.select().from(appointments)
    .where(and(eq(appointments.customerId, customer.id), isNotNull(appointments.reminderSentAt)))
    .orderBy(desc(appointments.reminderSentAt))
    .limit(1);
  if (!appt) return false;
  await db.update(appointments).set({ customerResponse: action, respondedAt: new Date() }).where(eq(appointments.id, appt.id));
  console.log(`[Twilio Webhook] ✓ Appointment ${appt.id} marked "${action}" from ${customer.name}`);
  return true;
}

/**
 * Check if message contains opt-out keywords
 */
function checkOptOutKeywords(messageBody: string): boolean {
  if (!messageBody) return false;

  const normalizedBody = messageBody.trim().toUpperCase();
  const optOutKeywords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

  return optOutKeywords.includes(normalizedBody);
}

/**
 * Check if message contains opt-in keywords
 */
function checkOptInKeywords(messageBody: string): boolean {
  if (!messageBody) return false;

  const normalizedBody = messageBody.trim().toUpperCase();
  const optInKeywords = ['START', 'YES', 'UNSTOP'];

  return optInKeywords.includes(normalizedBody);
}

/**
 * Test endpoint to verify webhook is accessible
 */
export async function handleWebhookTest(req: Request, res: Response) {
  res.json({
    status: "ok",
    message: "Twilio webhook endpoint is active",
    endpoint: req.path,
    timestamp: new Date().toISOString(),
    instructions: "This endpoint accepts POST requests from Twilio. Configure it in your Twilio Console."
  });
}

/**
 * Handle incoming WhatsApp messages from Twilio
 * This endpoint should be configured in Twilio Console:
 * https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders
 */
export async function handleTwilioWebhook(req: Request, res: Response) {
  try {
    const body: TwilioWebhookBody = req.body;

    console.log("[Twilio Webhook] Received:", {
      messageSid: body.MessageSid,
      from: body.From,
      to: body.To,
      body: body.Body,
      status: body.MessageStatus || body.SmsStatus,
    });

    // A tapped reminder button (Confirm/Cancel/Reschedule) is an appointment response —
    // NOT a STOP/opt-out. (Critical: the "Cancel" button must not unsubscribe the customer.)
    const buttonAction = body.ButtonText ? buttonToResponse(body.ButtonText) : null;
    const isOptOut = !buttonAction && checkOptOutKeywords(body.Body);

    // Log the incoming message
    await logIncomingMessage({
      messageSid: body.MessageSid,
      from: body.From,
      to: body.To,
      body: body.Body || body.ButtonText || "",
      status: body.MessageStatus || body.SmsStatus || "unknown",
      timestamp: new Date(),
      isOptOut,
    });

    if (buttonAction) {
      await recordAppointmentResponse((body.From || "").replace("whatsapp:", ""), buttonAction);
    }

    // Which channel this arrived on — Twilio prefixes WhatsApp addresses, plain SMS has no prefix.
    const isWhatsApp = String(body.From || "").startsWith("whatsapp:");

    // Send TwiML response to acknowledge receipt
    res.set("Content-Type", "text/xml");
    if (buttonAction) {
      const reply = buttonAction === "confirmed"
        ? "Thanks for confirming — see you then! ELI Motors, Hendon."
        : buttonAction === "cancel"
          ? "Thanks for letting us know. We've flagged your booking for cancellation and will be in touch."
          : "No problem — we'll contact you to rearrange your MOT. ELI Motors, Hendon.";
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${reply}</Message>
</Response>`);
    } else if (isOptOut) {
      // Always confirm an opt-out, on either channel — the customer asked to stop and is
      // owed an acknowledgement, and it is worth the few pence on SMS.
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed from MOT reminders. Reply START to opt back in.</Message>
</Response>`);
    } else if (isWhatsApp) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thank you for your message. We'll get back to you soon.</Message>
</Response>`);
    } else {
      // Plain SMS: acknowledge silently. On WhatsApp the courtesy reply is free, but by text
      // it bills per message — a customer answering "ok thanks" would cost a reply nobody
      // needed. The message is already in Conversations and raises a notification.
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`);
    }
  } catch (error) {
    console.error("[Twilio Webhook] Error:", error);
    res.status(500).send("Internal Server Error");
  }
}

/**
 * Handle message status callbacks from Twilio
 */
/**
 * WhatsApp failures that a plain text message would have got through: outside the 24-hour
 * service window, and "not a WhatsApp user". Both are reported asynchronously.
 */
const RESCUABLE_WHATSAPP_ERRORS = new Set([63016, 63024, 63003]);

/**
 * Re-send a WhatsApp message that failed after Twilio had already accepted it, as an SMS.
 * The original body isn't in the callback, so it's read back from Twilio by SID.
 */
async function retryAsSms(messageSid: string, errCode: number) {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!accountSid || !authToken) return;

  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}.json`,
    { headers: { Authorization: auth } });
  if (!res.ok) return;
  const msg: any = await res.json();

  // Only rescue outbound WhatsApp. An SMS that failed must not loop back through here.
  const from = String(msg.from || "");
  const to = String(msg.to || "");
  if (!from.startsWith("whatsapp:") || !to.startsWith("whatsapp:")) return;
  const body = String(msg.body || "").trim();
  if (!body) return;

  const { sendAsSms } = await import("../services/customerReply");
  const why = errCode === 63016 ? "the 24-hour WhatsApp window had closed" : "they aren't on WhatsApp";
  const out = await sendAsSms(to, body, why);
  console.log(`[Twilio Status] ${messageSid} failed ${errCode}; SMS rescue ${out.success ? "sent " + out.messageId : "failed: " + out.error}`);
}

export async function handleTwilioStatusCallback(req: Request, res: Response) {
  try {
    const body: TwilioWebhookBody = req.body;

    console.log("[Twilio Status] Received:", {
      messageSid: body.MessageSid || body.SmsSid,
      status: body.MessageStatus || body.SmsStatus,
      from: body.From,
      to: body.To,
      fullBody: body,
    });

    const msgSid = body.MessageSid || body.SmsSid || "";
    const status = body.MessageStatus || body.SmsStatus || "unknown";

    // Update message status in database
    const updated = await updateMessageStatus({ messageSid: msgSid || "unknown", status, timestamp: new Date() });
    console.log("[Twilio Status] Database update result:", updated);

    // Also reflect delivery status on the day-of MOT reminder, if this SID is one.
    if (msgSid) {
      const { updateAppointmentReminderStatus } = await import("../db");
      await updateAppointmentReminderStatus(msgSid, status);
    }

    // WhatsApp reports its two most common refusals asynchronously — 63016 (outside the
    // 24-hour window) and 63024 (recipient isn't a WhatsApp user). Twilio accepts the send with
    // a 201 and only says so here, so this is the only place the message can be rescued.
    // Without it the customer simply never hears back.
    const errCode = Number((req.body as any)?.ErrorCode || 0);
    if (msgSid && RESCUABLE_WHATSAPP_ERRORS.has(errCode)) {
      await retryAsSms(msgSid, errCode).catch((e) =>
        console.error("[Twilio Status] SMS rescue failed:", e?.message));
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("[Twilio Status Callback] Error:", error);
    res.status(500).send("Internal Server Error");
  }
}

/**
 * Log incoming WhatsApp message to database
 */
async function logIncomingMessage(data: {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  status?: string;
  timestamp: Date;
  isOptOut?: boolean;
}) {


  try {
    // Extract phone number from WhatsApp format (whatsapp:+1234567890)
    const fromNumber = data.from.replace('whatsapp:', '');
    const toNumber = data.to.replace('whatsapp:', '');

    // Try to find customer by phone number
    let customerId = null;
    try {
      const customer = await findCustomerByPhone(fromNumber);
      if (customer) {
        customerId = customer.id;

        // Handle opt-out
        if (data.isOptOut) {
          await setCustomerOptOut(customer.id);
          console.log(`[Twilio Webhook] ✓ Customer ${customer.id} (${customer.name}) opted out`);
        }

        // Handle opt-in (START keyword)
        const isOptIn = checkOptInKeywords(data.body);
        if (isOptIn) {
          await setCustomerOptIn(customer.id);
          console.log(`[Twilio Webhook] ✓ Customer ${customer.id} (${customer.name}) opted back in`);
        }

        // Handle auto-booking (BOOK keyword)
        const normalizedBody = data.body.trim().toUpperCase();
        if (normalizedBody.includes('BOOK') || normalizedBody.includes('YES')) {
          const { getDb } = await import("../db");
          const { reminderLogs, vehicles } = await import("../../drizzle/schema");
          const { eq, desc } = await import("drizzle-orm");
          
          const db = await getDb();
          if (db) {
            // Find the most recent reminder sent to this customer
            const recentReminders = await db.select()
              .from(reminderLogs)
              .where(eq(reminderLogs.customerId, customer.id))
              .orderBy(desc(reminderLogs.sentAt))
              .limit(1);
              
            const recentReminder = recentReminders[0];
            
            if (recentReminder && recentReminder.vehicleId) {
              await db.update(vehicles)
                .set({ bookingRequested: 1 })
                .where(eq(vehicles.id, recentReminder.vehicleId));
              console.log(`[Twilio Webhook] ✓ Customer ${customer.id} requested booking for vehicle ${recentReminder.vehicleId}. Flagged!`);
            }
          }
        }
      } else {
        // Customer not found, create new one
        console.log(`[Twilio Webhook] Creating new customer for unknown number: ${fromNumber}`);
        try {
          const newCustomerId = await createCustomer({
            name: `New Lead (${fromNumber})`,
            phone: fromNumber,
            optedOut: 0,
          });
          customerId = newCustomerId;
          console.log(`[Twilio Webhook] ✓ Created new customer ID: ${customerId}`);
        } catch (createError) {
          console.error("[Twilio Webhook] Failed to create new customer:", createError);
        }
      }
    } catch (error) {
      console.warn("[Twilio Webhook] Error looking up/creating customer:", error);
    }

    // Store the message
    await createCustomerMessage({
      messageSid: data.messageSid,
      fromNumber,
      toNumber,
      messageBody: data.body,
      customerId,
      receivedAt: data.timestamp,
      read: 0,
    });

    console.log("[Twilio Webhook] Message stored:", {
      messageSid: data.messageSid,
      from: fromNumber,
      customerId,
    });

    // Text whoever is on call, so a reply doesn't sit unseen in the web app. Awaited rather than
    // fired-and-forgotten because serverless can freeze the instance as soon as we respond to
    // Twilio — but it never throws, so a failed alert can't make Twilio retry the message.
    let customerName = fromNumber;
    if (customerId != null) {
      try {
        const c: any = await findCustomerByPhone(fromNumber);
        if (c?.name) customerName = c.name;
      } catch { /* fall back to showing the number */ }
    }
    const url = customerId != null ? `/conversations?customer=${customerId}` : "/conversations";
    const { pushToAll } = await import("../services/pushNotifications");
    const { notifyInboundMessage } = await import("../services/staffAlerts");
    // Push first — it's the one that lands on the lock screen. The text is the backstop for when
    // a phone's push subscription has quietly lapsed. Both are best-effort and neither throws.
    await Promise.all([
      pushToAll({
        title: customerName,
        body: (data.body || "").slice(0, 160),
        url,
        tag: customerId != null ? `customer-${customerId}` : "customer-message",
      }),
      notifyInboundMessage({ customerId, customerName, customerPhone: fromNumber, body: data.body }),
    ]);
  } catch (error) {
    console.error("[Twilio Webhook] Failed to log message:", error);
  }
}

/**
 * Update message delivery status in database
 */
async function updateMessageStatus(data: {
  messageSid: string;
  status?: string;
  timestamp: Date;
}): Promise<{ success: boolean; message: string }> {


  try {
    console.log("[Twilio Status] Updating status:", data);

    // Possible statuses: queued, sending, sent, delivered, read, undelivered, failed
    if (data.status === "read") {
      await updateReminderLogStatus(data.messageSid, "read", data.timestamp);
      console.log(`[Twilio Status] ✓ Message ${data.messageSid} marked as READ`);
      return { success: true, message: "Status updated to read" };
    } else if (data.status === "delivered") {
      await updateReminderLogStatus(data.messageSid, "delivered", data.timestamp);
      console.log(`[Twilio Status] ✓ Message ${data.messageSid} marked as DELIVERED`);
      return { success: true, message: "Status updated to delivered" };
    } else if (data.status === "failed" || data.status === "undelivered") {
      await updateReminderLogStatus(data.messageSid, "failed", data.timestamp, `Status: ${data.status}`);
      console.log(`[Twilio Status] ✓ Message ${data.messageSid} marked as FAILED: ${data.status}`);
      return { success: true, message: `Status updated to failed: ${data.status}` };
    } else if (data.status === "sent") {
      await updateReminderLogStatus(data.messageSid, "sent", data.timestamp);
      console.log(`[Twilio Status] ✓ Message ${data.messageSid} marked as SENT`);
      return { success: true, message: "Status updated to sent" };
    } else {
      console.log(`[Twilio Status] ⚠ Unknown status: ${data.status} for message ${data.messageSid}`);
      return { success: false, message: `Unknown status: ${data.status}` };
    }
  } catch (error) {
    console.error("[Twilio Status] ✗ Failed to update status:", error);
    return { success: false, message: `Error: ${error}` };
  }
}
