import { describe, it, expect } from "vitest";
import { readUsage, makeUsage, compactUsage, describeUsage } from "../shared/partUsage";

/**
 * Splitting a part line between fitted, returned and spare.
 *
 * The case this exists for is Adam's original ask: four filters bought, three fitted, one going
 * back. A single state per product code has to round that to all-or-nothing, and either way it
 * rounds is wrong — the customer is charged for four, or the credit on the fourth is lost.
 */
describe("readUsage", () => {
  it("treats a bare state as covering the WHOLE line", () => {
    // What the existing UI meant by it. Reading it any other way would silently change the meaning
    // of every row already stored.
    expect(readUsage("fitted", 4)).toMatchObject({ fitted: 4, returned: 0, spare: 0, state: "fitted" });
    expect(readUsage("returned", 2)).toMatchObject({ returned: 2, state: "returned" });
  });

  it("reads a split and reports it as part-decided", () => {
    expect(readUsage({ fitted: 3, returned: 1 }, 4)).toMatchObject({
      fitted: 3, returned: 1, spare: 0, undecided: 0, state: "part",
    });
  });

  it("counts what has not been decided yet", () => {
    expect(readUsage({ fitted: 1 }, 4)).toMatchObject({ fitted: 1, undecided: 3, state: "part" });
    expect(readUsage(null, 4)).toMatchObject({ undecided: 4, state: null });
  });

  it("does not report a line as fully fitted while some is undecided", () => {
    // 1 of 4 fitted is not "fitted" — calling it that would take the line off the to-do list with
    // three parts still unaccounted for.
    expect(readUsage({ fitted: 1 }, 4).state).toBe("part");
    expect(readUsage({ fitted: 4 }, 4).state).toBe("fitted");
  });

  it("survives rubbish in the stored value", () => {
    expect(readUsage({ fitted: -3 } as any, 2)).toMatchObject({ fitted: 0, undecided: 2 });
    expect(readUsage({ fitted: "two" } as any, 2)).toMatchObject({ fitted: 0 });
  });
});

describe("makeUsage", () => {
  it("never lets more be accounted for than was bought", () => {
    // Over-claiming credits stock that was never ordered, or charges for parts never delivered.
    expect(makeUsage({ fitted: 9 }, 4)).toEqual({ fitted: 4, returned: 0, spare: 0 });
    expect(makeUsage({ fitted: 3, returned: 9 }, 4)).toEqual({ fitted: 3, returned: 1, spare: 0 });
    expect(makeUsage({ fitted: 2, returned: 2, spare: 5 }, 4)).toEqual({ fitted: 2, returned: 2, spare: 0 });
  });

  it("clears the row when nothing is decided", () => {
    expect(makeUsage({}, 4)).toBeNull();
    expect(makeUsage({ fitted: 0, returned: 0 }, 4)).toBeNull();
  });
});

describe("compactUsage", () => {
  it("writes exactly what the old code wrote when the line is all one thing", () => {
    // Keeps the stored shape as small and as familiar as it was.
    expect(compactUsage({ fitted: 4, returned: 0, spare: 0 }, 4)).toBe("fitted");
    expect(compactUsage({ fitted: 0, returned: 1, spare: 0 }, 1)).toBe("returned");
  });

  it("keeps the numbers when the line is split", () => {
    expect(compactUsage({ fitted: 3, returned: 1, spare: 0 }, 4)).toEqual({ fitted: 3, returned: 1, spare: 0 });
  });

  it("round-trips a split without losing anything", () => {
    const stored = compactUsage(makeUsage({ fitted: 3, returned: 1 }, 4), 4);
    expect(readUsage(stored, 4)).toMatchObject({ fitted: 3, returned: 1, undecided: 0 });
  });

  it("round-trips a whole line through the old string shape", () => {
    const stored = compactUsage(makeUsage({ fitted: 4 }, 4), 4);
    expect(stored).toBe("fitted");
    expect(readUsage(stored, 4)).toMatchObject({ fitted: 4, state: "fitted" });
  });
});

describe("describeUsage", () => {
  it("spells out a split in words somebody can act on", () => {
    expect(describeUsage(readUsage({ fitted: 3, returned: 1 }, 4))).toBe("3 fitted · 1 to return");
  });

  it("says what is still outstanding", () => {
    expect(describeUsage(readUsage({ fitted: 1 }, 4))).toBe("1 fitted · 3 not decided");
  });

  it("stays a single word when the line is a single thing", () => {
    expect(describeUsage(readUsage("fitted", 4))).toBe("fitted");
    expect(describeUsage(readUsage(null, 4))).toBe("not decided");
  });
});
