#!/usr/bin/env node

/**
 * Check WhatsApp Message Templates in Twilio
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

console.log('=== Checking WhatsApp Message Templates ===\n');

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('❌ Missing Twilio credentials!');
  process.exit(1);
}

const url = `https://content.twilio.com/v1/Content`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
    },
  });

  const data = await response.json();

  if (response.ok) {
    console.log(`Found ${data.contents?.length || 0} templates:\n`);
    
    if (data.contents && data.contents.length > 0) {
      data.contents.forEach((template, index) => {
        console.log(`${index + 1}. ${template.friendly_name || template.sid}`);
        console.log(`   SID: ${template.sid}`);
        console.log(`   Type: ${template.types?.['twilio/text']?.body || 'N/A'}`);
        console.log(`   Status: ${template.approval_requests?.status || 'unknown'}`);
        console.log('');
      });
    } else {
      console.log('No templates found. You need to create WhatsApp message templates.');
      console.log('\nTo create templates:');
      console.log('1. Go to: https://console.twilio.com/us1/develop/sms/content-editor');
      console.log('2. Click "Create new Content"');
      console.log('3. Choose "WhatsApp" as the channel');
      console.log('4. Create a template for MOT reminders');
      console.log('\nExample template:');
      console.log('---');
      console.log('Name: mot_reminder');
      console.log('Body: Hello {{1}}, your vehicle {{2}} is due for MOT on {{3}}. Please book your appointment soon.');
      console.log('---');
    }
  } else {
    console.error('❌ Failed to fetch templates');
    console.error(JSON.stringify(data, null, 2));
  }
} catch (error) {
  console.error('❌ Request failed:', error.message);
}
