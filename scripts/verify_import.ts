import { getDb } from '../server/db';
import { customers, vehicles, serviceHistory, serviceLineItems } from '../drizzle/schema';
import { sql } from 'drizzle-orm';
import "dotenv/config";

async function verify() {
    const db = await getDb();
    if (!db) return;

    const [custCount] = await db.select({ count: sql<number>`count(*)` }).from(customers);
    const [vehCount] = await db.select({ count: sql<number>`count(*)` }).from(vehicles);
    const [docCount] = await db.select({ count: sql<number>`count(*)` }).from(serviceHistory);
    const [itemCount] = await db.select({ count: sql<number>`count(*)` }).from(serviceLineItems);

    console.log(`Customers: ${custCount.count}`);
    console.log(`Vehicles: ${vehCount.count}`);
    console.log(`Documents: ${docCount.count}`);
    console.log(`Line Items: ${itemCount.count}`);
    process.exit(0);
}

verify();
