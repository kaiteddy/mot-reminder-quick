import "dotenv/config";
import { getDb } from "./server/db";
import { sql } from "drizzle-orm";
import { serviceLineItems } from "./drizzle/schema";

async function main() {
    const db = await getDb();
    if (!db) return;
    
    const metrics = await db.select({
    partName: serviceLineItems.description,
    frequency: sql<number>`COUNT(*)`,
    avgPrice: sql<number>`AVG(${serviceLineItems.unitPrice})`,
    minPrice: sql<number>`MIN(${serviceLineItems.unitPrice})`,
    maxPrice: sql<number>`MAX(${serviceLineItems.unitPrice})`,
    })
    .from(serviceLineItems)
    .where(sql`${serviceLineItems.unitPrice} > 0`)
    .groupBy(serviceLineItems.description)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(10);

    console.log(metrics);
    process.exit(0);
}
main();
