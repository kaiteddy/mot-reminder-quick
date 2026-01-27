import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { like } from "drizzle-orm";

async function findStars() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select().from(vehicles).where(like(vehicles.registration, "%*%"));
    console.log(`Found ${results.length} vehicles with '*' in registration.`);
    results.slice(0, 10).forEach(v => console.log(`ID: ${v.id}, Reg: ${v.registration}`));
}

findStars().catch(console.error);
