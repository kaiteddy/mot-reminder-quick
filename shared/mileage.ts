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
