import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { isNull, and, or, sql, eq } from "drizzle-orm";

async function checkMissingPhones() {
    const db = await getDb();
    if (!db) return;

    const allVehiclesWithCustomers = await db
        .select({
            id: vehicles.id,
            registration: vehicles.registration,
            customerName: customers.name,
            customerPhone: customers.phone,
        })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id));

    const total = allVehiclesWithCustomers.length;
    const missingPhone = allVehiclesWithCustomers.filter(v => !v.customerPhone || v.customerPhone === '-').length;
    const hasPhone = total - missingPhone;

    console.log(`Total vehicles: ${total}`);
    console.log(`Vehicles with phone numbers: ${hasPhone}`);
    console.log(`Vehicles missing phone numbers: ${missingPhone} (${((missingPhone / total) * 100).toFixed(1)}%)`);

    console.log("\nSample of missing phones (first 10):");
    allVehiclesWithCustomers.filter(v => !v.customerPhone || v.customerPhone === '-').slice(0, 10).forEach(v => {
        console.log(`Reg: ${v.registration}, Owner: ${v.customerName}, Phone: ${v.customerPhone}`);
    });
}

checkMissingPhones().catch(console.error);
