/**
 * Twilio WhatsApp Webhook Handler
 * Handles incoming WhatsApp messages and status updates from Twilio
 */

import type { Request, Response } from "express";

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

    // Log the incoming message
    await logIncomingMessage({
      messageSid: body.MessageSid,
      from: body.From,
      to: body.To,
      body: body.Body,
      status: body.MessageStatus || body.SmsStatus || "unknown",
      timestamp: new Date(),
    });

    // Send TwiML response to acknowledge receipt
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thank you for your message. We'll get back to you soon.</Message>
</Response>`);
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
    });

    // Update message status in database
    await updateMessageStatus({
      messageSid: body.MessageSid || body.SmsSid || "unknown",
      status: body.MessageStatus || body.SmsStatus || "unknown",
      timestamp: new Date(),
    });

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
}) {
  const { createCustomerMessage, findCustomerByPhone } = await import("../db");

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
      }
    } catch (error) {
      console.warn("[Twilio Webhook] Could not find customer:", error);
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
}) {
  const { updateReminderLogStatus } = await import("../db");

  try {
    // Update reminder log status
    console.log("[Twilio Status] Status updated:", data);
    
    // Possible statuses: queued, sending, sent, delivered, undelivered, failed
    if (data.status === "delivered") {
      await updateReminderLogStatus(data.messageSid, "delivered", data.timestamp);
      console.log(`[Twilio Status] Message ${data.messageSid} delivered successfully`);
    } else if (data.status === "failed" || data.status === "undelivered") {
      await updateReminderLogStatus(data.messageSid, "failed", undefined, `Status: ${data.status}`);
      console.log(`[Twilio Status] Message ${data.messageSid} failed: ${data.status}`);
    } else if (data.status === "sent") {
      await updateReminderLogStatus(data.messageSid, "sent");
    }
  } catch (error) {
    console.error("[Twilio Status] Failed to update status:", error);
  }
}
