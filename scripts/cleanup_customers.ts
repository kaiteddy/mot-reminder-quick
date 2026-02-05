import { getDb } from '../server/db';
import { customers } from '../drizzle/schema';
import { sql, isNotNull } from 'drizzle-orm';
import "dotenv/config";

async function cleanup() {
    const db = await getDb();
    if (!db) return;

    console.log("Deduplicating customers by externalId...");

    // Find all external IDs that have more than one record
    const duplicates = await db.execute(sql`
        SELECT externalId 
        FROM customers 
        WHERE externalId IS NOT NULL 
        GROUP BY externalId 
        HAVING COUNT(*) > 1
    `);

    // @ts-ignore
    const ids = duplicates[0] as { externalId: string }[];
    console.log(`Found ${ids.length} duplicated externalId groups.`);

    let totalDeleted = 0;
    for (const group of ids) {
        // Find all IDs for this externalId
        const records = await db.select({ id: customers.id })
            .from(customers)
            .where(sql`${customers.externalId} = ${group.externalId}`)
            .orderBy(customers.id);

        if (records.length > 1) {
            // Keep the first one, delete the rest
            const keepId = records[0].id;
            const deleteIds = records.slice(1).map(r => r.id);

            await db.execute(sql`
                DELETE FROM customers 
                WHERE id IN (${sql.join(deleteIds, sql`, `)})
            `);
            totalDeleted += deleteIds.length;
        }
    }

    console.log(`Deleted ${totalDeleted} duplicate customer rows.`);
    process.exit(0);
}

cleanup();
