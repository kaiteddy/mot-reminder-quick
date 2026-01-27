import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { like, isNull, or, eq } from "drizzle-orm";

async function findFalsyMOT() {
    const db = await getDb();
    if (!db) return;

    const results = await db.select().from(vehicles).where(
        or(
            isNull(vehicles.motExpiryDate),
            eq(vehicles.motExpiryDate, "" as any)
        )
    );

    console.log(`Found ${results.length} vehicles with null/empty MOT.`);
    results.slice(0, 10).forEach(v => {
        console.log(`ID: ${v.id}, Reg: [${v.registration}], MOT: ${JSON.stringify(v.motExpiryDate)}`);
    });
}

findFalsyMOT().catch(console.error);
