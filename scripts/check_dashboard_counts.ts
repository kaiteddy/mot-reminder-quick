import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { sql, isNull, isNotNull } from "drizzle-orm";

async function checkCounts() {
    const db = await getDb();
    if (!db) return;

    const [total] = await db.select({ count: sql<number>`count(*)` }).from(vehicles);
    const [withMot] = await db.select({ count: sql<number>`count(*)` }).from(vehicles).where(isNotNull(vehicles.motExpiryDate));
    const [noMot] = await db.select({ count: sql<number>`count(*)` }).from(vehicles).where(isNull(vehicles.motExpiryDate));

    console.log(`Total Vehicles: ${total.count}`);
    console.log(`With MOT Data: ${withMot.count}`);
    console.log(`No MOT Data: ${noMot.count}`);
}

checkCounts().catch(console.error);
