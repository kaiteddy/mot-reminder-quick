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

    // Check for opt-out keywords (STOP, UNSUBSCRIBE, etc.)
    const isOptOut = checkOptOutKeywords(body.Body);

    // Log the incoming message
    await logIncomingMessage({
      messageSid: body.MessageSid,
      from: body.From,
      to: body.To,
      body: body.Body,
      status: body.MessageStatus || body.SmsStatus || "unknown",
      timestamp: new Date(),
      isOptOut,
    });

    // Send TwiML response to acknowledge receipt
    res.set("Content-Type", "text/xml");
    if (isOptOut) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed from MOT reminders. Reply START to opt back in.</Message>
</Response>`);
    } else {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thank you for your message. We'll get back to you soon.</Message>
</Response>`);
    }
  } catch (error) {
    console.error("[Twilio Webhook] Error:", error);
    res.status(500).send("Internal Server Error");
  }
}

/**
 * Handle message status callbacks from Twilio
 */
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

    // Update message status in database
    const updated = await updateMessageStatus({
      messageSid: body.MessageSid || body.SmsSid || "unknown",
      status: body.MessageStatus || body.SmsStatus || "unknown",
      timestamp: new Date(),
    });

    console.log("[Twilio Status] Database update result:", updated);

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
