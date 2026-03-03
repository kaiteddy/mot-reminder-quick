import { config } from 'dotenv';
import { resolve } from 'path';
import { generateFullMOTTemplateContent } from '../server/smsService';

// Load environment variables
const projectDir = resolve(process.cwd());
config({ path: resolve(projectDir, '.env') });

async function testDirectSMS() {
    const testNumber = process.argv[2] || '+447843275372'; // The user's number
    console.log(`Sending direct standard SMS (no WhatsApp) to ${testNumber}`);

    const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

    // Use an Alphanumeric sender ID for standard text messages in the UK
    // Max 11 characters allowed by Twilio.
    let fromNumber = "ELI MOTORS";

    if (!accountSid || !authToken) {
        console.error("Twilio credentials not configured.");
        return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 10);

    const formattedBody = generateFullMOTTemplateContent({
        customerName: "Mr Ahmad Rahman",
        registration: "AB12 CDE",
        motExpiryDate: expiryDate,
        isExpired: false,
        daysLeft: 10
    });

    const formData = new URLSearchParams({
        To: testNumber,
        Body: formattedBody,
    });

    if (messagingServiceSid) {
        formData.append('MessagingServiceSid', messagingServiceSid);
    } else {
        formData.append('From', fromNumber);
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Twilio SMS Error:', JSON.stringify(errorData, null, 2));
        } else {
            const data = await response.json();
            console.log('✅ Standard SMS successfully dispatched to network!', data.sid);
        }
    } catch (error) {
        console.error("❌ Error sending standard SMS:", error);
    }
}

testDirectSMS().catch(console.error);
