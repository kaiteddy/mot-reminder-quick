import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { isNull, sql } from "drizzle-orm";

async function checkMotProgress() {
    const db = await getDb();
    if (!db) return;

    const [neverChecked] = await db.select({ count: sql<number>`count(*)` }).from(vehicles).where(isNull(vehicles.lastChecked));
    const [checkedToday] = await db.select({ count: sql<number>`count(*)` }).from(vehicles).where(sql`DATE(${vehicles.lastChecked}) = CURDATE()`);

    console.log(`Never Checked: ${neverChecked.count}`);
    console.log(`Checked Today: ${checkedToday.count}`);
}

checkMotProgress().catch(console.error);
