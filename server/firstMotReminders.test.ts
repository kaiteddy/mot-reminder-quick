/**
 * First-MOT reminders for new cars. Pure: no database, no DVSA.
 */
import { describe, it, expect } from "vitest";
import { dvsaDate, firstMotFinding, reminderMotDate, runFirstMotCheck } from "./services/firstMotReminders";

const NOW = new Date("2026-09-11T09:00:00Z");

describe("dvsaDate", () => {
  it("reads every way DVSA writes a date", () => {
    expect(dvsaDate("2026-06-22")!.toISOString()).toBe("2026-06-22T00:00:00.000Z");
    expect(dvsaDate("2026.06.22 10:14:02")!.toISOString()).toBe("2026-06-22T00:00:00.000Z");
    expect(dvsaDate("22.06.2026")!.toISOString()).toBe("2026-06-22T00:00:00.000Z");
    expect(dvsaDate("")).toBeNull();
    expect(dvsaDate(null)).toBeNull();
  });
});

describe("firstMotFinding", () => {
  it("takes DVSA's first-MOT due date for a car never tested", () => {
    // BL23XYB as DVSA answered on 11/09/2026: registered 23/06/2023, first MOT due 22/06/2026, no tests.
    const f = firstMotFinding({ motTestDueDate: "2026-06-22", motTests: [] });
    expect(f).toEqual({ kind: "awaiting_first", due: new Date("2026-06-22T00:00:00Z") });
  });

  it("takes the latest pass expiry for a car already tested, whatever order the tests come in", () => {
    // MV11CTF: seven tests on DVSA, a pass valid to 01/04/2027, and no MOT expiry on file with us.
    const f = firstMotFinding({ motTests: [
      { testResult: "PASSED", expiryDate: "2026-04-01", completedDate: "2025-03-20T10:00:00Z" },
      { testResult: "FAILED", completedDate: "2026-03-18T10:00:00Z" },
      { testResult: "PASSED", expiryDate: "2027-04-01", completedDate: "2026-03-19T10:00:00Z" },
    ] });
    expect(f).toEqual({ kind: "tested", expiry: new Date("2027-04-01T00:00:00Z") });
  });

  it("treats a car that has only failed as tested with no MOT", () => {
    expect(firstMotFinding({ motTests: [{ testResult: "FAILED", completedDate: "2026-08-01" }] })).toEqual({ kind: "tested", expiry: null });
  });

  it("finds nothing when DVSA has no record or gives no date", () => {
    expect(firstMotFinding(null)).toEqual({ kind: "no_record" });
    expect(firstMotFinding({ motTests: [] })).toEqual({ kind: "no_record" });
  });
});

describe("reminderMotDate", () => {
  it("uses the real MOT expiry whenever there is one", () => {
    expect(reminderMotDate({ motExpiryDate: "2027-01-10", firstMotDue: "2026-10-01" })).toEqual({ motExpiryDate: new Date("2027-01-10"), firstMot: false });
  });
  it("falls back to the first-MOT due date for a car never tested, including one that is late", () => {
    expect(reminderMotDate({ motExpiryDate: null, firstMotDue: "2026-10-29" }, NOW)).toEqual({ motExpiryDate: new Date("2026-10-29"), firstMot: true });
    // BL23XYB: first MOT due 22/06/2026, still not done on 11/09/2026 — exactly who to chase.
    expect(reminderMotDate({ firstMotDue: "2026-06-22" }, NOW)).toEqual({ motExpiryDate: new Date("2026-06-22"), firstMot: true });
  });
  it("ignores a first MOT missed by more than two years: that car is off the road", () => {
    // EK08HYR: DVSA shows no test ever, first MOT due 30/03/2011.
    expect(reminderMotDate({ firstMotDue: "2011-03-30" }, NOW)).toEqual({ motExpiryDate: null, firstMot: false });
    expect(reminderMotDate({ firstMotDue: "2024-07-30" }, NOW)).toEqual({ motExpiryDate: null, firstMot: false });
  });
  it("gives nothing for a car with neither", () => {
    expect(reminderMotDate({})).toEqual({ motExpiryDate: null, firstMot: false });
  });
});

function fakeDb(candidates: any[]) {
  const writes: { text: string; params?: unknown[] }[] = [];
  const query = async (text: string, params?: unknown[]) => {
    if (/^\s*SELECT/i.test(text)) return { rows: candidates };
    writes.push({ text, params });
    return { rows: [], rowCount: 1 } as any;
  };
  return { query, writes };
}

describe("runFirstMotCheck", () => {
  const cars = [
    { id: 1, registration: "BL23XYB", customerId: 10, firstMotDue: null },
    { id: 2, registration: "LS73PWZ", customerId: 11, firstMotDue: null },
    { id: 3, registration: "MV11CTF", customerId: 12, firstMotDue: null },
    { id: 4, registration: "1497SM", customerId: 13, firstMotDue: null },
  ];
  const dvsa: Record<string, any> = {
    BL23XYB: { motTestDueDate: "2026-06-22", motTests: [] },
    LS73PWZ: { motTestDueDate: "2026-09-24", motTests: [] },
    MV11CTF: { motTests: [{ testResult: "PASSED", expiryDate: "2027-04-01" }] },
    "1497SM": null,
  };
  const lookup = async (reg: string) => dvsa[reg];

  it("reports without writing on a dry run", async () => {
    const db = fakeDb(cars);
    const s = await runFirstMotCheck(db.query, lookup, { apply: false, now: NOW });
    expect(db.writes).toHaveLength(0);
    expect(s).toMatchObject({ checked: 4, awaitingFirst: 2, overdue: 1, dueWithin60Days: 1, tested: 1, expiryFilled: 1, noRecord: 1, errors: 0 });
  });

  it("stores the due date, fills only a blank MOT expiry, and notes every question", async () => {
    const db = fakeDb(cars);
    await runFirstMotCheck(db.query, lookup, { apply: true, now: NOW });
    const [cleared, ...perCar] = db.writes;
    expect(cleared.text).toContain(`SET "firstMotDue" = NULL WHERE "motExpiryDate" IS NOT NULL`);
    expect(perCar).toHaveLength(4);
    expect(perCar[0].text).toContain(`"firstMotDue" = $2`);
    expect(perCar[0].params).toEqual([1, "2026-06-22T00:00:00.000Z", NOW.toISOString()]);
    expect(perCar[2].text).toContain(`COALESCE("motExpiryDate", $2`);
    expect(perCar[3].text).not.toContain(`"firstMotDue"`);
  });

  it("stops at once when DVSA refuses the key, instead of stamping every car as asked", async () => {
    const db = fakeDb(cars);
    const s = await runFirstMotCheck(db.query, async () => { throw new Error("Failed to get access token: Unauthorized"); }, { apply: true, now: NOW });
    expect(s.stopped).toMatch(/refused our key/);
    expect(s.checked).toBe(0);
    expect(db.writes.filter((w) => w.text.includes("firstMotCheckedAt"))).toHaveLength(0);
  });
});
