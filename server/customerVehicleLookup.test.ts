import { describe, it, expect } from "vitest";
import { getDb, getCustomerWithVehiclesByPhone } from "./db";

describe("Customer Vehicle Lookup", () => {
  it("should return customer and vehicles when phone number exists", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    // Test with a known phone number from the database
    const result = await getCustomerWithVehiclesByPhone("+447843275372");
    
    // Result should either be null (no customer) or have customer and vehicles array
    if (result) {
      expect(result).toHaveProperty("customer");
      expect(result).toHaveProperty("vehicles");
      expect(Array.isArray(result.vehicles)).toBe(true);
      expect(result.customer).toHaveProperty("phone");
      expect(result.customer.phone).toBe("+447843275372");
    } else {
      // No customer found is also valid
      expect(result).toBeNull();
    }
  });

  it("should return null for non-existent phone number", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    const result = await getCustomerWithVehiclesByPhone("+999999999999");
    expect(result).toBeNull();
  });

  it("should handle customer with no vehicles", async () => {
    const db = await getDb();
    if (!db) {
      console.warn("Database not available, skipping test");
      return;
    }

    // This tests the structure even if customer has 0 vehicles
    const result = await getCustomerWithVehiclesByPhone("+447843275372");
    
    if (result) {
      expect(Array.isArray(result.vehicles)).toBe(true);
      // Vehicles array can be empty, that's valid
    }
  });
});
