/**
 * The midnight MOT check: which run it is by the London clock, and what it reports. Pure: no database, no DVSA.
 */
import { describe, it, expect } from "vitest";
import { expiryCheckModeAt, expiryDayFor, runExpiryCheck, ukClock } from "./services/motExpiryCheck";

describe("which run it is, by the clock in London", () => {
  it("acts at 23:59 and 00:01 in British Summer Time, and skips the other UTC hour", () => {
    expect(expiryCheckModeAt(new Date("2026-09-14T22:59:00Z"))).toBe("last_day");   // 23:59 BST
    expect(expiryCheckModeAt(new Date("2026-09-14T23:59:00Z"))).toBeNull();         // 00:59 BST
    expect(expiryCheckModeAt(new Date("2026-09-14T23:01:00Z"))).toBe("day_after");  // 00:01 BST
    expect(expiryCheckModeAt(new Date("2026-09-15T00:01:00Z"))).toBeNull();         // 01:01 BST
  });

  it("acts at 23:59 and 00:01 in winter too", () => {
    expect(expiryCheckModeAt(new Date("2026-12-14T23:59:00Z"))).toBe("last_day");
    expect(expiryCheckModeAt(new Date("2026-12-14T22:59:00Z"))).toBeNull();
    expect(expiryCheckModeAt(new Date("2026-12-15T00:01:00Z"))).toBe("day_after");
    expect(expiryCheckModeAt(new Date("2026-12-14T23:01:00Z"))).toBeNull();
  });

  it("checks today's expiries at 23:59 and yesterday's at 00:01", () => {
    expect(ukClock(new Date("2026-09-14T23:01:00Z"))).toEqual({ day: "2026-09-15", hour: 0, minute: 1 });
    expect(expiryDayFor("last_day", new Date("2026-09-14T22:59:00Z"))).toBe("2026-09-14");
    expect(expiryDayFor("day_after", new Date("2026-09-14T23:01:00Z"))).toBe("2026-09-14");
    expect(expiryDayFor("day_after", new Date("2027-01-01T00:01:00Z"))).toBe("2026-12-31");
  });
});

describe("runExpiryCheck", () => {
  const query = async (_text: string, params?: unknown[]) => {
    expect(params?.[0]).toBe("2026-09-14");
    return { rows: [{ registration: "HJ14AJX" }, { registration: "EJ18BLF" }, { registration: "LS73PWZ" }] };
  };

  it("lists the plates without asking anyone on a dry run", async () => {
    let asked = false;
    const s = await runExpiryCheck(query, async () => { asked = true; return []; }, { mode: "day_after", apply: false, now: new Date("2026-09-14T23:01:00Z") });
    expect(asked).toBe(false);
    expect(s.plates).toEqual(["HJ14AJX", "EJ18BLF", "LS73PWZ"]);
  });

  it("tells a car tested elsewhere from one still out of MOT", async () => {
    const s = await runExpiryCheck(query, async (regs) => {
      expect(regs).toEqual(["HJ14AJX", "EJ18BLF", "LS73PWZ"]);
      return [
        { registration: "HJ14AJX", success: true, verified: true, motExpiryDate: "2027-09-14T00:00:00.000Z" },
        { registration: "EJ18BLF", success: true, verified: true, motExpiryDate: "2026-09-14T00:00:00.000Z" },
        { registration: "LS73PWZ", success: false, verified: false, error: "DVLA did not answer (rate limited), so the car was left as it was" },
      ];
    }, { mode: "day_after", apply: true, now: new Date("2026-09-14T23:01:00Z") });
    expect(s).toMatchObject({ day: "2026-09-14", checked: 3, renewed: 1, stillOut: 1, notAnswered: 1 });
  });
});
