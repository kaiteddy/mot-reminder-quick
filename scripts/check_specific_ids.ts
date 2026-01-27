import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, reminderLogs } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

async function checkSpecificVehicles() {
    const db = await getDb();
    if (!db) return;

    const ids = [9371, 90001];
    console.log("Checking vehicles IDs:", ids);

    for (const id of ids) {
        const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
        if (v) {
            // Get latest log
            const [log] = await db.select().from(reminderLogs).where(eq(reminderLogs.vehicleId, id)).orderBy(desc(reminderLogs.sentAt)).limit(1);
            console.log(`ID: ${v.id}, Reg: [${v.registration}], MOT: ${v.motExpiryDate}, Last Sent: ${log?.sentAt}`);
        } else {
            console.log(`ID: ${id} NOT FOUND`);
        }
    }
}

checkSpecificVehicles().catch(console.error);
