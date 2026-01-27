import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { isNull, eq } from "drizzle-orm";

async function checkAllNulls() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select({
        id: vehicles.id,
        registration: vehicles.registration,
        customerName: customers.name,
        mot: vehicles.motExpiryDate
    })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(isNull(vehicles.motExpiryDate));

    console.log(`Summary of ${results.length} vehicles with NULL MOT:`);

    // Group by customer
    const customerMap: Record<string, number> = {};
    results.forEach(r => {
        const name = r.customerName || "Unknown";
        customerMap[name] = (customerMap[name] || 0) + 1;
    });

    // Show top customers with missing MOT data
    const sorted = Object.entries(customerMap).sort((a, b) => b[1] - a[1]);
    console.log("\nTop customers with missing MOT data:");
    sorted.slice(0, 10).forEach(([name, count]) => {
        console.log(`- ${name}: ${count} vehicles`);
    });

    // Check specifically for Shaista Khan
    const shaista = results.filter(r => r.customerName?.includes("Shaista"));
    if (shaista.length > 0) {
        console.log("\nShaista Khan vehicles with NULL MOT:");
        shaista.forEach(v => console.log(`  ID: ${v.id}, Reg: [${v.registration}]`));
    } else {
        console.log("\nShaista Khan has NO vehicles with NULL MOT data in the DB.");
    }
}

checkAllNulls().catch(console.error);
