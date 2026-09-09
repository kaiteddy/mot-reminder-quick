/**
 * What counts as a real odometer reading.
 *
 * When the reading cannot be taken — the car is in on a recovery truck, the dash is dead, nobody
 * looked — the field still wanted a number, so a placeholder went in. In this garage's data that
 * placeholder is almost always "1" or "10": 453 invoices carry one, from March 2011 to August
 * 2026, sitting between readings in the tens of thousands. They are not readings, and treating
 * them as such makes a car's history appear to go backwards, drags down the mileage the job sheet
 * prints, and breaks any judgement about whether two records are the same car.
 *
 * So the rule is: a reading is a reading, or it is "not recorded". Never a stand-in number.
 * `null` is what the app already prints as "Not recorded", so that is what these become.
 */

/** Placeholders typed to get past a field that wanted a number. */
const PLACEHOLDERS = new Set([0, 1, 10]);

/**
 * A mileage figure, or null when it is not a real reading.
 *
 * `knownHigher` is the highest reading the same car has elsewhere: when it exists, anything under
 * 200 miles is a placeholder too, since a car with 60,000 miles on file did not arrive on 25. On
 * its own, a low figure is left alone — a genuinely new car really can come in on delivery miles.
 */
export function odometerReading(value: unknown, knownHigher?: number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (PLACEHOLDERS.has(n)) return null;
  if (n <= 200 && (knownHigher ?? 0) > 5000) return null;
  return n;
}

/** True when this figure is a stand-in rather than a reading — for warning in the UI. */
export const isPlaceholderReading = (value: unknown, knownHigher?: number | null): boolean =>
  value !== null && value !== undefined && String(value).trim() !== "" && odometerReading(value, knownHigher) === null;

/**
 * Where a car was swapped underneath a plate.
 *
 * A private plate follows its owner, not the car: they sell one, buy another, move the plate
 * across, and every job carries on under the same registration. The record is right — it is that
 * plate's history — but it spans two cars, and the join shows up as the one thing an odometer
 * cannot do: a later job reading far lower than an earlier one. Mr Kass's CR-V climbs to 45,221
 * miles by 2016, then a pre-sales check in 2017 reads 24,435 and it climbs again.
 *
 * A falling reading on its own proves nothing, though. Across this garage's history 445 jobs read
 * lower than the one before, and reading them back, almost every one is a figure typed wrong — a
 * Mazda3 reading 20,000 then 11,900, an Abarth reading 45,611 between 25,173 and 31,092. So two
 * things have to hold before a fall counts as a different car:
 *
 *   1. It is a step off the whole line, not a dip below one figure — the reading is at least
 *      `minDrop` below the LOWEST of at least two readings already on file, which a mistyped
 *      spike can never be, and which a guessed first reading has nothing to step down from.
 *   2. The job after it carries on from the new figure: at or above it, and still below where the
 *      old car had got to. A typo is a lone outlier; a car has a history of its own after it.
 *
 * That takes 445 down to 92. The caller supplies the third test — see
 * getServiceHistoryByVehicleId, which only asks this question of a record whose chassis number
 * also sits on another record, the signature of a plate that has moved. All three together leave
 * 17 changeovers, every one of them on a private plate.
 *
 * Give it documents with a date and a mileage and it returns the id of each job where a different
 * car starts, so the history can say so instead of looking like a mistake. Readings that were
 * never really readings are ignored — see odometerReading.
 */
export function carChangePoints<T>(
  docs: T[],
  read: (d: T) => { id: string | number; date: string | number | Date | null; miles: unknown },
  minDrop = 5000,
): Map<string | number, { from: number; to: number }> {
  const out = new Map<string | number, { from: number; to: number }>();
  const points = docs
    .map((d) => { const r = read(d); return { id: r.id, at: r.date ? new Date(r.date).getTime() : 0, miles: odometerReading(r.miles) }; })
    .filter((p) => p.miles !== null && p.at > 0)
    .sort((a, b) => a.at - b.at) as { id: string | number; at: number; miles: number }[];

  let floor = Infinity;      // the lowest this car's line has been
  let peak = -Infinity;      // and the highest, which is what the reader wants to be told
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // i >= 2: the old car has to have a LINE behind it, not one figure. Where the very first
    // reading was a guess (a Mazda3 written up at 20,000, then 11,900 and climbing from there),
    // there is nothing yet to have stepped down from.
    if (i >= 2 && p.miles <= floor - minDrop) {
      const next = points[i + 1];
      if (next && next.miles >= p.miles && next.miles < peak) {
        out.set(p.id, { from: peak, to: p.miles });
        floor = p.miles;     // the line restarts here, or every later job on the new car reads
        peak = p.miles;      // "low" against the old car's figures too
      }
      continue;              // a fall nothing confirms is a figure typed wrong; leave the line be
    }
    floor = Math.min(floor, p.miles);
    peak = Math.max(peak, p.miles);
  }
  return out;
}
