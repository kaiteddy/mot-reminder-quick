/**
 * Off-road cars: SORN, or no MOT pass in three years. Pure: no database.
 */
import { describe, it, expect } from "vitest";
import { offRoadVerdict, OFF_ROAD_TAG } from "./services/offRoadCarReminders";
import { KEPT_ON_MARKER } from "./services/staleCarReminders";

const NOW = new Date("2026-09-10T09:00:00Z");

describe("offRoadVerdict", () => {
  it("switches off a plate DVLA has no record of", () => {
    const v = offRoadVerdict({ dvlaStatus: "not_found", motExpiryDate: null, taxStatus: "Taxed" }, NOW)!;
    expect(v.kind).toBe("not_found");
    expect(v.reason).toContain("DVLA has no record of this registration, so the car has been scrapped or exported, or the plate has moved to another vehicle.");
    expect(v.reason).toContain(OFF_ROAD_TAG);
  });

  it("switches off a new car declared SORN before its first MOT, but not a taxed one", () => {
    expect(offRoadVerdict({ dvlaStatus: "found", taxStatus: "SORN", motExpiryDate: null }, NOW)!.reason).toContain("It has not needed an MOT yet.");
    expect(offRoadVerdict({ dvlaStatus: "found", taxStatus: "Taxed", motExpiryDate: null }, NOW)).toBeNull();
  });

  it("keeps reminding a taxed car with a recent MOT", () => {
    expect(offRoadVerdict({ taxStatus: "Taxed", motExpiryDate: "2026-11-01" }, NOW)).toBeNull();
    expect(offRoadVerdict({ taxStatus: "Untaxed", motExpiryDate: "2025-06-01" }, NOW)).toBeNull();
  });

  it("treats an MOT that ran out just under two years ago as still recent", () => {
    // Expired 23 months ago: the last pass was under three years ago.
    expect(offRoadVerdict({ taxStatus: "Untaxed", motExpiryDate: "2024-10-10" }, NOW)).toBeNull();
  });

  it("switches off a car with no MOT pass in three years", () => {
    const v = offRoadVerdict({ taxStatus: "Untaxed", motExpiryDate: "2023-03-14" }, NOW)!;
    expect(v.kind).toBe("no_mot");
    expect(v.reason).toContain("Its last MOT ran out on 14/03/2023, so it has not passed one in over 4 years, and DVLA shows it untaxed.");
  });

  it("switches off a SORN car even while its MOT is still valid", () => {
    const v = offRoadVerdict({ taxStatus: "SORN", motExpiryDate: "2027-04-26" }, NOW)!;
    expect(v.kind).toBe("sorn");
    expect(v.reason).toContain("DVLA shows it declared SORN, off the road. Its MOT is valid until 26/04/2027.");
  });

  it("says both when both are true", () => {
    const v = offRoadVerdict({ taxStatus: "sorn", motExpiryDate: "2022-01-20" }, NOW)!;
    expect(v.kind).toBe("sorn_and_no_mot");
    expect(v.reason).toContain("DVLA shows it declared SORN, and its last MOT ran out on 20/01/2022");
  });

  it("writes a reason the auto-lift can find and a hand override can never be mistaken for", () => {
    const v = offRoadVerdict({ taxStatus: "SORN", motExpiryDate: "2025-01-01" }, NOW)!;
    expect(v.reason).toMatch(/^Reminders stopped 10\/09\/2026\. Off the road:/);
    expect(v.reason).toContain(OFF_ROAD_TAG);
    expect(v.reason.startsWith(KEPT_ON_MARKER)).toBe(false);
    expect(v.reason).toContain("Reminders switch back on by themselves if DVLA shows it taxed with a valid MOT again.");
  });
});
