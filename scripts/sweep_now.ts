import "dotenv/config";
import { getDb, bulkUpdateVehicleMOT } from "../server/db";
import { getVehicleDetails } from "../server/dvlaApi";
import { vehicles } from "../drizzle/schema";
import { sql, or, asc } from "drizzle-orm";

async function runSweep() {
  console.log("[MANUAL BATCH SWEEP] Starting bulk MOT verification sweep for ALL remaining vehicles...");
  const db = await getDb();
  if (!db) {
    console.error("Database not available.");
    return;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const vehiclesToUpdate = await db.select()
    .from(vehicles)
    .where(or(
      sql`${vehicles.lastChecked} < ${thirtyDaysAgo}`,
      sql`${vehicles.lastChecked} IS NULL`
    ))
    .orderBy(asc(sql`COALESCE(${vehicles.lastChecked}, '1970-01-01')`));

  if (vehiclesToUpdate.length === 0) {
    console.log("[MANUAL BATCH SWEEP] No missing or stale vehicles found!");
    return;
  }

  console.log(`[MANUAL BATCH SWEEP] Found ${vehiclesToUpdate.length} vehicles. Verifying and saving in batches...`);

  let updates: Array<{
    id: number;
    motExpiryDate?: Date | null;
    make?: string;
    model?: string;
    colour?: string;
    fuelType?: string;
    taxStatus?: string;
    taxDueDate?: Date | null;
    lastChecked?: Date | null;
  }> = [];

  let successCount = 0;
  let failCount = 0;
  let processedCount = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < vehiclesToUpdate.length; i++) {
    const v = vehiclesToUpdate[i];
    if (v.registration) {
      try {
        const dvlaData = await getVehicleDetails(v.registration);
        if (dvlaData && dvlaData.motExpiryDate) {
          updates.push({
            id: v.id,
            motExpiryDate: new Date(dvlaData.motExpiryDate),
            make: dvlaData.make,
            model: dvlaData.model,
            colour: dvlaData.colour,
            fuelType: dvlaData.fuelType,
            taxStatus: dvlaData.taxStatus,
            taxDueDate: dvlaData.taxDueDate ? new Date(dvlaData.taxDueDate) : null,
            lastChecked: new Date()
          });
          successCount++;
        } else {
          updates.push({ id: v.id, lastChecked: new Date() });
          failCount++;
        }
      } catch (e) {
        updates.push({ id: v.id, lastChecked: new Date() });
        failCount++;
      }
      
      // Delay to avoid hitting DVSA API rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    processedCount++;
    
    if (updates.length >= BATCH_SIZE || i === vehiclesToUpdate.length - 1) {
      try {
        await bulkUpdateVehicleMOT(updates);
        console.log(`[BATCH SAVED] Progress: ${processedCount}/${vehiclesToUpdate.length} | Success: ${successCount} | Failed/Exempt: ${failCount}`);
      } catch (e) {
        console.error(`Failed to save batch ending at index ${i}`, e);
      }
      // Reset updates array for next batch
      updates = [];
    }
  }

  console.log(`\n\n[MANUAL BATCH SWEEP] Fully Completed!`);
  console.log(`[MANUAL BATCH SWEEP] Processed ${processedCount} total.`);
  console.log(`[MANUAL BATCH SWEEP] ${successCount} MOT Dates Found | ${failCount} Missing/Exempt/Failed.`);
  
  process.exit(0);
}

runSweep().catch(e => {
  console.error("Error running sweep:", e);
  process.exit(1);
});
