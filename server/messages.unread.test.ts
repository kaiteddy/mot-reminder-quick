import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { customerMessages } from "../drizzle/schema";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("messages.getUnreadCount", () => {
  beforeEach(async () => {
    // Clean up test data
    const db = await getDb();
    if (db) {
      await db.delete(customerMessages);
    }
  });

  it("returns 0 when there are no messages", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const count = await caller.messages.getUnreadCount();

    expect(count).toBe(0);
  });

  it("returns correct count of unread messages", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    // Insert test messages
    await db.insert(customerMessages).values([
      {
        messageSid: "test-sid-1",
        fromNumber: "+447843275372",
        toNumber: "+441234567890",
        messageBody: "Test message 1",
        read: 0,
      },
      {
        messageSid: "test-sid-2",
        fromNumber: "+447843275372",
        toNumber: "+441234567890",
        messageBody: "Test message 2",
        read: 0,
      },
      {
        messageSid: "test-sid-3",
        fromNumber: "+447843275372",
        toNumber: "+441234567890",
        messageBody: "Test message 3",
        read: 1,
      },
    ]);

    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const count = await caller.messages.getUnreadCount();

    expect(count).toBe(2);
  });
});

describe("messages.markAsRead", () => {
  beforeEach(async () => {
    // Clean up test data
    const db = await getDb();
    if (db) {
      await db.delete(customerMessages);
    }
  });

  it("marks a message as read", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    // Insert test message
    const [inserted] = await db.insert(customerMessages).values({
      messageSid: "test-sid-mark-read",
      fromNumber: "+447843275372",
      toNumber: "+441234567890",
      messageBody: "Test message to mark as read",
      read: 0,
    });

    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Mark as read
    const result = await caller.messages.markAsRead({ id: inserted.insertId });

    expect(result.success).toBe(true);

    // Verify it was marked as read
    const count = await caller.messages.getUnreadCount();
    expect(count).toBe(0);
  });
});

describe("messages.markAllAsRead", () => {
  beforeEach(async () => {
    // Clean up test data
    const db = await getDb();
    if (db) {
      await db.delete(customerMessages);
    }
  });

  it("marks all unread messages as read", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    // Insert multiple unread messages
    await db.insert(customerMessages).values([
      {
        messageSid: "test-sid-bulk-1",
        fromNumber: "+447843275372",
        toNumber: "+441234567890",
        messageBody: "Test message 1",
        read: 0,
      },
      {
        messageSid: "test-sid-bulk-2",
        fromNumber: "+447843275372",
        toNumber: "+441234567890",
        messageBody: "Test message 2",
        read: 0,
      },
      {
        messageSid: "test-sid-bulk-3",
        fromNumber: "+447843275372",
        toNumber: "+441234567890",
        messageBody: "Test message 3",
        read: 0,
      },
    ]);

    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Verify initial count
    const initialCount = await caller.messages.getUnreadCount();
    expect(initialCount).toBe(3);

    // Mark all as read
    const result = await caller.messages.markAllAsRead();
    expect(result.success).toBe(true);

    // Verify all are marked as read
    const finalCount = await caller.messages.getUnreadCount();
    expect(finalCount).toBe(0);
  });
});
