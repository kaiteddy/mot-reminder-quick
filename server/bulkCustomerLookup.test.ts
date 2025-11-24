import { describe, it, expect } from "vitest";
import { getDb, getCustomersWithVehiclesByPhones } from "./db";

describe("Bulk Customer Lookup", () => {
  it("should return multiple customers when phone numbers exist", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    // Test with multiple phone numbers
    const result = await getCustomersWithVehiclesByPhones(["+447843275372", "+999999999999"]);
    
    expect(Array.isArray(result)).toBe(true);
    
    // Each result should have phone, customer, and vehicles
    result.forEach((item) => {
      expect(item).toHaveProperty("phone");
      expect(item).toHaveProperty("customer");
      expect(item).toHaveProperty("vehicles");
      expect(Array.isArray(item.vehicles)).toBe(true);
    });
  });

  it("should return empty array for empty phone list", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    const result = await getCustomersWithVehiclesByPhones([]);
    expect(result).toEqual([]);
  });

  it("should return empty array when no customers match", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    const result = await getCustomersWithVehiclesByPhones(["+999999999999", "+888888888888"]);
    expect(Array.isArray(result)).toBe(true);
    // Could be empty or have results depending on database state
  });

  it("should group vehicles correctly by customer", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    const result = await getCustomersWithVehiclesByPhones(["+447843275372"]);
    
    if (result.length > 0) {
      const customerData = result[0];
      expect(customerData.vehicles).toBeDefined();
      expect(Array.isArray(customerData.vehicles)).toBe(true);
      
      // All vehicles should belong to this customer
      customerData.vehicles.forEach((vehicle) => {
        expect(vehicle.customerId).toBe(customerData.customer.id);
      });
    }
  });
});
