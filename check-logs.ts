import { getDb } from "./server/db";
import { reminderLogs } from "./drizzle/schema";
import { eq, desc, inArray } from "drizzle-orm";

async function check() {
    const db = await getDb();
    if (!db) return;
    
    const regs = ['EY09WEX', 'KN14LUO', 'LN65COA', 'LN65C0A', 'VN12XLS'];
    
    for (const reg of regs) {
        console.log(`\nLogs for Registration: ${reg} (checking by text ONLY):`);
        const logs = await db
            .select()
            .from(reminderLogs)
            .where(eq(reminderLogs.registration, reg))
            .orderBy(desc(reminderLogs.sentAt));
        console.log(logs.map(l => ({ sentAt: l.sentAt, status: l.status, vehicleId: l.vehicleId })));
    }
}
check().catch(console.error).then(() => process.exit(0));
