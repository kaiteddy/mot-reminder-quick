import "dotenv/config";
import { vehicles } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";

async function fix() {
    const db = await getDb();
    if (!db) {
        console.log("No DB");
        process.exit(1);
    }
    await db.delete(vehicles).where(eq(vehicles.registration, "RE71VOD"));
    console.log("Deleted RE71VOD");
    process.exit(0);
}
fix();
