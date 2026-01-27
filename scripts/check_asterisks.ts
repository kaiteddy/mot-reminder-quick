import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { like } from "drizzle-orm";

async function checkAsterisks() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select().from(vehicles).where(like(vehicles.registration, "%*%"));
    console.log(`Found ${results.length} registrations with asterisks.`);
    results.slice(0, 20).forEach(v => {
        console.log(`ID: ${v.id}, Reg: [${v.registration}], MOT: ${v.motExpiryDate}`);
    });
}

checkAsterisks().catch(console.error);
