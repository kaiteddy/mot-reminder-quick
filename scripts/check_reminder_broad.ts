import "dotenv/config";
import { getDb } from "../server/db";
import { reminders } from "../drizzle/schema";
import { like, or } from "drizzle-orm";

async function checkReminders() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select().from(reminders).where(
        or(
            like(reminders.registration, "%66%BZR%"),
            like(reminders.registration, "%BZR%")
        )
    );

    console.log(`Found ${results.length} reminders:`);
    results.forEach(r => {
        console.log(`- Reg: [${r.registration}], MOT: ${r.motExpiryDate}, ID: ${r.id}`);
    });
}

checkReminders().catch(console.error);
