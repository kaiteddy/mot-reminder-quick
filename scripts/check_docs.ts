import "dotenv/config";
import { getDb } from "../server/db";
import { serviceHistory } from "../drizzle/schema";

async function run() {
    const db = await getDb();
    if (!db) process.exit(1);

    const docs = await db.select().from(serviceHistory);
    console.log(`Documents in DB: ${docs.length}`);
    process.exit(0);
}
run().catch(console.error);
