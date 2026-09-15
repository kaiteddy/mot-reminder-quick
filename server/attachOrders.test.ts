import { describe, it, expect } from "vitest";
import { optionLabel, money, shortDate } from "../shared/attachOrders";

/**
 * The dropdown's wording.
 *
 * These strings are read by whoever is booking parts in against a job, often on a handheld, so
 * they are tested like any other behaviour rather than left to drift.
 */
describe("parts order labels", () => {
  const base = {
    supplier: "ECP",
    ref: "311-00005706664",
    orderedAt: "2026-09-10T09:52:44.000Z",
    netTotal: 53.46,
    lineCount: 4,
  };

  it("reads in the order somebody scans it", () => {
    // Cost first: that is what identifies the order to the person choosing. The supplier's
    // reference goes last, because it identifies the order to Euro Car Parts, not to us.
    expect(optionLabel(base)).toBe("£53.46 · ECP · 10 Sep · 4 parts · 311-00005706664");
  });

  it("says '1 part', not '1 parts'", () => {
    expect(optionLabel({ ...base, lineCount: 1 })).toContain("1 part ·");
  });

  it("never leaves a blank where a total or a date should be", () => {
    const label = optionLabel({ ...base, netTotal: null, orderedAt: null });
    expect(label).toContain("—");
    expect(label).toContain("no date");
  });

  it("keeps the number plate out of the row", () => {
    // The list sits next to the job, which already shows the car. Repeating the plate on every
    // row spreads it across screens and logs for nothing.
    expect(optionLabel(base)).not.toMatch(/[A-Z]{2}\d{2}\s?[A-Z]{3}/);
  });

  it("formats the month the same everywhere", () => {
    // toLocaleDateString's short month is "Sep" in a browser and "Sept" under Node's ICU, which
    // would make the server and the client disagree about the same order.
    expect(shortDate("2026-09-10T00:00:00.000Z")).toBe("10 Sep");
    expect(shortDate("2026-01-05T00:00:00.000Z")).toBe("05 Jan");
    expect(shortDate("not a date")).toBe("no date");
    expect(shortDate(null)).toBe("no date");
  });

  it("shows money to the penny", () => {
    expect(money(4.4)).toBe("£4.40");
    expect(money(0)).toBe("£0.00");
    expect(money(null)).toBe("—");
  });
});
