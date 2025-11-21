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
  const { getDb } = await import("../db");
  const db = await getDb();

  if (!db) {
    console.warn("[Twilio Webhook] Database not available");
    return;
  }

  try {
    // You can create a whatsapp_messages table to store these
    // For now, just log to console
    console.log("[Twilio Webhook] Message logged:", data);
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
  const { getDb } = await import("../db");
  const db = await getDb();

  if (!db) {
    console.warn("[Twilio Status] Database not available");
    return;
  }

  try {
    // Update reminder status based on message delivery status
    console.log("[Twilio Status] Status updated:", data);
    
    // Possible statuses: queued, sending, sent, delivered, undelivered, failed
    if (data.status === "delivered") {
      // Mark reminder as successfully delivered
      console.log(`[Twilio Status] Message ${data.messageSid} delivered successfully`);
    } else if (data.status === "failed" || data.status === "undelivered") {
      // Mark reminder as failed
      console.log(`[Twilio Status] Message ${data.messageSid} failed: ${data.status}`);
    }
  } catch (error) {
    console.error("[Twilio Status] Failed to update status:", error);
  }
}
