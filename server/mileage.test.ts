/**
 * What counts as an odometer reading. The placeholders here are the real ones: 453 invoices
 * between 2011 and 2026 carry "1" or "10" because the field wanted a number and the reading
 * could not be taken.
 */
import { describe, it, expect } from "vitest";
import { odometerReading, isPlaceholderReading, carChangePoints, mileageOutliers } from "../shared/mileage";

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

describe("carChangePoints", () => {
  const doc = (id: number, date: string, miles: number | null) => ({ id, date, miles });

  it("finds where the plate moved onto a different car", () => {
    // Mr Kass's CR-V, as it actually reads: climbs to 45,221, then a pre-sales check at 24,435.
    const docs = [
      doc(1, "2011-07-17", 30000), doc(2, "2013-06-02", 33000), doc(3, "2016-12-19", 45221),
      doc(4, "2017-08-08", 24435), doc(5, "2019-08-04", 34430), doc(6, "2026-08-12", 67688),
    ];
    const marks = carChangePoints(docs, (d) => d);
    expect([...marks.keys()]).toEqual([4]);
    expect(marks.get(4)).toEqual({ from: 45221, to: 24435 });
  });

  it("leaves an ordinary history alone, whatever order it arrives in", () => {
    const docs = [doc(3, "2026-08-12", 67688), doc(1, "2011-07-17", 30000), doc(2, "2019-08-04", 34430)];
    expect(carChangePoints(docs, (d) => d).size).toBe(0);
  });

  it("ignores stand-in readings rather than calling them a new car", () => {
    // 2DLU: 33,491 then "10" then 34,858 — one bad figure, one car.
    const docs = [doc(1, "2018-03-05", 33491), doc(2, "2018-12-18", 10), doc(3, "2019-03-12", 34858)];
    expect(carChangePoints(docs, (d) => d).size).toBe(0);
  });

  it("does not call a normal service interval a change of car", () => {
    const docs = [doc(1, "2024-01-01", 40000), doc(2, "2025-01-01", 44000), doc(3, "2026-01-01", 48000)];
    expect(carChangePoints(docs, (d) => d).size).toBe(0);
  });

  it("a mistyped figure is a dip, not a different car", () => {
    // KD19GWU as it really reads: 45,611 sits between 25,173 and 31,092. The job after the drop
    // goes straight back onto the old line, so the odd figure was typed wrong, not a new car.
    const docs = [
      doc(1, "2021-11-01", 15924), doc(2, "2022-06-01", 20827), doc(3, "2023-01-01", 25173),
      doc(4, "2023-06-01", 45611), doc(5, "2023-12-01", 31092), doc(6, "2025-11-01", 42000),
    ];
    expect(carChangePoints(docs, (d) => d).size).toBe(0);
  });

  it("a figure typed high is not a change of car either", () => {
    // GX65WHG: a guessed 20,000 at the first visit, then the real line from 11,900 upwards.
    const docs = [
      doc(1, "2018-02-01", 20000), doc(2, "2018-06-01", 11900), doc(3, "2018-12-01", 13009),
      doc(4, "2019-07-01", 14486), doc(5, "2020-12-01", 16055),
    ];
    expect(carChangePoints(docs, (d) => d).size).toBe(0);
  });

  it("will not call the very last reading a different car", () => {
    // Nothing follows it, so nothing confirms it — a low final figure is more often a typo.
    const docs = [doc(1, "2024-01-01", 40000), doc(2, "2025-01-01", 44000), doc(3, "2026-01-01", 12000)];
    expect(carChangePoints(docs, (d) => d).size).toBe(0);
  });
});

