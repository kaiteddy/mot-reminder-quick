/**
 * Recording DVLA's answer on a vehicle. The cases are the real ones from the 10/09/2026 sample.
 */
import { describe, it, expect } from "vitest";
import { dvlaUpdateFor, isSupersededRegistration } from "./services/dvlaRecord";

const NOW = new Date("2026-09-10T09:00:00Z");

describe("dvlaUpdateFor", () => {
  it("keeps a new car's tax status even though it has no MOT date yet", () => {
    // LP73EZV: DVLA says Taxed, "No details held by DVLA" for MOT, first registered 2023-12.
    const { update, answered } = dvlaUpdateFor({}, { outcome: "found", data: { registrationNumber: "LP73EZV", taxStatus: "Taxed", taxDueDate: "2027-01-01", motStatus: "No details held by DVLA", monthOfFirstRegistration: "2023-12" } }, NOW);
    expect(answered).toBe(true);
    expect(update.taxStatus).toBe("Taxed");
    expect(update.dvlaStatus).toBe("found");
    expect(update.dvlaAnsweredAt).toEqual(NOW);
    expect("motExpiryDate" in update).toBe(false);
    expect(update.dateOfRegistration).toEqual(new Date("2023-12-01T00:00:00Z"));
  });

  it("records SORN and the MOT date for an older car", () => {
    const { update } = dvlaUpdateFor({}, { outcome: "found", data: { registrationNumber: "FN61NYR", taxStatus: "SORN", motExpiryDate: "2026-11-06" } }, NOW);
    expect(update.taxStatus).toBe("SORN");
    expect(update.taxDueDate).toBeNull();
    expect(update.motExpiryDate).toEqual(new Date("2026-11-06"));
  });

  it("records that DVLA has no record of a plate, and counts it as an answer", () => {
    const { update, answered } = dvlaUpdateFor({}, { outcome: "not_found", httpStatus: 404 }, NOW);
    expect(answered).toBe(true);
    expect(update).toEqual({ lastChecked: NOW, dvlaAnsweredAt: NOW, dvlaStatus: "not_found" });
  });

  it("leaves a car due when DVLA did not really answer", () => {
    for (const outcome of ["rate_limited", "auth_failed", "no_key", "error"] as const) {
      const { update, answered } = dvlaUpdateFor({}, { outcome }, NOW);
      expect(answered, outcome).toBe(false);
      expect(update, outcome).toEqual({});
    }
  });

  it("never overwrites what GA4 or UKVD already gave us", () => {
    const { update } = dvlaUpdateFor(
      { make: "NISSAN", colour: "WHITE", fuelType: "DIESEL", dateOfRegistration: "2014-03-27" },
      { outcome: "found", data: { registrationNumber: "P1ADD", make: "NISSAN MOTOR", colour: "SILVER", fuelType: "PETROL", taxStatus: "Taxed", monthOfFirstRegistration: "2014-03" } }, NOW);
    expect(update.make).toBeUndefined();
    expect(update.colour).toBeUndefined();
    expect(update.fuelType).toBeUndefined();
    expect(update.dateOfRegistration).toBeUndefined();
  });
});

describe("isSupersededRegistration", () => {
  it("spots GA4's renamed records so they are never looked up", () => {
    expect(isSupersededRegistration("241DK (05/11/18)")).toBe(true);
    expect(isSupersededRegistration("S8 BEP* (03/03/2023)")).toBe(true);
    expect(isSupersededRegistration("S31STK")).toBe(false);
    expect(isSupersededRegistration("EF13 FYN")).toBe(false);
  });
});
