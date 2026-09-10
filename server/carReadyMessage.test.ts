/**
 * The car-ready message and its MOT note. These rules decide whether Twilio accepts the send at all
 * (a template variable over 256 characters, or with a newline in it, is refused), whether the text
 * and the WhatsApp template say the same thing, and what a text costs (one curly apostrophe turns
 * GSM-7 into UCS-2).
 */
import { describe, it, expect } from "vitest";
import {
  MOT_NOTE_MAX, carReadyRoute, cleanMotNote, insertAfterReadySentence, motNoteBlock, smsSegments, withMotNote,
} from "../shared/carReadyMessage";
import { generateCarReadyMessage } from "./smsService";
import { itemsForNote } from "./services/motCustomerNote";

/** The approved vehicle_ready template body, read back from Twilio on 10/09/2026. */
const APPROVED_READY = "Hi {{1}}, your {{2}} is ready to collect from ELI MOTORS. We are open 8:30am-5:30pm Mon-Fri. If you cannot collect today, please let us know. Any questions, call us on 020 8203 6449.";

describe("the text matches the WhatsApp templates", () => {
  it("vehicle_ready wording is still word for word what WhatsApp approved", () => {
    expect(generateCarReadyMessage({ customerName: "{{1}}", registration: "", vehicle: "{{2}}" })).toBe(APPROVED_READY);
  });

  it("the notes template, filled in, is exactly the text an SMS carries", () => {
    const body = insertAfterReadySentence(APPROVED_READY, motNoteBlock("{{3}}"));
    const note = "It passed, but both rear tyres have tread getting close to the legal limit.";
    const rendered = body.replace("{{1}}", "Sam").replace("{{2}}", "FORD Focus AB12CDE").replace("{{3}}", note);
    const text = withMotNote(generateCarReadyMessage({ customerName: "Mr Sam Smith", registration: "AB12CDE", vehicle: "FORD Focus" }), note);
    expect(rendered).toBe(text);
  });

  it("obeys WhatsApp's placement rules for variables", () => {
    const body = insertAfterReadySentence(APPROVED_READY, motNoteBlock("{{3}}"));
    expect(body.startsWith("{{")).toBe(false);
    expect(body.endsWith("}}")).toBe(false);
    expect(body).not.toMatch(/\}\}\s*\{\{/);
    expect([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
  });
});

describe("cleanMotNote", () => {
  it("makes one line of plain ASCII", () => {
    const s = cleanMotNote("It passed — but the tyre’s tread is “low”…\n\nWorth a look \u{1F697}");
    expect(s).toBe(`It passed - but the tyre's tread is "low"... Worth a look.`);
    expect(s).not.toMatch(/[\r\n\t]/);
    expect(s).toMatch(/^[\x20-\x7E]*$/);
  });

  it("capitalises sentences the model left in lower case, and closes the last one", () => {
    expect(cleanMotNote("passed, but the light is on. both rear tyres are worn")).toBe("Passed, but the light is on. Both rear tyres are worn.");
  });

  it("drops a lead-in the message already carries", () => {
    expect(cleanMotNote("Notes from its MOT: It passed.")).toBe("It passed.");
  });

  it("never exceeds the limit, and cuts at a whole sentence", () => {
    const s = "It failed because the front left tyre tread is below 1.6mm and it must be replaced before driving. "
      + "The brake pads are wearing thin, so plan to replace them in the next month or so. ".repeat(3);
    const out = cleanMotNote(s);
    expect(out.length).toBeLessThanOrEqual(MOT_NOTE_MAX);
    expect(out.endsWith(".")).toBe(true);
    expect(out).toContain("1.6mm");            // a decimal point is not the end of a sentence
    expect(s.includes(out)).toBe(true);        // whole sentences, nothing rewritten
  });

  it("cuts one over-long sentence at a word", () => {
    const out = cleanMotNote("word ".repeat(80));
    expect(out.length).toBeLessThanOrEqual(MOT_NOTE_MAX);
    expect(out).toMatch(/^Word( word)*\.$/);
  });

  it("is safe to apply twice, and empty stays empty", () => {
    const once = cleanMotNote("passed. both rear tyres are worn – replace soon");
    expect(cleanMotNote(once)).toBe(once);
    expect(cleanMotNote("  \n ")).toBe("");
    expect(cleanMotNote(null)).toBe("");
  });
});

describe("withMotNote", () => {
  const base = "Hi Sam, your FORD Focus AB12CDE is ready to collect from ELI MOTORS. We are open 8:30am-5:30pm Mon-Fri.";

  it("puts the note in its own paragraph straight after the ready sentence", () => {
    expect(withMotNote(base, "It passed.")).toBe(
      "Hi Sam, your FORD Focus AB12CDE is ready to collect from ELI MOTORS.\n\n"
      + "Notes from its MOT: It passed. We are happy to explain any of this, and nothing is done without your go-ahead.\n\n"
      + "We are open 8:30am-5:30pm Mon-Fri.");
  });

  it("still carries the note when staff reworded the message", () => {
    expect(withMotNote("Hi Sam, pop in any time.", "It passed.")).toBe(
      "Hi Sam, pop in any time.\n\nNotes from its MOT: It passed. We are happy to explain any of this, and nothing is done without your go-ahead.");
  });

  it("no note, no change", () => {
    expect(withMotNote(base, "")).toBe(base);
    expect(withMotNote(base, undefined)).toBe(base);
  });
});

describe("carReadyRoute", () => {
  it("never sends a note through the template that would drop it", () => {
    expect(carReadyRoute({ hasNote: true, readyTemplate: true, notesTemplate: false })).toEqual({ channel: "text" });
  });
  it("uses the notes template once it exists", () => {
    expect(carReadyRoute({ hasNote: true, readyTemplate: true, notesTemplate: true })).toEqual({ channel: "template", template: "vehicle_ready_mot_notes" });
  });
  it("leaves a message without a note exactly as before", () => {
    expect(carReadyRoute({ hasNote: false, readyTemplate: true, notesTemplate: true })).toEqual({ channel: "template", template: "vehicle_ready" });
    expect(carReadyRoute({ hasNote: false, readyTemplate: false, notesTemplate: false })).toEqual({ channel: "text" });
  });
});

describe("smsSegments", () => {
  it("counts GSM-7 segments", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("a".repeat(307))).toBe(3);
  });
});

describe("itemsForNote", () => {
  it("drops PRS items, repeats and the manual's reference numbers", () => {
    expect(itemsForNote([
      { type: "ADVISORY", text: "Nearside Rear Tyre worn close to legal limit/worn on edge (5.2.3 (e))" },
      { type: "ADVISORY", text: "Nearside Rear Tyre worn close to legal limit/worn on edge (5.2.3 (e))" },
      { type: "PRS", text: "Offside Headlamp aim too high (4.1.2 (a) (ii))" },
      { type: "ADVISORY", text: "TPMS  LIGHT ON" },
    ])).toEqual([
      { type: "ADVISORY", text: "Nearside Rear Tyre worn close to legal limit/worn on edge", dangerous: false },
      { type: "ADVISORY", text: "TPMS LIGHT ON", dangerous: false },
    ]);
  });
});
