/**
 * Turn one DVLA answer into the update for one vehicle. Pure, and shared by the hourly refresh,
 * the manual bulk check and the whole-database scan so they cannot drift apart again.
 *
 * What was wrong before (found 10/09/2026 scanning all 11,493 cars):
 *   - When DVLA answered with no MOT expiry, the whole answer was thrown away. That is every new
 *     car before its first MOT, so new cars never got a tax status — and a new car declared SORN
 *     could never be seen.
 *   - "Checked" was stamped whether DVLA answered, said it had no record, rejected our key or
 *     rate-limited us. So a car could look freshly checked while holding months-old data, and
 *     4,071 cars looked checked while holding nothing at all.
 *
 * Now: `dvlaAnsweredAt` moves only when DVLA really answered (a record, or "no record of this
 * plate"), and `dvlaStatus` says which. `lastChecked` still moves on those and on a plate that is
 * not a valid format (we will never ask about it), so the refresh keeps working through the list;
 * it does NOT move on a rejected key, rate limit or outage, so those cars stay due.
 */
import type { DvlaLookup } from "../dvlaApi";

export type DvlaCurrent = {
  make?: string | null; colour?: string | null; fuelType?: string | null; dateOfRegistration?: Date | string | null;
};

export type DvlaUpdate = {
  lastChecked?: Date;
  dvlaAnsweredAt?: Date;
  dvlaStatus?: "found" | "not_found" | "invalid_plate" | "superseded";
  motExpiryDate?: Date;
  taxStatus?: string | null;
  taxDueDate?: Date | null;
  make?: string;
  colour?: string;
  fuelType?: string;
  dateOfRegistration?: Date;
};

/**
 * GA4 renames a record when its plate moves to another car ("241DK (05/11/18)", "S8 BEP* (03/03/2023)").
 * Looking up that plate would return the car wearing it TODAY and write it onto the old one —
 * the mistake that once turned a Mini into a Tesla. Such records are never looked up.
 */
export const isSupersededRegistration = (reg?: string | null) => /[*(]/.test(String(reg || ""));

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

export function dvlaUpdateFor(current: DvlaCurrent, r: DvlaLookup, now: Date = new Date()): { update: DvlaUpdate; answered: boolean } {
  if (r.outcome === "not_found") {
    return { update: { lastChecked: now, dvlaAnsweredAt: now, dvlaStatus: "not_found" }, answered: true };
  }
  if (r.outcome === "invalid_plate") {
    return { update: { lastChecked: now, dvlaStatus: "invalid_plate" }, answered: false };
  }
  if (r.outcome !== "found" || !r.data) {
    return { update: {}, answered: false };  // key rejected, rate limited, outage: leave the car due
  }

  const d = r.data;
  const u: DvlaUpdate = {
    lastChecked: now,
    dvlaAnsweredAt: now,
    dvlaStatus: "found",
    taxStatus: d.taxStatus ?? null,
    taxDueDate: d.taxDueDate ? new Date(d.taxDueDate) : null,
  };
  // A new car has no MOT expiry yet ("No details held by DVLA"); never blank one we already hold.
  if (d.motExpiryDate) u.motExpiryDate = new Date(d.motExpiryDate);
  // DVLA's descriptive fields only fill gaps: GA4 and UKVD usually hold something better.
  if (d.make && blank(current.make)) u.make = d.make;
  if (d.colour && blank(current.colour)) u.colour = d.colour;
  if (d.fuelType && blank(current.fuelType)) u.fuelType = d.fuelType;
  if (blank(current.dateOfRegistration) && /^\d{4}-\d{2}$/.test(String(d.monthOfFirstRegistration || ""))) {
    u.dateOfRegistration = new Date(`${d.monthOfFirstRegistration}-01T00:00:00Z`);
  }
  return { update: u, answered: true };
}
