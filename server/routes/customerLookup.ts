import { Router } from "express";
import { getDb } from "../db";
import { customers, vehicles } from "../../drizzle/schema";
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

    if (!vehicle.customerId) {
      // No owner linked yet — still return the vehicle so the client can offer to assign one.
      return res.json({ success: true, customer: null, vehicle });
    }

    // Get the customer
    const customerRecords = await db.select()
      .from(customers)
      .where(eq(customers.id, vehicle.customerId))
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
