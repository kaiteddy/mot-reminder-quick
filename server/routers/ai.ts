import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { appSettings, serviceHistory, serviceLineItems, vehicles } from "../../drizzle/schema";
import { eq, like, desc } from "drizzle-orm";
import { fetchTrakm8ObdImage } from "../services/trakm8";

// Cheapest current OpenAI model (replaces the legacy gpt-4o-mini).
// Override via AI_MODEL env without a code change (e.g. gpt-5.4-mini for higher quality).
const AI_MODEL = process.env.AI_MODEL || "gpt-5.4-nano";
// The Job Guide is technical reference content (steps/specs/cautions) where nano-tier
// quality visibly disappoints — default it to the higher-quality mini tier instead.
const AI_MODEL_GUIDE = process.env.AI_MODEL_GUIDE || "gpt-5.4-mini";

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

// Static rules + worked examples for generateJobSpec's system prompt. The target style is
// a REAL UK garage's terse invoice note — not a training-manual checklist. See the worked
// examples below, copied from an actual job sheet.
const JOB_SPEC_SYSTEM = `You are a UK master technician writing a job description exactly as it would appear, printed, on a real garage invoice/job sheet. Match a real technician's terse handwritten-note style — NOT a structured, instructional checklist.

OUTPUT SHAPE — return "lines": a plain array of strings, one per printed line (an empty string "" is a blank spacer line). Do NOT put "-" or "•" or any bullet marker at the start of a line. Do NOT bold or wrap anything in ** — GA4 staff bold a line themselves afterwards if they want a title.

STYLE, copied from a real invoice:
1. If (and only if) this was a diagnostic job (a fault was found, not just a known part swap), open with a short heading line ("Carry out Diagnostic") and the customer's symptom ("Engine Management Light on"), then an empty string "" as its own array entry (a blank spacer line — always include this, never skip it), then ONE plain-English sentence stating the symptom and what was found — written as prose, not a fragment: "The car was stalling and had lack of power. We found the valve control unit controller assembly required replacement."
2. If reaching the faulty/target part needs removing other parts first, add a line "To obtain access to [target part]" then list ONLY the parts removed to get there, one per line, as BARE NOUNS with no leading verb — "Battery", "Battery casing", "Engine cover" — not "Remove the battery". Only include this step at all if real disassembly was needed; skip it entirely for a part that's already accessible (e.g. brake pads, a bulb).
3. The actual repair is ONE line: "To supply and fit [part]" for a replacement, or "To remove and replace [part]" when there's no separate access step.
4. If step 2 was used, close reassembly with exactly one line: "Reassemble per removal" — never re-list the removed parts in reverse.
5. Close with ONE short line: "Test" (diagnostic/mechanical repairs) or "Road test" (anything affecting ride/handling/braking). Never elaborate this into a sentence.
6. For a routine service (no diagnosis, no access step), skip straight to a heading line ("Carry out Interim Service") then the actual tasks, each as a short plain line — still no bullets, still no verb padding — then "Test".
7. UK terms. No prices, no part numbers. Total length: as short as the real job allows — most single jobs are 4-11 lines. Only go longer when the description genuinely names several distinct jobs; keep each job's own lines grouped together in one list.

EXAMPLE 1 — diagnostic + repair (copied from a real job sheet):
Carry out Diagnostic
Engine Management Light on

The car was stalling and had lack of power. We found the valve control unit controller assembly required replacement.
To obtain access to Valvematic unit
Battery
Battery casing
Engine cover
Engine cover gasket
To supply and fit Valvematic unit
Reassemble per removal
Test

EXAMPLE 2 — simple part swap, no access step needed (Front Brake Discs & Pads):
To remove and replace front brake discs and pads
Bleed brakes and check fluid level
Road test

EXAMPLE 3 — routine service (Interim Service):
Carry out Interim Service
Drain and replace engine oil and filter
Top up screen wash and check coolant level
Check tyre condition and pressures
Check brake pads and discs front and rear
Check all exterior lights and wipers
Reset service indicator
Road test

EXAMPLE 4 — MOT failure repair, access step needed (Front Suspension):
To obtain access to front suspension components
Front road wheels
To remove and replace front lower arm bushes, ARB link and offside track rod end
Set toe angle to manufacturer specification
Reassemble per removal
Road test

EXAMPLE 5 — several distinct jobs together (Service + separate diagnostic repair):
Carry out Interim Service
Drain and replace engine oil and filter
Check all fluid levels
Reset service indicator

Carry out Diagnostic
ABS warning light on
We found the offside front wheel speed sensor had failed
To remove and replace offside front wheel speed sensor
Clear fault codes
Road test`;

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

  // Smart job specification: the technician types what job was done; the AI returns the
  // printed job-sheet/invoice description as plain lines, in real terse garage-note style
  // (see JOB_SPEC_SYSTEM) rather than a structured instructional checklist.
  generateJobSpec: publicProcedure
    .input(z.object({
      job: z.string().min(2),
      make: z.string().optional(), model: z.string().optional(), derivative: z.string().optional(),
      year: z.number().optional(), fuelType: z.string().optional(), engineCode: z.string().optional(), engineCC: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!hasAIKey()) {
        throw new Error("AI API key is not configured. Please set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY in your .env");
      }
      const veh = [input.year, input.make, input.model, input.derivative].filter(Boolean).join(" ") || "the vehicle";
      const detail = [input.engineCode && `engine ${input.engineCode}`, input.engineCC && `${input.engineCC}cc`, input.fuelType].filter(Boolean).join(", ");
      const userPrompt = `A UK garage technician is carrying out this job on ${veh}${detail ? ` (${detail})` : ""}:\n\n"${input.job}"`;

      try {
        const provider = getRuntimeProvider();
        const { object } = await generateObject({
          model: provider(AI_MODEL),
          system: JOB_SPEC_SYSTEM,
          prompt: userPrompt,
          schema: z.object({ lines: z.array(z.string()).min(3).max(16) }),
        });
        return object;
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

  // Workshop "Job Guide" (inspired by 7zap's AI Mechanic, which is paywalled in-page and
  // can't be embedded): for the job on a document, generate a structured guide — what the
  // job is, how it's done on THIS vehicle, parts to check/replace together, and cautions.
  // Saved onto the document (serviceHistory.jobGuide) so it persists, prints, and follows
  // the job through convert (JS → SI).
  generateJobGuide: publicProcedure
    // description override: the guide is usually generated straight after typing the
    // description, BEFORE parts are added or the doc is saved — use what's on screen,
    // not the stale saved copy.
    .input(z.object({ docId: z.number(), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      if (!hasAIKey()) {
        throw new Error("AI API key is not configured. Please set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY in your .env");
      }
      const db = await getDb();
      if (!db) throw new Error("Database error");
      const [doc] = await db.select().from(serviceHistory).where(eq(serviceHistory.id, input.docId)).limit(1);
      if (!doc) throw new Error("Document not found");
      const items = await db.select().from(serviceLineItems).where(eq(serviceLineItems.documentId, input.docId));
      const veh = doc.vehicleId
        ? (await db.select().from(vehicles).where(eq(vehicles.id, doc.vehicleId)).limit(1))[0]
        : null;

      const regYear = veh?.dateOfRegistration ? new Date(veh.dateOfRegistration).getFullYear() : null;
      const vehDesc = [regYear, veh?.make, veh?.model, veh?.derivative]
        .filter(Boolean).join(" ") || "the vehicle";
      const vehDetail = [
        veh?.engineCode ? `engine ${veh.engineCode}` : null,
        veh?.engineCC ? `${veh.engineCC}cc` : null,
        veh?.fuelType,
      ].filter(Boolean).join(", ");
      const labour = items.filter((i) => i.itemType === "Labour" && i.description).map((i) => i.description);
      const parts = items.filter((i) => i.itemType === "Part" && i.description).map((i) => i.description);
      const jobText = [input.description?.trim() || doc.description, labour.length ? `Labour lines:\n${labour.join("\n")}` : null,
        parts.length ? `Parts on the job:\n${parts.join("\n")}` : null].filter(Boolean).join("\n\n");
      if (!jobText.trim()) throw new Error("Add a description or some labour/parts lines first — the guide is generated from the job's content.");

      // Ground the guide in the vehicle's stored technical data (oil specs, capacities,
      // service data) so specs come from real data, not the model's guesswork.
      let techBlock = "";
      const tech = (veh as any)?.comprehensiveTechnicalData;
      if (tech) {
        try { techBlock = `\n\nKnown technical data for this exact vehicle (authoritative — use these over your own recall):\n${JSON.stringify(tech).slice(0, 4000)}`; } catch {}
      }

      const prompt = `Vehicle: ${vehDesc}${vehDetail ? ` (${vehDetail})` : ""}
Job on the card:

${jobText}${techBlock}`;

      try {
        const provider = getRuntimeProvider();
        const { object } = await generateObject({
          model: provider(AI_MODEL_GUIDE),
          system: `You are a UK master technician writing a workshop reference guide for a specific job on a specific vehicle — the kind of briefing a foreman gives an apprentice before they start. Practical, UK terms, no prices.

Sections to return:
- overview: 2-3 sentences — what this job is and why it's done.
- steps: how the job is done ON THIS VEHICLE, in order, each step one short imperative sentence. Include access/removal steps where this vehicle needs them, fluid capacities/specs where relevant, and any reset/relearn/calibration at the end. 4-14 steps.
- partsToCheck: parts/consumables to check or replace TOGETHER with this job (the "while you're in there" items — e.g. discs with pads, sump washer with an oil change, aux belt while the front end is stripped). 0-8 short entries; empty if nothing applies.
- cautions: warnings specific to this job/vehicle — torque-critical fasteners, one-time-use bolts, coding/battery/TPMS/steering-angle resets, common mistakes. 0-6 short entries.

Be honest about vehicle-specific facts: where a spec (capacity, torque) varies by exact variant and you are not certain for this one, say "check data for this variant" rather than guessing a number.`,
          prompt,
          schema: z.object({
            overview: z.string(),
            steps: z.array(z.string()).min(3).max(14),
            partsToCheck: z.array(z.string()).max(8),
            cautions: z.array(z.string()).max(6),
          }),
        });
        const guide = { ...object, generatedAt: new Date().toISOString() };
        await db.update(serviceHistory).set({ jobGuide: guide }).where(eq(serviceHistory.id, input.docId));
        return guide;
      } catch (e: any) {
        console.error("AI generateJobGuide error:", e);
        throw new Error("Failed to generate job guide: " + e.message);
      }
    }),

  // Per-vehicle workshop card: how to reset the service/oil-service light on THIS car and
  // where its OBD port is. Vehicle-level knowledge (not job-level), so it's cached on the
  // vehicle record and reused across every job on the car.
  generateServiceReset: publicProcedure
    .input(z.object({ vehicleId: z.number() }))
    .mutation(async ({ input }) => {
      if (!hasAIKey()) {
        throw new Error("AI API key is not configured. Please set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY in your .env");
      }
      const db = await getDb();
      if (!db) throw new Error("Database error");
      const [veh] = await db.select().from(vehicles).where(eq(vehicles.id, input.vehicleId)).limit(1);
      if (!veh) throw new Error("Vehicle not found");
      const regYear = veh.dateOfRegistration ? new Date(veh.dateOfRegistration).getFullYear() : null;
      const vehDesc = [regYear, veh.make, veh.model, veh.derivative].filter(Boolean).join(" ");
      if (!vehDesc.trim()) throw new Error("The vehicle needs at least a make/model on record first");
      const detail = [veh.engineCode && `engine ${veh.engineCode}`, veh.engineCC && `${veh.engineCC}cc`, veh.fuelType].filter(Boolean).join(", ");

      let techBlock = "";
      if (veh.comprehensiveTechnicalData) {
        try { techBlock = `\n\nKnown technical data for this exact vehicle (authoritative where relevant):\n${JSON.stringify(veh.comprehensiveTechnicalData).slice(0, 2500)}`; } catch {}
      }

      // Trakm8 diagram lookup runs alongside the AI call — neither blocks the other.
      const obdImagePromise = fetchTrakm8ObdImage(veh.make, veh.model, regYear);

      try {
        const provider = getRuntimeProvider();
        const { object } = await generateObject({
          model: provider(AI_MODEL_GUIDE),
          system: `You are a UK master technician writing a quick-reference card for a specific vehicle. Two things only: where the OBD-II diagnostic port is, and how to reset the service/oil-service indicator. Practical, UK terms.

Rules:
- obdLocation: one or two sentences — exact physical location of the OBD port on this vehicle (e.g. "under the driver's side dash above the pedals, behind a flip-down cover"). If it genuinely varies within this model, say where to check.
- resetSteps: the manual (button/stalk) reset procedure for the service indicator on this vehicle, one short imperative step per entry. If this model has no manual reset and NEEDS a diagnostic tool, return a single step saying exactly that.
- alternatives: 0-3 entries — a different procedure used by other model-years/clusters of the same model, each as one compact entry ("Pre-2019 cluster: ..."), or empty.
- cautions: 0-3 entries — e.g. "does not reset the oil-life counter", "ignition on, engine off", hybrid-specific notes.
- HONESTY: procedures vary by year/cluster. If you are not confident for this exact year, give the most common procedure for this generation and add a caution that it varies — never invent button names.`,
          prompt: `Vehicle: ${vehDesc}${detail ? ` (${detail})` : ""}${techBlock}`,
          schema: z.object({
            obdLocation: z.string(),
            resetSteps: z.array(z.string()).min(1).max(12),
            alternatives: z.array(z.string()).max(3),
            cautions: z.array(z.string()).max(3),
          }),
        });
        const obdImage = await obdImagePromise;
        const card = {
          ...object,
          ...(obdImage ? { obdImage: { locationId: obdImage.locationId, matched: obdImage.matched, source: "Trakm8 OBD checker", dataBase64: obdImage.dataBase64 } } : {}),
          generatedAt: new Date().toISOString(),
        };
        await db.update(vehicles).set({ serviceResetInfo: card }).where(eq(vehicles.id, input.vehicleId));
        return card;
      } catch (e: any) {
        console.error("AI generateServiceReset error:", e);
        throw new Error("Failed to generate the service reset card: " + e.message);
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
