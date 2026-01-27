import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, reminderLogs } from "../drizzle/schema";
import { like, desc, eq } from "drizzle-orm";

async function checkAllMW18() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select().from(vehicles).where(like(vehicles.registration, "%MW18%"));
    console.log(`Found ${results.length} MW18 vehicles:`);

    for (const v of results) {
        const [log] = await db.select().from(reminderLogs).where(eq(reminderLogs.vehicleId, v.id)).orderBy(desc(reminderLogs.sentAt)).limit(1);
        console.log(`ID: ${v.id}, Reg: [${v.registration}], MOT: ${v.motExpiryDate}, Last Sent: ${log?.sentAt}`);
    }
}

checkAllMW18().catch(console.error);
