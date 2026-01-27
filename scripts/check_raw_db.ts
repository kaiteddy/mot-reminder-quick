import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function checkRaw() {
    const db = await getDb();
    if (!db) return;

    const query = sql`SELECT id, registration, motExpiryDate FROM vehicles WHERE registration LIKE '%MW18%' OR registration LIKE '%LK04%'`;
    const [rows] = await db.execute(query) as any;

    console.log("Raw rows from DB:");
    rows.forEach((r: any) => {
        console.log(`ID: ${r.id}, Reg: [${r.registration}], MOT: ${r.motExpiryDate} (Type: ${typeof r.motExpiryDate})`);
    });
}

checkRaw().catch(console.error);
