/**
 * Did the customer get it: the status beside each message on the MOT Reminders page. Pure.
 */
import { describe, it, expect } from "vitest";
import { deliveryOf, summariseReminderLogs, type DeliveryState, type SentLog } from "../shared/messageDelivery";
import { followUpFor } from "../shared/motFollowUp";

const state = (log: Partial<SentLog>, rescue?: { status: string | null }) =>
  deliveryOf({ status: null, templateUsed: null, messageSid: null, ...log }, rescue).state;

describe("deliveryOf", () => {
  it("reads WhatsApp's own status", () => {
    const wa = { templateUsed: "urgent_expired", messageSid: "MM068832faa64654d3c2c59b326b400edc" };
    expect(state({ ...wa, status: "read" })).toBe("read");
    expect(state({ ...wa, status: "delivered" })).toBe("delivered");
    expect(state({ ...wa, status: "sent" })).toBe("sent");
    expect(state({ ...wa, status: "queued" })).toBe("sent");
    expect(state({ ...wa, status: "failed" })).toBe("not_received");
    expect(state({ ...wa, status: "undelivered" })).toBe("not_received");
  });

  it("spots a template refused outright and sent as a text (SM… SID)", () => {
    const text = { templateUsed: "mot_reminder", messageSid: "SM0123" };
    expect(state({ ...text, status: "sent" })).toBe("sms_sent");
    expect(state({ ...text, status: "delivered" })).toBe("sms_delivered");
    expect(state({ ...text, status: "undelivered" })).toBe("not_received");
  });

  it("tells free-form WhatsApp (also SM…) from free-form texts", () => {
    expect(state({ templateUsed: "freeform", messageSid: "SM1", status: "read" })).toBe("read");
    expect(state({ templateUsed: "freeform-sms", messageSid: "SM2", status: "delivered" })).toBe("sms_delivered");
  });

  it("follows a WhatsApp the webhook rescued to how its text did", () => {
    const original = { templateUsed: "urgent_expired", messageSid: "MMabc" };
    expect(state({ ...original, status: "rescued" }, { status: "delivered" })).toBe("sms_delivered");
    expect(state({ ...original, status: "rescued" }, { status: "failed" })).toBe("not_received");
    // Twilio repeats callbacks, which can turn the original back to "failed" after the rescue.
    expect(state({ ...original, status: "failed" }, { status: "sent" })).toBe("sms_sent");
    // Older rescue rows don't name their original.
    expect(state({ ...original, status: "rescued" })).toBe("sms_sent");
  });
});

describe("summariseReminderLogs", () => {
  const at = (s: string) => new Date(s);
  // Newest first, as the query returns them.
  const logs: SentLog[] = [
    { vehicleId: 1, sentAt: at("2026-09-14T10:31:00Z"), status: "delivered", messageType: "MOT", templateUsed: "rescue-sms:MMfollow", messageSid: "SMtext" },
    { vehicleId: 1, sentAt: at("2026-09-14T10:30:00Z"), status: "rescued", messageType: "MOT", templateUsed: "urgent_expired", messageSid: "MMfollow" },
    { vehicleId: 1, sentAt: at("2026-07-10T10:48:00Z"), status: "read", messageType: "MOT", templateUsed: "mot_reminder", messageSid: "MMremind" },
  ];

  it("files a rescue text under the message it rescued, never as a new reminder", () => {
    const { last, lastMot, lastFollowUp } = summariseReminderLogs(logs);
    expect(lastMot.get(1)).toMatchObject({ at: at("2026-07-10T10:48:00Z"), delivery: { state: "read" } });
    expect(lastFollowUp.get(1)).toMatchObject({ at: at("2026-09-14T10:30:00Z"), delivery: { state: "sms_delivered" } });
    expect(last.get(1)?.at).toEqual(at("2026-09-14T10:30:00Z"));
  });
});

describe("a follow-up that never arrived", () => {
  const NOW = new Date("2026-09-15T08:00:00Z");
  const car = { motExpiryDate: "2026-09-09T00:00:00Z", lastMotReminderAt: "2026-08-20T09:00:00Z", lastFollowUpAt: "2026-09-14T10:30:00Z" };
  const sent = (state: DeliveryState) => followUpFor({ ...car, lastFollowUpHow: "message", lastFollowUpDelivery: { state, note: "" } }, NOW);

  it("keeps the car on the list, marked not received", () => {
    expect(sent("read").handled).toBe(true);
    expect(sent("sent").handled).toBe(true);
    expect(sent("sms_delivered").handled).toBe(true);
    expect(sent("not_received")).toMatchObject({ handled: false, followUpDelivery: { state: "not_received" } });
  });

  it("counts a phone call whatever happened to the messages", () => {
    expect(followUpFor({ ...car, lastFollowUpHow: "call", lastFollowUpDelivery: null }, NOW)).toMatchObject({ handled: true, followUpDelivery: null });
  });
});
