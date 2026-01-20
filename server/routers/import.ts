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
  getCustomerEmail,
} from "../services/csv-import";
import { cleanPhoneField } from "../utils/phoneUtils";

export const importRouter = router({
  /**
   * Import customers from GA4 CSV with smart merge
   */
  importCustomers: publicProcedure
    .input(z.object({
      csvData: z.string().min(1), // Base64 encoded CSV data (data URL format)
    }))
    .mutation(async ({ input }) => {
      const {
        createCustomer,
        findCustomerBySmartMatch,
        updateCustomer,
        getCustomerByExternalId
      } = await import("../db");

      // Decode base64 and parse CSV
      // Handle both data URL format (data:text/csv;base64,xxx) and raw base64
      const base64Data = input.csvData.includes(',')
        ? input.csvData.split(',')[1]
        : input.csvData;
      const buffer = Buffer.from(base64Data, 'base64');
      const customers = parseCSV<GA4Customer>(buffer);

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];

      console.log(`[IMPORT-CUSTOMERS] Processing ${customers.length} customers with smart merge...`);

      for (const ga4Customer of customers) {
        try {
          const name = buildCustomerName(ga4Customer);
          const phone = getPhoneNumber(ga4Customer);
          const email = getCustomerEmail(ga4Customer);

          // Smart match: phone > email > name
          const existing = await findCustomerBySmartMatch(phone, email, name);

          const customerData = {
            name,
            email,
            phone,
            externalId: ga4Customer._ID || null,
            address: buildAddress(ga4Customer),
            postcode: ga4Customer.addressPostCode || null,
            notes: ga4Customer.Notes || null,
          };

          if (existing) {
            // Smart merge: only update if new data is better
            const updates: any = {};

            // Name: update if existing is empty, shorter, or generic
            if (name && name.length > 0) {
              if (!existing.name ||
                existing.name.length < name.length ||
                existing.name.toLowerCase().includes('customer') ||
                existing.name.toLowerCase().includes('unknown')) {
                updates.name = name;
              }
            }

            // Phone: update if existing is empty or new is longer
            if (phone && phone.length >= 10) {
              if (!existing.phone || existing.phone.length < phone.length) {
                updates.phone = phone;
              }
            }

            // Email: update if existing is empty, placeholder, or new is better
            if (email && email.includes('@') && !email.includes('placeholder')) {
              if (!existing.email ||
                existing.email.includes('placeholder') ||
                existing.email.length < email.length) {
                updates.email = email;
              }
            }

            // Address: update if existing is empty
            if (customerData.address && !existing.address) {
              updates.address = customerData.address;
            }

            // Postcode: update if existing is empty
            if (customerData.postcode && !existing.postcode) {
              updates.postcode = customerData.postcode;
            }

            // Notes: update if existing is empty
            if (customerData.notes && !existing.notes) {
              updates.notes = customerData.notes;
            }

            // External ID: always update to maintain link
            if (!existing.externalId && ga4Customer._ID) {
              updates.externalId = ga4Customer._ID;
            }

            if (Object.keys(updates).length > 0) {
              await updateCustomer(existing.id, updates);
              console.log(`[IMPORT-CUSTOMERS] Updated: ${name} with ${Object.keys(updates).length} fields`);
              updated++;
            } else {
              skipped++;
            }
          } else {
            // Create new customer
            await createCustomer(customerData);
            console.log(`[IMPORT-CUSTOMERS] Created: ${name}`);
            imported++;
          }
        } catch (error: any) {
          const idLabel = ga4Customer._ID || ga4Customer.nameSurname || 'Unknown';
          errors.push(`Customer ${idLabel}: ${error.message}`);
          console.error(`[IMPORT-CUSTOMERS] Error for ${idLabel}:`, error);
          skipped++;
        }
      }

      console.log(`[IMPORT-CUSTOMERS] Completed: ${imported} new, ${updated} updated, ${skipped} skipped`);

      return {
        total: customers.length,
        imported,
        updated,
        skipped,
        errors: errors.slice(0, 3), // Only return first 3 errors
      };
    }),

  /**
   * Import vehicles from GA4 CSV with smart merge and customer linking
   */
  importVehicles: publicProcedure
    .input(z.object({
      csvData: z.string().min(1), // Base64 encoded CSV data (data URL format)
      enrichWithDVLA: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const {
        createVehicle,
        findVehicleByRegistration,
        updateVehicle,
        getCustomerByExternalId,
        findCustomerByName,
        findCustomerBySmartMatch,
      } = await import("../db");
      const { getVehicleDetails } = await import("../dvlaApi");

      // Decode base64 and parse CSV
      // Handle both data URL format (data:text/csv;base64,xxx) and raw base64
      const base64Data = input.csvData.includes(',')
        ? input.csvData.split(',')[1]
        : input.csvData;
      const buffer = Buffer.from(base64Data, 'base64');
      const vehicles = parseCSV<GA4Vehicle>(buffer);

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      let preservedConnections = 0;
      let smartLinked = 0;
      const errors: string[] = [];

      console.log(`[IMPORT-VEHICLES] Processing ${vehicles.length} vehicles with smart merge and linking...`);

      for (const ga4Vehicle of vehicles) {
        try {
          const registration = ga4Vehicle.Registration?.toUpperCase().replace(/\s/g, '');

          if (!registration) {
            skipped++;
            continue;
          }

          // Find existing vehicle by normalized registration
          const existing = await findVehicleByRegistration(registration);

          // Find customer by external ID or name
          let customerId = null;
          const ga4CustomerId = ga4Vehicle._ID_Customer || ga4Vehicle["ID Customer"];
          if (ga4CustomerId) {
            const customer = await getCustomerByExternalId(ga4CustomerId);
            if (customer) {
              customerId = customer.id;
            }
          }

          // Fallback: Smart Link if customer not found by ID
          if (!customerId) {
            const forename = ga4Vehicle.Forename || ga4Vehicle["Owner Forename"];
            const surname = ga4Vehicle.Surname || ga4Vehicle["Owner Surname"];
            const name = [forename, surname].filter(Boolean).join(' ');

            // Try Mobile then Telephone
            const rawPhone = ga4Vehicle.Mobile || ga4Vehicle.Telephone || ga4Vehicle["Owner Mobile"] || ga4Vehicle["Owner Telephone"];
            const { phone } = cleanPhoneField(rawPhone);
            const email = ga4Vehicle.Email || ga4Vehicle["Owner Email"];

            if (phone || email || (name && name.length > 2)) {
              const customer = await findCustomerBySmartMatch(phone, email || null, name || null);
              if (customer) {
                customerId = customer.id;
              }
            }
          }

          // Prepare vehicle data
          const engineCCVal = ga4Vehicle.EngineCC || ga4Vehicle["Engine CC"];
          const vin = ga4Vehicle.VIN || ga4Vehicle["VIN "];
          const vehicleId = ga4Vehicle._ID || ga4Vehicle["ID Vehicle"];

          const vehicleData: any = {
            registration,
            make: ga4Vehicle.Make || null,
            model: ga4Vehicle.Model || null,
            colour: ga4Vehicle.Colour || null,
            fuelType: ga4Vehicle.FuelType || null,
            vin: vin || null,
            engineCC: engineCCVal ? parseInt(engineCCVal) : null,
            notes: ga4Vehicle.Notes || null,
            externalId: vehicleId,
            customerId,
          };

          // Extract year from DateofReg if available
          const dateOfReg = ga4Vehicle.DateofReg || ga4Vehicle["Date of Manufacture"];
          if (dateOfReg) {
            const dateParts = dateOfReg.split('/');
            if (dateParts.length === 3) {
              vehicleData.dateOfRegistration = parseGA4Date(dateOfReg);
            }
          }

          // CSV MOT Expiry
          if (ga4Vehicle.MOTExpiry) {
            const motDate = parseGA4Date(ga4Vehicle.MOTExpiry);
            if (motDate) {
              vehicleData.motExpiryDate = motDate;
            }
          }

          // Enrich with DVLA data if requested
          if (input.enrichWithDVLA) {
            try {
              const dvlaData = await getVehicleDetails(registration);
              if (dvlaData) {
                vehicleData.make = dvlaData.make || vehicleData.make;
                vehicleData.model = dvlaData.model || vehicleData.model;
                vehicleData.colour = dvlaData.colour || vehicleData.colour;
                vehicleData.fuelType = dvlaData.fuelType || vehicleData.fuelType;
                vehicleData.motExpiryDate = dvlaData.motExpiryDate || null;
              }
            } catch (dvlaError) {
              console.log(`[IMPORT-VEHICLES] DVLA enrichment failed for ${registration}`);
            }
          }

          if (existing) {
            const hasExistingConnection = !!existing.customerId;

            // Smart merge: only update if new data is better
            const updates: any = {};

            // Make: update if existing is empty or new is longer
            if (vehicleData.make && vehicleData.make.length > 2) {
              if (!existing.make || existing.make.length < vehicleData.make.length) {
                updates.make = vehicleData.make;
              }
            }

            // Model: update if existing is empty or new is longer
            if (vehicleData.model && vehicleData.model.length > 2) {
              if (!existing.model || existing.model.length < vehicleData.model.length) {
                updates.model = vehicleData.model;
              }
            }

            // Other fields: update if existing is empty
            if (vehicleData.colour && !existing.colour) updates.colour = vehicleData.colour;
            if (vehicleData.fuelType && !existing.fuelType) updates.fuelType = vehicleData.fuelType;
            if (vehicleData.vin && !existing.vin) updates.vin = vehicleData.vin;
            if (vehicleData.engineCC && !existing.engineCC) updates.engineCC = vehicleData.engineCC;
            if (vehicleData.notes && !existing.notes) updates.notes = vehicleData.notes;
            if (vehicleData.dateOfRegistration && !existing.dateOfRegistration) {
              updates.dateOfRegistration = vehicleData.dateOfRegistration;
            }
            if (vehicleData.motExpiryDate && !existing.motExpiryDate) {
              updates.motExpiryDate = vehicleData.motExpiryDate;
            }

            // External ID: always update to maintain link
            if (!existing.externalId) {
              updates.externalId = ga4Vehicle._ID;
            }

            // Smart customer linking if no existing connection
            if (!hasExistingConnection && customerId) {
              updates.customerId = customerId;
              smartLinked++;
            }

            if (Object.keys(updates).length > 0) {
              await updateVehicle(existing.id, updates);
              console.log(`[IMPORT-VEHICLES] Updated: ${registration} with ${Object.keys(updates).length} fields`);
              updated++;

              if (hasExistingConnection) {
                preservedConnections++;
              }
            } else {
              if (hasExistingConnection) {
                preservedConnections++;
              }
              skipped++;
            }
          } else {
            // Create new vehicle
            await createVehicle(vehicleData);
            console.log(`[IMPORT-VEHICLES] Created: ${registration}${customerId ? ' (linked to customer)' : ''}`);
            imported++;

            if (customerId) {
              smartLinked++;
            }
          }
        } catch (error: any) {
          errors.push(`Vehicle ${ga4Vehicle.Registration}: ${error.message}`);
          console.error(`[IMPORT-VEHICLES] Error:`, error);
          skipped++;
        }
      }

      console.log(`[IMPORT-VEHICLES] Completed: ${imported} new, ${updated} updated, ${skipped} skipped, ${preservedConnections} preserved, ${smartLinked} smart-linked`);

      return {
        total: vehicles.length,
        imported,
        updated,
        skipped,
        preservedConnections,
        smartLinked,
        errors: errors.slice(0, 3),
      };
    }),

  /**
   * Import reminders from GA4 CSV
   */
  importReminders: publicProcedure
    .input(z.object({
      remindersCSV: z.string().min(1),
      templatesCSV: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const { createReminder, getVehicleByExternalId } = await import("../db");

      // Parse both CSVs
      // Handle both data URL format and raw base64
      const remindersBase64 = input.remindersCSV.includes(',')
        ? input.remindersCSV.split(',')[1]
        : input.remindersCSV;
      const templatesBase64 = input.templatesCSV.includes(',')
        ? input.templatesCSV.split(',')[1]
        : input.templatesCSV;
      const remindersBuffer = Buffer.from(remindersBase64, 'base64');
      const templatesBuffer = Buffer.from(templatesBase64, 'base64');

      const reminders = parseCSV<GA4Reminder>(remindersBuffer);
      const templates = parseCSV<GA4ReminderTemplate>(templatesBuffer);

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      console.log(`[IMPORT-REMINDERS] Processing ${reminders.length} reminders...`);

      for (const ga4Reminder of reminders) {
        try {
          // Find vehicle
          const vehicle = await getVehicleByExternalId(ga4Reminder._ID_Vehicle);
          if (!vehicle) {
            skipped++;
            continue;
          }

          // Parse due date
          const dueDate = parseGA4Date(ga4Reminder.DueDate);
          if (!dueDate) {
            skipped++;
            continue;
          }

          // Determine status and sent info
          const actioned = isReminderActioned(ga4Reminder);
          const actionedInfo = getReminderActionedInfo(ga4Reminder);

          const reminderData = {
            type: mapReminderType(ga4Reminder._ID_Template, templates),
            dueDate,
            vehicleId: vehicle.id,
            customerId: vehicle.customerId,
            registration: vehicle.registration,
            customer: null, // Will be populated from customer table if needed
            phone: null,
            email: null,
            vehicle: `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || null,
            motExpiryDate: vehicle.motExpiryDate,
            status: (actioned ? 'sent' : 'pending') as 'sent' | 'pending',
            sentMethod: actionedInfo.method,
            sentDate: actionedInfo.date,
            externalId: ga4Reminder._ID,
          };

          await createReminder(reminderData);
          imported++;
        } catch (error: any) {
          errors.push(`Reminder ${ga4Reminder._ID}: ${error.message}`);
          skipped++;
        }
      }

      console.log(`[IMPORT-REMINDERS] Completed: ${imported} imported, ${skipped} skipped`);

      return {
        total: reminders.length,
        imported,
        skipped,
        errors: errors.slice(0, 3),
      };
    }),

  /**
   * Get import statistics
   */
  getImportStats: publicProcedure.query(async () => {
    const { getAllCustomers, getAllVehicles, getAllReminders } = await import("../db");

    const customers = await getAllCustomers();
    const vehicles = await getAllVehicles();
    const reminders = await getAllReminders();

    return {
      customers: customers.length,
      vehicles: vehicles.length,
      reminders: reminders.length,
    };
  }),
});
