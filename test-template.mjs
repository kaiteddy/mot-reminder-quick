#!/usr/bin/env node

/**
 * Test WhatsApp Message Template
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
const TO_NUMBER = '+447843275372';
const TEMPLATE_SID = 'HX7989152000fc9771c99762c03f72785d'; // mot_reminder_eli_motors

console.log('=== Testing WhatsApp Message Template ===\n');

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

// Calculate MOT expiry (7 days from now for testing)
const motDate = new Date();
motDate.setDate(motDate.getDate() + 7);
const formattedDate = motDate.toLocaleDateString("en-GB", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const templateVariables = {
  '1': 'Test Customer',
  '2': 'AB12 CDE',
  '3': formattedDate,
  '4': '7',
};

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

console.log('Sending template message...\n');

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
    console.log('✅ Template message sent successfully!');
    console.log(`\nMessage SID: ${data.sid}`);
    console.log(`Status: ${data.status}`);
    console.log(`\nCheck WhatsApp at ${TO_NUMBER} for the MOT reminder.`);
  } else {
    console.error('❌ Failed to send template message');
    console.error('\nError response:');
    console.error(JSON.stringify(data, null, 2));
  }
} catch (error) {
  console.error('❌ Request failed:', error.message);
}
