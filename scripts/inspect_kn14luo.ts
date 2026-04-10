import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers, reminderLogs, reminders } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

async function investigate() {
    const db = await getDb();
    if (!db) return;

    console.log("Investigating KN14LUO...");

    const vList = await db.select().from(vehicles).where(eq(vehicles.registration, 'KN14LUO'));
    if (vList.length === 0) {
        console.log("No vehicle found with registration KN14LUO");
        return;
    }

    for (const v of vList) {
        console.log("\n--- Vehicle ---");
        console.log(`ID: ${v.id}, ExternalId: ${v.externalId}`);
        console.log(`MOT Expiry: ${v.motExpiryDate}`);
        console.log(`Requires MOT: ${v.requiresMot}`);
        console.log(`Last Checked: ${v.lastChecked}`);
        console.log(`Created At: ${v.createdAt}`);

        if (v.customerId) {
            const [c] = await db.select().from(customers).where(eq(customers.id, v.customerId));
            if (c) {
                console.log(`Customer: ${c.name}, Phone: ${c.phone}, OptOut: ${c.smsOptOut}, Created At: ${c.createdAt}`);
            } else {
                console.log(`Customer ID ${v.customerId} NOT FOUND!`);
            }
        } else {
            console.log("No customer linked.");
        }

        const rems = await db.select().from(reminders).where(eq(reminders.registration, 'KN14LUO')).orderBy(desc(reminders.dueDate));
        console.log(`\nReminders (${rems.length}):`);
        for (const r of rems) {
            console.log(` - ID: ${r.id}, Type: ${r.type}, Due: ${r.dueDate}, Status: ${r.status}, SentDate: ${r.sentDate}, CreatedAt: ${r.createdAt}`);
        }

        const logs = await db.select().from(reminderLogs).where(eq(reminderLogs.vehicleId, v.id)).orderBy(desc(reminderLogs.sentAt));
        console.log(`\nLogs (${logs.length}):`);
        for (const l of logs) {
            console.log(` - ID: ${l.id}, Status: ${l.status}, Reason: ${l.failureReason}, SentAt: ${l.sentAt}`);
        }
    }
    
    process.exit(0);
}

investigate().catch(console.error);
