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
const SIDE = /^(nearside|offside)\s+/i;

/** DVSA's side shorthand inside an item: n/s/f is nearside front, which is the front left. */
const SIDE_CODES: Record<string, string> = {
  "n/s/f": "front left", "o/s/f": "front right", "n/s/r": "rear left", "o/s/r": "rear right", "n/s": "left", "o/s": "right",
};

/** Left and right, in the words a customer uses, wherever DVSA's side words appear. */
export function plainSides(text: string): string {
  return text
    .replace(/\b[no]\/s(?:\/[fr])?\b/gi, (m) => SIDE_CODES[m.toLowerCase()] ?? m)
    .replace(/\bnearside\b/gi, "left")
    .replace(/\boffside\b/gi, "right");
}

/**
 * The items worth telling the customer about, tidied. PRS items were put right during the test
 * itself — in the trial the model described one as "will be adjusted", which is exactly the kind of
 * promise this note must never make — so they never reach it. Repeats of one wording collapse.
 */
export function itemsForNote(items: MotItem[]): MotItem[] {
  type Entry = MotItem & { rest: string; sides: Set<string> };
  const byKey = new Map<string, Entry>();
  const out: Entry[] = [];
  for (const item of items) {
    const type = String(item.type || "").trim().toUpperCase();
    if (type === "PRS") continue;
    const text = String(item.text || "").replace(MANUAL_REF, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // The same wording on the left and the right is one point. Left to the model, a pair came back
    // as ONE side — "the front right tyre has some cracking" when both were recorded (HJ14AJX trial).
    const side = SIDE.exec(text)?.[1]?.toLowerCase();
    const rest = side ? text.replace(SIDE, "") : text;
    const key = `${type}|${!!item.dangerous}|${rest.toLowerCase()}`;
    const hit = byKey.get(key);
    if (hit) { if (side) hit.sides.add(side); continue; }
    const entry: Entry = { type: type || "ADVISORY", text, dangerous: !!item.dangerous, rest, sides: new Set(side ? [side] : []) };
    byKey.set(key, entry);
    out.push(entry);
  }
  // Sides in the customer's words. The prompt forbids nearside/offside, yet a one-sided item still
  // arrived spelled that way and a note said "the offside rear tyre" (YC05OUU trial) — so those
  // words never reach the model at all.
  return out.map(({ rest, sides, ...item }) => {
    if (sides.size === 2) return { ...item, text: plainSides(`${rest} (both sides)`) };
    if (sides.size === 1) return { ...item, text: plainSides(`${sides.has("nearside") ? "Left-hand" : "Right-hand"} ${rest}`) };
    return { ...item, text: plainSides(item.text) };
  });
}

/**
 * The result as the customer should hear it. DVSA records a test as FAILED even when the only
 * failing item was put right during the test (PRS) and the car left with a pass. With the PRS item
 * removed, the model saw a fail with nothing failing and wrote "It failed, but only for advisories"
 * (DF03UGA trial, 10/09/2026).
 */
export function resultForNote(result: string | null | undefined, items: MotItem[]): string | undefined {
  const r = String(result || "").trim().toUpperCase();
  if (!r) return undefined;
  const repaired = items.some((i) => String(i.type || "").trim().toUpperCase() === "PRS");
  const stillFailing = itemsForNote(items).some((i) => i.dangerous || ["MAJOR", "DANGEROUS", "FAIL"].includes(String(i.type)));
  return /FAIL/.test(r) && repaired && !stillFailing ? "PASSED (a fault was put right during the test)" : r;
}

const SYSTEM = `You write one short note for a text message from a UK family garage to a customer who knows nothing about cars. The text has already told them their car is ready to collect, and introduces your note with "${MOT_NOTE_LEAD}". Straight after your note it says "${MOT_NOTE_CLOSE}" Write only the middle: what the MOT tester recorded, in plain everyday English, and whether they need to do anything.

Rules:
- At most ${MOT_NOTE_MAX} characters including spaces. Aim for 120-220. It is a text message, so be brief.
- Normal sentences, each starting with a capital letter. Open with the result in a few words, e.g. "It passed, but ..." or "It failed because ...".
- Plain English. No jargon and no abbreviations: say "tyre pressure warning light", never "TPMS". When a part has a technical name, say what it is instead: a side repeater is the small indicator light on the side of the car, a sub-frame is part of the car's underbody frame. No reference numbers, no prices, no sales pressure, no capitals for emphasis.
- "(both sides)" means the item was recorded on the left and the right: say "both".
- Sides: nearside means left and offside means right, so "n/s/f" is front left and "o/s/r" is rear right. Write "front left tyre" or "both rear tyres". Never write nearside, offside or those abbreviations.
- A tyre worn close to the legal limit: say its tread is getting close to the legal limit. Do not call the tyre "low".
- Merge items that are really one point: both rear tyres worn and cracking is ONE point.
- Most important point first: a FAILED test, then DANGEROUS, MAJOR, MINOR and ADVISORY items in that order. Within those, brakes, tyres, steering, suspension and lights come before warning lights, wipers and anything that is not a fault. Never leave out an item about brakes, tyres or steering to save space; leave out something else instead.
- A DANGEROUS item means the car should not be driven until it is fixed: say so. A MAJOR item has to be fixed for the car to pass: say that, and never say the car cannot be driven unless an item is DANGEROUS. A MINOR item still passes but should be repaired soon.
- For each point say what it means for them: whether it is fine for now, and roughly when to act ("worth replacing in the next few weeks", "nothing to do yet, we will look again at the next service").
- Only what the tester recorded. Never claim anything has been, or will be, fixed, adjusted or replaced, unless the result line itself says a fault was put right during the test.
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

/**
 * One more try when the connection drops mid-answer. Seen live on 10/09/2026: a 200 from OpenAI,
 * then ECONNRESET while reading it, which the AI SDK marks as not retryable — so staff would get an
 * error for a network blip. Anything else (a bad key, a refused request) still fails straight away.
 */
export async function withNetworkRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const trail = [e?.message, e?.cause?.message, e?.cause?.code, e?.cause?.cause?.code, e?.cause?.cause?.message].filter(Boolean).join(" ");
    if (!/ECONNRESET|terminated|socket hang up|ETIMEDOUT|fetch failed/i.test(trail)) throw e;
    return await fn();
  }
}

export async function writeMotNote(input: { testDate?: string | null; testResult?: string | null; items: MotItem[] }):
  Promise<{ note: string; urgency: MotNoteUrgency; attempts: number; trimmed: boolean }> {
  const items = itemsForNote(input.items);
  if (!items.length) return { note: "", urgency: "monitor", attempts: 0, trimmed: false };
  if (!hasAIKey()) throw new Error("AI is not configured — OPENAI_API_KEY is missing");

  const result = resultForNote(input.testResult, input.items);
  const prompt = [
    `MOT test${input.testDate ? ` on ${input.testDate}` : ""}${result ? `, result ${result}` : ""}.`,
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
    const { object } = await withNetworkRetry(() => generateObject({
      model: provider(AI_MODEL_GUIDE),
      system: SYSTEM,
      prompt: attempt === 1 ? prompt
        : `${prompt}\n\nYour note was ${last.length} characters, over the ${MOT_NOTE_MAX}-character limit:\n"${last}"\nRewrite it in at most ${MOT_NOTE_MAX - 40} characters, leaving out the least important points.`,
      schema,
    }));
    // A last net for side words the model brings in on its own.
    last = plainSides(toPlainText(object.note).replace(/\s+/g, " ").trim());
    urgency = floorUrgency(object.urgency, items, result);
    if (cleanMotNote(last, Number.MAX_SAFE_INTEGER).length <= MOT_NOTE_MAX) {
      return { note: cleanMotNote(last), urgency, attempts: attempt, trimmed: false };
    }
  }
  return { note: cleanMotNote(last), urgency, attempts: 2, trimmed: true };
}
