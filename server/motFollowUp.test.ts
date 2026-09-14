/**
 * The follow-up list: cars sent an MOT reminder whose MOT hasn't been renewed. Pure.
 */
import { describe, it, expect } from "vitest";
import { followUpFor, ukDay } from "../shared/motFollowUp";

// Tuesday 15/09/2026, 09:00 in the UK.
const NOW = new Date("2026-09-15T08:00:00Z");

describe("ukDay", () => {
  it("gives the UK calendar day, however the time was stored", () => {
    expect(ukDay("2026-09-14T00:00:00Z")).toBe("2026-09-14");
    expect(ukDay("2026-09-14T01:00:00Z")).toBe("2026-09-14");
    expect(ukDay("2026-09-14T23:01:00Z")).toBe("2026-09-15"); // 00:01 in British Summer Time
  });
});

describe("followUpFor", () => {
  const reminded = { lastMotReminderAt: "2026-09-01T09:00:00Z", lastMotReminderStatus: "read" };

  it("leaves off a car never sent a reminder", () => {
    expect(followUpFor({ motExpiryDate: "2026-09-14T00:00:00Z" }, NOW)).toBeNull();
  });

  it("drops a car whose MOT was renewed after the reminder, wherever it was done", () => {
    expect(followUpFor({ ...reminded, motExpiryDate: "2027-09-13T00:00:00Z" }, NOW)).toBeNull();
  });

  it("shows a reminded car still due within 14 days as not done yet", () => {
    const f = followUpFor({ ...reminded, motExpiryDate: "2026-09-20T00:00:00Z" }, NOW)!;
    expect(f).toMatchObject({ stage: "due", daysLeft: 5, reminderStatus: "read", handled: false });
  });

  it("does not trust an expiry until a check after midnight has confirmed it", () => {
    // Ran out 14/09. Checked at 23:58 on the 14th: that is still its last day, so not yet confirmed.
    const f = followUpFor({ ...reminded, motExpiryDate: "2026-09-14T00:00:00Z", lastChecked: "2026-09-14T22:58:00Z" }, NOW)!;
    expect(f).toMatchObject({ stage: "expired_unchecked", daysLeft: -1, checkedAfterExpiry: null });
  });

  it("calls it a missed MOT once the 00:01 check still finds no new MOT", () => {
    const f = followUpFor({ ...reminded, motExpiryDate: "2026-09-14T00:00:00Z", lastChecked: "2026-09-14T23:01:00Z" }, NOW)!;
    expect(f.stage).toBe("missed");
    expect(f.checkedAfterExpiry).toEqual(new Date("2026-09-14T23:01:00Z"));
  });

  it("ignores a reminder sent long before this MOT, and a missed MOT over 60 days old", () => {
    expect(followUpFor({ lastMotReminderAt: "2026-06-01T09:00:00Z", motExpiryDate: "2026-09-14T00:00:00Z" }, NOW)).toBeNull();
    expect(followUpFor({ lastMotReminderAt: "2026-06-20T09:00:00Z", motExpiryDate: "2026-07-01T00:00:00Z", lastChecked: "2026-07-02T00:01:00Z" }, NOW)).toBeNull();
  });

  it("counts a reminder sent after the MOT ran out", () => {
    expect(followUpFor({ lastMotReminderAt: "2026-09-12T09:00:00Z", motExpiryDate: "2026-09-10T00:00:00Z", lastChecked: "2026-09-11T00:01:00Z" }, NOW)!.stage).toBe("missed");
  });

  it("marks it handled when followed up since the reminder, or booked in", () => {
    const base = { ...reminded, motExpiryDate: "2026-09-10T00:00:00Z", lastChecked: "2026-09-11T00:01:00Z" };
    expect(followUpFor({ ...base, lastFollowUpAt: "2026-09-12T10:00:00Z", lastFollowUpHow: "call" }, NOW)).toMatchObject({ handled: true, followedUpHow: "call" });
    expect(followUpFor({ ...base, lastFollowUpAt: "2026-08-20T10:00:00Z" }, NOW)).toMatchObject({ handled: false, followedUpAt: null });
    expect(followUpFor({ ...base, motBookedDate: "2026-09-18T00:00:00Z" }, NOW)).toMatchObject({ handled: true });
  });
});
