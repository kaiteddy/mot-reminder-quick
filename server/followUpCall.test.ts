/**
 * After the follow-up: a phone call, never a third message; and the morning re-check behind it. Pure.
 */
import { describe, it, expect } from "vitest";
import { CALL_AFTER_DAYS, FOLLOW_UP_AFTER_DAYS, followUpFor, repeatFollowUpBlock } from "../shared/motFollowUp";
import type { DeliveryState } from "../shared/messageDelivery";
import { isFollowUpRecheckTime, runFollowUpRecheck } from "./services/followUpRecheck";

const at = (s: string) => new Date(s);
const d = (state: DeliveryState) => ({ state, note: state === "read" ? "Read on WhatsApp." : "" });
// MOT ran out 09/09/2026; reminded 20/08; follow-up read on 14/09.
const car = { motExpiryDate: "2026-09-09T00:00:00Z", lastMotReminderAt: "2026-08-20T09:00:00Z" };
const followedUp = { ...car, lastFollowUpAt: "2026-09-14T10:30:00Z", lastFollowUpHow: "message" as const, lastFollowUpDelivery: d("read") };

describe("what to do next on the Follow up tab", () => {
  it("asks for the follow-up message when none has gone", () => {
    expect(followUpFor(car, at("2026-09-15T08:00:00Z"))).toMatchObject({ todo: "message", handled: false });
  });

  it("leaves a follow-up that reached them alone for 14 days", () => {
    expect(CALL_AFTER_DAYS).toBe(14);
    expect(followUpFor({ ...followedUp, lastChecked: "2026-09-27T05:00:00Z" }, at("2026-09-27T08:00:00Z"))).toMatchObject({ todo: null, handled: true });
  });

  it("asks for a call 14 days on, once a check that day still shows no MOT", () => {
    const day14 = at("2026-09-28T08:00:00Z");
    expect(followUpFor({ ...followedUp, lastChecked: "2026-09-28T05:01:00Z" }, day14)).toMatchObject({ todo: "call", handled: false });
    // Not checked since: wait for the morning check rather than ask to phone someone maybe tested elsewhere.
    expect(followUpFor({ ...followedUp, lastChecked: "2026-09-20T05:00:00Z" }, day14)).toMatchObject({ todo: null });
    // Sent but never on their phone counts the same as read.
    expect(followUpFor({ ...followedUp, lastFollowUpDelivery: d("sent"), lastChecked: "2026-09-28T05:01:00Z" }, day14)).toMatchObject({ todo: "call" });
  });

  it("asks for a call straight away when the follow-up never arrived", () => {
    expect(followUpFor({ ...followedUp, lastFollowUpDelivery: d("not_received") }, at("2026-09-15T08:00:00Z"))).toMatchObject({ todo: "call" });
  });

  it("is done once they're called or booked in", () => {
    expect(followUpFor({ ...followedUp, lastFollowUpHow: "call", lastChecked: "2026-09-28T05:01:00Z" }, at("2026-09-28T08:00:00Z"))).toMatchObject({ todo: null });
    expect(followUpFor({ ...car, motBookedDate: "2026-09-18T00:00:00Z" }, at("2026-09-15T08:00:00Z"))).toMatchObject({ todo: null });
  });
});

describe("giving them time to book after the reminder", () => {
  // MOT runs out 28/09; reminded 14/09 at 11:46, two weeks before.
  const fresh = { motExpiryDate: "2026-09-28T00:00:00Z", lastMotReminderAt: "2026-09-14T10:46:00Z" };

  it("waits 7 days before asking for the follow-up", () => {
    expect(FOLLOW_UP_AFTER_DAYS).toBe(7);
    expect(followUpFor(fresh, at("2026-09-14T12:00:00Z"))).toMatchObject({ todo: "wait", handled: false, followUpFrom: "2026-09-21" });
    expect(followUpFor(fresh, at("2026-09-20T20:00:00Z"))).toMatchObject({ todo: "wait" });   // 21:00 on the 20th in the UK
    expect(followUpFor(fresh, at("2026-09-21T07:00:00Z"))).toMatchObject({ todo: "message" });
  });

  it("asks straight away once the MOT has run out", () => {
    const late = { motExpiryDate: "2026-09-16T00:00:00Z", lastMotReminderAt: "2026-09-14T10:46:00Z" };
    expect(followUpFor(late, at("2026-09-16T20:00:00Z"))).toMatchObject({ todo: "wait", followUpFrom: "2026-09-17" });
    expect(followUpFor(late, at("2026-09-17T07:00:00Z"))).toMatchObject({ todo: "message" });
  });
});

describe("one follow-up message per MOT", () => {
  const last = { at: "2026-09-14T10:30:00Z", delivery: d("read") };

  it("refuses a second one for the same MOT, and says to call", () => {
    expect(repeatFollowUpBlock(last, "2026-09-09T00:00:00Z", "NG07OYY"))
      .toBe("NG07OYY was already sent a follow-up for this MOT on 14/09/2026 (Read on WhatsApp). Give them a call instead.");
  });

  it("lets another go when the last one never arrived", () => {
    expect(repeatFollowUpBlock({ ...last, delivery: d("not_received") }, "2026-09-09T00:00:00Z", "HY65SWJ")).toBeNull();
  });

  it("ignores a follow-up about an earlier MOT, or none at all", () => {
    expect(repeatFollowUpBlock({ ...last, at: "2025-09-14T10:30:00Z" }, "2026-09-09T00:00:00Z", "NG07OYY")).toBeNull();
    expect(repeatFollowUpBlock(null, "2026-09-09T00:00:00Z", "NG07OYY")).toBeNull();
  });
});

describe("the morning re-check", () => {
  it("acts at 06:00 in London, summer and winter, and skips the other UTC hour", () => {
    expect(isFollowUpRecheckTime(at("2026-09-15T05:00:00Z"))).toBe(true);   // 06:00 BST
    expect(isFollowUpRecheckTime(at("2026-09-15T06:00:00Z"))).toBe(false);  // 07:00 BST
    expect(isFollowUpRecheckTime(at("2026-12-15T06:00:00Z"))).toBe(true);   // 06:00 GMT
    expect(isFollowUpRecheckTime(at("2026-12-15T05:00:00Z"))).toBe(false);  // 05:00 GMT
  });

  const query = async (_text: string, params?: unknown[]) => {
    expect(params?.[0]).toBe("2026-09-15");
    return { rows: [{ registration: "AB12CDE", mot: "2026-09-20" }, { registration: "XY34ZZZ", mot: "2026-09-01" }] };
  };

  it("lists the plates without asking anyone on a dry run", async () => {
    let asked = false;
    const s = await runFollowUpRecheck(query, async () => { asked = true; return []; }, { apply: false, now: at("2026-09-15T05:00:00Z") });
    expect(asked).toBe(false);
    expect(s.plates).toEqual(["AB12CDE", "XY34ZZZ"]);
  });

  it("tells a car tested early elsewhere from one still without an MOT", async () => {
    const s = await runFollowUpRecheck(query, async (regs) => {
      expect(regs).toEqual(["AB12CDE", "XY34ZZZ"]);
      return [
        { registration: "AB12CDE", success: true, verified: true, motExpiryDate: "2027-09-10T00:00:00.000Z" },
        { registration: "XY34ZZZ", success: true, verified: true, motExpiryDate: "2026-08-31T23:00:00.000Z" },
      ];
    }, { apply: true, now: at("2026-09-15T05:00:00Z") });
    expect(s).toMatchObject({ day: "2026-09-15", checked: 2, renewed: 1, stillOut: 1, notAnswered: 0 });
  });
});
