import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
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
    res: {} as TrpcContext["res"],
  };
}

describe("conversations", () => {
  it("should get conversation threads", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const threads = await caller.conversations.getThreads();

    expect(Array.isArray(threads)).toBe(true);
    // Threads may be empty if no messages have been sent
    threads.forEach(thread => {
      expect(thread).toHaveProperty("customerId");
      expect(thread).toHaveProperty("customerName");
      expect(thread).toHaveProperty("customerPhone");
      expect(thread).toHaveProperty("lastMessageAt");
      expect(thread).toHaveProperty("lastMessagePreview");
      expect(thread).toHaveProperty("unreadCount");
      expect(typeof thread.unreadCount).toBe("number");
    });
  });

  it("should get messages for a conversation", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // First get threads to find a valid customerId
    const threads = await caller.conversations.getThreads();
    
    if (threads.length > 0) {
      const customerId = threads[0].customerId;
      const messages = await caller.conversations.getMessages({ customerId });

      expect(Array.isArray(messages)).toBe(true);
      messages.forEach(message => {
        expect(message).toHaveProperty("id");
        expect(message).toHaveProperty("type");
        expect(["sent", "received"]).toContain(message.type);
        expect(message).toHaveProperty("content");
        expect(message).toHaveProperty("timestamp");
        expect(message.timestamp).toBeInstanceOf(Date);
      });
    }
  });

  it("should mark conversation as read", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Get threads to find a valid customerId
    const threads = await caller.conversations.getThreads();
    
    if (threads.length > 0) {
      const customerId = threads[0].customerId;
      const result = await caller.conversations.markAsRead({ customerId });

      expect(result).toEqual({ success: true });
    } else {
      // If no threads, just test that the endpoint doesn't error
      const result = await caller.conversations.markAsRead({ customerId: 999999 });
      expect(result).toEqual({ success: true });
    }
  });
});
