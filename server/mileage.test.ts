/**
 * What counts as an odometer reading. The placeholders here are the real ones: 453 invoices
 * between 2011 and 2026 carry "1" or "10" because the field wanted a number and the reading
 * could not be taken.
 */
import { describe, it, expect } from "vitest";
import { odometerReading, isPlaceholderReading } from "../shared/mileage";

describe("odometerReading", () => {
  it("keeps real readings, however they are typed", () => {
    expect(odometerReading(36323)).toBe(36323);
    expect(odometerReading("36,323")).toBe(36323);
    expect(odometerReading(" 36323 mi")).toBe(36323);
    expect(odometerReading(2)).toBe(2);           // no other reading on file: could be delivery miles
  });

  it("treats the stand-ins as not recorded", () => {
    for (const v of [0, 1, 10, "1", "10", "", null, undefined, -5]) expect(odometerReading(v), String(v)).toBeNull();
  });

  it("a tiny figure on a car we know has done miles is a stand-in too", () => {
    expect(odometerReading(25, 60000)).toBeNull();     // Mrs Duboff-style: 25 against 60,000 on file
    expect(odometerReading(123, 52691)).toBeNull();
    expect(odometerReading(25, null)).toBe(25);        // nothing else on file: leave it alone
    expect(odometerReading(2500, 60000)).toBe(2500);   // low but plausible, not a placeholder
  });

  it("flags a stand-in for the UI without changing it", () => {
    expect(isPlaceholderReading("10")).toBe(true);
    expect(isPlaceholderReading("36323")).toBe(false);
    expect(isPlaceholderReading("")).toBe(false);      // blank is already "not recorded"
  });
});
