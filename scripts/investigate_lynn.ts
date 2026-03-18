import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { eq, like, or } from "drizzle-orm";

async function run() {
    const db = await getDb();
    if (!db) process.exit(1);

    const reg = "LD57PYG";
    const foundVehicles = await db.select().from(vehicles).where(like(vehicles.registration, `%LD57%`));
    console.log(`Vehicles with LD57: ${foundVehicles.length}`);
    for (const v of foundVehicles) {
        console.log(`- ID: ${v.id}, Reg: ${v.registration}, Make: ${v.make}, CustomerID: ${v.customerId}`);
    }

    const foundCustomers = await db.select().from(customers).where(or(
        like(customers.name, `%Stringer%`),
        like(customers.phone, `%07507997002%`),
        like(customers.email, `%lucyloo%`)
    ));
    console.log(`\nCustomers matching details: ${foundCustomers.length}`);
    for (const c of foundCustomers) {
        console.log(`- ID: ${c.id}, Name: ${c.name}, Phone: ${c.phone}, Email: ${c.email}`);
    }

    process.exit(0);
}
run().catch(console.error);
