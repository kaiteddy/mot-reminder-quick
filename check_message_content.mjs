import { drizzle } from "drizzle-orm/mysql2";
import { reminderLogs } from "./drizzle/schema.ts";
import { desc } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

const logs = await db
  .select({
    id: reminderLogs.id,
    messageType: reminderLogs.messageType,
    messageContent: reminderLogs.messageContent,
    templateUsed: reminderLogs.templateUsed,
    sentAt: reminderLogs.sentAt,
  })
  .from(reminderLogs)
  .orderBy(desc(reminderLogs.sentAt))
  .limit(5);

console.log("Recent reminder logs:");
logs.forEach(log => {
  console.log("\n---");
  console.log(`ID: ${log.id}`);
  console.log(`Type: ${log.messageType}`);
  console.log(`Template: ${log.templateUsed}`);
  console.log(`Content: ${log.messageContent}`);
  console.log(`Sent: ${log.sentAt}`);
});

process.exit(0);
