import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
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
                        type: { type: "string", enum: ["MOT", "Service"] },
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

        // Insert reminders into database
        for (const reminder of reminders) {
          await createReminder({
            type: reminder.type as "MOT" | "Service",
            dueDate: new Date(reminder.dueDate),
            registration: reminder.registration,
            customerName: reminder.customerName || null,
            customerEmail: reminder.customerEmail || null,
            customerPhone: reminder.customerPhone || null,
            vehicleMake: reminder.vehicleMake || null,
            vehicleModel: reminder.vehicleModel || null,
            status: "pending",
          });
        }

        return { count: reminders.length };
      }),
    
    lookupMOT: publicProcedure
      .input(z.object({ registration: z.string() }))
      .mutation(async ({ input }) => {
        const { getMOTHistory, getLatestMOTExpiry } = await import("./motApi");
        const { getVehicleDetails } = await import("./dvlaApi");
        
        // Fetch from both APIs
        const [motData, dvlaData] = await Promise.all([
          getMOTHistory(input.registration).catch(() => null),
          getVehicleDetails(input.registration).catch(() => null),
        ]);
        
        if (!motData && !dvlaData) {
          throw new Error("Vehicle not found");
        }
        
        const motExpiry = motData ? getLatestMOTExpiry(motData) : null;
        
        return {
          registration: input.registration,
          make: motData?.make || dvlaData?.make,
          model: motData?.model,
          motExpiryDate: motExpiry,
          colour: motData?.primaryColour || dvlaData?.colour,
          fuelType: motData?.fuelType || dvlaData?.fuelType,
          taxStatus: dvlaData?.taxStatus,
          taxDueDate: dvlaData?.taxDueDate,
        };
      }),
    
    update: publicProcedure
      .input(z.object({
        id: z.number(),
        type: z.enum(["MOT", "Service"]).optional(),
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
      }))
      .mutation(async ({ input }) => {
        const { getAllReminders, updateReminder } = await import("./db");
        const { sendSMS, generateMOTReminderMessage, generateServiceReminderMessage } = await import("./smsService");
        
        // Get reminder details
        const reminders = await getAllReminders();
        const reminder = reminders.find(r => r.id === input.id);
        
        if (!reminder) {
          throw new Error("Reminder not found");
        }
        
        // Generate message
        const message = reminder.type === "MOT"
          ? generateMOTReminderMessage({
              customerName: reminder.customerName || "Customer",
              registration: reminder.registration,
              dueDate: new Date(reminder.dueDate),
            })
          : generateServiceReminderMessage({
              customerName: reminder.customerName || "Customer",
              registration: reminder.registration,
              dueDate: new Date(reminder.dueDate),
            });
        
        // Send WhatsApp message
        const result = await sendSMS({
          to: input.phoneNumber,
          message,
        });
        
        if (!result.success) {
          throw new Error(result.error || "Failed to send message");
        }
        
        // Update reminder status
        await updateReminder(input.id, {
          status: "sent",
          sentAt: new Date(),
        });
        
        return { success: true, messageId: result.messageId };
      }),
  }),
});

export type AppRouter = typeof appRouter;
