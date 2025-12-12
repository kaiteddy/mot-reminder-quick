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

describe("Delivery Status Display in Database", () => {
  it("getAllVehiclesWithCustomers includes delivery status fields", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const vehicles = await caller.database.getAllVehiclesWithCustomers();

    expect(Array.isArray(vehicles)).toBe(true);
    
    // Check that vehicles have the new delivery status fields
    if (vehicles.length > 0) {
      const vehicle = vehicles[0];
      expect(vehicle).toHaveProperty("lastReminderSent");
      expect(vehicle).toHaveProperty("deliveryStatus");
      expect(vehicle).toHaveProperty("deliveredAt");
      expect(vehicle).toHaveProperty("readAt");
    }
  });

  it("vehicles with sent reminders show delivery status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const vehicles = await caller.database.getAllVehiclesWithCustomers();

    // Find vehicles that have been sent reminders
    const vehiclesWithReminders = vehicles.filter(v => v.lastReminderSent);
    
    // If there are vehicles with reminders, verify they have delivery status
    vehiclesWithReminders.forEach(vehicle => {
      expect(vehicle.lastReminderSent).toBeTruthy();
      // Delivery status should be one of the valid values or null
      if (vehicle.deliveryStatus) {
        expect(["queued", "sent", "delivered", "read", "failed"]).toContain(vehicle.deliveryStatus);
      }
    });
  });

  it("vehicles without sent reminders have null delivery status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const vehicles = await caller.database.getAllVehiclesWithCustomers();

    // Find vehicles that have never been sent reminders
    const vehiclesWithoutReminders = vehicles.filter(v => !v.lastReminderSent);
    
    // These vehicles should have null delivery status
    vehiclesWithoutReminders.forEach(vehicle => {
      expect(vehicle.deliveryStatus).toBeNull();
      expect(vehicle.deliveredAt).toBeNull();
      expect(vehicle.readAt).toBeNull();
    });
  });
});
