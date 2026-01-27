import "dotenv/config";
import { getDb } from "../server/db";
import { reminders } from "../drizzle/schema";
import { eq, or, inArray, sql } from "drizzle-orm";

async function checkReminders() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    const regs = [
        "MW18 AFX",
        "MW18AFX",
        "LK04JKZ",
        "AV06 BPE",
        "MV63ANX",
        "ET07XZW"
    ];

    console.log("Checking reminders for registrations:", regs);

    const results = await db.select().from(reminders).where(
        or(
            inArray(reminders.registration, regs),
            inArray(reminders.registration, regs.map(r => r.toUpperCase()))
        )
    );

    console.log(`Found ${results.length} reminders:`);
    results.forEach(r => {
        console.log(`- Reg: ${r.registration}, ID: ${r.id}, MOT in Reminder: ${r.motExpiryDate}, Status: ${r.status}`);
    });
}

checkReminders().catch(console.error);
