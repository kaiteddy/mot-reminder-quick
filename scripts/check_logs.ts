import "dotenv/config";
import { getDb } from "../server/db";
import { reminderLogs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
    try {
        const db = await getDb();
        if (!db) throw new Error("No db");
        const logs = await db.select()
            .from(reminderLogs)
            .where(eq(reminderLogs.recipient, "07526258305"))
            .limit(5);
        console.log("Logs for 07526258305:");
        console.dir(logs, { depth: null });

        // Let's also check Twilio directly if we can
        try {
            const twilioClient = (await import("twilio")).default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            const messages = await twilioClient.messages.list({
                to: "whatsapp:+447526258305",
                limit: 5
            });
            console.log("\nTwilio WhatsApp logs:");
            messages.forEach(m => {
                console.log(`SID: ${m.sid} | Status: ${m.status} | ErrorCode: ${m.errorCode} | ErrorMessage: ${m.errorMessage}`);
            });

            const smsMessages = await twilioClient.messages.list({
                to: "+447526258305",
                limit: 5
            });
            console.log("\nTwilio SMS logs:");
            smsMessages.forEach(m => {
                console.log(`SID: ${m.sid} | Status: ${m.status} | ErrorCode: ${m.errorCode} | ErrorMessage: ${m.errorMessage}`);
            });
        } catch (e: any) {
            console.log("Could not fetch from Twilio directly:", e.message);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
