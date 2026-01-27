import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, reminders, reminderLogs, customerMessages } from "../drizzle/schema";
import { eq, like, sql } from "drizzle-orm";

async function cleanupData() {
    const db = await getDb();
    if (!db) return;

    console.log("Starting Data Cleanup...");

    const allVehicles = await db.select().from(vehicles);
    console.log(`Found ${allVehicles.length} vehicles total.`);

    for (const vehicle of allVehicles) {
        let cleanReg = vehicle.registration.split('*')[0].split('(')[0].trim().toUpperCase();

        // Normalize 0 vs O? No, that's risky. But let's at least fix the asterisks.
        if (cleanReg !== vehicle.registration) {
            console.log(`Cleaning: [${vehicle.registration}] -> [${cleanReg}]`);

            try {
                // Check if the clean reg already exists
                const [existing] = await db.select().from(vehicles).where(eq(vehicles.registration, cleanReg)).limit(1);

                if (existing) {
                    console.log(`  Clean reg exists (ID: ${existing.id}). Merging...`);

                    // Move reminders
                    await db.update(reminders).set({ vehicleId: existing.id, registration: cleanReg }).where(eq(reminders.vehicleId, vehicle.id));
                    // Move logs
                    await db.update(reminderLogs).set({ vehicleId: existing.id, registration: cleanReg }).where(eq(reminderLogs.vehicleId, vehicle.id));

                    // Delete duplicate
                    await db.delete(vehicles).where(eq(vehicles.id, vehicle.id));
                    console.log(`  Merged and deleted ID: ${vehicle.id}`);
                } else {
                    // Just update it
                    await db.update(vehicles).set({ registration: cleanReg }).where(eq(vehicles.id, vehicle.id));
                    console.log(`  Updated ID: ${vehicle.id}`);
                }
            } catch (err: any) {
                console.error(`  Error processing [${vehicle.registration}]: ${err.message}`);
            }
        }
    }

    // Handle exact duplicates differing only by spaces
    console.log("\nHandling space-differing duplicates...");
    const allVehiclesNew = await db.select().from(vehicles);
    const regMap = new Map<string, typeof allVehiclesNew[0]>();

    for (const v of allVehiclesNew) {
        const spaceFree = v.registration.replace(/\s+/g, "").toUpperCase();
        if (regMap.has(spaceFree)) {
            const existing = regMap.get(spaceFree)!;
            console.log(`Duplicate found: [${v.registration}] (ID: ${v.id}) vs [${existing.registration}] (ID: ${existing.id})`);

            // Keep the one with MOT if possible
            const keep = existing.motExpiryDate ? existing : v;
            const remove = keep === existing ? v : existing;

            console.log(`  Keeping ID: ${keep.id}, Removing ID: ${remove.id}`);

            // Update references
            await db.update(reminders).set({ vehicleId: keep.id, registration: keep.registration }).where(eq(reminders.vehicleId, remove.id));
            await db.update(reminderLogs).set({ vehicleId: keep.id, registration: keep.registration }).where(eq(reminderLogs.vehicleId, remove.id));

            // Delete
            await db.delete(vehicles).where(eq(vehicles.id, remove.id));

            // Update map to keep the one we kept
            regMap.set(spaceFree, keep);
        } else {
            regMap.set(spaceFree, v);
        }
    }

    console.log("Cleanup complete.");
}

cleanupData().catch(console.error);
