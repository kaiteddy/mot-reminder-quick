import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { generateText, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { getDb } from "../db";
import { appSettings, serviceHistory, serviceLineItems, vehicles } from "../../drizzle/schema";
import { eq, like, desc } from "drizzle-orm";

export const aiRouter = router({
  generateMOTEstimate: publicProcedure
    .input(z.object({
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().optional(),
      defects: z.array(z.object({
        text: z.string(),
        type: z.string(),
        dangerous: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured.");
      }

      const db = await getDb();
      let pricingRules = "";
      let historicalContext = "";

      if (db) {
        const settings = await db.select().from(appSettings).where(eq(appSettings.keyName, 'pricing_knowledge')).limit(1);
        if (settings.length > 0 && settings[0].value) {
          const rules = settings[0].value as any;
          pricingRules = `
CRITICAL PRICING RULES TO USE (DO NOT DEVIATE):
- Hourly Labour Rate: £${rules.labourRate || "70"}
- Fixed MOT Cost: £${rules.motCost || "45"}
- Fixed Service Labour (Small/Medium): £${rules.serviceMedium || "124"}
${rules.customKnowledge ? `\nADDITIONAL PRICING KNOWLEDGE:\n${rules.customKnowledge}` : ''}
`;
        }

        // Fetch historical pricing intelligence
        if (input.make) {
          try {
            const recentHistory = await db.select({
              desc: serviceLineItems.description,
              price: serviceLineItems.unitPrice,
              type: serviceLineItems.itemType,
              date: serviceHistory.dateIssued,
              model: vehicles.model
            })
            .from(serviceLineItems)
            .innerJoin(serviceHistory, eq(serviceLineItems.documentId, serviceHistory.id))
            .innerJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
            .where(like(vehicles.make, `%${input.make}%`))
            .orderBy(desc(serviceHistory.createdAt))
            .limit(30);

            if (recentHistory.length > 0) {
              historicalContext = `
HISTORICAL PRICING INTELLIGENCE FOR ${input.make.toUpperCase()}:
You MUST use these actual past invoices from our system to accurately price similar items for this estimate:
${recentHistory.filter(h => h.desc && h.price).map(h => `- ${h.model || 'Vehicle'}: ${h.desc} - £${Number(h.price).toFixed(2)} (${h.type || 'Parts/Labour'})`).join("\n")}
`;
            }
          } catch (e) {
            console.error("[AI] Failed to fetch historical invoice context", e);
          }
        }
      }

      const prompt = `You are an expert UK mechanic and garage owner.
A customer has brought in a ${input.year ? input.year + " " : ""}${input.make || "vehicle"} ${input.model || ""} that just failed its MOT test.
Here are the exact MOT defects from the test history:
${input.defects.map(d => `- [${d.type}${d.dangerous ? " - DANGEROUS" : ""}] ${d.text}`).join("\n")}

Your task is to provide a breakdown of the items that need to be replaced or fixed to pass the MOT, along with sensible advisory repairs. Provide realistic estimated costs for this specific UK independent garage based on their pricing rules context.
${pricingRules}
${historicalContext}

Please format the response strictly as a JSON object matching this structure:
{
  "repairs": [
    {
      "classification": "DANGEROUS | MAJOR | MINOR | ADVISORY",
      "item": "e.g., Nearside Front Tyre",
      "issue": "Brief description of the issue to fix",
      "partsCost": 90, // Number in GBP
      "labourCost": 15, // Number in GBP
      "estimatedTotal": 105, // Number in GBP
      "notes": "Any mechanic notes, optional"
    }
  ],
  "summary": {
    "minimumToPass": "£xyz - £xyz",
    "withAdvisories": "£xyz - £xyz"
  },
  "mechanicNotes": [
    "Useful observation 1",
    "Useful observation 2"
  ]
}

Only return the JSON. Do not include markdown formatting like \`\`\`json.`;

      try {
        const { object } = await generateObject({
          model: openai('gpt-4o-mini'),
          system: "You are an expert UK mechanic and garage manager.",
          prompt: prompt,
          schema: z.object({
            repairs: z.array(z.object({
              classification: z.enum(["DANGEROUS", "MAJOR", "MINOR", "ADVISORY"]),
              item: z.string(),
              issue: z.string(),
              partsCost: z.number(),
              labourCost: z.number(),
              estimatedTotal: z.number(),
              notes: z.string(),
            })),
            summary: z.object({
              minimumToPass: z.string(),
              withAdvisories: z.string(),
            }),
            mechanicNotes: z.array(z.string()),
          }),
        });

        return object;

      } catch (e: any) {
        console.error("AI Generation Error:", e);
        throw new Error("Failed to generate estimate: " + e.message);
      }
    }),

  explainDefect: publicProcedure
    .input(z.object({
      defect: z.string(),
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().optional()
    }))
    .mutation(async ({ input }) => {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured.");
      }

      const prompt = `You are a friendly, helpful UK mechanic talking to a customer who knows absolutely nothing about cars. They received this MOT defect on their ${input.year ? input.year + " " : ""}${input.make || "vehicle"} ${input.model || ""}:

Defect: "${input.defect}"

Your job is to translate this into plain English. 
CRITICAL INSTRUCTIONS:
1. Explain what the car part actually DOES in the simplest terms possible (e.g., if it says "drive shaft", explain that it's the metal bar that spins the wheels to make the car move).
2. Explain WHY it is bad or dangerous that it's broken or worn out.
3. Absolutely NO mechanic jargon. Use simple analogies if helpful.
4. Keep it very short (3 sentences maximum). 
5. Do not mention prices.`;

      try {
        const { text } = await generateText({
          model: openai('gpt-4o-mini'),
          system: "You are a helpful, friendly UK mechanic.",
          prompt: prompt,
        });

        return { explanation: text };
      } catch (e: any) {
        console.error("AI Generation Error:", e);
        throw new Error("Failed to generate explanation: " + e.message);
      }
    }),

  getPricingKnowledge: publicProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return null;
      const settings = await db.select().from(appSettings).where(eq(appSettings.keyName, 'pricing_knowledge')).limit(1);
      if (settings.length > 0) {
        return settings[0].value;
      }
      return {
        labourRate: 70,
        motCost: 45,
        serviceSmall: 124,
        serviceMedium: 124,
        serviceLarge: 154,
        customKnowledge: ""
      };
    }),

  savePricingKnowledge: publicProcedure
    .input(z.object({
      labourRate: z.number(),
      motCost: z.number(),
      serviceSmall: z.number(),
      serviceMedium: z.number(),
      serviceLarge: z.number(),
      customKnowledge: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database error");
      
      const existing = await db.select().from(appSettings).where(eq(appSettings.keyName, 'pricing_knowledge')).limit(1);
      
      if (existing.length > 0) {
        await db.update(appSettings)
          .set({ value: input })
          .where(eq(appSettings.keyName, 'pricing_knowledge'));
      } else {
        await db.insert(appSettings).values({
          keyName: 'pricing_knowledge',
          value: input
        });
      }
      return { success: true };
    }),
});
