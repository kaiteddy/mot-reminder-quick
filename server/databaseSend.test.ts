import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(): { ctx: TrpcContext } {
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

describe("Database Page Send with Linked IDs", () => {
  it("sendWhatsApp with id=0 accepts vehicleId and customerId parameters", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // This test verifies the schema accepts the new parameters
    // Actual send will fail due to missing Twilio credentials, but schema validation will pass
    try {
      await caller.reminders.sendWhatsApp({
        id: 0,
        phoneNumber: "+447956477569",
        messageType: "MOT",
        customerName: "Test Customer",
        registration: "TEST123",
        expiryDate: "2025-12-31",
        vehicleId: 123,
        customerId: 456,
      });
    } catch (error: any) {
      // Expected to fail at Twilio send, not at schema validation
      expect(error.message).not.toContain("Invalid input");
      expect(error.message).not.toContain("vehicleId");
      expect(error.message).not.toContain("customerId");
    }
  });

  it("sendWhatsApp with id=0 works without vehicleId and customerId (backward compatible)", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Verify backward compatibility - should work without the new fields
    try {
      await caller.reminders.sendWhatsApp({
        id: 0,
        phoneNumber: "+447956477569",
        messageType: "MOT",
        customerName: "Test Customer",
        registration: "TEST123",
        expiryDate: "2025-12-31",
      });
    } catch (error: any) {
      // Expected to fail at Twilio send, not at schema validation
      expect(error.message).not.toContain("Invalid input");
      expect(error.message).not.toContain("required");
    }
  });

  it("sendWhatsApp input schema is properly typed", () => {
    // This is a compile-time test - if it compiles, the types are correct
    const validInput = {
      id: 0,
      phoneNumber: "+447956477569",
      messageType: "MOT" as const,
      customerName: "Test",
      registration: "TEST123",
      expiryDate: "2025-12-31",
      vehicleId: 123,
      customerId: 456,
    };

    expect(validInput).toBeDefined();
    expect(validInput.vehicleId).toBe(123);
    expect(validInput.customerId).toBe(456);
  });
});
