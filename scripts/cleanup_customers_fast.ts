import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';
import "dotenv/config";

async function cleanup() {
    const db = await getDb();
    if (!db) return;

    console.log("Deduplicating customers by externalId (fast modo)...");

    // Fast delete using a join
    await db.execute(sql`
        DELETE c1 FROM customers c1
        INNER JOIN customers c2 
        WHERE 
            c1.id > c2.id AND 
            c1.externalId = c2.externalId AND
            c1.externalId IS NOT NULL
    `);

    console.log("Fast cleanup complete.");
    process.exit(0);
}

cleanup();