describe("mileageOutliers", () => {
  const doc = (id: number, date: string, miles: number | null) => ({ id, date, miles });

  it("names the one figure that cannot be true", () => {
    // KD19GWU: 45,611 sits between 25,173 and 31,092. An odometer does not do that.
    const docs = [
      doc(1, "2021-11-01", 15924), doc(2, "2022-06-01", 20827), doc(3, "2023-01-01", 25173),
      doc(4, "2023-06-01", 45611), doc(5, "2023-12-01", 31092), doc(6, "2025-11-01", 42000),
    ];
    const bad = mileageOutliers(docs, (d) => d);
    expect([...bad.keys()]).toEqual([4]);
    expect(bad.get(4)).toEqual({ reading: 45611, before: 25173, after: 31092 });
  });

  it("blames the odd figure, not the ordinary ones either side of it", () => {
    // EO14BLF: 86,385 between 46,835 and 49,662 — the spike is wrong, the neighbours are fine.
    const docs = [
      doc(1, "2020-01-01", 40000), doc(2, "2021-01-01", 46835),
      doc(3, "2021-06-01", 86385), doc(4, "2022-01-01", 49662), doc(5, "2023-01-01", 55000),
    ];
    expect([...mileageOutliers(docs, (d) => d).keys()]).toEqual([3]);
  });

  it("catches the same wrong figure entered twice", () => {
    // EU16ZRA: 22,156 on two June 2023 jobs, between 51,022 and 54,954.
    const docs = [
      doc(1, "2023-01-01", 48886), doc(2, "2023-06-01", 51022), doc(3, "2023-06-10", 22156),
      doc(4, "2023-06-11", 22156), doc(5, "2024-03-01", 54954), doc(6, "2025-08-01", 62192),
    ];
    expect([...mileageOutliers(docs, (d) => d).keys()].sort()).toEqual([3, 4]);
  });

  it("leaves a clean history alone", () => {
    const docs = [doc(1, "2024-01-01", 40000), doc(2, "2025-01-01", 44000), doc(3, "2026-01-01", 48000)];
    expect(mileageOutliers(docs, (d) => d).size).toBe(0);
  });

  it("lets a small fall pass — a rounded figure is not a mistake worth chasing", () => {
    const docs = [doc(1, "2024-01-01", 40000), doc(2, "2025-01-01", 44000), doc(3, "2025-06-01", 43378), doc(4, "2026-01-01", 48000)];
    expect(mileageOutliers(docs, (d) => d).size).toBe(0);
  });

  it("will not call a run of jobs typing mistakes — that is another car", () => {
    // M17MEA: six jobs from 31,254 to 41,041 sitting under a 116,150 line. Those are readings,
    // not errors; the record has simply not been told it holds two cars.
    const docs = [
      doc(1, "2015-01-01", 74539), doc(2, "2016-01-01", 74741), doc(3, "2017-01-01", 116150),
      doc(4, "2018-01-01", 31254), doc(5, "2019-01-01", 34251), doc(6, "2020-01-01", 36137),
      doc(7, "2021-01-01", 38253), doc(8, "2022-01-01", 41041),
    ];
    expect(mileageOutliers(docs, (d) => d).size).toBe(0);
  });

  it("says nothing about a figure the history does not close around", () => {
    // Nothing on the line after it, so there is no second opinion — only a history that stops.
    const docs = [doc(1, "2024-01-01", 40000), doc(2, "2025-01-01", 44000), doc(3, "2026-01-01", 12000)];
    expect(mileageOutliers(docs, (d) => d).size).toBe(0);
  });

  it("measures each car against its own line where the plate moved", () => {
    // Mr Kass's record: the 2017 restart is a different car, not a wrong figure.
    const docs = [
      doc(1, "2011-07-17", 30000), doc(2, "2013-06-02", 33000), doc(3, "2016-12-19", 45221),
      doc(4, "2017-08-08", 24435), doc(5, "2018-08-06", 29534), doc(6, "2019-08-04", 34430),
      doc(7, "2026-08-12", 67688),
    ];
    const changes = carChangePoints(docs, (d) => d);
    expect([...changes.keys()]).toEqual([4]);
    expect(mileageOutliers(docs, (d) => d, new Set(changes.keys())).size).toBe(0);
  });
});
