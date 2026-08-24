import { Router } from "express";
import { getDb } from "../db";
import { customers, vehicles, serviceHistory } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

export const customerLookupRouter = Router();

customerLookupRouter.get("/:registration", async (req, res) => {
  const { registration } = req.params;
  
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Find the vehicle space-insensitively — GA4 stores regs with a space ("LT18 DTU"),
    // so an exact match against "LT18DTU" misses and the owner never shows.
    const cleanReg = String(registration).toUpperCase().replace(/\s/g, "");
    const vehicleRecords = await db.select()
      .from(vehicles)
      .where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${cleanReg}`)
      .limit(1);
      
    if (vehicleRecords.length === 0) {
      return res.json({ success: true, customer: null });
    }

    const vehicle = vehicleRecords[0];

    // The owner can be missing from the vehicle row itself: records created by a
    // DVLA/tech-data lookup arrive with the solid, no-space reg and no customerId,
    // and the GA4 customer link only lives on that reg's service history (keyed on
    // the spaced form). Without this fallback such a car reports "no customer" even
    // though its history unambiguously names the owner — the PE59OFH case. So when
    // the vehicle has no customerId, resolve it from the most recent service-history
    // doc for the same normalized reg, and self-heal the vehicle row for next time.
    let resolvedCustomerId = vehicle.customerId;
    if (!resolvedCustomerId) {
      const [histOwner] = await db.select({ customerId: serviceHistory.customerId })
        .from(serviceHistory)
        .where(sql`REPLACE(UPPER(${serviceHistory.registration}), ' ', '') = ${cleanReg} AND ${serviceHistory.customerId} IS NOT NULL`)
        .orderBy(sql`${serviceHistory.dateCreated} DESC NULLS LAST`)
        .limit(1);
      resolvedCustomerId = histOwner?.customerId ?? null;
      if (resolvedCustomerId) {
        // Best-effort backfill so the lookup is O(1) next time; never block the response on it.
        db.update(vehicles).set({ customerId: resolvedCustomerId }).where(eq(vehicles.id, vehicle.id))
          .catch((e: any) => console.error("customerLookup: vehicle backfill failed:", e?.message));
      }
    }

    if (!resolvedCustomerId) {
      // No owner linked or resolvable — still return the vehicle so the client can offer to assign one.
      return res.json({ success: true, customer: null, vehicle });
    }

    // Get the customer
    const customerRecords = await db.select()
      .from(customers)
      .where(eq(customers.id, resolvedCustomerId))
      .limit(1);

    if (customerRecords.length === 0) {
      return res.json({ success: true, customer: null, vehicle });
    }
    
    // We could potentially format the data nicely here
    res.json({ 
      success: true, 
      customer: customerRecords[0],
      vehicle: vehicle
    });

  } catch (err: any) {
    console.error("Failed to lookup customer:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
