import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers, reminders } from "../drizzle/schema";
import { sql, isNotNull } from "drizzle-orm";

async function checkAllCounts() {
    const db = await getDb();
    if (!db) return;

    console.log("Monitoring GA4 Reminder Import Progress Live... (Press Ctrl+C to stop)");

    while (true) {
        const [rTotal] = await db.select({ count: sql<number>`count(*)` }).from(reminders);
        const [rImported] = await db.select({ count: sql<number>`count(*)` }).from(reminders).where(isNotNull(reminders.externalId));

        console.log(`${new Date().toLocaleTimeString()} - Total Reminders: ${rTotal.count} (Imported via GA4: ${rImported.count})`);
        
        await new Promise(res => setTimeout(res, 2000));
    }
}

checkAllCounts().catch(console.error);
