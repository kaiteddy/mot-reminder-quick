import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
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
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("MOT Refresh - bulkVerifyMOT", () => {
  it("should accept empty registrations array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.reminders.bulkVerifyMOT({
      registrations: [],
    });

    expect(result).toEqual([]);
  });

  it("should return results array for registrations", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Use a test registration that might not exist
    const result = await caller.reminders.bulkVerifyMOT({
      registrations: ["TEST123"],
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]).toHaveProperty("registration");
    expect(result[0]).toHaveProperty("success");
    expect(result[0]?.registration).toBe("TEST123");
  });

  it("should handle multiple registrations", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.reminders.bulkVerifyMOT({
      registrations: ["TEST123", "TEST456"],
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]?.registration).toBe("TEST123");
    expect(result[1]?.registration).toBe("TEST456");
  });
});
