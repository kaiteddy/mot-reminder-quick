#!/usr/bin/env node

/**
 * Test WhatsApp Reminder with Real Data
 * This sends a test MOT reminder using the template with your phone number
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
const TO_NUMBER = '+447843275372'; // Your test number
const TEMPLATE_SID = 'HX7989152000fc9771c99762c03f72785d'; // mot_reminder_eli_motors

console.log('=== Testing MOT Reminder with Real Data ===\n');

if (!ACCOUNT_SID || !AUTH_TOKEN || !WHATSAPP_NUMBER) {
  console.error('❌ Missing Twilio credentials!');
  process.exit(1);
}

// Format numbers
const fromNumber = WHATSAPP_NUMBER.startsWith('whatsapp:') 
  ? WHATSAPP_NUMBER 
  : `whatsapp:${WHATSAPP_NUMBER}`;
  
const toNumber = TO_NUMBER.startsWith('whatsapp:')
  ? TO_NUMBER
  : `whatsapp:${TO_NUMBER}`;

// Use real-looking data for testing
const customerName = 'John Smith';
const registration = 'AB12 CDE';
const motDate = new Date();
motDate.setDate(motDate.getDate() + 14); // 14 days from now
const formattedDate = motDate.toLocaleDateString("en-GB", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const templateVariables = {
  '1': customerName,
  '2': registration,
  '3': formattedDate,
  '4': '14',
};

console.log('Sending MOT Reminder:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Customer: ${customerName}`);
console.log(`Vehicle: ${registration}`);
console.log(`MOT Expiry: ${formattedDate}`);
console.log(`Days Left: 14`);
console.log(`To: ${TO_NUMBER}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('Template Variables:');
console.log(JSON.stringify(templateVariables, null, 2));
console.log('');

const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

const formData = new URLSearchParams({
  To: toNumber,
  From: fromNumber,
  ContentSid: TEMPLATE_SID,
  ContentVariables: JSON.stringify(templateVariables),
});

console.log('Sending message...\n');

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  const data = await response.json();

  if (response.ok) {
    console.log('✅ MOT Reminder sent successfully!');
    console.log(`\nMessage SID: ${data.sid}`);
    console.log(`Status: ${data.status}`);
    console.log(`\nExpected Message Format:`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚗 Eli Motors Ltd - MOT Reminder');
    console.log('');
    console.log(`Hi ${customerName},`);
    console.log('');
    console.log(`Your vehicle ${registration} MOT expires on ${formattedDate} (14 days).`);
    console.log('');
    console.log('📅 Book your MOT test today');
    console.log('📞 Call: 0208 203 6449');
    console.log('🌐 Visit: www.elimotors.co.uk');
    console.log('📍 Hendon, London');
    console.log('');
    console.log('✨ Serving Hendon since 1979 ✨');
    console.log('');
    console.log('Reply STOP to opt out.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\nCheck WhatsApp at ${TO_NUMBER} for the message.`);
  } else {
    console.error('❌ Failed to send message');
    console.error('\nError response:');
    console.error(JSON.stringify(data, null, 2));
  }
} catch (error) {
  console.error('❌ Request failed:', error.message);
}
