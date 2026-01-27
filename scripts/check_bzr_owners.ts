import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { eq, like, or } from "drizzle-orm";

async function checkBZR() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select({
        id: vehicles.id,
        reg: vehicles.registration,
        customer: customers.name
    })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(like(vehicles.registration, "%BZR%"));

    console.log("BZR Vehicles and Owners:");
    results.forEach(r => console.log(`- Reg: [${r.reg}], ID: ${r.id}, Owner: ${r.customer}`));
}

checkBZR().catch(console.error);
