import { z } from "zod";
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { vehicles } from "../../drizzle/schema";
import { AI_MODEL_GUIDE, getRuntimeProvider, hasAIKey } from "./aiProvider";
import { fetchTrakm8ObdImage } from "./trakm8";

// Generates (and caches on the vehicle) the Service Reset & OBD card: how to reset the
// service light on THIS car + where the OBD port is, with the Trakm8 interior diagram.
// Called from the AI router's mutation AND from getRichPDF when a diagnostic/service
// job sheet is printed for a vehicle that doesn't have a card yet.
export async function generateServiceResetCard(vehicleId: number) {
  if (!hasAIKey()) {
    throw new Error("AI API key is not configured. Please set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY in your .env");
  }
  const db = await getDb();
  if (!db) throw new Error("Database error");
  const [veh] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
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
  const prevImage = (veh as any).serviceResetInfo?.obdImage;
  const card = {
    ...object,
    // Keep a previously-captured diagram if this run's Trakm8 lookup fails.
    ...(obdImage
      ? { obdImage: { locationId: obdImage.locationId, matched: obdImage.matched, source: "Trakm8 OBD checker", dataBase64: obdImage.dataBase64 } }
      : (prevImage ? { obdImage: prevImage } : {})),
    generatedAt: new Date().toISOString(),
  };
  await db.update(vehicles).set({ serviceResetInfo: card }).where(eq(vehicles.id, vehicleId));
  return card;
}
