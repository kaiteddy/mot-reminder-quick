import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function checkLengths() {
    const db = await getDb();
    if (!db) return;

    const query = sql`SELECT id, registration, length(registration) as len, motExpiryDate FROM vehicles WHERE registration LIKE '%MW18%'`;
    const [rows] = await db.execute(query) as any;

    console.log("Vehicle Registration Lengths:");
    rows.forEach((r: any) => {
        console.log(`ID: ${r.id}, Reg: [${r.registration}], Len: ${r.len}, MOT: ${r.motExpiryDate}`);
    });
}

checkLengths().catch(console.error);
