import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function findBZR() {
    const db = await getDb();
    if (!db) return;

    const query = sql`SELECT id, registration, motExpiryDate FROM vehicles WHERE registration LIKE '%BZR%'`;
    const [rows] = await db.execute(query) as any;

    console.log("Vehicles with BZR:");
    rows.forEach((r: any) => {
        console.log(`ID: ${r.id}, Reg: [${r.registration}], MOT: ${r.motExpiryDate}`);
    });
}

findBZR().catch(console.error);
