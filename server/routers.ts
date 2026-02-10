import { COOKIE_NAME } from "../shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { diagnosticsRouter } from "./routers/diagnostics";
import { analyticsRouter } from "./routers/analytics";

import { desc, eq, and, sql, inArray, isNotNull, lt, gt } from "drizzle-orm";
import { reminders, reminderLogs, customerMessages, vehicles, customers } from "../drizzle/schema";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  diagnostics: diagnosticsRouter,
  analytics: analyticsRouter,
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
        const { getCustomerById, getVehiclesByCustomerId, getRemindersByCustomerId, getServiceHistoryByCustomerId } = await import("./db");
        const customer = await getCustomerById(input.id);
        if (!customer) return null;

        const vehicles = await getVehiclesByCustomerId(input.id);
        const reminders = await getRemindersByCustomerId(input.id);
        const history = await getServiceHistoryByCustomerId(input.id);

        const totalJobs = history.length;
        const totalSpent = history.reduce((acc, h) => acc + (Number(h.totalGross) || 0), 0);

        return {
          customer,
          vehicles,
          reminders,
          stats: {
            totalJobs,
            totalSpent
          },
          history // Include history so we can show it as a list
        };
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

    update: publicProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        postcode: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { updateCustomer } = await import("./db");
        // Filter out undefined/null values naturally, though partial handles undefined mostly
        // Zod optional() allows undefined.
        const { id, ...data } = input;
        await updateCustomer(id, data);
        return { success: true };
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
        const { getVehicleByRegistration, getCustomerById, getRemindersByVehicleId, getLatestVehicleMileage } = await import("./db");
        const vehicle = await getVehicleByRegistration(input.registration);
        if (!vehicle) return null;

        let customer = null;
        if (vehicle.customerId) {
          customer = await getCustomerById(vehicle.customerId);
        }

        const reminders = await getRemindersByVehicleId(vehicle.id);
        const latestMileage = await getLatestVehicleMileage(vehicle.id);
        const { getServiceHistoryByVehicleId } = await import("./db");
        const history = await getServiceHistoryByVehicleId(vehicle.id);

        return {
          vehicle,
          customer,
          reminders,
          latestMileage,
          history,
          stats: {
            totalJobs: history.length,
            lastVisit: history.length > 0 ? history[0].dateCreated : null
          }
        };
      }),
    search: publicProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        const { searchVehiclesByRegistration } = await import("./db");
        return searchVehiclesByRegistration(input.query);
      }),
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const { getDb, getCustomerById, getRemindersByVehicleId, getLatestVehicleMileage, getServiceHistoryByVehicleId } = await import("./db");
        const { vehicles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return null;

        const vehicleResult = await db.select().from(vehicles).where(eq(vehicles.id, input.id)).limit(1);
        const vehicle = vehicleResult[0];
        if (!vehicle) return null;

        let customer = null;
        if (vehicle.customerId) {
          customer = await getCustomerById(vehicle.customerId);
        }

        const reminders = await getRemindersByVehicleId(vehicle.id);
        const latestMileage = await getLatestVehicleMileage(vehicle.id);
        const history = await getServiceHistoryByVehicleId(vehicle.id);

        return {
          vehicle,
          customer,
          reminders,
          latestMileage,
          history,
          stats: {
            totalJobs: history.length,
            lastVisit: history.length > 0 ? history[0].dateCreated : null
          }
        };
      }),
    listByCustomer: publicProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ input }) => {
        const { getVehiclesByCustomerId } = await import("./db");
        return getVehiclesByCustomerId(input.customerId);
      }),

    fetchTechnicalData: publicProcedure
      .input(z.object({
        registration: z.string(),
        force: z.boolean().optional()
      }))
      .mutation(async ({ input }) => {
        const { getVehicleByRegistration, saveTechnicalData } = await import("./db");
        const cleanReg = input.registration.toUpperCase().replace(/\s/g, "");

        // 1. Check Cache first (unless forced refresh)
        if (!input.force) {
          const existingVehicle = await getVehicleByRegistration(cleanReg);
          if (existingVehicle?.comprehensiveTechnicalData) {
            console.log(`[SWS Cache] Hit for ${cleanReg} - skipping API call`);
            return {
              success: true,
              data: existingVehicle.comprehensiveTechnicalData,
              cached: true
            };
          }
        }

        // 2. Clear for API fetch
        const { fetchRichVehicleData } = await import("./sws");
        try {
          console.log(`[SWS Cache] Miss for ${cleanReg} - fetching from API`);
          const data = await fetchRichVehicleData(input.registration);
          await saveTechnicalData(input.registration, data);
          return { success: true, data, cached: false };
        } catch (error) {
          console.error("Technical data fetch failed:", error);
          throw new Error("Failed to fetch technical data");
        }
      }),

    getRepairTimesByCategory: publicProcedure
      .input(z.object({
        registration: z.string(),
        repid: z.string(),
        nodeId: z.string()
      }))
      .mutation(async ({ input }) => {
        const { fetchRepairNodes } = await import("./sws");
        try {
          const data = await fetchRepairNodes(input.registration, input.repid, input.nodeId);
          return { success: true, data };
        } catch (error) {
          console.error("Failed to fetch repair nodes:", error);
          throw new Error("Failed to fetch repair categories");
        }
      }),
  }),

  reminders: router({
    list: publicProcedure.query(async () => {
      const { getVehiclesWithCustomersForReminders, getDb } = await import("./db");
      const vehiclesWithCustomers = await getVehiclesWithCustomersForReminders();
      const db = await getDb();

      if (!db) {
        throw new Error("Database not available");
      }

      // Get latest reminder logs for each vehicle to track send status


      // Get manual flags from reminders table (needsFollowUp, customerResponded overrides)
      // This allows manually clearing flags even if logic says otherwise
      const manualStates = await db
        .select({
          vehicleId: reminders.vehicleId,
          needsFollowUp: reminders.needsFollowUp,
          customerResponded: reminders.customerResponded,
        })
        .from(reminders)
        .where(sql`${reminders.vehicleId} IS NOT NULL`);

      const manualStateMap = new Map();
      manualStates.forEach(s => {
        if (s.vehicleId) manualStateMap.set(s.vehicleId, s);
      });

      // Get latest log for each vehicle
      const latestLogs = await db
        .select({
          vehicleId: reminderLogs.vehicleId,
          sentAt: reminderLogs.sentAt,
          status: reminderLogs.status,
          messageSid: reminderLogs.messageSid,
          deliveredAt: reminderLogs.deliveredAt,
          readAt: reminderLogs.readAt,
        })
        .from(reminderLogs)
        .where(sql`${reminderLogs.vehicleId} IS NOT NULL`)
        .orderBy(desc(reminderLogs.sentAt));

      const logMap = new Map();
      latestLogs.forEach(log => {
        if (log.vehicleId && !logMap.has(log.vehicleId)) {
          logMap.set(log.vehicleId, log);
        }
      });

      // Get latest customer messages
      const latestMessages = await db
        .select({
          customerId: customerMessages.customerId,
          receivedAt: customerMessages.receivedAt,
          fromNumber: customerMessages.fromNumber,
        })
        .from(customerMessages)
        .orderBy(desc(customerMessages.receivedAt));

      const messageMap = new Map();
      const phoneMessageMap = new Map();

      latestMessages.forEach(msg => {
        if (msg.customerId && !messageMap.has(msg.customerId)) {
          messageMap.set(msg.customerId, new Date(msg.receivedAt));
        }
        if (msg.fromNumber && !phoneMessageMap.has(msg.fromNumber.replace('whatsapp:', ''))) {
          phoneMessageMap.set(msg.fromNumber.replace('whatsapp:', ''), new Date(msg.receivedAt));
        }
      });

      return vehiclesWithCustomers
        .filter(v => {
          if (!v.motExpiryDate || v.customerOptedOut) return false;

          // Check for dead vehicles (No MOT & No Tax for > 12 months)
          const today = new Date();
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(today.getFullYear() - 1);

          const motDate = new Date(v.motExpiryDate);
          const isMotLongExpired = motDate < oneYearAgo;

          let isTaxLongExpired = false;
          if (v.taxDueDate) {
            const taxDate = new Date(v.taxDueDate);
            isTaxLongExpired = taxDate < oneYearAgo;
          }

          if (isMotLongExpired && isTaxLongExpired) {
            return false;
          }

          return true;
        })
        .map(v => {
          const motDate = new Date(v.motExpiryDate!);
          const today = new Date();
          const daysUntilExpiry = Math.ceil((motDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          const dueDate = new Date(motDate);
          dueDate.setDate(dueDate.getDate() - 30);

          const latestLog = logMap.get(v.vehicleId);
          const manualState = manualStateMap.get(v.vehicleId);

          let status: "pending" | "sent" | "archived" = "pending";
          let sentAt: Date | null = null;
          let sentMethod: string | null = null;
          let deliveryStatus: "queued" | "sent" | "delivered" | "read" | "failed" | null = null;
          let needsFollowUp = 0;
          let customerResponded = 0;
          let respondedAt: Date | null = null;

          if (latestLog) {
            const logAge = Math.ceil((today.getTime() - new Date(latestLog.sentAt).getTime()) / (1000 * 60 * 60 * 24));
            if (logAge <= 60) {
              status = "sent";
              sentAt = new Date(latestLog.sentAt);
              sentMethod = "whatsapp";
              deliveryStatus = latestLog.status as any;
            }
          }

          if (daysUntilExpiry < 0 && status !== "sent") {
            status = "archived";
          }

          if (status === "sent" && sentAt) {
            let lastResponseDate: Date | null = null;
            if (v.customerId && messageMap.has(v.customerId)) {
              lastResponseDate = messageMap.get(v.customerId);
            } else if (v.customerPhone && phoneMessageMap.has(v.customerPhone)) {
              lastResponseDate = phoneMessageMap.get(v.customerPhone);
            }

            if (lastResponseDate && lastResponseDate > sentAt) {
              customerResponded = 1;
              respondedAt = lastResponseDate;
            } else {
              const daysSinceSent = Math.floor((today.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24));
              if (daysSinceSent >= 7) {
                needsFollowUp = 1;
              }
            }
          }

          if (manualState?.customerResponded) {
            customerResponded = 1;
            needsFollowUp = 0;
          }

          return {
            id: v.vehicleId,
            type: "MOT" as const,
            dueDate,
            registration: v.registration,
            customerName: v.customerName || null,
            customerEmail: v.customerEmail || null,
            customerPhone: v.customerPhone || null,
            customerOptedOut: !!v.customerOptedOut,
            vehicleMake: v.make || null,
            vehicleModel: v.model || null,
            motExpiryDate: v.motExpiryDate,
            status,
            sentAt,
            lastSentAt: latestLog ? new Date(latestLog.sentAt) : null,
            sentMethod,
            deliveryStatus,
            deliveredAt: latestLog?.deliveredAt || null,
            readAt: latestLog?.readAt || null,
            customerResponded,
            respondedAt,
            needsFollowUp,
            notes: null,
            vehicleId: v.vehicleId,
            customerId: v.customerId || null,
            externalId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        });
    }),

    checkStatusBatch: publicProcedure
      .input(z.object({ registrations: z.array(z.string()) }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new Error("Database not available");



        // Normalize inputs
        const normalized = input.registrations.map(r => r.toUpperCase().replace(/\s/g, ''));
        const result: Record<string, any> = {};

        if (normalized.length === 0) return result;

        // 1. Find vehicles
        const foundVehicles = await db
          .select({
            id: vehicles.id,
            registration: vehicles.registration,
            make: vehicles.make,
            model: vehicles.model,
          })
          .from(vehicles)
          .where(inArray(vehicles.registration, normalized));

        const vehicleMap = new Map();
        const vehicleIds: number[] = [];
        foundVehicles.forEach(v => {
          vehicleMap.set(v.registration, v);
          vehicleIds.push(v.id);
        });

        // 2. Find latest logs
        let latestLogMap = new Map();

        if (vehicleIds.length > 0) {
          const BATCH_SIZE = 500;
          for (let i = 0; i < vehicleIds.length; i += BATCH_SIZE) {
            const batch = vehicleIds.slice(i, i + BATCH_SIZE);
            const logs = await db
              .select({
                vehicleId: reminderLogs.vehicleId,
                sentAt: reminderLogs.sentAt,
                status: reminderLogs.status
              })
              .from(reminderLogs)
              .where(inArray(reminderLogs.vehicleId, batch))
              .orderBy(desc(reminderLogs.sentAt));

            logs.forEach(log => {
              if (!latestLogMap.has(log.vehicleId) && log.vehicleId) {
                latestLogMap.set(log.vehicleId, log);
              }
            });
          }
        }

        // 3. Construct result
        for (const reg of normalized) {
          const v = vehicleMap.get(reg);
          if (!v) {
            result[reg] = { found: false };
            continue;
          }

          const log = latestLogMap.get(v.id);
          result[reg] = {
            found: true,
            vehicle: v,
            lastSent: log ? log.sentAt : null,
            status: log ? log.status : null
          };
        }

        return result;
      }),

    scanFromImage: publicProcedure
      .input(z.object({ imageData: z.string() }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import("./_core/llm");
        const { getDb } = await import("./db");
        // Import DVLA API for live checks
        const { getVehicleDetails } = await import("./dvlaApi");
        const db = await getDb();
        if (!db) throw new Error("Database not available");


        // Extract reminders from image using LLM vision
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are a data extraction assistant. Extract all vehicle rows from the provided screenshot table. Look for 'Reg' or 'Registration' columns. Return a JSON array of items. Important: Extract the row even if the MOT Date is 'No data' or missing. Default type to 'MOT' if unsure. Treat 'Reg' column values like '01D68212' as valid registrations.",
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
                      required: ["registration"],
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
        const extracted = parsed.reminders || [];

        // Normalize registrations
        const normalizedInfo = extracted.map((r: any) => ({
          ...r,
          normalizedReg: r.registration.toUpperCase().replace(/\s/g, '')
        }));

        const regs = normalizedInfo.map((r: any) => r.normalizedReg);

        // Batch check status
        const vehicleMap = new Map();
        const vehicleIds: number[] = [];

        if (regs.length > 0) {
          const BATCH_SIZE = 500;
          const found: any[] = [];

          for (let i = 0; i < regs.length; i += BATCH_SIZE) {
            const batch = regs.slice(i, i + BATCH_SIZE);
            const results = await db.select({
              id: vehicles.id,
              registration: vehicles.registration,
              customerId: vehicles.customerId
            }).from(vehicles).where(inArray(vehicles.registration, batch));
            found.push(...results);
          }

          // Fetch customer details for matched vehicles
          const customerIds = found.filter(v => v.customerId).map(v => v.customerId) as number[];
          const customerMap = new Map();

          if (customerIds.length > 0) {
            for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
              const batch = customerIds.slice(i, i + BATCH_SIZE);
              const linkedCustomers = await db.select().from(customers).where(inArray(customers.id, batch));
              linkedCustomers.forEach(c => customerMap.set(c.id, c));
            }
          }

          found.forEach(v => {
            const customer = v.customerId ? customerMap.get(v.customerId) : null;
            vehicleMap.set(v.registration, {
              ...v,
              customer // Attach full customer object to vehicle
            });
            vehicleIds.push(v.id);
          });
        }

        const logMap = new Map();
        if (vehicleIds.length > 0) {
          const BATCH_SIZE = 500;
          for (let i = 0; i < vehicleIds.length; i += BATCH_SIZE) {
            const batch = vehicleIds.slice(i, i + BATCH_SIZE);
            const logs = await db.select({
              vehicleId: reminderLogs.vehicleId,
              sentAt: reminderLogs.sentAt,
              status: reminderLogs.status
            }).from(reminderLogs)
              .where(inArray(reminderLogs.vehicleId, batch))
              .orderBy(desc(reminderLogs.sentAt));

            logs.forEach(log => {
              if (log.vehicleId && !logMap.has(log.vehicleId)) {
                logMap.set(log.vehicleId, log);
              }
            });
          }
        }

        // Process results and perform live check if not sent
        const results = await Promise.all(normalizedInfo.map(async (item: any, i: number) => {
          const v = vehicleMap.get(item.normalizedReg);
          const log = v ? logMap.get(v.id) : null;
          const isSent = !!log;

          // Prefer DB customer name if linked, otherwise use extracted name from image
          const finalCustomerName = v?.customer?.name || item.customerName;
          const finalCustomerPhone = v?.customer?.phone || item.customerPhone;

          let motExpiryDate = null;
          let taxDueDate = null;
          let taxStatus = null;
          let make = item.vehicleMake;
          let model = item.vehicleModel;

          // Always fetch live MOT/Tax data to ensure accuracy, but sequentially with a small delay to avoid rate limiting
          try {
            // Add a small staggered delay based on index to reduce concurrent load even before sequential processing
            await new Promise(resolve => setTimeout(resolve, i * 50));

            const dvlaData = await getVehicleDetails(item.normalizedReg);
            if (dvlaData) {
              motExpiryDate = dvlaData.motExpiryDate;
              taxDueDate = dvlaData.taxDueDate;
              taxStatus = dvlaData.taxStatus;
              make = dvlaData.make || make;
              model = dvlaData.model || model;
            }
          } catch (err) {
            console.error(`Failed to fetch DVLA details for ${item.normalizedReg}`, err);
          }

          return {
            ...item,
            customerName: finalCustomerName, // Override with DB name if found
            customerPhone: finalCustomerPhone, // Override with DB phone if found
            vehicleMake: make,
            vehicleModel: model,
            existsInDb: !!v,
            lastSent: log ? log.sentAt : null,
            lastStatus: log ? log.status : null,
            liveMotExpiryDate: motExpiryDate,
            liveTaxDueDate: taxDueDate,
            liveTaxStatus: taxStatus
          };
        }));


        return results;
      }),

    createManualReminder: publicProcedure
      .input(z.object({
        registration: z.string(),
        dueDate: z.string(),
        type: z.enum(["MOT", "Service", "Cambelt", "Other"]),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const {
          createReminder,
          getVehicleByRegistration,
          createVehicle,
          updateVehicle,
          findCustomerBySmartMatch,
          createCustomer
        } = await import("./db");
        // Import DVLA API
        const { getVehicleDetails } = await import("./dvlaApi");

        const reg = input.registration.toUpperCase().replace(/\s/g, '');

        // 1. Fetch live vehicle data
        let vehicleMake = null;
        let vehicleModel = null;
        let motExpiryDate = null;
        let vehicleData: any = null;

        try {
          vehicleData = await getVehicleDetails(reg);
          if (vehicleData) {
            vehicleMake = vehicleData.make;
            vehicleModel = vehicleData.model;
            if (vehicleData.motExpiryDate) {
              motExpiryDate = new Date(vehicleData.motExpiryDate);
            }
          }
        } catch (e) {
          console.error("Manual Reminder: Failed to fetch DVLA data", e);
        }

        // 2. Find or Create Customer
        let customerId: number | null = null;
        let customerName = input.customerName || "Unknown";

        // Only try to find/create if we have at least a name or phone
        if (input.customerName || input.customerPhone) {
          const existingCustomer = await findCustomerBySmartMatch(
            input.customerPhone || null,
            null,
            input.customerName || null
          );

          if (existingCustomer) {
            customerId = existingCustomer.id;
            customerName = existingCustomer.name;
          } else {
            customerId = await createCustomer({
              name: input.customerName || "Unknown Customer",
              phone: input.customerPhone || null,
              email: null,
              notes: "Created via GA4 Scanner"
            });
          }
        }

        // 3. Find or Create Vehicle & Link
        let vehicleId: number | null = null;
        const existingVehicle = await getVehicleByRegistration(reg);

        if (existingVehicle) {
          vehicleId = existingVehicle.id;
          // Update with latest DVLA data and link to customer if not already linked
          const updates: any = {};
          if (motExpiryDate) updates.motExpiryDate = motExpiryDate;
          if (vehicleMake) updates.make = vehicleMake;
          if (vehicleModel) updates.model = vehicleModel;
          if (vehicleData?.taxStatus) updates.taxStatus = vehicleData.taxStatus;
          if (vehicleData?.taxDueDate) updates.taxDueDate = new Date(vehicleData.taxDueDate);

          // Only update customer if we found one and vehicle isn't linked,
          // OR if we want to override? Let's say we only link if currently unlinked to be safe.
          if (customerId && !existingVehicle.customerId) {
            updates.customerId = customerId;
          }

          if (Object.keys(updates).length > 0) {
            await updateVehicle(vehicleId, updates);
          }
        } else {
          // Create new vehicle
          const result = await createVehicle({
            registration: reg,
            make: vehicleMake,
            model: vehicleModel,
            motExpiryDate: motExpiryDate,
            customerId: customerId, // Link immediately
            taxStatus: vehicleData?.taxStatus,
            taxDueDate: vehicleData?.taxDueDate ? new Date(vehicleData.taxDueDate) : null
          });
          // Result from insert is [ResultSetHeader] in mysql2, usually insertId is available
          // Drizzle insert returns result array? No, mysql2 returns ResultHeader.
          // My db function returns `result` directly.
          // Let's assume standard mysql2/drizzle return.
          // Safest to just fetch it back or check result type.
          // Drizzle MySQL insert returns [OkPacket].
          vehicleId = (result as any).insertId;
        }

        // 4. Create the reminder (Linked)
        // Ensure all fields are at least null to avoid 'undefined' shifting issues in Drizzle
        const reminderResult = await createReminder({
          type: input.type,
          dueDate: new Date(input.dueDate),
          registration: reg,
          customerName: customerName ?? null,
          customerEmail: null,
          customerPhone: input.customerPhone ?? null,
          vehicleMake: vehicleMake ?? null,
          vehicleModel: vehicleModel ?? null,
          motExpiryDate: motExpiryDate ?? null,
          status: "pending",
          vehicleId: vehicleId ?? null,
          customerId: customerId ?? null
        });

        // @ts-ignore
        const newReminderId = reminderResult.insertId || reminderResult?.[0]?.insertId;

        return {
          success: true,
          reminderId: newReminderId,
          customerPhone: input.customerPhone || null,
          customerName: customerName
        };
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
              customerName: reminder.customerName ?? null,
              customerEmail: reminder.customerEmail ?? null,
              customerPhone: reminder.customerPhone ?? null,
              vehicleMake: vehicleMake ?? null,
              vehicleModel: vehicleModel ?? null,
              motExpiryDate: motExpiryDate ?? null,
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
        // Template parameters for test messages (id = 0)
        customerName: z.string().optional(),
        registration: z.string().optional(),
        expiryDate: z.string().optional(),
        daysUntil: z.number().optional(),
        messageType: z.enum(["MOT", "Service"]).optional(),
        // IDs for linking logs to database records
        vehicleId: z.number().optional(),
        customerId: z.number().optional(),
        preview: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { getAllReminders, updateReminder, createReminderLog, findCustomerByPhone } = await import("./db");
        const { sendMOTReminderWithTemplate, sendSMS, generateServiceReminderMessage } = await import("./smsService");

        // Check if customer has opted out
        const customer = await findCustomerByPhone(input.phoneNumber);
        if (customer && customer.optedOut) {
          throw new Error(`Customer ${customer.name} has opted out of messages. They can opt back in by replying START.`);
        }

        // Handle test messages (id = 0)
        if (input.id === 0) {
          let result;
          let messageContent: string;
          const messageType = input.messageType || "MOT";
          const customerName = input.customerName || "Test User";
          const registration = input.registration || "TEST123";
          const expiryDate = input.expiryDate ? new Date(input.expiryDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          const daysUntil = input.daysUntil ?? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

          // If custom message provided, send it directly (for chat quick replies)
          if (input.customMessage) {
            result = await sendSMS({
              to: input.phoneNumber,
              message: input.customMessage,
            });
            messageContent = input.customMessage;
          } else if (messageType === "Service") {
            // Send Service reminder template
            const { sendServiceReminderWithTemplate, generateFullServiceTemplateContent } = await import("./smsService");

            // Generate full template content with emojis and contact details
            messageContent = generateFullServiceTemplateContent({
              customerName,
              registration,
              serviceDueDate: expiryDate,
              daysLeft: daysUntil,
            });

            result = await sendServiceReminderWithTemplate({
              to: input.phoneNumber,
              customerName,
              registration,
              serviceDueDate: expiryDate,
            });
          } else {
            // Send MOT reminder template (automatically selects expired or expiring template)
            const { sendMOTReminderWithTemplate, generateFullMOTTemplateContent } = await import("./smsService");
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const expDate = new Date(expiryDate);
            expDate.setHours(0, 0, 0, 0);
            const isExpired = expDate < now;

            // Generate full template content with emojis and contact details
            messageContent = generateFullMOTTemplateContent({
              customerName,
              registration,
              motExpiryDate: expiryDate,
              isExpired,
              daysLeft: daysUntil,
            });

            result = await sendMOTReminderWithTemplate({
              to: input.phoneNumber,
              customerName,
              registration,
              motExpiryDate: expiryDate,
            });
          }

          if (input.preview) {
            return {
              success: true,
              preview: true,
              messageContent,
            };
          }

          if (!result.success) {
            throw new Error(result.error || "Failed to send test message");
          }

          // Log test message
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const expDate = new Date(expiryDate);
          expDate.setHours(0, 0, 0, 0);
          const isExpired = expDate < now;

          await createReminderLog({
            reminderId: null,
            customerId: input.customerId || null,
            vehicleId: input.vehicleId || null,
            messageType,
            recipient: input.phoneNumber,
            messageSid: result.messageId || null,
            status: "sent",
            templateUsed: messageType === "MOT" ? (isExpired ? "copy_motreminder" : "mot_reminder") : "servicereminder",
            customerName,
            registration,
            dueDate: expiryDate,
            messageContent,
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
        let isExpired = false; // Track if MOT has expired

        if (reminder.type === "MOT") {
          // Use WhatsApp template for MOT reminders (no 24-hour window restriction)
          const { generateFullMOTTemplateContent } = await import("./smsService");
          let motExpiryDate = new Date(reminder.dueDate);
          const daysLeft = Math.ceil((motExpiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

          // Check if MOT has expired
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const expDate = new Date(motExpiryDate);
          expDate.setHours(0, 0, 0, 0);
          isExpired = expDate < now;

          // Generate full template content with emojis and contact details
          messageContent = generateFullMOTTemplateContent({
            customerName: reminder.customerName || "Customer",
            registration: reminder.registration,
            motExpiryDate,
            isExpired,
            daysLeft,
          });

          result = await sendMOTReminderWithTemplate({
            to: input.phoneNumber,
            customerName: reminder.customerName || "Customer",
            registration: reminder.registration,
            motExpiryDate,
          });
        } else if (reminder.type === "Service") {
          // Use WhatsApp template for Service reminders
          const { sendServiceReminderWithTemplate, generateFullServiceTemplateContent } = await import("./smsService");
          const serviceDueDate = new Date(reminder.dueDate);
          const daysLeft = Math.ceil((serviceDueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

          // Generate full template content with emojis and contact details
          messageContent = generateFullServiceTemplateContent({
            customerName: reminder.customerName || "Customer",
            registration: reminder.registration,
            serviceDueDate,
            daysLeft,
          });

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

        if (input.preview) {
          return {
            success: true,
            preview: true,
            messageContent,
          };
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
          templateUsed: reminder.type === "MOT" ? (isExpired ? "copy_motreminder" : "mot_reminder") : reminder.type === "Service" ? "servicereminder" : "freeform",
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
      const { getVehiclesWithCustomersForReminders, getDb } = await import("./db");

      const vehiclesWithCustomers = await getVehiclesWithCustomersForReminders();
      const db = await getDb();

      if (!db) {
        throw new Error("Database not available");
      }

      // Get latest reminder logs for each vehicle to track send status


      // Get latest log for each vehicle
      const latestLogs = await db
        .select({
          vehicleId: reminderLogs.vehicleId,
          sentAt: reminderLogs.sentAt,
          status: reminderLogs.status,
          messageSid: reminderLogs.messageSid,
          deliveredAt: reminderLogs.deliveredAt,
          readAt: reminderLogs.readAt,
        })
        .from(reminderLogs)
        .where(sql`${reminderLogs.vehicleId} IS NOT NULL`)
        .orderBy(desc(reminderLogs.sentAt));

      // Create a map of vehicleId -> latest log
      const logMap = new Map();
      latestLogs.forEach(log => {
        if (log.vehicleId && !logMap.has(log.vehicleId)) {
          logMap.set(log.vehicleId, log);
        }
      });

      // Get latest customer messages to check for responses
      const latestMessages = await db
        .select({
          customerId: customerMessages.customerId,
          receivedAt: customerMessages.receivedAt,
          fromNumber: customerMessages.fromNumber,
        })
        .from(customerMessages)
        .orderBy(desc(customerMessages.receivedAt));

      const messageMap = new Map(); // customerId -> latest message date
      const phoneMessageMap = new Map(); // phoneNumber -> latest message date

      latestMessages.forEach(msg => {
        if (msg.customerId && !messageMap.has(msg.customerId)) {
          messageMap.set(msg.customerId, new Date(msg.receivedAt));
        }
        if (msg.fromNumber && !phoneMessageMap.has(msg.fromNumber.replace('whatsapp:', ''))) {
          phoneMessageMap.set(msg.fromNumber.replace('whatsapp:', ''), new Date(msg.receivedAt));
        }
      });

      // Generate reminders for vehicles with MOT expiry dates
      // Exclude opted-out customers
      const generatedReminders = vehiclesWithCustomers
        .filter(v => v.motExpiryDate && !v.customerOptedOut)
        .map(v => {
          const motDate = new Date(v.motExpiryDate!);
          const today = new Date();
          const daysUntilExpiry = Math.ceil((motDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          // Calculate reminder due date (30 days before MOT expiry)
          const dueDate = new Date(motDate);
          dueDate.setDate(dueDate.getDate() - 30);

          // Get latest log for this vehicle
          const latestLog = logMap.get(v.vehicleId);

          // Determine status based on latest log and days until expiry
          let status: "pending" | "sent" | "archived" = "pending";
          let sentAt: Date | null = null;
          let sentMethod: string | null = null;
          let deliveryStatus: "queued" | "sent" | "delivered" | "read" | "failed" | null = null;

          if (latestLog) {
            // Check if the log is recent (within last 60 days)
            const logAge = Math.ceil((today.getTime() - new Date(latestLog.sentAt).getTime()) / (1000 * 60 * 60 * 24));
            if (logAge <= 60) {
              status = "sent";
              sentAt = new Date(latestLog.sentAt);
              sentMethod = "whatsapp";
              deliveryStatus = latestLog.status as any;
            }
          }

          if (daysUntilExpiry < 0 && status !== "sent") {
            status = "archived"; // Expired and not sent
          }


          let needsFollowUp = 0;
          let customerResponded = 0;
          let respondedAt: Date | null = null;

          if (status === "sent" && sentAt) {
            // Check for response after sentAt
            let lastResponseDate: Date | null = null;

            if (v.customerId && messageMap.has(v.customerId)) {
              lastResponseDate = messageMap.get(v.customerId);
            } else if (v.customerPhone && phoneMessageMap.has(v.customerPhone)) {
              lastResponseDate = phoneMessageMap.get(v.customerPhone);
            }

            if (lastResponseDate && lastResponseDate > sentAt) {
              customerResponded = 1;
              respondedAt = lastResponseDate;
            } else {
              // No response, check if it needs follow up (sent > 7 days ago)
              // NOTE: For now, setting > 3 days for quicker visibility as per user request context
              const daysSinceSent = Math.floor((today.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24));
              if (daysSinceSent >= 7) {
                needsFollowUp = 1;
              }
            }
          }

          return {
            id: v.vehicleId, // Use vehicle ID as temporary ID
            type: "MOT" as const,
            dueDate,
            registration: v.registration,
            customerName: v.customerName || null,
            customerEmail: v.customerEmail || null,
            customerPhone: v.customerPhone || null,
            customerOptedOut: v.customerOptedOut || false,
            vehicleMake: v.make || null,
            vehicleModel: v.model || null,
            motExpiryDate: v.motExpiryDate,
            status,
            sentAt,
            sentMethod,
            deliveryStatus,
            deliveredAt: latestLog?.deliveredAt || null,
            readAt: latestLog?.readAt || null,
            customerResponded,
            respondedAt,
            needsFollowUp,
            notes: null,
            vehicleId: v.vehicleId,
            customerId: v.customerId || null,
            externalId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        });

      return generatedReminders.filter(r => {
        // Exclude sent reminders unless they need follow up
        if (r.status === 'sent' && !r.needsFollowUp) {
          return false;
        }
        return true;
      });
    }),

    bulkVerifyMOT: publicProcedure
      .input(z.object({
        registrations: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        const { getVehicleDetails } = await import("./dvlaApi");
        const { updateVehicleMOTExpiryDate } = await import("./db");

        const results = [];

        for (const registration of input.registrations) {
          try {
            // Use DVLA API which provides MOT expiry date directly
            const dvlaData = await getVehicleDetails(registration);

            if (dvlaData && dvlaData.motExpiryDate) {
              const expiryDate = new Date(dvlaData.motExpiryDate);

              // Update vehicle MOT date in database
              await updateVehicleMOTExpiryDate(registration, expiryDate);

              results.push({
                registration,
                success: true,
                motExpiryDate: expiryDate.toISOString(),
                make: dvlaData.make,
                model: dvlaData.model,
                verified: true,
              });
            } else if (dvlaData) {
              // Vehicle found but no MOT data (might be exempt or too new)
              results.push({
                registration,
                success: false,
                error: 'Vehicle found but no MOT expiry date available (may be exempt or too new)',
                verified: false,
              });
            } else {
              // Vehicle not found
              results.push({
                registration,
                success: false,
                error: 'Vehicle not found in DVLA database',
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

    bookMOT: publicProcedure
      .input(z.object({
        vehicleId: z.number(),
        registration: z.string(),
        motDate: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { updateVehicleMOTExpiryDate, resetReminderState } = await import("./db");

        await updateVehicleMOTExpiryDate(input.registration, new Date(input.motDate));
        await resetReminderState(input.vehicleId);

        return { success: true };
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
        vehicleIds: z.array(z.number()).optional(), // If empty, use limit
        limit: z.number().optional(), // Number of vehicles to update if no IDs provided
      }))
      .mutation(async ({ input }) => {
        const { getDb, getAllVehicles, bulkUpdateVehicleMOT } = await import("./db");
        const { getVehicleDetails } = await import("./dvlaApi");
        const { vehicles } = await import("../drizzle/schema");
        const { asc, sql, or } = await import("drizzle-orm");

        let vehiclesToUpdate: any[] = [];

        if (input.vehicleIds && input.vehicleIds.length > 0) {
          const idSet = new Set(input.vehicleIds);
          const allVehicles = await getAllVehicles();
          vehiclesToUpdate = allVehicles.filter(v => idSet.has(v.id));
        } else if (input.limit) {
          const db = await getDb();
          if (!db) throw new Error("Database not available");

          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          // Fetch vehicles that haven't been checked in 30 days, or ever
          vehiclesToUpdate = await db.select()
            .from(vehicles)
            .where(or(
              sql`${vehicles.lastChecked} < ${thirtyDaysAgo}`,
              sql`${vehicles.lastChecked} IS NULL`
            ))
            .orderBy(asc(sql`COALESCE(${vehicles.lastChecked}, '1970-01-01')`))
            .limit(input.limit);
        } else {
          // Default to all if nothing provided (current behavior)
          vehiclesToUpdate = await getAllVehicles();
        }

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
                lastChecked: new Date(),
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

              // Always update tax info if available
              if (dvlaData.taxStatus) {
                update.taxStatus = dvlaData.taxStatus;
              }
              if (dvlaData.taxDueDate) {
                update.taxDueDate = new Date(dvlaData.taxDueDate);
              }

              updates.push(update);
              updated++;
              console.log(`[BULK-MOT] Updated ${vehicle.registration}: MOT expires ${dvlaData.motExpiryDate}`);
            } else {
              // Even if no MOT data, update lastChecked so we don't keep checking it as "Never Checked"
              updates.push({
                id: vehicle.id,
                lastChecked: new Date(),
              } as any);
              skipped++;
              console.log(`[BULK-MOT] No MOT data for ${vehicle.registration}, updated lastChecked`);
            }

            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 50));
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
      const { getDb } = await import("./db");
      const { vehicles } = await import("../drizzle/schema");
      const { isNull, sql } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const allNoMOT = await db.select({
        id: vehicles.id,
        registration: vehicles.registration,
        make: vehicles.make,
        model: vehicles.model,
        lastChecked: vehicles.lastChecked,
        customerPhone: customers.phone,
      })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(isNull(vehicles.motExpiryDate));

      const ukPatterns = [
        /^[A-Z]{2}\d{2}[A-Z]{3}$/, // Current (AB12CDE)
        /^[A-Z]\d{1,3}[A-Z]{3}$/, // Prefix (A123BCD)
        /^[A-Z]{3}\d{1,3}[A-Z]$/, // Suffix (ABC123D)
        /^[A-Z]{1,3}\d{1,4}$/, // Dateless (ABC1234)
        /^\d{1,4}[A-Z]{1,3}$/, // Dateless (1234ABC)
      ];

      const irishPattern = /^(\d{2,3})[A-Z]{1,2}(\d+)$/;
      const newCodes = [22, 72, 23, 73, 24, 74, 25, 75];

      const categories = {
        validUKNeverChecked: [] as any[],
        validUKCheckedNoData: [] as any[],
        tooNew: [] as any[],
        irish: [] as any[],
        invalidFormat: [] as any[],
        missing: [] as any[],
        missingPhone: [] as any[],
      };

      for (const v of allNoMOT) {
        if (!v.registration) {
          categories.missing.push({ ...v, issues: ["Missing registration"] });
          continue;
        }

        const diagVehicle = {
          ...v,
          issues: [] as string[]
        };

        if (!v.customerPhone || v.customerPhone === '-') {
          diagVehicle.issues.push("Missing mobile number");
        }

        const cleanReg = v.registration.replace(/\s+/g, "").toUpperCase();

        // 1. Check for "Too New"
        const newMatch = cleanReg.match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/);
        if (newMatch && newCodes.includes(parseInt(newMatch[1]))) {
          diagVehicle.issues.push("Too new for MOT (< 3 years)");
          categories.tooNew.push(diagVehicle);
          continue;
        }

        // 2. Check for Irish
        if (irishPattern.test(cleanReg)) {
          diagVehicle.issues.push("Irish registration (not supported by UK DVLA Enquiry API)");
          categories.irish.push(diagVehicle);
          continue;
        }

        // 3. Check for UK Format
        const isValidUK = ukPatterns.some(p => p.test(cleanReg));
        if (isValidUK) {
          if (v.lastChecked) {
            diagVehicle.issues.push("Checked but no MOT data found (likely scrapped)");
            categories.validUKCheckedNoData.push(diagVehicle);
          } else {
            diagVehicle.issues.push("Valid format but never checked");
            categories.validUKNeverChecked.push(diagVehicle);
          }
          continue;
        }

        // 4. Invalid
        diagVehicle.issues.push(`Invalid UK format: ${cleanReg}`);
        categories.invalidFormat.push(diagVehicle);
      }

      // Return summary and samples for each
      return {
        total: allNoMOT.length,
        summary: {
          validUKNeverChecked: categories.validUKNeverChecked.length,
          validUKCheckedNoData: categories.validUKCheckedNoData.length,
          tooNew: categories.tooNew.length,
          irish: categories.irish.length,
          invalidFormat: categories.invalidFormat.length,
          missing: categories.missing.length,
          missingPhone: allNoMOT.filter(v => !v.customerPhone || v.customerPhone === '-').length,
        },
        // Provide category IDs for bulk actions
        categoryIds: {
          invalid: categories.invalidFormat.map(v => v.id),
          missing: categories.missing.map(v => v.id),
          scrapped: categories.validUKCheckedNoData.map(v => v.id),
          neverChecked: categories.validUKNeverChecked.map(v => v.id),
          missingPhone: allNoMOT.filter(v => !v.customerPhone || v.customerPhone === '-').map(v => v.id),
        },
        // Provide samples for the UI to display
        diagnostics: [
          ...categories.invalidFormat.slice(0, 5),
          ...categories.irish.slice(0, 5),
          ...categories.tooNew.slice(0, 5),
          ...categories.validUKNeverChecked.slice(0, 5),
        ],
      };
    }),

    // Bulk delete vehicles based on diagnostic categories
    deleteCategorizedVehicles: publicProcedure
      .input(z.object({
        vehicleIds: z.array(z.number()),
        skipIfHistoryExists: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        const { deleteVehiclesByIds, getVehiclesWithReminderHistory } = await import("./db");

        let idsToDelete = input.vehicleIds;

        if (input.skipIfHistoryExists) {
          const idsWithHistory = await getVehiclesWithReminderHistory(input.vehicleIds);
          idsToDelete = input.vehicleIds.filter(id => !idsWithHistory.includes(id));
        }

        if (idsToDelete.length > 0) {
          await deleteVehiclesByIds(idsToDelete);
        }

        return {
          success: true,
          deletedCount: idsToDelete.length,
          skippedCount: input.vehicleIds.length - idsToDelete.length,
        };
      }),

    delete: publicProcedure
      .input(z.object({
        vehicleIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        const { deleteVehicle } = await import("./db");
        for (const id of input.vehicleIds) {
          await deleteVehicle(id);
        }
        return { success: true };
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
      const { createReminderLog, findCustomerByPhone } = await import("./db");

      const testMessage = input.message || `Test message from MOT Reminder Quick App. This is a test to verify WhatsApp integration is working correctly. Sent at ${new Date().toLocaleString("en-GB")}.`;

      const result = await sendSMS({
        to: input.phoneNumber,
        message: testMessage,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to send WhatsApp message");
      }

      // Try to associate with a customer
      let customerId = null;
      try {
        const customer = await findCustomerByPhone(input.phoneNumber);
        if (customer) {
          customerId = customer.id;
        }
      } catch (e) {
        console.warn("Could not look up customer for test message logging", e);
      }

      // Log the sent message so it appears in conversations
      try {
        await createReminderLog({
          reminderId: null,
          customerId, // If null, it won't appear in conversations view but will be in global logs
          vehicleId: null,
          messageType: "Other",
          recipient: input.phoneNumber,
          messageSid: result.messageId,
          status: "sent",
          templateUsed: "freeform",
          messageContent: testMessage,
          sentAt: new Date(),
        });
      } catch (e) {
        console.error("Failed to log test message to database", e);
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

  conversations: router({
    // Get all conversation threads
    getThreads: publicProcedure.query(async () => {
      const { getConversationThreads } = await import("./conversations");
      return getConversationThreads();
    }),

    // Get messages for a specific conversation
    getMessages: publicProcedure
      .input(z.object({ customerId: z.number() }))
      .query(async ({ input }) => {
        const { getConversationMessages } = await import("./conversations");
        return getConversationMessages(input.customerId);
      }),

    // Mark conversation as read
    markAsRead: publicProcedure
      .input(z.object({ customerId: z.number() }))
      .mutation(async ({ input }) => {
        const { markConversationAsRead } = await import("./conversations");
        await markConversationAsRead(input.customerId);
        return { success: true };
      }),

    // Send reply in conversation
    sendReply: publicProcedure
      .input(z.object({
        customerId: z.number(),
        phoneNumber: z.string(),
        message: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { sendSMS } = await import("./smsService");
        const { createReminderLog } = await import("./db");
        const { getDb } = await import("./db");


        // Find the vehicle for this customer (use latest)
        const db = await getDb();
        let vehicleId: number | null = null;

        if (db) {
          const results = await db
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(eq(vehicles.customerId, input.customerId))
            .orderBy(desc(vehicles.id))
            .limit(1);

          if (results.length > 0) {
            vehicleId = results[0].id;
          }
        }

        const result = await sendSMS({
          to: input.phoneNumber,
          message: input.message,
        });

        if (!result.success) {
          throw new Error(result.error || "Failed to send message");
        }

        // Log the sent message
        await createReminderLog({
          reminderId: null,
          customerId: input.customerId,
          vehicleId: vehicleId,
          messageType: "Other",
          recipient: input.phoneNumber,
          messageSid: result.messageId,
          status: "sent",
          templateUsed: "freeform",
          messageContent: input.message,
          sentAt: new Date(),
        });

        return { success: true, messageId: result.messageId };
      }),
  }),

  serviceHistory: router({
    getByVehicleId: publicProcedure
      .input(z.object({ vehicleId: z.number() }))
      .query(async ({ input }) => {
        const { getServiceHistoryByVehicleId } = await import("./db");
        return getServiceHistoryByVehicleId(input.vehicleId);
      }),

    getLineItems: publicProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ input }) => {
        const { getServiceLineItemsByDocumentId } = await import("./db");
        return getServiceLineItemsByDocumentId(input.documentId);
      }),

    create: publicProcedure
      .input(z.object({
        doc: z.any(),
        items: z.array(z.any()),
      }))
      .mutation(async ({ input }) => {
        const { createServiceDocument } = await import("./db");
        return createServiceDocument(input.doc, input.items);
      }),
  }),
});

export type AppRouter = typeof appRouter;
