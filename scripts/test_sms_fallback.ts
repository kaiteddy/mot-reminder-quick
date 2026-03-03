import { sendMOTReminderWithTemplate } from '../server/smsService';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
const projectDir = resolve(process.cwd());
config({ path: resolve(projectDir, '.env') });

async function testSMSFallback() {
    console.log('Testing SMS Fallback feature...');

    // NOTE: Put a known Non-WhatsApp number here or a number you want to test the SMS with.
    // We recommend using your own mobile number.
    const testNumber = process.argv[2] || '+447000000000'; // Example format

    console.log(`Sending test MOT reminder to ${testNumber}`);

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 10); // Expiring in 10 days

    const response = await sendMOTReminderWithTemplate({
        to: testNumber,
        customerName: "Test Customer",
        registration: "AB12 CDE",
        motExpiryDate: expiryDate
    });

    if (response.success) {
        console.log('✅ Message sent successfully!', response.messageId);
        console.log('If the number was not registered on WhatsApp, it should have fallen back to standard SMS.');
    } else {
        console.error('❌ Failed to send message:', response.error);
    }
}

testSMSFallback().catch(console.error);
