/**
 * One car's MOT refresh, as run from the MOT Reminders page ("Refresh Visible"). Pure.
 *
 * Adam ran it on 102 cars on 11/09/2026. It saved each MOT date and nothing else: tax status, the
 * "Updated" date and DVLA's answer never moved, so the page looked as if nothing had happened, and
 * the daily off-road check (which only acts on a fresh DVLA answer) could not use it. It now
 * records DVLA's answer exactly as the hourly refresh and the bulk check do
 * (server/services/dvlaRecord.ts), takes DVSA's latest pass for the MOT date, and gives a car that
 * has never been tested its first-MOT due date (server/services/firstMotReminders.ts).
 */
import type { DvlaLookup } from "../dvlaApi";
import { dvlaUpdateFor, type DvlaCurrent, type DvlaUpdate } from "./dvlaRecord";
import { firstMotFinding, type MotHistoryLike } from "./firstMotReminders";

export type MotRefreshUpdate = DvlaUpdate & { id: number; firstMotDue?: Date | null; firstMotCheckedAt?: Date };
export type MotRefreshResult = { success: boolean; motExpiryDate?: string; firstMot?: boolean; taxStatus?: string | null; error?: string };

/** `dvsa` is DVSA's answer — the history, or null for no record — or undefined when DVSA could not be asked. */
export function motRefreshFor(
  car: DvlaCurrent & { id: number },
  lookup: DvlaLookup,
  dvsa: MotHistoryLike | undefined,
  now: Date = new Date(),
): { update: MotRefreshUpdate; result: MotRefreshResult } {
  const { update: dvla } = dvlaUpdateFor(car, lookup, now);
  const update: MotRefreshUpdate = { id: car.id, ...dvla };
  let motExpiry: Date | null = dvla.motExpiryDate ?? null;
  let firstMotDue: Date | null = null;

  if (dvsa !== undefined) {
    update.firstMotCheckedAt = now;
    const f = firstMotFinding(dvsa);
    if (f.kind === "tested" && f.expiry) {
      // DVSA's latest pass beats DVLA's expiry, which lags a test done in the last few days.
      motExpiry = f.expiry;
      update.motExpiryDate = f.expiry;
      update.lastChecked = now;
    } else if (f.kind === "awaiting_first" && !motExpiry) {
      firstMotDue = f.due;
      update.firstMotDue = f.due;
    }
  }
  if (motExpiry) update.firstMotDue = null;

  const taxStatus = lookup.outcome === "found" ? (lookup.data?.taxStatus ?? null) : undefined;
  let result: MotRefreshResult;
  if (motExpiry) result = { success: true, motExpiryDate: motExpiry.toISOString(), taxStatus };
  else if (firstMotDue) result = { success: true, motExpiryDate: firstMotDue.toISOString(), firstMot: true, taxStatus };
  else if (lookup.outcome === "found") result = { success: false, error: "DVLA has the car but no MOT date: it may be exempt", taxStatus };
  else if (lookup.outcome === "not_found" || lookup.outcome === "invalid_plate") result = { success: false, error: "Neither DVLA nor DVSA has an MOT date for this plate" };
  else result = { success: false, error: `DVLA did not answer (${lookup.outcome.replace("_", " ")}), so the car was left as it was` };
  return { update, result };
}
