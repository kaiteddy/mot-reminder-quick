import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getVehicleDetails } from "../server/dvlaApi";

async function forceRefresh() {
    const db = await getDb();
    if (!db) return;

    const regs = ["MV63ANX", "LK04JKZ", "MW18 AFX"];

    for (const reg of regs) {
        console.log(`\n--- Refreshing ${reg} ---`);
        const details = await getVehicleDetails(reg);
        if (details && details.motExpiryDate) {
            console.log(`Found MOT: ${details.motExpiryDate}`);
            const updateResult = await db.update(vehicles)
                .set({
                    motExpiryDate: new Date(details.motExpiryDate),
                    lastChecked: new Date(),
                    taxStatus: details.taxStatus,
                    make: details.make || undefined,
                    model: details.model || undefined
                })
                .where(eq(vehicles.registration, reg));
            console.log(`Update completed.`);

            const [v] = await db.select().from(vehicles).where(eq(vehicles.registration, reg));
            console.log(`Verified in DB: MOT is ${v.motExpiryDate} (Type: ${typeof v.motExpiryDate})`);
        } else {
            console.log(`DVLA API failed to find MOT for ${reg}`);
        }
    }
}

forceRefresh().catch(console.error);
