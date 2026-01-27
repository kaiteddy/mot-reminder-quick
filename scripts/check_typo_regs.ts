import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq, or, inArray, sql, like } from "drizzle-orm";

async function checkVehicles() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    console.log("Searching for E066 or EO66...");

    const results = await db.select().from(vehicles).where(
        or(
            like(vehicles.registration, "%E066%"),
            like(vehicles.registration, "%EO66%")
        )
    );

    console.log(`Found ${results.length} vehicles:`);
    results.forEach(v => {
        console.log(`- Reg: [${v.registration}], Make: ${v.make}, MOT Expiry: ${v.motExpiryDate}`);
    });
}

checkVehicles().catch(console.error);
