import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { appSettings, serviceHistory, serviceLineItems, vehicles } from "../../drizzle/schema";
import { eq, like, desc } from "drizzle-orm";

// generateJobSpec runs on Claude instead of the OpenAI/Forge path the rest of this
// router uses — see JOB_SPEC_SYSTEM below for why (prompt caching needs a large,
// static system prompt to actually activate).
const anthropic = new Anthropic();

// Cheapest current OpenAI model (replaces the legacy gpt-4o-mini).
// Override via AI_MODEL env without a code change (e.g. gpt-5.4-mini for higher quality).
const AI_MODEL = process.env.AI_MODEL || "gpt-5.4-nano";

// AI is usable when an OpenAI key (OPENAI_API_KEY) or the Forge fallback (BUILT_IN_FORGE_API_KEY)
// is configured in the environment — Vercel in production, .env locally.
const hasAIKey = () => Boolean(process.env.OPENAI_API_KEY || ENV.forgeApiKey);

const getRuntimeProvider = () => {
  const activeKey = process.env.OPENAI_API_KEY;

  return activeKey
    ? createOpenAI({ apiKey: activeKey, headers: { Authorization: `Bearer ${activeKey}` } })
    : createOpenAI({
        baseURL: ENV.forgeApiUrl ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1` : "https://forge.manus.im/v1",
        apiKey: ENV.forgeApiKey,
      });
};

// Static rules + worked examples for generateJobSpec — identical on every call, so it's
// the prefix Claude's prompt cache reuses. Kept as one frozen constant (never
// interpolated) so its rendered bytes never change; a single byte difference here would
// invalidate the cache for every technician's request, not just this one.
const JOB_SPEC_SYSTEM = `You are an expert UK master technician writing job specifications as a list of clear, short workshop steps for the job sheet / invoice.

RULES:
- Cover EVERYTHING in the job description. If several jobs or tasks are described, include the steps for EVERY one of them — do not drop, merge or summarise away any job the user mentioned.
- Use as many bullets as needed for the full scope of ALL the work: gaining access (panels, wheels, covers), each replacement/repair itself, fluids/bleeding, adjustments, torque/calibration, and a final check / road test where relevant.
- ONE step per bullet, kept SHORT — a few words to a single line. Do NOT cram several steps into one bullet with semicolons or "and then…", and no "in order to / to ensure…" filler.
- Specific to THIS vehicle where it matters (correct part, fluid spec, torque, calibration).
- UK terminology. No prices, no part numbers, no preamble.
- Title: 3–6 words naming the job (or covering the main theme if several jobs, e.g. "Service & Repairs"). Do NOT repeat the make/model.

EXAMPLE 1 — single job (Front Brake Discs & Pads):
Title: "Front Brake Discs & Pads"
- Raise vehicle and remove front road wheels
- Remove calipers and old pads
- Remove old discs and clean hub faces
- Fit new discs and pads
- Refit calipers and lubricate slider pins
- Check fluid, bleed brakes if required
- Refit wheels and torque to spec
- Road test and check braking

EXAMPLE 2 — routine service (Interim Service):
Title: "Interim Service"
- Raise vehicle on ramp and carry out visual inspection
- Drain and replace engine oil
- Remove and replace oil filter
- Reset sump plug washer and torque to spec
- Top up screen wash and check coolant level
- Check tyre condition and pressures, adjust to spec
- Check brake pad and disc wear front and rear
- Check all exterior lights and wipers
- Reset service indicator
- Road test vehicle

EXAMPLE 3 — several jobs mentioned together (Full Service & Cambelt Replacement):
Title: "Full Service & Cambelt"
- Raise vehicle on ramp and carry out full visual inspection
- Drain and replace engine oil and filter
- Replace air filter and cabin/pollen filter
- Check and top up all fluid levels
- Remove auxiliary drive belt and covers to access cambelt
- Fit new cambelt, tensioner and idler pulleys to correct tension
- Refit auxiliary belt and covers
- Check and reset service indicator
- Recheck for leaks after running engine to temperature
- Road test vehicle

EXAMPLE 4 — diagnostic + repair (Engine Warning Light — Coil Pack Fault):
Title: "Engine Fault Diagnosis & Repair"
- Connect diagnostic equipment and retrieve stored fault codes
- Interpret codes and identify cylinder 3 misfire
- Inspect ignition coil pack and spark plug on cylinder 3
- Replace faulty ignition coil pack
- Replace spark plug on affected cylinder
- Clear fault codes and run engine to confirm fix
- Road test and recheck for fault code return

EXAMPLE 5 — MOT failure repair (Front Suspension & Steering):
Title: "Front Suspension & Steering Repair"
- Raise vehicle on ramp and remove front road wheels
- Inspect front suspension, steering and driveshaft components
- Remove and replace worn front lower arm bushes
- Remove and replace offside front anti-roll bar drop link
- Remove and replace nearside front outer track rod end
- Set toe angle to manufacturer specification
- Torque all suspension and steering fixings to spec
- Refit wheels and torque to spec
- Road test and recheck for noise or vibration

When several jobs are listed together, keep each job's steps grouped in the order the
jobs were described, but still return them as ONE combined bullet list under a single
title covering all of them — do not return separate lists per job.

COMMON PHRASING TO MATCH:
- "Raise vehicle" / "raise on ramp" for anything needing the car off the ground.
- "Torque to spec" rather than a made-up number, unless the job description gives one.
- "Road test" as the closing step whenever the job affects how the car drives, brakes,
  or steers — omit it only for jobs with no effect on driving (e.g. bulb replacement,
  interior trim, infotainment).
- Prefer "remove and replace" over separate remove/replace bullets for a simple part swap;
  split into separate steps only when there's meaningful work between them (cleaning a
  mating face, bleeding a system, calibrating a sensor).
- "Check and reset service indicator" only for service-type jobs, never for one-off repairs.`;

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
      if (!hasAIKey()) {
        throw new Error("AI API key is not configured. Please set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY in your .env");
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
        const provider = getRuntimeProvider();
        const { object } = await generateObject({
          model: provider(AI_MODEL),
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
      if (!hasAIKey()) {
        throw new Error("AI API key is not configured. Please set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY in your .env");
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
        const provider = getRuntimeProvider();
        const { text } = await generateText({
          model: provider(AI_MODEL),
          system: "You are a helpful, friendly UK mechanic.",
          prompt: prompt,
        });

        return { explanation: text };
      } catch (e: any) {
        console.error("AI Generation Error:", e);
        throw new Error("Failed to generate explanation: " + e.message);
      }
    }),

  // Smart job specification: the technician types what job was done; the AI returns a
  // vehicle-aware bullet-point breakdown of the work carried out, for the job-sheet/invoice.
  //
  // Runs on Claude (Sonnet 5) instead of the OpenAI/Forge path above, with prompt
  // caching on the system prompt — every technician's request shares the exact same
  // rules + worked examples, only the vehicle/job details in the user turn change, so
  // this is the one call in this router where caching pays for itself. The worked
  // examples below aren't just instructional — they also need to be long enough to
  // clear Sonnet's cache-eligible prefix minimum (1024 tokens), or cache_control is a
  // no-op (silently: no error, no discount, cache_creation_input_tokens stays 0).
  generateJobSpec: publicProcedure
    .input(z.object({
      job: z.string().min(2),
      make: z.string().optional(), model: z.string().optional(), derivative: z.string().optional(),
      year: z.number().optional(), fuelType: z.string().optional(), engineCode: z.string().optional(), engineCC: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("AI API key is not configured. Please set ANTHROPIC_API_KEY in your .env");
      }
      const veh = [input.year, input.make, input.model, input.derivative].filter(Boolean).join(" ") || "the vehicle";
      const detail = [input.engineCode && `engine ${input.engineCode}`, input.engineCC && `${input.engineCC}cc`, input.fuelType].filter(Boolean).join(", ");
      const userPrompt = `A UK garage technician is carrying out this job on ${veh}${detail ? ` (${detail})` : ""}:\n\n"${input.job}"`;

      try {
        const message = await anthropic.messages.parse({
          model: "claude-sonnet-5",
          max_tokens: 2048,
          system: [{ type: "text", text: JOB_SPEC_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userPrompt }],
          output_config: {
            format: zodOutputFormat(z.object({ title: z.string(), bullets: z.array(z.string()).min(4).max(20) })),
          },
        });
        if (!message.parsed_output) throw new Error("Model response didn't match the expected schema");
        return message.parsed_output;
      } catch (e: any) {
        console.error("AI Generation Error:", e);
        throw new Error("Failed to generate job spec: " + e.message);
      }
    }),

  // From MOT defects/advisories, work out the parts/consumables a garage would replace to fix
  // them — used by the MOT Advisories tab to build a job (defects → description + these parts).
  partsForDefects: publicProcedure
    .input(z.object({
      defects: z.array(z.string().min(2)).min(1).max(15),
      make: z.string().optional(), model: z.string().optional(), year: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!hasAIKey()) throw new Error("AI API key is not configured. Set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY in .env");
      const veh = [input.year, input.make, input.model].filter(Boolean).join(" ") || "the vehicle";
      const prompt = `A UK MOT test recorded these defects/advisories on ${veh}:
${input.defects.map((d, i) => `${i + 1}. ${d}`).join("\n")}

List the parts or consumables a garage would replace to put these right (e.g. bulbs, wiper blades, brake pads/discs, tyres, bushes). UK terms, short part names — include the common spec/type in brackets where obvious (e.g. "Stop lamp bulb (P21W)"). One entry per distinct part. SKIP any defect that needs only adjustment, cleaning, lubrication or a top-up with no part to buy. If none of the defects need a part, return an empty list.`;
      try {
        const provider = getRuntimeProvider();
        const { object } = await generateObject({
          model: provider(AI_MODEL),
          system: "You are a UK MOT tester and parts advisor. Be concise and practical — only real parts, no labour, no prices.",
          prompt,
          schema: z.object({ parts: z.array(z.object({ description: z.string() })).max(15) }),
        });
        return object;
      } catch (e: any) {
        console.error("AI partsForDefects error:", e);
        throw new Error("Failed to work out parts: " + e.message);
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

  getHistoricalPricingMetrics: publicProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const { sql } = await import("drizzle-orm");
      
      const metrics = await db.select({
        partName: serviceLineItems.description,
        frequency: sql<number>`COUNT(*)`,
        avgPrice: sql<number>`AVG(${serviceLineItems.unitPrice})`,
        minPrice: sql<number>`MIN(${serviceLineItems.unitPrice})`,
        maxPrice: sql<number>`MAX(${serviceLineItems.unitPrice})`,
      })
      .from(serviceLineItems)
      .where(sql`${serviceLineItems.unitPrice} > 0`)
      .groupBy(serviceLineItems.description)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(500);

      return metrics;
    }),
});
