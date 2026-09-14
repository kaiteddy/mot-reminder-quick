/**
 * Refresh plates' MOT and tax from DVLA and DVSA, four at a time, and write what they say onto every
 * car with that plate (server/services/motRefresh.ts decides what is written). The one refresh path:
 * "Refresh Visible" (reminders.bulkVerifyMOT) and the midnight MOT check
 * (server/services/motExpiryCheck.ts) both run it, so a car is recorded the same way whichever asked.
 */
export type PlateResult = {
  registration: string;
  success: boolean;
  verified: boolean;
  motExpiryDate?: string;
  firstMot?: boolean;
  taxStatus?: string | null;
  error?: string;
};

export async function refreshPlates(registrations: string[], opts: { concurrency?: number } = {}): Promise<PlateResult[]> {
  const { getDb, bulkUpdateVehicleMOT } = await import("../db");
  const { lookupVehicle } = await import("../dvlaApi");
  const { getMOTHistory } = await import("../motApi");
  const { isSupersededRegistration } = await import("./dvlaRecord");
  const { motRefreshFor } = await import("./motRefresh");
  const { vehicles } = await import("../../drizzle/schema");
  const { sql, inArray } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const norm = (r: string) => String(r || "").replace(/\s+/g, "").toUpperCase();
  const wanted = Array.from(new Set(registrations.map(norm).filter(Boolean)));
  const rows = wanted.length
    ? await db.select({
        id: vehicles.id, registration: vehicles.registration, make: vehicles.make, colour: vehicles.colour,
        fuelType: vehicles.fuelType, dateOfRegistration: vehicles.dateOfRegistration,
      }).from(vehicles).where(inArray(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '')`, wanted))
    : [];
  const carsByReg = new Map<string, typeof rows>();
  for (const row of rows) carsByReg.set(norm(row.registration), [...(carsByReg.get(norm(row.registration)) || []), row]);

  const refreshPlate = async (reg: string): Promise<PlateResult> => {
    const cars = carsByReg.get(reg) || [];
    try {
      // GA4's renamed record: its plate is on another car now, so never look it up.
      if (isSupersededRegistration(reg)) {
        if (cars.length) await bulkUpdateVehicleMOT(cars.map((c) => ({ id: c.id, lastChecked: new Date(), dvlaStatus: "superseded" })));
        return { registration: reg, success: false, verified: false, error: "This plate has moved to another car, so it was not checked" };
      }
      let lookup = await lookupVehicle(reg);
      if (lookup.outcome === "rate_limited") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        lookup = await lookupVehicle(reg);
      }
      let dvsa: any; // undefined = DVSA could not be asked; null = DVSA has no record
      try { dvsa = await getMOTHistory(reg); } catch (e: any) { console.error(`[MOT-REFRESH] DVSA failed for ${reg}:`, e?.message || e); }
      const now = new Date();
      const outcomes = (cars.length ? cars : [{ id: 0 }]).map((c) => motRefreshFor(c, lookup, dvsa, now));
      const writes = cars.length ? outcomes.map((o) => o.update).filter((u) => Object.keys(u).length > 1) : [];
      if (writes.length) await bulkUpdateVehicleMOT(writes);
      const result = outcomes[0].result;
      console.log(`[MOT-REFRESH] ${reg}: DVLA ${lookup.outcome}, DVSA ${dvsa === undefined ? "unavailable" : dvsa ? "answered" : "no record"} → ${result.success ? `${result.firstMot ? "first MOT due" : "MOT expires"} ${result.motExpiryDate?.slice(0, 10)}${result.taxStatus ? `, ${result.taxStatus}` : ""}` : result.error}`);
      return { registration: reg, verified: result.success, ...result };
    } catch (error: any) {
      return { registration: reg, success: false, verified: false, error: error?.message || "Failed to verify MOT" };
    }
  };

  const results: PlateResult[] = new Array(wanted.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, wanted.length) }, async () => {
    while (next < wanted.length) {
      const i = next++;
      results[i] = await refreshPlate(wanted[i]);
    }
  }));
  const refreshedCount = results.filter((r) => r.success).length;
  console.log(`[MOT-REFRESH] ${wanted.length} plates: ${refreshedCount} refreshed, ${wanted.length - refreshedCount} not`);
  return results;
}
