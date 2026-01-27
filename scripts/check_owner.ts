import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function checkOwner() {
    const db = await getDb();
    if (!db) return;

    const ids = [9371, 90001];
    for (const id of ids) {
        const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
        if (v && v.customerId) {
            const [c] = await db.select().from(customers).where(eq(customers.id, v.customerId));
            console.log(`Vehicle ID: ${v.id}, Reg: [${v.registration}], Customer: ${c?.name}, Phone: ${c?.phone}`);
        } else {
            console.log(`Vehicle ID: ${v?.id || id}, Reg: [${v?.registration}], Customer: NONE`);
        }
    }
}

checkOwner().catch(console.error);
