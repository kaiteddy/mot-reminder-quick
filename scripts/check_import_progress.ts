import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers, reminders } from "../drizzle/schema";
import { sql } from "drizzle-orm";

async function checkAllCounts() {
    const db = await getDb();
    if (!db) return;

    const [vTotal] = await db.select({ count: sql<number>`count(*)` }).from(vehicles);
    const [cTotal] = await db.select({ count: sql<number>`count(*)` }).from(customers);
    const [rTotal] = await db.select({ count: sql<number>`count(*)` }).from(reminders);

    console.log(`${new Date().toISOString()} - Vehicles: ${vTotal.count}, Customers: ${cTotal.count}, Reminders: ${rTotal.count}`);
}

checkAllCounts().catch(console.error);
