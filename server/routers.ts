import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { importRouter } from "./routers/import";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  import: importRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  customers: router({
    list: publicProcedure.query(async () => {
      const { getAllCustomers } = await import("./db");
      return getAllCustomers();
    }),
    
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const { getCustomerById, getVehiclesByCustomerId, getRemindersByCustomerId } = await import("./db");
        const customer = await getCustomerById(input.id);
        if (!customer) return null;
        
        const vehicles = await getVehiclesByCustomerId(input.id);
        const reminders = await getRemindersByCustomerId(input.id);
        
        return { customer, vehicles, reminders };
      }),
    
    getByPhone: publicProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        const { getCustomerWithVehiclesByPhone } = await import("./db");
        return getCustomerWithVehiclesByPhone(input.phone);
      }),
    
    getByPhones: publicProcedure
      .input(z.object({ phones: z.array(z.string()) }))
      .query(async ({ input }) => {
        const { getCustomersWithVehiclesByPhones } = await import("./db");
        return getCustomersWithVehiclesByPhones(input.phones);
      }),
  }),
  
  vehicles: router({
    list: publicProcedure.query(async () => {
      const { getAllVehicles } = await import("./db");
      return getAllVehicles();
    }),
    
    getByRegistration: publicProcedure
      .input(z.object({ registration: z.string() }))
      .query(async ({ input }) => {
        const { getVehicleByRegistration, getCustomerById, getRemindersByVehicleId } = await import("./db");
        const vehicle = await getVehicleByRegistration(input.registration);
        if (!vehicle) return null;
        
        let customer = null;
        if (vehicle.customerId) {
          customer = await getCustomerById(vehicle.customerId);
        }
        
        const reminders = await getRemindersByVehicleId(vehicle.id);
        
        return { vehicle, customer, reminders };
      }),
  }),

  reminders: router({
    list: publicProcedure.query(async () => {
      const { getAllReminders } = await import("./db");
      return getAllReminders();
    }),
    
    processImage: publicProcedure
      .input(z.object({ imageData: z.string() }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import("./_core/llm");
        const { createReminder } = await import("./db");
        
        // Extract reminders from image using LLM vision
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are a data extraction assistant. Extract MOT and Service reminders from the provided screenshot. Return a JSON array of reminders with fields: type (MOT or Service), dueDate (ISO date), registration, customerName, customerEmail, customerPhone, vehicleMake, vehicleModel. If a field is not visible, omit it.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all reminders from this screenshot. Return only valid JSON array.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: input.imageData,
                  },
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "reminders",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  reminders: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["MOT", "Service", "Cambelt", "Other"] },
                        dueDate: { type: "string" },
                        registration: { type: "string" },
                        customerName: { type: "string" },
                        customerEmail: { type: "string" },
                        customerPhone: { type: "string" },
                        vehicleMake: { type: "string" },
                        vehicleModel: { type: "string" },
                      },
                      required: ["type", "dueDate", "registration"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["reminders"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("No response from LLM");

        const parsed = JSON.parse(content as string);
        const reminders = parsed.reminders || [];

        // Enrich with DVLA data and insert reminders into database
        const { getVehicleDetails } = await import("./dvlaApi");
        let savedCount = 0;
        const errors: string[] = [];

        for (const reminder of reminders) {
          try {
            // Enrich with DVLA data
            let motExpiryDate: Date | null = null;
            let vehicleMake = reminder.vehicleMake;
            let vehicleModel = reminder.vehicleModel;
            
            try {
              const dvlaData = await getVehicleDetails(reminder.registration);
              if (dvlaData?.motExpiryDate) {
                motExpiryDate = new Date(dvlaData.motExpiryDate);
              }
              vehicleMake = dvlaData?.make || reminder.vehicleMake;
              vehicleModel = dvlaData?.model || reminder.vehicleModel;
            } catch (error) {
              console.log(`Could not fetch DVLA data for ${reminder.registration}`);
            }

            await createReminder({
              type: reminder.type as "MOT" | "Service" | "Cambelt" | "Other",
              dueDate: new Date(reminder.dueDate),
              registration: reminder.registration,
              customerName: reminder.customerName || null,
              customerEmail: reminder.customerEmail || null,
              customerPhone: reminder.customerPhone || null,
              vehicleMake: vehicleMake || null,
              vehicleModel: vehicleModel || null,
              motExpiryDate,
              status: "pending",
            });
            savedCount++;
          } catch (error: any) {
            errors.push(`${reminder.registration}: ${error.message}`);
          }
        }

        return { 
          count: savedCount,
          total: reminders.length,
          errors 
        };
      }),
    
    lookupMOT: publicProcedure
      .input(z.object({ registration: z.string() }))
      .mutation(async ({ input }) => {
        const { getMOTHistory, getLatestMOTExpiry } = await import("./motApi");
        const { getVehicleDetails } = await import("./dvlaApi");
        
        // Use mock data for testing if registration is TEST123
        if (input.registration.toUpperCase() === "TEST123") {
          const mockExpiryDate = new Date();
          mockExpiryDate.setDate(mockExpiryDate.getDate() + 15); // 15 days from now
          
          return {
            registration: "TEST123",
            make: "Ford",
            model: "Focus",
            motExpiryDate: mockExpiryDate,
            colour: "Blue",
            fuelType: "Petrol",
            taxStatus: "Taxed",
            taxDueDate: "2025-12-31",
            motTests: [
              {
                completedDate: "2024-11-01",
                testResult: "PASSED",
                expiryDate: mockExpiryDate.toISOString(),
                odometerValue: "45000",
                odometerUnit: "mi",
                motTestNumber: "123456789",
                defects: [],
              },
            ],
          };
        }
        
        // Fetch from both APIs
        const [motData, dvlaData] = await Promise.all([
          getMOTHistory(input.registration).catch((err) => {
            console.error("MOT API Error:", err.message);
            return null;
          }),
          getVehicleDetails(input.registration).catch((err) => {
            console.error("DVLA API Error:", err.message);
            return null;
          }),
        ]);
        
        if (!motData && !dvlaData) {
          throw new Error("Vehicle not found. Try TEST123 to see a demo.");
        }
        
        // DVLA provides MOT expiry date directly! Use it if available
        const dvlaExpiry = dvlaData?.motExpiryDate ? new Date(dvlaData.motExpiryDate) : null;
        const motExpiry = motData ? getLatestMOTExpiry(motData) : null;
        const finalExpiry = dvlaExpiry || motExpiry;
        
        return {
          registration: input.registration,
          make: motData?.make || dvlaData?.make,
          model: motData?.model || dvlaData?.model,
          motExpiryDate: finalExpiry,
          colour: motData?.primaryColour || dvlaData?.colour,
          fuelType: motData?.fuelType || dvlaData?.fuelType,
          taxStatus: dvlaData?.taxStatus,
          taxDueDate: dvlaData?.taxDueDate,
          motTests: motData?.motTests || [],
          // All DVLA fields
          engineCapacity: dvlaData?.engineCapacity,
          co2Emissions: dvlaData?.co2Emissions,
          markedForExport: dvlaData?.markedForExport,
          monthOfFirstRegistration: dvlaData?.monthOfFirstRegistration,
          yearOfManufacture: dvlaData?.yearOfManufacture,
          euroStatus: dvlaData?.euroStatus,
          realDrivingEmissions: dvlaData?.realDrivingEmissions,
          dateOfLastV5CIssued: dvlaData?.dateOfLastV5CIssued,
          typeApproval: dvlaData?.typeApproval,
          wheelplan: dvlaData?.wheelplan,
          revenueWeight: dvlaData?.revenueWeight,
          artEndDate: dvlaData?.artEndDate,
          // Additional MOT fields
          primaryColour: motData?.primaryColour,
        };
      }),
    
    update: publicProcedure
      .input(z.object({
        id: z.number(),
        type: z.enum(["MOT", "Service", "Cambelt", "Other"]).optional(),
        dueDate: z.string().optional(),
        registration: z.string().optional(),
        customerName: z.string().optional(),
        customerEmail: z.string().optional(),
        customerPhone: z.string().optional(),
        vehicleMake: z.string().optional(),
        vehicleModel: z.string().optional(),
        status: z.enum(["pending", "sent", "archived"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { updateReminder } = await import("./db");
        const { id, ...data } = input;
        
        const updateData: any = {};
        if (data.type) updateData.type = data.type;
        if (data.dueDate) updateData.dueDate = new Date(data.dueDate);
        if (data.registration) updateData.registration = data.registration;
        if (data.customerName !== undefined) updateData.customerName = data.customerName || null;
        if (data.customerEmail !== undefined) updateData.customerEmail = data.customerEmail || null;
        if (data.customerPhone !== undefined) updateData.customerPhone = data.customerPhone || null;
        if (data.vehicleMake !== undefined) updateData.vehicleMake = data.vehicleMake || null;
        if (data.vehicleModel !== undefined) updateData.vehicleModel = data.vehicleModel || null;
        if (data.status) updateData.status = data.status;
        if (data.notes !== undefined) updateData.notes = data.notes || null;
        
        await updateReminder(id, updateData);
        return { success: true };
      }),
    
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteReminder } = await import("./db");
        await deleteReminder(input.id);
        return { success: true };
      }),
    
    sendWhatsApp: publicProcedure
      .input(z.object({
        id: z.number(),
        phoneNumber: z.string(),
        customMessage: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { getAllReminders, updateReminder, createReminderLog } = await import("./db");
        const { sendMOTReminderWithTemplate, sendSMS, generateServiceReminderMessage } = await import("./smsService");
        
        // Handle test messages (id = 0)
        if (input.id === 0) {
          // If custom message provided, send it directly
          let result;
          if (input.customMessage) {
            result = await sendSMS({
              to: input.phoneNumber,
              message: input.customMessage,
            });
          } else {
            // Otherwise send default MOT reminder
            result = await sendMOTReminderWithTemplate({
              to: input.phoneNumber,
              customerName: "Test User",
              registration: "TEST123",
              motExpiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
            });
          }
          
          if (!result.success) {
            throw new Error(result.error || "Failed to send test message");
          }
          
          // Log test message
          await createReminderLog({
            reminderId: null,
            customerId: null,
            vehicleId: null,
            messageType: "MOT",
            recipient: input.phoneNumber,
            messageSid: result.messageId || null,
            status: "sent",
            templateUsed: null,
            customerName: "Test User",
            registration: "TEST123",
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            messageContent: input.customMessage || undefined,
          });
          
          return { success: true, messageSid: result.messageId };
        }
        
        // Get reminder details for non-test messages
        const reminders = await getAllReminders();
        const reminder = reminders.find(r => r.id === input.id);
        
        if (!reminder) {
          throw new Error("Reminder not found");
        }
        
        let result;
        let messageContent: string;
        
        if (reminder.type === "MOT") {
          // Use WhatsApp template for MOT reminders (no 24-hour window restriction)
          let motExpiryDate = new Date(reminder.dueDate);
          const daysLeft = Math.ceil((motExpiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const formattedDate = motExpiryDate.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          });
          
          // Construct the message content that matches the template
          messageContent = `Hi ${reminder.customerName || "Customer"}, this is a reminder that the MOT for your vehicle ${reminder.registration} expires on ${formattedDate} (${daysLeft} days). Please contact us to book your MOT test.`;
          
          result = await sendMOTReminderWithTemplate({
            to: input.phoneNumber,
            customerName: reminder.customerName || "Customer",
            registration: reminder.registration,
            motExpiryDate,
          });
        } else if (reminder.type === "Service") {
          // Use WhatsApp template for Service reminders
          const { sendServiceReminderWithTemplate } = await import("./smsService");
          const serviceDueDate = new Date(reminder.dueDate);
          const daysLeft = Math.ceil((serviceDueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const formattedDate = serviceDueDate.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          });
          
          // Construct the message content that matches the template
          messageContent = `Hi ${reminder.customerName || "Customer"}, this is a reminder that your vehicle ${reminder.registration} is due for a service on ${formattedDate} (${daysLeft} days). Please contact us to book your service.`;
          
          result = await sendServiceReminderWithTemplate({
            to: input.phoneNumber,
            customerName: reminder.customerName || "Customer",
            registration: reminder.registration,
            serviceDueDate,
          });
        } else {
          // Use freeform message for other reminder types (Cambelt, Other)
          const message = generateServiceReminderMessage({
            customerName: reminder.customerName || "Customer",
            registration: reminder.registration,
            dueDate: new Date(reminder.dueDate),
          });
          
          messageContent = message;
          
          result = await sendSMS({
            to: input.phoneNumber,
            message,
          });
        }
        
        if (!result.success) {
          throw new Error(result.error || "Failed to send message");
        }
        
        // Update reminder status
        await updateReminder(input.id, {
          status: "sent",
          sentAt: new Date(),
          sentMethod: "whatsapp",
        });
        
        // Create reminder log
        await createReminderLog({
          reminderId: input.id,
          customerId: reminder.customerId,
          vehicleId: reminder.vehicleId,
          messageType: reminder.type,
          recipient: input.phoneNumber,
          messageSid: result.messageId,
          status: "sent",
          templateUsed: reminder.type === "MOT" ? "motreminder" : reminder.type === "Service" ? "servicereminder" : "freeform",
          customerName: reminder.customerName,
          registration: reminder.registration,
          dueDate: new Date(reminder.dueDate),
          messageContent: messageContent,
          sentAt: new Date(),
        });
        
        return { success: true, messageId: result.messageId };
      }),
    
    // Auto-generate reminders from vehicles
    generateFromVehicles: publicProcedure.query(async () => {
      const { getVehiclesWithCustomersForReminders } = await import("./db");
      
      const vehiclesWithCustomers = await getVehiclesWithCustomersForReminders();
      
      // Generate reminders for vehicles with MOT expiry dates
      const generatedReminders = vehiclesWithCustomers
        .filter(v => v.motExpiryDate)
        .map(v => {
          const motDate = new Date(v.motExpiryDate!);
          const today = new Date();
          const daysUntilExpiry = Math.ceil((motDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          // Calculate reminder due date (30 days before MOT expiry)
          const dueDate = new Date(motDate);
          dueDate.setDate(dueDate.getDate() - 30);
          
          // Determine status based on days until expiry
          let status: "pending" | "sent" | "archived" = "pending";
          if (daysUntilExpiry < 0) {
            status = "archived"; // Expired
          } else if (daysUntilExpiry > 30) {
            status = "pending"; // Not yet due
          }
          
          return {
            id: v.vehicleId, // Use vehicle ID as temporary ID
            type: "MOT" as const,
            dueDate,
            registration: v.registration,
            customerName: v.customerName || null,
            customerEmail: v.customerEmail || null,
            customerPhone: v.customerPhone || null,
            vehicleMake: v.make || null,
            vehicleModel: v.model || null,
            motExpiryDate: v.motExpiryDate,
            status,
            sentAt: null,
            sentMethod: null,
            customerResponded: 0,
            respondedAt: null,
            needsFollowUp: 0,
            notes: null,
            vehicleId: v.vehicleId,
            customerId: v.customerId || null,
            externalId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        });
      
      return generatedReminders;
    }),
    
    bulkVerifyMOT: publicProcedure
      .input(z.object({ 
        registrations: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        const { getMOTHistory, getLatestMOTExpiry } = await import("./motApi");
        const { updateVehicleMOTExpiryDate } = await import("./db");
        
        const results = [];
        
        for (const registration of input.registrations) {
          try {
            const motHistory = await getMOTHistory(registration);
            
            if (motHistory) {
              const expiryDate = getLatestMOTExpiry(motHistory);
              
              if (expiryDate) {
                // Update vehicle MOT date in database
                await updateVehicleMOTExpiryDate(registration, expiryDate);
                
                results.push({
                  registration,
                  success: true,
                  motExpiryDate: expiryDate.toISOString(),
                  make: motHistory.make,
                  model: motHistory.model,
                  verified: true,
                });
              } else {
                results.push({
                  registration,
                  success: false,
                  error: 'No valid MOT expiry date found',
                  verified: false,
                });
              }
            } else {
              results.push({
                registration,
                success: false,
                error: 'No MOT data found',
                verified: false,
              });
            }
          } catch (error: any) {
            results.push({
              registration,
              success: false,
              error: error.message || 'Failed to verify MOT',
              verified: false,
            });
          }
        }
        
        return results;
      }),
    
    markResponded: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { updateReminder } = await import("./db");
        await updateReminder(input.id, {
          customerResponded: 1,
          respondedAt: new Date(),
          needsFollowUp: 0, // Clear follow-up flag when customer responds
        });
        return { success: true };
      }),
    
    updateFollowUpFlags: publicProcedure.mutation(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const { reminders } = await import("../drizzle/schema");
      const { eq, and, lt } = await import("drizzle-orm");
      
      // Update needsFollowUp flag for reminders sent more than 7 days ago with no response
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      await db.update(reminders)
        .set({ needsFollowUp: 1 })
        .where(
          and(
            eq(reminders.status, "sent"),
            lt(reminders.sentAt, sevenDaysAgo),
            eq(reminders.customerResponded, 0),
            eq(reminders.needsFollowUp, 0)
          )
        );
      
      return { success: true };
    }),
  }),
  
  // Database overview
  database: router({
    getAllVehiclesWithCustomers: publicProcedure.query(async () => {
      const { getAllVehiclesWithCustomers } = await import("./db");
      return await getAllVehiclesWithCustomers();
    }),
    
    bulkUpdateMOT: publicProcedure
      .input(z.object({
        vehicleIds: z.array(z.number()).optional(), // If empty, update all
      }))
      .mutation(async ({ input }) => {
        const { getAllVehicles, bulkUpdateVehicleMOT } = await import("./db");
        const { getVehicleDetails } = await import("./dvlaApi");
        
        // Get vehicles to update
        const allVehicles = await getAllVehicles();
        const vehiclesToUpdate = input.vehicleIds && input.vehicleIds.length > 0
          ? allVehicles.filter(v => input.vehicleIds!.includes(v.id))
          : allVehicles;
        
        let updated = 0;
        let failed = 0;
        let skipped = 0;
        const errors: string[] = [];
        const updates: Array<{ id: number; motExpiryDate: Date | null; make?: string; model?: string; colour?: string; fuelType?: string }> = [];
        
        console.log(`[BULK-MOT] Starting bulk MOT check for ${vehiclesToUpdate.length} vehicles...`);
        
        for (const vehicle of vehiclesToUpdate) {
          try {
            if (!vehicle.registration) {
              skipped++;
              continue;
            }
            
            const dvlaData = await getVehicleDetails(vehicle.registration);
            
            if (dvlaData && dvlaData.motExpiryDate) {
              const update: any = {
                id: vehicle.id,
                motExpiryDate: new Date(dvlaData.motExpiryDate),
              };
              
              // Update other fields if they're better
              if (dvlaData.make && (!vehicle.make || dvlaData.make.length > vehicle.make.length)) {
                update.make = dvlaData.make;
              }
              if (dvlaData.model && (!vehicle.model || dvlaData.model.length > vehicle.model.length)) {
                update.model = dvlaData.model;
              }
              if (dvlaData.colour && !vehicle.colour) {
                update.colour = dvlaData.colour;
              }
              if (dvlaData.fuelType && !vehicle.fuelType) {
                update.fuelType = dvlaData.fuelType;
              }
              
              updates.push(update);
              updated++;
              console.log(`[BULK-MOT] Updated ${vehicle.registration}: MOT expires ${dvlaData.motExpiryDate}`);
            } else {
              skipped++;
              console.log(`[BULK-MOT] No MOT data for ${vehicle.registration}`);
            }
            
            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error: any) {
            failed++;
            errors.push(`${vehicle.registration}: ${error.message}`);
            console.error(`[BULK-MOT] Error for ${vehicle.registration}:`, error);
          }
        }
        
        // Apply all updates
        if (updates.length > 0) {
          await bulkUpdateVehicleMOT(updates);
        }
        
        console.log(`[BULK-MOT] Completed: ${updated} updated, ${failed} failed, ${skipped} skipped`);
        
        return {
          total: vehiclesToUpdate.length,
          updated,
          failed,
          skipped,
          errors: errors.slice(0, 10), // Return first 10 errors
        };
      }),
    
    // Diagnostic endpoint to investigate vehicles without MOT data
    diagnoseNoMOT: publicProcedure.query(async () => {
      const { getAllVehicles } = await import("./db");
      const { getVehicleDetails } = await import("./dvlaApi");
      
      const allVehicles = await getAllVehicles();
      const vehiclesWithoutMOT = allVehicles.filter(v => !v.motExpiryDate);
      
      console.log(`[DIAGNOSE] Found ${vehiclesWithoutMOT.length} vehicles without MOT data`);
      
      const diagnostics = [];
      
      for (const vehicle of vehiclesWithoutMOT.slice(0, 20)) { // Test first 20
        const diagnosis: any = {
          id: vehicle.id,
          registration: vehicle.registration,
          make: vehicle.make,
          model: vehicle.model,
          issues: [],
        };
        
        // Check if registration exists
        if (!vehicle.registration) {
          diagnosis.issues.push("No registration number");
          diagnostics.push(diagnosis);
          continue;
        }
        
        // Check registration format
        const cleanReg = vehicle.registration.replace(/\s+/g, "").toUpperCase();
        const patterns = [
          /^[A-Z]{2}\d{2}[A-Z]{3}$/, // Current (AB12CDE)
          /^[A-Z]\d{1,3}[A-Z]{3}$/, // Prefix (A123BCD)
          /^[A-Z]{3}\d{1,3}[A-Z]$/, // Suffix (ABC123D)
          /^[A-Z]{1,3}\d{1,4}$/, // Dateless (ABC1234)
        ];
        
        const isValidFormat = patterns.some(pattern => pattern.test(cleanReg));
        if (!isValidFormat) {
          diagnosis.issues.push(`Invalid UK registration format: ${cleanReg}`);
        }
        
        // Try DVLA API
        try {
          const dvlaData = await getVehicleDetails(vehicle.registration);
          if (!dvlaData) {
            diagnosis.issues.push("DVLA API returned no data (404 or vehicle not found)");
          } else if (!dvlaData.motExpiryDate) {
            diagnosis.issues.push("DVLA API returned data but no MOT expiry date (vehicle may be exempt or too new)");
            diagnosis.dvlaData = {
              make: dvlaData.make,
              model: dvlaData.model,
              yearOfManufacture: dvlaData.yearOfManufacture,
              taxStatus: dvlaData.taxStatus,
            };
          } else {
            diagnosis.issues.push("DVLA API has MOT data - needs database update");
            diagnosis.motExpiryDate = dvlaData.motExpiryDate;
          }
        } catch (error: any) {
          diagnosis.issues.push(`DVLA API error: ${error.message}`);
        }
        
        diagnostics.push(diagnosis);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      return {
        total: vehiclesWithoutMOT.length,
        tested: diagnostics.length,
        diagnostics,
      };
      }),
  }),
  
  // Test WhatsApp/SMS
  testWhatsApp: publicProcedure
    .input(z.object({
      phoneNumber: z.string(),
      message: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { sendSMS } = await import("./smsService");
      
      const testMessage = input.message || `Test message from MOT Reminder Quick App. This is a test to verify WhatsApp integration is working correctly. Sent at ${new Date().toLocaleString("en-GB")}.`;
      
      const result = await sendSMS({
        to: input.phoneNumber,
        message: testMessage,
      });
      
      if (!result.success) {
        throw new Error(result.error || "Failed to send WhatsApp message");
      }
      
      return {
        success: true,
        messageId: result.messageId,
        message: "Test message sent successfully!",
      };
    }),
  
  // Reminder Logs
  logs: router({
    list: publicProcedure.query(async () => {
      const { getAllReminderLogs } = await import("./db");
      return getAllReminderLogs();
    }),
    
    byCustomer: publicProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ input }) => {
        const { getReminderLogsByCustomerId } = await import("./db");
        return getReminderLogsByCustomerId(input.customerId);
      }),
  }),
  
  // Customer Messages
  // Phone number cleanup
  cleanup: router({
    phoneNumbers: publicProcedure
      .input(z.object({ dryRun: z.boolean().default(true) }))
      .mutation(async ({ input }) => {
        const { cleanupCustomerPhoneNumbers } = await import("./scripts/cleanupPhoneNumbers");
        return cleanupCustomerPhoneNumbers(input.dryRun);
      }),
  }),
  
  messages: router({
    list: publicProcedure.query(async () => {
      const { getAllCustomerMessages } = await import("./db");
      return getAllCustomerMessages();
    }),
    
    byCustomer: publicProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ input }) => {
        const { getCustomerMessagesByCustomerId } = await import("./db");
        return getCustomerMessagesByCustomerId(input.customerId);
      }),
      
    markAsRead: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { markMessageAsRead } = await import("./db");
        await markMessageAsRead(input.id);
        return { success: true };
      }),
      
    getUnreadCount: publicProcedure.query(async () => {
      const { getUnreadMessageCount } = await import("./db");
      return getUnreadMessageCount();
    }),
    
    markAllAsRead: publicProcedure.mutation(async () => {
      const { markAllMessagesAsRead } = await import("./db");
      await markAllMessagesAsRead();
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;
