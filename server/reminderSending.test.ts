import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
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

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("Reminder Sending and Status Updates", () => {
  it("generateFromVehicles includes delivery status from logs", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const reminders = await caller.reminders.generateFromVehicles();

    expect(Array.isArray(reminders)).toBe(true);
    
    // Check that reminders have the new delivery status fields
    if (reminders.length > 0) {
      const reminder = reminders[0];
      expect(reminder).toHaveProperty("deliveryStatus");
      expect(reminder).toHaveProperty("sentAt");
      expect(reminder).toHaveProperty("deliveredAt");
      expect(reminder).toHaveProperty("readAt");
    }
  });

  it("reminders with recent logs show sent status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const reminders = await caller.reminders.generateFromVehicles();

    // Find reminders that have been sent (have logs within 60 days)
    const sentReminders = reminders.filter(r => r.status === "sent");
    
    // If there are sent reminders, verify they have delivery status
    sentReminders.forEach(reminder => {
      expect(reminder.sentAt).toBeTruthy();
      expect(reminder.deliveryStatus).toBeTruthy();
      expect(["queued", "sent", "delivered", "read", "failed"]).toContain(reminder.deliveryStatus);
    });
  });

  it("pending reminders do not have delivery status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const reminders = await caller.reminders.generateFromVehicles();

    // Find pending reminders
    const pendingReminders = reminders.filter(r => r.status === "pending");
    
    // Pending reminders should not have delivery status
    pendingReminders.forEach(reminder => {
      expect(reminder.deliveryStatus).toBeNull();
      expect(reminder.sentAt).toBeNull();
    });
  });
});
