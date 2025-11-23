import "dotenv/config";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

/**
 * Format customer name for WhatsApp templates
 * Handles various name field combinations from GA4 import
 */
function formatCustomerName(params) {
  // If fullName is provided, use it
  if (params.fullName) {
    return params.fullName.trim();
  }

  const parts = [];

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

async function sendTestReminder(customerData, testNumber) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  
  const toNumber = "whatsapp:+447843275372";
  const fromNumber = TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:') 
    ? TWILIO_WHATSAPP_NUMBER 
    : `whatsapp:${TWILIO_WHATSAPP_NUMBER}`;
  
  const motDate = new Date();
  motDate.setDate(motDate.getDate() + 14);
  const formattedDate = motDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  
  const customerName = formatCustomerName(customerData);
  
  console.log(`\nTest ${testNumber}: ${JSON.stringify(customerData)}`);
  console.log(`Formatted name: "${customerName}"`);
  
  const formData = new URLSearchParams({
    To: toNumber,
    From: fromNumber,
    ContentSid: 'HX127c47f8a63b992d86b43943394a1740', // motreminder
    ContentVariables: JSON.stringify({
      '1': customerName,
      '2': 'AB12 CDE',
      '3': formattedDate,
      '4': '14',
    }),
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const data = await response.json();
  console.log(`Status: ${data.status}, SID: ${data.sid}`);
  return data;
}

// Test various name format scenarios
const testCases = [
  // Full format with title
  { title: "Mr", firstName: "John", lastName: "Smith" },
  
  // No title
  { firstName: "Sarah", lastName: "Johnson" },
  
  // Only surname (common in GA4)
  { surname: "Williams" },
  
  // Only first name
  { firstName: "David" },
  
  // Title and surname only
  { title: "Mrs", surname: "Brown" },
  
  // Full name field (some GA4 records)
  { fullName: "Dr. Emily Roberts" },
];

console.log("Testing various customer name formats...\n");
console.log("All messages will be sent to +447843275372");

for (let i = 0; i < testCases.length; i++) {
  await sendTestReminder(testCases[i], i + 1);
  
  // Wait 2 seconds between messages to avoid rate limiting
  if (i < testCases.length - 1) {
    console.log("\nWaiting 2 seconds...");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

console.log("\n✅ All test reminders sent!");
console.log("Check your WhatsApp at +447843275372 to see how each name format appears.");
