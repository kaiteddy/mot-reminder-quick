import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getDb, updateReminderLogStatus } from "./db";
import { reminderLogs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Message Status Tracking", () => {
  let testMessageSid: string;
  let testLogId: number;

  beforeEach(async () => {
    // Create a unique message SID for each test
    testMessageSid = `TEST_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Create a test reminder log
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const result = await db.insert(reminderLogs).values({
      messageType: "MOT",
      recipient: "+447843275372",
      messageSid: testMessageSid,
      status: "queued",
      customerName: "Test Customer",
      registration: "TEST123",
      messageContent: "Test message content",
    });

    testLogId = Number(result.insertId);
  });

  afterEach(async () => {
    // Clean up test data
    const db = await getDb();
    if (!db) return;
    
    await db.delete(reminderLogs).where(eq(reminderLogs.messageSid, testMessageSid));
  });

  it("should update status to 'sent' without timestamp fields", async () => {
    await updateReminderLogStatus(testMessageSid, "sent");

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);

    expect(log?.status).toBe("sent");
    expect(log?.deliveredAt).toBeNull();
    expect(log?.readAt).toBeNull();
    expect(log?.failedAt).toBeNull();
  });

  it("should update status to 'delivered' and set deliveredAt timestamp", async () => {
    const deliveryTime = new Date();
    await updateReminderLogStatus(testMessageSid, "delivered", deliveryTime);

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);

    expect(log?.status).toBe("delivered");
    expect(log?.deliveredAt).toBeTruthy();
    expect(log?.readAt).toBeNull();
    expect(log?.failedAt).toBeNull();
  });

  it("should update status to 'read' and set readAt timestamp", async () => {
    const readTime = new Date();
    await updateReminderLogStatus(testMessageSid, "read", readTime);

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);

    expect(log?.status).toBe("read");
    expect(log?.readAt).toBeTruthy();
    expect(log?.deliveredAt).toBeNull();
    expect(log?.failedAt).toBeNull();
  });

  it("should update status to 'failed' and set failedAt timestamp with error message", async () => {
    const failTime = new Date();
    const errorMsg = "Message delivery failed";
    await updateReminderLogStatus(testMessageSid, "failed", failTime, errorMsg);

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);

    expect(log?.status).toBe("failed");
    expect(log?.failedAt).toBeTruthy();
    expect(log?.errorMessage).toBe(errorMsg);
    expect(log?.deliveredAt).toBeNull();
    expect(log?.readAt).toBeNull();
  });

  it("should handle status progression: queued → sent → delivered → read", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Initial status is queued (set in beforeEach)
    let [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);
    expect(log?.status).toBe("queued");

    // Update to sent
    await updateReminderLogStatus(testMessageSid, "sent");
    [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);
    expect(log?.status).toBe("sent");

    // Update to delivered
    await updateReminderLogStatus(testMessageSid, "delivered", new Date());
    [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);
    expect(log?.status).toBe("delivered");
    expect(log?.deliveredAt).toBeTruthy();

    // Update to read
    await updateReminderLogStatus(testMessageSid, "read", new Date());
    [log] = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);
    expect(log?.status).toBe("read");
    expect(log?.readAt).toBeTruthy();
    expect(log?.deliveredAt).toBeTruthy(); // deliveredAt should still be set
  });
});
