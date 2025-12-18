import { drizzle } from "drizzle-orm/mysql2";
import { reminderLogs } from "./drizzle/schema.ts";
import { eq } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

// Get the latest message (17:49)
const result = await db.select({
  messageSid: reminderLogs.messageSid,
  status: reminderLogs.status,
  sentAt: reminderLogs.sentAt,
  deliveredAt: reminderLogs.deliveredAt,
  readAt: reminderLogs.readAt
}).from(reminderLogs)
  .orderBy(reminderLogs.sentAt)
  .limit(5);

console.log("Latest 5 messages:");
result.reverse().forEach(r => {
  console.log(`\nMessageSid: ${r.messageSid}`);
  console.log(`Status: ${r.status}`);
  console.log(`SentAt: ${r.sentAt}`);
  console.log(`DeliveredAt: ${r.deliveredAt}`);
  console.log(`ReadAt: ${r.readAt}`);
});

process.exit(0);
