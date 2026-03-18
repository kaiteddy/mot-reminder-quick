import "dotenv/config";
import { getDb } from "../server/db";
import { serviceHistory } from "../drizzle/schema";
import { desc, isNotNull } from "drizzle-orm";

async function run() {
    const db = await getDb();
    if (!db) process.exit(1);

    const docs = await db.select({
        id: serviceHistory.id,
        dateIssued: serviceHistory.dateIssued,
        dateCreated: serviceHistory.dateCreated,
        totalGross: serviceHistory.totalGross
    })
    .from(serviceHistory)
    .where(isNotNull(serviceHistory.dateIssued))
    .orderBy(desc(serviceHistory.dateIssued))
    .limit(10);
    
    console.log("Most recent invoices:");
    docs.forEach(d => console.log(d.dateIssued, d.dateCreated, d.totalGross));
    process.exit(0);
}
run().catch(console.error);
