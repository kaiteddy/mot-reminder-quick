import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { like } from "drizzle-orm";

async function findBZR() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select().from(vehicles).where(like(vehicles.registration, "%BZR%"));
    console.log(`Found ${results.length} BZR vehicles:`);
    results.forEach(v => {
        console.log(`ID: ${v.id}, Reg: [${v.registration}], MOT: ${v.motExpiryDate}`);
    });
}

findBZR().catch(console.error);
