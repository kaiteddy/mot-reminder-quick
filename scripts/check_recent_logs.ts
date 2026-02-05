import "dotenv/config";
import { getDb } from "../server/db";
import { reminderLogs } from "../drizzle/schema";
import { desc } from "drizzle-orm";

async function checkRecentLogs() {
    const db = await getDb();
    if (!db) return;

    const logs = await db.select().from(reminderLogs).orderBy(desc(reminderLogs.sentAt)).limit(5);
    console.log(logs.map(l => ({ id: l.id, sentAt: l.sentAt, type: l.messageType, recipient: l.recipient })));
}

checkRecentLogs().catch(console.error);
