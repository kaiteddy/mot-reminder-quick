import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq, or, inArray, sql } from "drizzle-orm";

async function checkUpdateTime() {
    const db = await getDb();
    if (!db) return;

    const regs = ["MW18 AFX", "MW18AFX", "LK04JKZ", "MV63ANX", "ET07XZW", "AV06 BPE"];
    const normalized = sql`UPPER(REPLACE(${vehicles.registration}, ' ', ''))`;

    const results = await db.select().from(vehicles).where(inArray(normalized, regs));

    console.log(`Found ${results.length} vehicles:`);
    results.forEach(v => {
        console.log(`- Reg: [${v.registration}], Last Checked: ${v.lastChecked}, Updated At: ${v.updatedAt}`);
    });
}

checkUpdateTime().catch(console.error);
