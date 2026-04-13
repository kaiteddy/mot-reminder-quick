import "dotenv/config";

import { getDb } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Connecting to DB and altering vehicles table...");
    try {
        const db = await getDb();
        if (db) {
            await db.execute(sql`ALTER TABLE vehicles ADD COLUMN bookingRequested INT DEFAULT 0`);
            console.log("Success!");
        } else {
            console.log("DB connection failed.");
        }
    } catch(e) {
        console.log("Error or already exists:", e);
    }
    process.exit(0);
}
main();
