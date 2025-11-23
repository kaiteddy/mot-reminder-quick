#!/usr/bin/env node

/**
 * Twilio WhatsApp Test Script
 * Tests sending a WhatsApp message directly using Twilio API
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
const TO_NUMBER = '+447843275372';

console.log('=== Twilio WhatsApp Test ===\n');
console.log('Configuration:');
console.log(`Account SID: ${ACCOUNT_SID ? ACCOUNT_SID.substring(0, 10) + '...' : 'NOT SET'}`);
console.log(`Auth Token: ${AUTH_TOKEN ? '***' + AUTH_TOKEN.substring(AUTH_TOKEN.length - 4) : 'NOT SET'}`);
console.log(`From Number: ${WHATSAPP_NUMBER || 'NOT SET'}`);
console.log(`To Number: ${TO_NUMBER}\n`);

if (!ACCOUNT_SID || !AUTH_TOKEN || !WHATSAPP_NUMBER) {
  console.error('❌ Missing Twilio credentials!');
  console.error('Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER');
  process.exit(1);
}

// Format numbers with whatsapp: prefix
const fromNumber = WHATSAPP_NUMBER.startsWith('whatsapp:') 
  ? WHATSAPP_NUMBER 
  : `whatsapp:${WHATSAPP_NUMBER}`;
  
const toNumber = TO_NUMBER.startsWith('whatsapp:')
  ? TO_NUMBER
  : `whatsapp:${TO_NUMBER}`;

console.log('Formatted numbers:');
console.log(`From: ${fromNumber}`);
console.log(`To: ${toNumber}\n`);

const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

const formData = new URLSearchParams({
  To: toNumber,
  From: fromNumber,
  Body: 'Test message from MOT Reminder Quick App - ' + new Date().toISOString(),
});

console.log('Sending request to Twilio API...\n');

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
    console.log('✅ Message sent successfully!');
    console.log('\nResponse:');
    console.log(JSON.stringify(data, null, 2));
    console.log(`\nMessage SID: ${data.sid}`);
    console.log(`Status: ${data.status}`);
    console.log(`\nCheck your WhatsApp at ${TO_NUMBER} for the message.`);
  } else {
    console.error('❌ Failed to send message');
    console.error('\nError response:');
    console.error(JSON.stringify(data, null, 2));
    
    if (data.code === 21408) {
      console.error('\n⚠️  Permission error: The recipient may not have messaged your Twilio WhatsApp number first.');
      console.error('To fix: Send a message from +447843275372 to your Twilio WhatsApp number first.');
    } else if (data.code === 21211) {
      console.error('\n⚠️  Invalid phone number format.');
    } else if (data.code === 21606) {
      console.error('\n⚠️  The From number is not a valid WhatsApp-enabled phone number.');
    }
  }
} catch (error) {
  console.error('❌ Request failed:', error.message);
}
