/**
 * The grading and wording behind "Reminders off" on a stale car. Pure: no database.
 */
import { describe, it, expect } from "vitest";
import { staleCarVerdict, KEPT_ON_MARKER } from "./services/staleCarReminders";

const NOW = new Date("2026-09-10T09:00:00Z");

describe("staleCarVerdict", () => {
  it("puts the owner's own word first", () => {
    const v = staleCarVerdict({ lastActivity: "2011-12-09", saidNotTheirs: true, remindedCount: 4, otherReg: "LN63JXR", otherDate: "2024-01-01" }, NOW);
    expect(v.tier).toBe(1);
    expect(v.reason).toContain("saying a car was not theirs");
  });

  it("names the car they came back with when the same phone returned 2+ years later", () => {
    const v = staleCarVerdict({ lastActivity: "2015-10-04", saidNotTheirs: false, remindedCount: 0, otherReg: "FT19AAE", otherDate: "2021-03-01" }, NOW);
    expect(v.tier).toBe(2);
    expect(v.reason).toContain("back with FT19AAE on 01/03/2021");
  });

  it("does not call a car replaced when the other car was only a little later", () => {
    // Two cars in the same household, seen months apart, is not a replacement.
    const v = staleCarVerdict({ lastActivity: "2019-06-01", saidNotTheirs: false, remindedCount: 0, otherReg: "AB12CDE", otherDate: "2020-01-01" }, NOW);
    expect(v.tier).toBe(5);
  });

  it("grades by how often we have already asked", () => {
    expect(staleCarVerdict({ lastActivity: "2018-04-30", saidNotTheirs: false, remindedCount: 3 }, NOW).tier).toBe(3);
    expect(staleCarVerdict({ lastActivity: "2018-04-30", saidNotTheirs: false, remindedCount: 1 }, NOW).tier).toBe(4);
    expect(staleCarVerdict({ lastActivity: "2018-04-30", saidNotTheirs: false, remindedCount: 0 }, NOW).tier).toBe(5);
  });

  it("writes UK dates, the years, and how to undo it", () => {
    const v = staleCarVerdict({ lastActivity: "2015-07-27T23:00:00Z", saidNotTheirs: false, remindedCount: 0 }, NOW);
    expect(v.reason).toMatch(/^Reminders stopped 10\/09\/2026\. No work on this car since 28\/07\/2015, over 11 years ago\./);
    expect(v.reason).toContain("Owner and history unchanged; switch reminders back on here if it is still theirs.");
  });

  it("never writes a reason that looks like a hand override", () => {
    const v = staleCarVerdict({ lastActivity: "2012-04-30", saidNotTheirs: false, remindedCount: 0 }, NOW);
    expect(v.reason.startsWith(KEPT_ON_MARKER)).toBe(false);
  });
});
