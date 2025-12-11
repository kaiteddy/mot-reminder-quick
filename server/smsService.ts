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
  message?: string;
  useTemplate?: boolean;
  templateSid?: string;
  templateVariables?: Record<string, string>;
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
    
    // Ensure From number also has whatsapp: prefix
    const fromNumber = config.whatsappNumber.startsWith('whatsapp:') 
      ? config.whatsappNumber 
      : `whatsapp:${config.whatsappNumber}`;
    
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
        formData.append('ContentVariables', JSON.stringify(params.templateVariables));
      }
    } else {
      // Use freeform message (requires 24-hour window)
      formData = new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        Body: params.message || '',
      });
    }

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

/**
 * Send MOT reminder using WhatsApp template
 */
export async function sendMOTReminderWithTemplate(params: {
  to: string;
  customerName: string;
  registration: string;
  motExpiryDate: Date;
}): Promise<SendSMSResult> {
  const daysLeft = Math.ceil((params.motExpiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  
  const formattedDate = params.motExpiryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  
  return sendSMS({
    to: params.to,
    useTemplate: true,
    templateSid: 'HX127c47f8a63b992d80b43943394a1740', // motreminder
    templateVariables: {
      '1': params.customerName,
      '2': params.registration,
      '3': formattedDate,
      '4': daysLeft.toString(),
    },
  });
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
