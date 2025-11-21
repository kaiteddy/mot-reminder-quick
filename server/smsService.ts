/**
 * SMS Service using Twilio
 * Sends SMS reminders to customers
 */

interface SMSConfig {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
}

interface SendSMSParams {
  to: string;
  message: string;
}

interface SendSMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send SMS using Twilio
 */
export async function sendSMS(params: SendSMSParams): Promise<SendSMSResult> {
  const config: SMSConfig = {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || "",
  };

  // Check if Twilio is configured
  if (!config.accountSid || !config.authToken || !config.whatsappNumber) {
    return {
      success: false,
      error: "Twilio credentials not configured. Please add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER to your environment variables.",
    };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    
    // Format recipient number for WhatsApp if not already formatted
    const toNumber = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;
    
    const formData = new URLSearchParams({
      To: toNumber,
      From: config.whatsappNumber,
      Body: params.message,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: errorData.message || `Twilio API error: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.sid,
    };
  } catch (error) {
    console.error("Error sending SMS:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Generate MOT reminder SMS message
 */
export function generateMOTReminderMessage(params: {
  customerName: string;
  registration: string;
  dueDate: Date;
  garageName?: string;
}): string {
  const formattedDate = params.dueDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const garageName = params.garageName || "your garage";

  return `Hi ${params.customerName}, this is a reminder that the MOT for your vehicle ${params.registration} is due on ${formattedDate}. Please contact ${garageName} to book your MOT test. Thank you!`;
}

/**
 * Generate Service reminder SMS message
 */
export function generateServiceReminderMessage(params: {
  customerName: string;
  registration: string;
  dueDate: Date;
  garageName?: string;
}): string {
  const formattedDate = params.dueDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const garageName = params.garageName || "your garage";

  return `Hi ${params.customerName}, this is a reminder that your vehicle ${params.registration} is due for a service on ${formattedDate}. Please contact ${garageName} to book your service. Thank you!`;
}
