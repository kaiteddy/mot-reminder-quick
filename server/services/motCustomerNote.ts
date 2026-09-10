/**
 * The plain-English MOT note that goes out with "your car is ready to collect".
 *
 * "Nearside Rear Tyre worn close to legal limit/worn on edge (5.2.3 (e))" tells a customer nothing,
 * and the questions come back by phone. This turns what the tester recorded into two or three
 * sentences they can act on: what it is, whether it is fine for now, and when to do something.
 *
 * Deliberately separate from ai.explainDefect, which explains ONE item at length for staff and
 * caches per wording. This note covers the whole test at once and has to fit a text message — and
 * one WhatsApp template variable, which Twilio caps at 256 characters.
 *
 * Staff always see the note, and can change it, before anything is sent.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { AI_MODEL_GUIDE, getRuntimeProvider, hasAIKey } from "./aiProvider";
import { MOT_NOTE_CLOSE, MOT_NOTE_LEAD, MOT_NOTE_MAX, cleanMotNote, toPlainText } from "../../shared/carReadyMessage";

export type MotItem = { type?: string | null; text: string; dangerous?: boolean | null };
export type MotNoteUrgency = "monitor" | "plan" | "soon" | "urgent";

/** "(5.2.3 (d) (ii))" — the MOT manual reference. Meaningless to a customer, noise to the model. */
const MANUAL_REF = /\s*\(\d+(?:\.\d+)+(?:\s*\([^()]*\))*\)/g;

/**
 * The items worth telling the customer about, tidied. PRS items were put right during the test
 * itself — in the trial the model described one as "will be adjusted", which is exactly the kind of
 * promise this note must never make — so they never reach it. Repeats of one wording collapse.
 */
export function itemsForNote(items: MotItem[]): MotItem[] {
  const seen = new Set<string>();
  const out: MotItem[] = [];
  for (const item of items) {
    const type = String(item.type || "").trim().toUpperCase();
    if (type === "PRS") continue;
    const text = String(item.text || "").replace(MANUAL_REF, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = `${type}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: type || "ADVISORY", text, dangerous: !!item.dangerous });
  }
  return out;
}

const SYSTEM = `You write one short note for a text message from a UK family garage to a customer who knows nothing about cars. The text has already told them their car is ready to collect, and introduces your note with "${MOT_NOTE_LEAD}". Straight after your note it says "${MOT_NOTE_CLOSE}" Write only the middle: what the MOT tester recorded, in plain everyday English, and whether they need to do anything.

Rules:
- At most ${MOT_NOTE_MAX} characters including spaces. Aim for 120-220. It is a text message, so be brief.
- Normal sentences, each starting with a capital letter. Open with the result in a few words, e.g. "It passed, but ..." or "It failed because ...".
- Plain English. No jargon and no abbreviations: say "tyre pressure warning light", never "TPMS". No reference numbers, no prices, no sales pressure, no capitals for emphasis.
- Sides: nearside means left and offside means right, so "n/s/f" is front left and "o/s/r" is rear right. Write "front left tyre" or "both rear tyres". Never write nearside, offside or those abbreviations.
- A tyre worn close to the legal limit: say its tread is getting close to the legal limit. Do not call the tyre "low".
- Merge items that are really one point: both rear tyres worn and cracking is ONE point.
- Most important point first: a FAILED test, then DANGEROUS, MAJOR, MINOR and ADVISORY items in that order. Within those, brakes, tyres, steering, suspension and lights come before warning lights, wipers and anything that is not a fault.
- A DANGEROUS item means the car should not be driven until it is fixed: say so. A MAJOR item has to be fixed for the car to pass: say that, and never say the car cannot be driven unless an item is DANGEROUS. A MINOR item still passes but should be repaired soon.
- For each point say what it means for them: whether it is fine for now, and roughly when to act ("worth replacing in the next few weeks", "nothing to do yet, we will look again at the next service").
- Only what the tester recorded. Never claim anything has been, or will be, fixed, adjusted or replaced.
- When space is short, leave minor points out rather than cramming. Drop things that are not faults first, such as a child seat stopping a seat belt being fully checked.
- No greeting, no sign-off, and do not repeat the lead-in or the closing line.
- One paragraph: no line breaks, no lists, no emoji. Plain keyboard characters only: straight quotes and apostrophes, hyphens not dashes.`;

const schema = z.object({
  note: z.string(),
  urgency: z.enum(["monitor", "plan", "soon", "urgent"]),
});

const RANK: MotNoteUrgency[] = ["monitor", "plan", "soon", "urgent"];

/** A floor under the model's urgency: it may soften the wording, never the severity. */
function floorUrgency(u: MotNoteUrgency, items: MotItem[], result?: string | null): MotNoteUrgency {
  let floor: MotNoteUrgency = "monitor";
  if (items.some((i) => i.dangerous || i.type === "DANGEROUS")) floor = "urgent";
  else if (/fail/i.test(result || "") || items.some((i) => i.type === "MAJOR" || i.type === "FAIL")) floor = "soon";
  return RANK.indexOf(u) >= RANK.indexOf(floor) ? u : floor;
}

export async function writeMotNote(input: { testDate?: string | null; testResult?: string | null; items: MotItem[] }):
  Promise<{ note: string; urgency: MotNoteUrgency; attempts: number; trimmed: boolean }> {
  const items = itemsForNote(input.items);
  if (!items.length) return { note: "", urgency: "monitor", attempts: 0, trimmed: false };
  if (!hasAIKey()) throw new Error("AI is not configured — OPENAI_API_KEY is missing");

  const prompt = [
    `MOT test${input.testDate ? ` on ${input.testDate}` : ""}${input.testResult ? `, result ${String(input.testResult).toUpperCase()}` : ""}.`,
    "Items the tester recorded:",
    ...items.map((i) => `- ${i.dangerous ? "DANGEROUS" : i.type}: ${i.text}`),
  ].join("\n");

  const provider = getRuntimeProvider();
  let last = "";
  let urgency: MotNoteUrgency = "monitor";
  // The limit is hard — Twilio refuses the template variable over 256 characters — and the model
  // overshot in 3 of 8 trial runs (10/09/2026). One rewrite with the count in hand; whatever is
  // still long is cut at a whole sentence rather than sent broken.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { object } = await generateObject({
      model: provider(AI_MODEL_GUIDE),
      system: SYSTEM,
      prompt: attempt === 1 ? prompt
        : `${prompt}\n\nYour note was ${last.length} characters, over the ${MOT_NOTE_MAX}-character limit:\n"${last}"\nRewrite it in at most ${MOT_NOTE_MAX - 40} characters, leaving out the least important points.`,
      schema,
    });
    last = toPlainText(object.note).replace(/\s+/g, " ").trim();
    urgency = floorUrgency(object.urgency, items, input.testResult);
    if (cleanMotNote(last, Number.MAX_SAFE_INTEGER).length <= MOT_NOTE_MAX) {
      return { note: cleanMotNote(last), urgency, attempts: attempt, trimmed: false };
    }
  }
  return { note: cleanMotNote(last), urgency, attempts: 2, trimmed: true };
}
