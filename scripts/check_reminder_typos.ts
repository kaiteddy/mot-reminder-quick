import "dotenv/config";
import { getDb } from "../server/db";
import { reminders } from "../drizzle/schema";
import { eq, or, inArray, sql, like } from "drizzle-orm";

async function checkReminders() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    console.log("Searching reminders for E066/EO66 BZR...");

    const results = await db.select().from(reminders).where(
        like(reminders.registration, "%66%BZR%")
    );

    console.log(`Found ${results.length} reminders:`);
    results.forEach(r => {
        console.log(`- Reg: [${r.registration}], ID: ${r.id}, MOT: ${r.motExpiryDate}`);
    });
}

checkReminders().catch(console.error);
