/**
 * "Refresh Visible" on the MOT Reminders page: what one car's refresh records. Pure.
 */
import { describe, it, expect } from "vitest";
import { motRefreshFor } from "./services/motRefresh";

const NOW = new Date("2026-09-11T09:31:00Z");
const car = { id: 7, make: "Ford", colour: "Blue", fuelType: "Diesel", dateOfRegistration: new Date("2014-03-01") };
const found = (data: any) => ({ outcome: "found" as const, httpStatus: 200, data });

describe("motRefreshFor", () => {
  it("records tax, DVLA's answer and the time, not just the MOT date", () => {
    // HJ14AJX on 11/09/2026: MOT renewed that morning, DVLA still showing the old expiry.
    const { update, result } = motRefreshFor(car, found({ taxStatus: "Taxed", taxDueDate: "2027-03-01", motExpiryDate: "2026-09-11" }),
      { motTests: [{ testResult: "PASSED", expiryDate: "2027-09-11", completedDate: "2026-09-11T08:10:00Z" }] }, NOW);
    expect(update).toMatchObject({ id: 7, taxStatus: "Taxed", dvlaStatus: "found", dvlaAnsweredAt: NOW, lastChecked: NOW, firstMotCheckedAt: NOW, firstMotDue: null });
    expect(update.motExpiryDate).toEqual(new Date("2027-09-11T00:00:00Z"));
    expect(result).toEqual({ success: true, motExpiryDate: "2027-09-11T00:00:00.000Z", taxStatus: "Taxed" });
  });

  it("takes DVSA's MOT for a car DVLA has no record of", () => {
    // WP21KOX: DVLA said no record, DVSA shows a pass on 28/07/2026.
    const { update, result } = motRefreshFor(car, { outcome: "not_found", httpStatus: 404 },
      { motTests: [{ testResult: "PASSED", expiryDate: "2027-07-26" }] }, NOW);
    expect(update).toMatchObject({ dvlaStatus: "not_found", motExpiryDate: new Date("2027-07-26T00:00:00Z") });
    expect(result.success).toBe(true);
  });

  it("gives a car never tested its first-MOT due date", () => {
    const { update, result } = motRefreshFor(car, found({ taxStatus: "Taxed" }), { motTestDueDate: "2026-09-24", motTests: [] }, NOW);
    expect(update).toMatchObject({ taxStatus: "Taxed", firstMotDue: new Date("2026-09-24T00:00:00Z") });
    expect(update.motExpiryDate).toBeUndefined();
    expect(result).toMatchObject({ success: true, firstMot: true, motExpiryDate: "2026-09-24T00:00:00.000Z" });
  });

  it("uses DVLA's MOT date when DVSA cannot be asked, and does not claim DVSA was asked", () => {
    const { update, result } = motRefreshFor(car, found({ taxStatus: "Untaxed", motExpiryDate: "2026-12-01" }), undefined, NOW);
    expect(update.firstMotCheckedAt).toBeUndefined();
    expect(update).toMatchObject({ taxStatus: "Untaxed", motExpiryDate: new Date("2026-12-01"), lastChecked: NOW });
    expect(result.success).toBe(true);
  });

  it("changes nothing and says why when neither answers", () => {
    const { update, result } = motRefreshFor(car, { outcome: "rate_limited", httpStatus: 429 }, undefined, NOW);
    expect(Object.keys(update)).toEqual(["id"]);
    expect(result).toEqual({ success: false, error: "DVLA did not answer (rate limited), so the car was left as it was" });
  });
});
