import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function checkSchema() {
    const db = await getDb();
    if (!db) return;

    const [rows] = await db.execute(sql`SHOW CREATE TABLE vehicles`) as any;
    console.log("Vehicles Table Schema:");
    console.log(rows[0]['Create Table']);

    const [r2] = await db.execute(sql`SHOW CREATE TABLE reminderLogs`) as any;
    console.log("\nReminderLogs Table Schema:");
    console.log(r2[0]['Create Table']);
}

checkSchema().catch(console.error);
