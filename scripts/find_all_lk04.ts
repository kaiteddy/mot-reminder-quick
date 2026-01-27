import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function findAllLK04() {
    const db = await getDb();
    if (!db) return;

    const query = sql`SELECT id, registration, motExpiryDate, customerId FROM vehicles WHERE registration LIKE '%LK04JKZ%'`;
    const [rows] = await db.execute(query) as any;

    console.log("All LK04JKZ entries:");
    rows.forEach((r: any) => {
        console.log(`ID: ${r.id}, Reg: [${r.registration}], MOT: ${r.motExpiryDate}, CustomerID: ${r.customerId}`);
    });
}

findAllLK04().catch(console.error);
