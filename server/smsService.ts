/**
 * SMS Service using Twilio
 * Sends SMS reminders to customers
 */
import { normalizePhoneNumber } from "./utils/phoneUtils";


interface SMSConfig {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  messagingServiceSid?: string;
}

interface SendSMSParams {
  to: string;
  message?: string;
  useTemplate?: boolean;
  templateSid?: string;
  templateVariables?: Record<string, string>;
  fallbackMessage?: string;
}

interface SendSMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send SMS using Twilio
 */
/** Where Twilio should report delivery outcomes. Must be publicly reachable. */
export function statusCallbackUrl(): string {
  const base = (process.env.PUBLIC_APP_URL || "https://mot-reminder-quick.vercel.app").replace(/\/$/, "");
  return `${base}/api/webhooks/twilio/status`;
}

/**
 * The garage's own numbers. Customer #87 ("ELI MOTORS LTD") carries the workshop landline, so
 * reminders were being sent to the garage itself — 8 of them before anyone noticed. Blocking at
 * the send layer rather than at one caller catches every path, including future ones.
 */
const OWN_NUMBERS = ["+442082036449"];

export function isOwnNumber(phone: string): boolean {
  const d = String(phone || "").replace(/^whatsapp:/, "").replace(/\D/g, "");
  if (!d) return false;
  const norm = (n: string) => n.replace(/\D/g, "").replace(/^44/, "0").replace(/^0/, "");
  const target = norm(d);
  return OWN_NUMBERS.some((own) => norm(own) === target)
    || [process.env.TWILIO_WHATSAPP_NUMBER, process.env.TWILIO_SMS_NUMBER]
         .filter(Boolean).some((own) => norm(String(own)) === target);
}

