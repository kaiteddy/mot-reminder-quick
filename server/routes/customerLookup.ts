import { Router } from "express";
import { getDb } from "../db";
import { customers, vehicles } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const customerLookupRouter = Router();

customerLookupRouter.get("/:registration", async (req, res) => {
  const { registration } = req.params;
  
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Try to find the vehicle by registration
    const vehicleRecords = await db.select()
      .from(vehicles)
      .where(eq(vehicles.registration, registration.toUpperCase()))
      .limit(1);
      
    if (vehicleRecords.length === 0) {
      return res.json({ success: true, customer: null });
    }
    
    const vehicle = vehicleRecords[0];
    
    if (!vehicle.customerId) {
      return res.json({ success: true, customer: null });
    }
    
    // Get the customer
    const customerRecords = await db.select()
      .from(customers)
      .where(eq(customers.id, vehicle.customerId))
      .limit(1);
      
    if (customerRecords.length === 0) {
      return res.json({ success: true, customer: null });
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
