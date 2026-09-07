/**
 * Pure-logic tests for the unanswered-message escalation: working-hours arithmetic and the
 * overdue verdict. No database — everything here is a function of its arguments.
 */
import { describe, it, expect } from "vitest";
import {
  evaluate, isWithinHours, nextOpening, workingMinutesBetween, isAutoHandledBody,
  DEFAULT_SETTINGS, type WaitingRow,
} from "./services/unansweredAlerts";

// September 2026 is British Summer Time (UTC+1): 14:00Z = 15:00 UK.
const clock = { openTime: "08:00", closeTime: "18:00", days: [1, 2, 3, 4, 5, 6] };
const S = { ...DEFAULT_SETTINGS, enabled: true, afterMinutes: 30, repeatMinutes: 60, maxAlerts: 6 };

function row(over: Partial<WaitingRow> = {}): WaitingRow {
  return {
    messageId: 1, customerId: 7088, customerName: "Ms Eva", customerPhone: "+447475104187",
    registration: "YL67KWC", body: "Monday morning", hasMedia: false,
    receivedAt: new Date("2026-09-03T15:12:30Z"), // Thu 16:12 UK
    repliedAt: null, handledAt: null, escalatedAt: null, escalationCount: 0,
    ...over,
  };
}

describe("working hours (UK wall clock)", () => {
  it("knows open from closed", () => {
    expect(isWithinHours(new Date("2026-09-03T08:00:00Z"), clock)).toBe(true);  // Thu 09:00 UK
    expect(isWithinHours(new Date("2026-09-03T06:59:00Z"), clock)).toBe(false); // Thu 07:59 UK
    expect(isWithinHours(new Date("2026-09-03T17:00:00Z"), clock)).toBe(false); // Thu 18:00 UK (closed at 18)
    expect(isWithinHours(new Date("2026-09-06T10:00:00Z"), clock)).toBe(false); // Sunday
  });

  it("rolls a late-evening message to the next opening", () => {
    // Thu 21:00 UK -> Fri 08:00 UK = 07:00Z
    expect(nextOpening(new Date("2026-09-03T20:00:00Z"), clock).toISOString()).toBe("2026-09-04T07:00:00.000Z");
    // Sat 19:00 UK -> Mon 08:00 UK
    expect(nextOpening(new Date("2026-09-05T18:00:00Z"), clock).toISOString()).toBe("2026-09-07T07:00:00.000Z");
    // already open -> unchanged
    const t = new Date("2026-09-03T10:00:00Z");
    expect(nextOpening(t, clock)).toBe(t);
  });

  it("counts only open minutes", () => {
    // Thu 16:12 UK -> Thu 17:00 UK = 48 minutes
    expect(workingMinutesBetween(new Date("2026-09-03T15:12:00Z"), new Date("2026-09-03T16:00:00Z"), clock)).toBe(48);
    // Thu 16:12 UK -> Fri 08:30 UK = 108 (to close) + 30
    expect(workingMinutesBetween(new Date("2026-09-03T15:12:00Z"), new Date("2026-09-04T07:30:00Z"), clock)).toBe(138);
    // Thu 21:00 -> Fri 08:00: nothing yet
    expect(workingMinutesBetween(new Date("2026-09-03T20:00:00Z"), new Date("2026-09-04T07:00:00Z"), clock)).toBe(0);
    // Sunday is skipped entirely: Sat 17:00 UK -> Mon 09:00 UK = 60 + 60
    expect(workingMinutesBetween(new Date("2026-09-05T16:00:00Z"), new Date("2026-09-07T08:00:00Z"), clock)).toBe(120);
  });
});

describe("auto-handled keywords", () => {
  it("does not chase replies to STOP or reminder buttons", () => {
    expect(isAutoHandledBody("STOP", false)).toBe(true);
    expect(isAutoHandledBody("Confirm", false)).toBe(true);
    expect(isAutoHandledBody("cancel", false)).toBe(true);
    expect(isAutoHandledBody("", false)).toBe(true);
  });
  it("does chase real messages, including a bare photo", () => {
    expect(isAutoHandledBody("Monday morning", false)).toBe(false);
    expect(isAutoHandledBody("Yes", false)).toBe(false);
    expect(isAutoHandledBody("", true)).toBe(false);
  });
});

describe("evaluate", () => {
  it("is not waiting once a staff reply followed the message", () => {
    const v = evaluate(row({ repliedAt: new Date("2026-09-03T15:20:00Z") }), S, new Date("2026-09-04T09:00:00Z"));
    expect(v.waiting).toBe(false);
    expect(v.reason).toBe("replied");
  });

  it("ignores a reply that came BEFORE the latest message (Eva's case)", () => {
    // Staff replied 16:53 UK, she answered 17:12 UK, nothing since.
    const v = evaluate(row({ repliedAt: new Date("2026-09-03T14:53:41Z") }), S, new Date("2026-09-04T09:00:00Z"));
    expect(v.waiting).toBe(true);
    expect(v.alertNow).toBe(true);
    expect(v.reason).toBe("first alert");
  });

  it("stops once marked handled", () => {
    const v = evaluate(row({ handledAt: new Date("2026-09-04T08:00:00Z") }), S, new Date("2026-09-04T09:00:00Z"));
    expect(v.waiting).toBe(false);
  });

  it("waits out the grace period, then alerts", () => {
    // Message Thu 16:12 UK; at 16:30 UK only 18 minutes gone.
    expect(evaluate(row(), S, new Date("2026-09-03T15:30:00Z"))).toMatchObject({ waiting: true, alertNow: false });
    // At 16:45 UK, 33 minutes -> due.
    expect(evaluate(row(), S, new Date("2026-09-03T15:45:00Z"))).toMatchObject({ waiting: true, alertNow: true });
  });

  it("never fires outside working hours, even when overdue", () => {
    const v = evaluate(row(), S, new Date("2026-09-03T21:00:00Z")); // Thu 22:00 UK
    expect(v.waiting).toBe(true);
    expect(v.alertNow).toBe(false);
    expect(v.reason).toBe("outside working hours");
  });

  it("repeats on the timer and stops at the ceiling", () => {
    const now = new Date("2026-09-04T09:00:00Z");
    expect(evaluate(row({ escalatedAt: new Date("2026-09-04T08:30:00Z"), escalationCount: 1 }), S, now).alertNow).toBe(false);
    expect(evaluate(row({ escalatedAt: new Date("2026-09-04T07:55:00Z"), escalationCount: 1 }), S, now)).toMatchObject({ alertNow: true, reason: "repeat #2" });
    expect(evaluate(row({ escalatedAt: new Date("2026-09-04T07:00:00Z"), escalationCount: 6 }), S, now).alertNow).toBe(false);
  });

  it("still reports waiting when alerts are switched off, but does not fire", () => {
    const v = evaluate(row(), { ...S, enabled: false }, new Date("2026-09-04T09:00:00Z"));
    expect(v).toMatchObject({ waiting: true, alertNow: false, reason: "alerts off" });
  });
});
