import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { eq, like, or } from "drizzle-orm";

async function run() {
    const db = await getDb();
    if (!db) process.exit(1);

    const vData = await db.select({
        id: vehicles.id,
        reg: vehicles.registration,
        customerId: vehicles.customerId,
        cName: customers.name
    })
    .from(vehicles)
    .leftJoin(customers, eq(vehicles.customerId, customers.id))
    .where(eq(vehicles.registration, "LD57PYG"));

    console.log(vData);

    const cData = await db.select()
    .from(customers)
    .where(like(customers.name, '%Lynn%'))

    process.exit(0);
}
run().catch(console.error);
