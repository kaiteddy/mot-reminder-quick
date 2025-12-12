import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the SMS service
vi.mock("./smsService", () => ({
  sendMOTReminderWithTemplate: vi.fn().mockResolvedValue({
    success: true,
    messageId: "TEST_MOT_MESSAGE_ID",
  }),
  sendServiceReminderWithTemplate: vi.fn().mockResolvedValue({
    success: true,
    messageId: "TEST_SERVICE_MESSAGE_ID",
  }),
  sendSMS: vi.fn().mockResolvedValue({
    success: true,
    messageId: "TEST_CUSTOM_MESSAGE_ID",
  }),
  generateServiceReminderMessage: vi.fn(),
}));

// Mock the database functions
vi.mock("./db", () => ({
  getAllReminders: vi.fn().mockResolvedValue([]),
  updateReminder: vi.fn(),
  createReminderLog: vi.fn().mockResolvedValue({ insertId: 1 }),
  findCustomerByPhone: vi.fn().mockResolvedValue(null), // No customer found by default
}));

function createTestContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("sendWhatsApp with Template Parameters", () => {
  it("should send MOT reminder with custom template parameters", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.reminders.sendWhatsApp({
      id: 0,
      phoneNumber: "+447843275372",
      customerName: "John Smith",
      registration: "AB12CDE",
      expiryDate: "2025-12-25",
      daysUntil: 14,
      messageType: "MOT",
    });

    expect(result.success).toBe(true);
    expect(result.messageSid).toBe("TEST_MOT_MESSAGE_ID");
  });

  it("should send Service reminder with custom template parameters", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.reminders.sendWhatsApp({
      id: 0,
      phoneNumber: "+447843275372",
      customerName: "Jane Doe",
      registration: "XY99ZZZ",
      expiryDate: "2025-11-30",
      daysUntil: 7,
      messageType: "Service",
    });

    expect(result.success).toBe(true);
    expect(result.messageSid).toBe("TEST_SERVICE_MESSAGE_ID");
  });

  it("should send custom message when customMessage is provided", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.reminders.sendWhatsApp({
      id: 0,
      phoneNumber: "+447843275372",
      customMessage: "Thanks for confirming! We'll book you in.",
    });

    expect(result.success).toBe(true);
    expect(result.messageSid).toBe("TEST_CUSTOM_MESSAGE_ID");
  });

  it("should use default values when template parameters are not provided", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.reminders.sendWhatsApp({
      id: 0,
      phoneNumber: "+447843275372",
    });

    expect(result.success).toBe(true);
    expect(result.messageSid).toBe("TEST_MOT_MESSAGE_ID");
  });
});
