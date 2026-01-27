import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { isNull } from "drizzle-orm";

async function findNullMOT() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select().from(vehicles).where(isNull(vehicles.motExpiryDate));

    console.log(`Found ${results.length} vehicles with null MOT.`);
    results.slice(0, 20).forEach(v => {
        console.log(`ID: ${v.id}, Reg: [${v.registration}], Make: ${v.make}`);
    });
}

findNullMOT().catch(console.error);
