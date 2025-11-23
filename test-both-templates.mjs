import "dotenv/config";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

async function sendMOTReminder() {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  
  const toNumber = "whatsapp:+447843275372";
  const fromNumber = TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:') 
    ? TWILIO_WHATSAPP_NUMBER 
    : `whatsapp:${TWILIO_WHATSAPP_NUMBER}`;
  
  const motDate = new Date();
  motDate.setDate(motDate.getDate() + 14); // 14 days from now
  const formattedDate = motDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  
  const formData = new URLSearchParams({
    To: toNumber,
    From: fromNumber,
    ContentSid: 'HX127c47f8a63b992d86b43943394a1740', // motreminder
    ContentVariables: JSON.stringify({
      '1': 'John Smith',
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
  console.log("MOT Reminder sent:", data.sid, data.status);
  return data;
}

async function sendServiceReminder() {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  
  const toNumber = "whatsapp:+447843275372";
  const fromNumber = TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:') 
    ? TWILIO_WHATSAPP_NUMBER 
    : `whatsapp:${TWILIO_WHATSAPP_NUMBER}`;
  
  const serviceDate = new Date();
  serviceDate.setDate(serviceDate.getDate() + 7); // 7 days from now
  const formattedDate = serviceDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  
  const formData = new URLSearchParams({
    To: toNumber,
    From: fromNumber,
    ContentSid: 'HXac307a9bd92b65df83038c2b2a3eeeff', // servicereminder
    ContentVariables: JSON.stringify({
      '1': 'John Smith',
      '2': 'XY98 ZAB',
      '3': formattedDate,
      '4': '7',
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
  console.log("Service Reminder sent:", data.sid, data.status);
  return data;
}

console.log("Sending MOT reminder...");
await sendMOTReminder();

console.log("\nWaiting 2 seconds...\n");
await new Promise(resolve => setTimeout(resolve, 2000));

console.log("Sending Service reminder...");
await sendServiceReminder();

console.log("\nBoth reminders sent to +447843275372!");
