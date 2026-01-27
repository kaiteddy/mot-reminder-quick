import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function compareVehicles() {
    const db = await getDb();
    if (!db) return;

    const query = sql`SELECT id, registration, motExpiryDate FROM vehicles WHERE registration IN ('KE68 GVN', 'KE68GVN', 'ET07XZW', 'ET07 XZW')`;
    const [rows] = await db.execute(query) as any;

    console.log("Comparing Working vs Non-Working:");
    rows.forEach((r: any) => {
        console.log(`ID: ${r.id}, Reg: [${r.registration}], MOT: [${r.motExpiryDate}] (Type: ${typeof r.motExpiryDate})`);
    });
}

compareVehicles().catch(console.error);
