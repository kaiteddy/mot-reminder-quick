import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

async function checkDuplicates() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    const results = await db.select({
        registration: vehicles.registration,
        count: sql<number>`count(*)`,
        ids: sql<string>`group_concat(${vehicles.id})`,
        motDates: sql<string>`group_concat(coalesce(${vehicles.motExpiryDate}, 'null'))`
    })
        .from(vehicles)
        .groupBy(vehicles.registration)
        .having(sql`count(*) > 1`);

    console.log(`Found ${results.length} duplicate registrations:`);
    results.forEach(r => {
        console.log(`- Reg: ${r.registration}, Count: ${r.count}, IDs: ${r.ids}, MOTs: ${r.motDates}`);
    });
}

checkDuplicates().catch(console.error);
