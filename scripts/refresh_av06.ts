import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getVehicleDetails } from "../server/dvlaApi";

async function refreshAV06() {
    const db = await getDb();
    if (!db) return;

    const reg = "AV06 BPE";
    console.log(`Refreshing MOT for ${reg}...`);

    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.registration, reg)).limit(1);
    if (!vehicle) {
        console.error("Vehicle not found");
        return;
    }

    const dvlaData = await getVehicleDetails(vehicle.registration);
    console.log("DVLA Result:", JSON.stringify(dvlaData, null, 2));

    if (dvlaData && dvlaData.motExpiryDate) {
        console.log("Updating database...");
        await db.update(vehicles).set({
            motExpiryDate: new Date(dvlaData.motExpiryDate),
            make: dvlaData.make || vehicle.make,
            model: dvlaData.model || vehicle.model
        }).where(eq(vehicles.id, vehicle.id));
        console.log("Update successful");
    } else {
        console.log("No MOT info found in DVLA result");
    }
}

refreshAV06().catch(console.error);
