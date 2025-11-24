import { describe, expect, it, beforeEach } from "vitest";
import { getDb } from "./db";
import { reminderLogs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Message Content Logging", () => {
  it("should store custom message content in reminderLogs", async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    // Insert a test reminder log with custom message content
    const testMessageContent = "This is a custom test message for the customer";
    const testRecipient = "+447843275372";
    const testMessageSid = "TEST_SID_" + Date.now() + "_" + Math.random();

    await db.insert(reminderLogs).values({
      reminderId: null,
      customerId: null,
      vehicleId: null,
      messageType: "MOT",
      recipient: testRecipient,
      messageSid: testMessageSid,
      status: "sent",
      templateUsed: null,
      customerName: "Test Customer",
      registration: "TEST123",
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      messageContent: testMessageContent,
      sentAt: new Date(),
    });

    // Retrieve the log and verify messageContent is stored correctly
    const logs = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.messageSid, testMessageSid))
      .limit(1);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.messageContent).toBe(testMessageContent);
    expect(logs[0]?.recipient).toBe(testRecipient);
    expect(logs[0]?.customerName).toBe("Test Customer");

    // Cleanup: delete the test log
    await db.delete(reminderLogs).where(eq(reminderLogs.messageSid, testMessageSid));
  });

  it("should handle null messageContent gracefully", async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const testRecipient = "+447843275373";

    // Insert a log without messageContent
    await db.insert(reminderLogs).values({
      reminderId: null,
      customerId: null,
      vehicleId: null,
      messageType: "Service",
      recipient: testRecipient,
      messageSid: "TEST_SID_NULL_" + Date.now(),
      status: "sent",
      templateUsed: "servicereminder",
      customerName: "Test Customer 2",
      registration: "ABC123",
      dueDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      messageContent: null,
      sentAt: new Date(),
    });

    // Retrieve and verify null is handled correctly
    const logs = await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.recipient, testRecipient))
      .limit(1);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.messageContent).toBeNull();
    expect(logs[0]?.messageType).toBe("Service");

    // Cleanup
    await db.delete(reminderLogs).where(eq(reminderLogs.recipient, testRecipient));
  });

  it("should retrieve messageContent through getAllReminderLogs", async () => {
    const { getAllReminderLogs, createReminderLog } = await import("./db");

    const testMessageContent = "Another custom message for testing retrieval";
    const testRecipient = "+447843275374";

    // Create a log using the helper function
    await createReminderLog({
      reminderId: null,
      customerId: null,
      vehicleId: null,
      messageType: "MOT",
      recipient: testRecipient,
      messageSid: "TEST_RETRIEVAL_" + Date.now(),
      status: "sent",
      templateUsed: null,
      customerName: "Retrieval Test",
      registration: "RET123",
      dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      messageContent: testMessageContent,
    });

    // Retrieve all logs and find our test log
    const allLogs = await getAllReminderLogs();
    const testLog = allLogs.find((log) => log.recipient === testRecipient);

    expect(testLog).toBeDefined();
    expect(testLog?.messageContent).toBe(testMessageContent);
    expect(testLog?.customerName).toBe("Retrieval Test");

    // Cleanup
    const db = await getDb();
    if (db) {
      await db.delete(reminderLogs).where(eq(reminderLogs.recipient, testRecipient));
    }
  });
});
