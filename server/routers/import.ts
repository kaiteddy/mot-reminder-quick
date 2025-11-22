import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { 
  parseCSV, 
  type GA4Customer, 
  type GA4Vehicle, 
  type GA4Reminder,
  type GA4ReminderTemplate,
  mapReminderType,
  parseGA4Date,
  isReminderActioned,
  getReminderActionedInfo,
  buildCustomerName,
  buildAddress,
  getPhoneNumber,
} from "../services/csv-import";

export const importRouter = router({
  /**
   * Import customers from GA4 CSV
   */
  importCustomers: publicProcedure
    .input(z.object({
      csvData: z.string(), // Base64 encoded CSV data
    }))
    .mutation(async ({ input }) => {
      const { createCustomer, getCustomerByExternalId } = await import("../db");
      
      // Decode base64 and parse CSV
      const buffer = Buffer.from(input.csvData.split(',')[1], 'base64');
      const customers = parseCSV<GA4Customer>(buffer);
      
      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const errors: string[] = [];
      
      for (const ga4Customer of customers) {
        try {
          // Check if customer already exists
          const existing = await getCustomerByExternalId(ga4Customer._ID);
          
          const customerData = {
            name: buildCustomerName(ga4Customer),
            email: ga4Customer.contactEmail || null,
            phone: getPhoneNumber(ga4Customer),
            externalId: ga4Customer._ID,
            address: buildAddress(ga4Customer),
            postcode: ga4Customer.addressPostCode || null,
            notes: ga4Customer.Notes || null,
          };
          
          if (existing) {
            // Update existing customer
            // TODO: Add update customer function
            updated++;
          } else {
            // Create new customer
            await createCustomer(customerData);
            imported++;
          }
        } catch (error: any) {
          errors.push(`Customer ${ga4Customer._ID}: ${error.message}`);
          skipped++;
        }
      }
      
      return {
        total: customers.length,
        imported,
        updated,
        skipped,
        errors,
      };
    }),

  /**
   * Import vehicles from GA4 CSV
   */
  importVehicles: publicProcedure
    .input(z.object({
      csvData: z.string(), // Base64 encoded CSV data
      enrichWithDVLA: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const { createVehicle, getVehicleByExternalId, getCustomerByExternalId } = await import("../db");
      const { getVehicleDetails } = await import("../dvlaApi");
      
      // Decode base64 and parse CSV
      const buffer = Buffer.from(input.csvData.split(',')[1], 'base64');
      const vehicles = parseCSV<GA4Vehicle>(buffer);
      
      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const errors: string[] = [];
      
      for (const ga4Vehicle of vehicles) {
        try {
          if (!ga4Vehicle.Registration) {
            skipped++;
            continue;
          }
          
          // Check if vehicle already exists
          const existing = await getVehicleByExternalId(ga4Vehicle._ID);
          
          // Find customer by external ID
          let customerId: number | null = null;
          if (ga4Vehicle._ID_Customer) {
            const customer = await getCustomerByExternalId(ga4Vehicle._ID_Customer);
            customerId = customer?.id || null;
          }
          
          // Optionally enrich with DVLA data
          let dvlaData: any = null;
          if (input.enrichWithDVLA) {
            try {
              dvlaData = await getVehicleDetails(ga4Vehicle.Registration);
            } catch (error) {
              console.log(`Could not fetch DVLA data for ${ga4Vehicle.Registration}`);
            }
          }
          
          const vehicleData = {
            registration: ga4Vehicle.Registration.toUpperCase(),
            make: dvlaData?.make || ga4Vehicle.Make || null,
            model: dvlaData?.model || ga4Vehicle.Model || null,
            customerId,
            externalId: ga4Vehicle._ID,
            colour: dvlaData?.colour || ga4Vehicle.Colour || null,
            fuelType: dvlaData?.fuelType || ga4Vehicle.FuelType || null,
            dateOfRegistration: parseGA4Date(ga4Vehicle.DateofReg || ''),
            vin: ga4Vehicle.VIN || null,
            engineCC: ga4Vehicle.EngineCC ? parseInt(ga4Vehicle.EngineCC, 10) : null,
            notes: [ga4Vehicle.Notes, ga4Vehicle.Notes_Reminders].filter(Boolean).join('\n\n') || null,
            motExpiryDate: dvlaData?.motExpiryDate ? new Date(dvlaData.motExpiryDate) : null,
          };
          
          if (existing) {
            // Update existing vehicle
            // TODO: Add update vehicle function
            updated++;
          } else {
            // Create new vehicle
            await createVehicle(vehicleData);
            imported++;
          }
        } catch (error: any) {
          errors.push(`Vehicle ${ga4Vehicle.Registration}: ${error.message}`);
          skipped++;
        }
      }
      
      return {
        total: vehicles.length,
        imported,
        updated,
        skipped,
        errors,
      };
    }),

  /**
   * Import reminders from GA4 CSV
   */
  importReminders: publicProcedure
    .input(z.object({
      remindersCSV: z.string(), // Base64 encoded CSV data
      templatesCSV: z.string(), // Base64 encoded CSV data
    }))
    .mutation(async ({ input }) => {
      const { createReminder, getVehicleByExternalId, getCustomerById } = await import("../db");
      
      // Decode and parse CSVs
      const remindersBuffer = Buffer.from(input.remindersCSV.split(',')[1], 'base64');
      const templatesBuffer = Buffer.from(input.templatesCSV.split(',')[1], 'base64');
      
      const reminders = parseCSV<GA4Reminder>(remindersBuffer);
      const templates = parseCSV<GA4ReminderTemplate>(templatesBuffer);
      
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      
      for (const ga4Reminder of reminders) {
        try {
          // Get vehicle by external ID
          const vehicle = await getVehicleByExternalId(ga4Reminder._ID_Vehicle);
          if (!vehicle) {
            errors.push(`Reminder ${ga4Reminder._ID}: Vehicle not found`);
            skipped++;
            continue;
          }
          
          // Get customer
          let customer: any = null;
          if (vehicle.customerId) {
            customer = await getCustomerById(vehicle.customerId);
          }
          
          // Map reminder type
          const type = mapReminderType(ga4Reminder._ID_Template, templates);
          
          // Determine status
          const actioned = isReminderActioned(ga4Reminder);
          const actionedInfo = getReminderActionedInfo(ga4Reminder);
          
          const reminderData = {
            type,
            dueDate: parseGA4Date(ga4Reminder.DueDate) || new Date(),
            registration: vehicle.registration,
            customerName: customer?.name || null,
            customerEmail: customer?.email || null,
            customerPhone: customer?.phone || null,
            vehicleMake: vehicle.make || null,
            vehicleModel: vehicle.model || null,
            motExpiryDate: vehicle.motExpiryDate || null,
            status: actioned ? "sent" as const : "pending" as const,
            sentAt: actionedInfo.date,
            sentMethod: actionedInfo.method,
            vehicleId: vehicle.id,
            customerId: customer?.id || null,
            externalId: ga4Reminder._ID,
          };
          
          await createReminder(reminderData);
          imported++;
        } catch (error: any) {
          errors.push(`Reminder ${ga4Reminder._ID}: ${error.message}`);
          skipped++;
        }
      }
      
      return {
        total: reminders.length,
        imported,
        skipped,
        errors,
      };
    }),

  /**
   * Get import statistics
   */
  getImportStats: publicProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { customers, vehicles, reminders } = await import("../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    
    const db = await getDb();
    if (!db) {
      return {
        customersTotal: 0,
        customersImported: 0,
        vehiclesTotal: 0,
        vehiclesImported: 0,
        remindersTotal: 0,
        remindersImported: 0,
      };
    }
    
    const [customersCount] = await db.select({ count: sql<number>`count(*)` }).from(customers);
    const [customersImportedCount] = await db.select({ count: sql<number>`count(*)` }).from(customers).where(sql`externalId IS NOT NULL`);
    
    const [vehiclesCount] = await db.select({ count: sql<number>`count(*)` }).from(vehicles);
    const [vehiclesImportedCount] = await db.select({ count: sql<number>`count(*)` }).from(vehicles).where(sql`externalId IS NOT NULL`);
    
    const [remindersCount] = await db.select({ count: sql<number>`count(*)` }).from(reminders);
    const [remindersImportedCount] = await db.select({ count: sql<number>`count(*)` }).from(reminders).where(sql`externalId IS NOT NULL`);
    
    return {
      customersTotal: Number(customersCount?.count || 0),
      customersImported: Number(customersImportedCount?.count || 0),
      vehiclesTotal: Number(vehiclesCount?.count || 0),
      vehiclesImported: Number(vehiclesImportedCount?.count || 0),
      remindersTotal: Number(remindersCount?.count || 0),
      remindersImported: Number(remindersImportedCount?.count || 0),
    };
  }),
});