export async function sendSMS(params: SendSMSParams): Promise<SendSMSResult> {
  const config: SMSConfig = {
    accountSid: (process.env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: (process.env.TWILIO_AUTH_TOKEN || "").trim(),
    whatsappNumber: (process.env.TWILIO_WHATSAPP_NUMBER || "").trim(),
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID?.trim(),
  };

  // Auth: prefer a Twilio API Key (SID "SK..." + its Secret) over the account Auth Token.
  // The request URL always uses the Account SID; only the Basic-auth credentials change.
  const apiKey = (process.env.TWILIO_API_KEY || "").trim();
  const apiSecret = (process.env.TWILIO_API_SECRET || "").trim();
  const usingApiKey = apiKey.startsWith("SK") && !!apiSecret;
  const authHeader = `Basic ${Buffer.from(`${usingApiKey ? apiKey : config.accountSid}:${usingApiKey ? apiSecret : config.authToken}`).toString("base64")}`;

  console.log(`[SMS Service] Sending to ${params.to} via SID ${config.accountSid.substring(0, 6)}... (auth: ${usingApiKey ? "API key" : "auth token"})`);

  // Never message ourselves — see isOwnNumber.
  if (isOwnNumber(params.to)) {
    console.log(`[SMS Service] Refusing to message our own number (${params.to})`);
    return { success: false, error: "That is the garage's own number — not sending." };
  }

  // Check if Twilio is configured
  if (!config.accountSid || !config.whatsappNumber || (!usingApiKey && !config.authToken)) {
    return {
      success: false,
      error: "Twilio credentials not configured. Need TWILIO_ACCOUNT_SID + TWILIO_WHATSAPP_NUMBER and either TWILIO_AUTH_TOKEN or TWILIO_API_KEY + TWILIO_API_SECRET.",
    };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;

    // Normalize phone number
    const normalizedTo = normalizePhoneNumber(params.to).normalized || params.to;

    // Format recipient number for WhatsApp if not already formatted
    const toNumber = normalizedTo.startsWith('whatsapp:') ? normalizedTo : `whatsapp:${normalizedTo}`;

    // Ensure From number also has whatsapp: prefix
    const fromNumber = config.whatsappNumber.startsWith('whatsapp:')
      ? config.whatsappNumber
      : `whatsapp:${config.whatsappNumber}`;

    // Use Messaging Service SID if available
    const messagingServiceSid = config.messagingServiceSid;

    let formData: URLSearchParams;

    if (params.useTemplate && params.templateSid) {
      // Use WhatsApp Message Template (no 24-hour window restriction)
      formData = new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        ContentSid: params.templateSid,
      });

      // Add template variables
      if (params.templateVariables) {
        const contentVars = JSON.stringify(params.templateVariables);
        console.log('[SMS Service] ContentSid:', params.templateSid);
        console.log('[SMS Service] ContentVariables:', contentVars);
        formData.append('ContentVariables', contentVars);
      }
    } else {
      // Use freeform message (requires 24-hour window)
      formData = new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        Body: params.message || '',
      });
    }

    // Add MessagingServiceSid if available (overrides From)
    if (messagingServiceSid) {
      formData.append('MessagingServiceSid', messagingServiceSid);
      // When using MessagingServiceSid, 'From' is optional but good to keep as fallback
      console.log('[SMS Service] Using MessagingServiceSid:', messagingServiceSid);
    }

    // WhatsApp's commonest refusals — outside the 24h window (63016) and "not a WhatsApp user"
    // (63024) — arrive AFTER Twilio has accepted the send with a 201, so the synchronous
    // fallback below can never see them. Requesting a status callback is what lets the webhook
    // catch them and re-send as a text; without it those messages are simply lost.
    formData.append('StatusCallback', statusCallbackUrl());

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[SMS Service] Twilio API Error:', JSON.stringify(errorData, null, 2));

      // Verify if it's a WhatsApp error (e.g. 63003 - Channel could not find route, 63016 - outside window)
      const isWhatsAppRoutingError =
        errorData.code === 63003 ||
        errorData.code === 63016 ||
        errorData.code === 63024 ||
        (errorData.message && errorData.message.toLowerCase().includes('whatsapp')) ||
        (errorData.message && errorData.message.toLowerCase().includes('channel could not find route'));

      if (isWhatsAppRoutingError && params.useTemplate) {
        console.log(`[SMS Service] Target number does not have WhatsApp or is unreachable via WhatsApp. Falling back to standard SMS...`);

        const fallbackBody = params.fallbackMessage || params.message || 'You have a new message. Please contact Eli Motors.';
        const smsFormData = new URLSearchParams({
          To: normalizedTo, // SMS expects normal phone number without whatsapp: prefix
          Body: fallbackBody,
        });

        if (messagingServiceSid) {
          smsFormData.append('MessagingServiceSid', messagingServiceSid);
        } else {
          // In the UK, we can use an Alphanumeric Sender ID directly without registration!
          // Note: Twilio enforces a strict maximum of 11 characters for these IDs. "ELI MOTORS LTD" is 14. 
          // So we use "ELI MOTORS" (10 chars).
          smsFormData.append('From', 'ELI MOTORS');
        }

        try {
          const smsResponse = await fetch(url, {
            method: "POST",
            headers: {
              "Authorization": authHeader,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: smsFormData.toString(),
          });

          if (!smsResponse.ok) {
            const smsErrorData = await smsResponse.json();
            console.error('[SMS Service] Twilio Fallback SMS API Error:', JSON.stringify(smsErrorData, null, 2));
            return {
              success: false,
              error: `Twilio Fallback Error: ${smsErrorData.message || smsResponse.statusText}`,
            };
          }

          const smsData = await smsResponse.json();
          return {
            success: true,
            messageId: smsData.sid,
          };
        } catch (smsError) {
          console.error("Error sending Fallback SMS:", smsError);
          return {
            success: false,
            error: smsError instanceof Error ? smsError.message : "Unknown error during fallback",
          };
        }
      }

      const sidHint = config.accountSid ? `${config.accountSid.substring(0, 6)}...` : "missing";
      const tokenHint = config.authToken ? `${config.authToken.substring(0, 3)}...` : "missing";
      return {
        success: false,
        error: `Twilio Error: ${errorData.message || response.statusText} (SID: ${sidHint}, Token: ${tokenHint})`,
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

/**
 * Generate full MOT reminder template content (for display/storage)
 * This matches what customers see in WhatsApp including emojis, contact details, and footer
 */
export function generateFullMOTTemplateContent(params: {
  customerName: string;
  registration: string;
  motExpiryDate: Date;
  isExpired: boolean;
  daysLeft?: number;
}): string {
  const formattedDate = params.motExpiryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const header = "🚗 Eli Motors Ltd - MOT Reminder";

  const body = params.isExpired
    ? `Hi ${params.customerName},\n\nYour vehicle ${params.registration} MOT expired on ${formattedDate}.`
    : `Hi ${params.customerName},\n\nYour vehicle ${params.registration} MOT expires on ${formattedDate} (${params.daysLeft} days).`;

  const callToAction = `📅 Book your MOT test today\nCall: 0208 203 6449\n🌐 Visit: www.elimotors.co.uk\n📍 Hendon, London`;

  const footer = `✨ Serving Hendon since 1979 ✨\n\nReply STOP to opt out.`;

  return `${header}\n\n${body}\n\n${callToAction}\n\n${footer}`;
}

/**
 * Send MOT reminder using WhatsApp template
 */
export async function sendMOTReminderWithTemplate(params: {
  to: string;
  customerName: string;
  registration: string;
  motExpiryDate: Date;
}): Promise<SendSMSResult> {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison

  const expiryDate = new Date(params.motExpiryDate);
  expiryDate.setHours(0, 0, 0, 0);

  const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isExpired = expiryDate < now;

  const formattedDate = params.motExpiryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Choose template based on whether MOT has expired
  const templateSid = isExpired
    ? 'HX0a553ba697cdc3acce4a935f5d462ada' // copy_motreminder (expired)
    : 'HX127c47f8a63b992d86b43943394a1740'; // motreminder (expiring)

  // For expired MOTs, we only need 3 variables (name, registration, date)
  // For expiring MOTs, we need 4 variables (name, registration, date, days)
  const templateVariables: Record<string, string> = isExpired ? {
    '1': params.customerName,
    '2': params.registration,
    '3': formattedDate,
  } : {
    '1': params.customerName,
    '2': params.registration,
    '3': formattedDate,
    '4': daysLeft.toString(),
  };

  const fallbackMessage = generateFullMOTTemplateContent({
    customerName: params.customerName,
    registration: params.registration,
    motExpiryDate: params.motExpiryDate,
    isExpired,
    daysLeft,
  });

  return sendSMS({
    to: params.to,
    useTemplate: true,
    templateSid,
    templateVariables,
    fallbackMessage,
  });
}

/**
 * Generate full Service reminder template content (for display/storage)
 */
export function generateFullServiceTemplateContent(params: {
  customerName: string;
  registration: string;
  serviceDueDate: Date;
  daysLeft: number;
}): string {
  const formattedDate = params.serviceDueDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const header = "🔧 Eli Motors Ltd - Service Reminder";

  const body = `Hi ${params.customerName},\n\nYour vehicle ${params.registration} is due for a service on ${formattedDate} (${params.daysLeft} days).`;

  const callToAction = `📅 Book your service today\nCall: 0208 203 6449\n🌐 Visit: www.elimotors.co.uk\n📍 Hendon, London`;

  const footer = `✨ Serving Hendon since 1979 ✨\n\nReply STOP to opt out.`;

  return `${header}\n\n${body}\n\n${callToAction}\n\n${footer}`;
}

/**
 * Send Service reminder using WhatsApp template
 */
export async function sendServiceReminderWithTemplate(params: {
  to: string;
  customerName: string;
  registration: string;
  serviceDueDate: Date;
}): Promise<SendSMSResult> {
  const daysLeft = Math.ceil((params.serviceDueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  const formattedDate = params.serviceDueDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const fallbackMessage = generateFullServiceTemplateContent({
    customerName: params.customerName,
    registration: params.registration,
    serviceDueDate: params.serviceDueDate,
    daysLeft,
  });

  return sendSMS({
    to: params.to,
    useTemplate: true,
    templateSid: 'HXac307a9bd92b65df83038c2b2a3eeeff', // servicereminder
    templateVariables: {
      '1': params.customerName,
      '2': params.registration,
      '3': formattedDate,
      '4': daysLeft.toString(),
    },
    fallbackMessage,
  });
}

/**
 * Generate full Urgent Follow-Up template content (for display/storage)
 */
export function generateFullUrgentFollowUpTemplateContent(params: {
  customerName: string;
  registration: string;
  motExpiryDate: Date;
  isExpired: boolean;
  daysLeft?: number;
}): string {
  const formattedDate = params.motExpiryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const header = "🚗 *Eli Motors Ltd* - MOT Reminder";

  const body = params.isExpired
    ? `Hi ${params.customerName},\n\nYour vehicle ${params.registration} MOT expired on ${formattedDate}.\nPlease do call us to book your car in or notify us if you no longer own the vehicle.`
    : `Hi ${params.customerName},\n\nYour vehicle ${params.registration} MOT is due to expire on ${formattedDate} (in ${params.daysLeft} days).\nPlease do call us to book your car in or notify us if you no longer own the vehicle.`;

  const callToAction = `📅 Book your MOT test today\n📞 Call: 0208 203 6449\n🌐 Visit: www.elimotors.co.uk\n📍 Hendon, London`;

  const footer = `✨ Serving Hendon since 1979 ✨\n\nReply STOP to opt out.`;

  return `${header}\n\n${body}\n\n${callToAction}\n\n${footer}`;
}

/**
 * Send Urgent Follow-Up reminder using WhatsApp template
 */
export async function sendUrgentFollowUpWithTemplate(params: {
  to: string;
  customerName: string;
  registration: string;
  motExpiryDate: Date;
}): Promise<SendSMSResult> {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const expiryDate = new Date(params.motExpiryDate);
  expiryDate.setHours(0, 0, 0, 0);

  const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isExpired = expiryDate < now;

  const formattedDate = params.motExpiryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Use the approved SIDs provided by the user in Twilio console
  const templateSid = isExpired
    ? process.env.TWILIO_URGENT_EXPIRED_TEMPLATE_SID || 'HXe190fe9ce0c696e1631a32319f8eb783' // mot_expired
    : process.env.TWILIO_URGENT_EXPIRING_TEMPLATE_SID || 'HXd3903b97116a1967f51c87a233a052c6'; // mot_expiring

  const templateVariables: Record<string, string> = isExpired ? {
    '1': params.customerName,
    '2': params.registration,
    '3': formattedDate,
  } : {
    '1': params.customerName,
    '2': params.registration,
    '3': formattedDate,
    '4': daysLeft.toString(),
  };

  const fallbackMessage = generateFullUrgentFollowUpTemplateContent({
    customerName: params.customerName,
    registration: params.registration,
    motExpiryDate: params.motExpiryDate,
    isExpired,
    daysLeft,
  });

  return sendSMS({
    to: params.to,
    useTemplate: true,
    templateSid,
    templateVariables,
    fallbackMessage,
  });
}

/**
 * Format customer name for WhatsApp templates
 * Handles various name field combinations
 */
export function formatCustomerName(params: {
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  surname?: string | null;
  fullName?: string | null;
}): string {
  // If fullName is provided, use it
  if (params.fullName) {
    return params.fullName.trim();
  }

  const parts: string[] = [];

  // Add title if present
  if (params.title) {
    parts.push(params.title.trim());
  }

  // Add first name if present
  if (params.firstName) {
    parts.push(params.firstName.trim());
  }

  // Add last name or surname (prefer lastName)
  const lastNamePart = params.lastName || params.surname;
  if (lastNamePart) {
    parts.push(lastNamePart.trim());
  }

  // If we have parts, join them
  if (parts.length > 0) {
    return parts.join(' ');
  }

  // Fallback
  return 'Customer';
}

/**
 * "Your car is ready to collect."
 *
 * Deliberately carries no money: a job sheet is often still being edited when the car is
 * finished, so a figure quoted here would be wrong as often as right.
 */
export function generateCarReadyMessage(params: {
  customerName: string;
  registration: string;
  vehicle?: string | null;
  companyName?: string | null;
  phone?: string | null;
}): string {
  // Greet by first name. Names arrive as "Mr Ben Rosenfeld", so drop a leading title first —
  // taking the last word would address the customer by their surname.
  const words = (params.customerName || "").trim().split(/\s+/).filter(Boolean);
  if (/^(mr|mrs|ms|miss|dr|rev|prof|sir|mx)\.?$/i.test(words[0] || "") && words.length > 1) words.shift();
  const first = words[0] || "there";
  const vehicle = [params.vehicle, params.registration].filter(Boolean).join(" ").trim();
  const who = params.companyName || "ELI MOTORS";
  const tel = params.phone || "020 8203 6449";
  // Plain ASCII only — a curly apostrophe or an en dash pushes the SMS from GSM-7 into UCS-2,
  // which drops a segment from 153 characters to 67 and doubles what the message costs to send.
  return `Hi ${first}, your ${vehicle || "vehicle"} is ready to collect from ${who}. `
    + `We are open 8:30am-5:30pm Mon-Fri. If you cannot collect today, please let us know. `
    + `Any questions, call us on ${tel}.`;
}

/**
 * Send the "car is ready" message. Uses the approved WhatsApp template when its ContentSid has
 * been set in Settings (carReadyTemplateSid) — WhatsApp only allows templates outside the 24h
 * window — and otherwise sends the same wording as plain text, which works over SMS and over
 * WhatsApp while the window is open. So this is useful the day it ships, and upgrades to the
 * template the moment Twilio approves one.
 */
export async function sendCarReadyMessage(params: {
  to: string;
  customerName: string;
  registration: string;
  message: string;
  templateSid?: string | null;
}): Promise<SendSMSResult> {
  if (params.templateSid) {
    return sendSMS({
      to: params.to,
      useTemplate: true,
      templateSid: params.templateSid,
      templateVariables: { '1': params.customerName, '2': params.registration },
      fallbackMessage: params.message,
    });
  }
  return sendSMS({ to: params.to, message: params.message });
}
