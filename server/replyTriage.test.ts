/**
 * The rules half of reply triage — the part that must never need a network call, and the part
 * that decides what the unanswered-message alerts chase. Every message here is one a customer
 * actually sent to the garage.
 */
import { describe, it, expect } from "vitest";
import { triageByRule } from "./services/replyTriage";

const kindOf = (s: string, media = false) => triageByRule(s, media)?.kind ?? "unplaced";
const needs = (s: string, media = false) => triageByRule(s, media)?.needsReply;

describe("messages that do not need a reply", () => {
  it("plain thank-yous", () => {
    for (const s of ["Thank you", "thanks", "Thanks!", "Thank you 🙏", "ok thanks", "Many thanks", "Thanks for the reminder", "Noted", "Will do", "cheers"]) {
      expect(needs(s), s).toBe(false);
      expect(kindOf(s), s).toBe("thanks");
    }
  });

  it("business autoresponders", () => {
    // Mathilde Dhoosche's salon bounced this back at the reminder, 08/09/2026.
    const s = "Thank you for contacting Mathilde Dhoosche @ Serene Birth With Mathilde! Please note our opening hours";
    expect(needs(s)).toBe(false);
    expect(kindOf(s)).toBe("auto_reply");
    expect(needs("I am currently away from the office and will reply on Monday")).toBe(false);
  });

  it("telling us the car is gone — an action, not an answer", () => {
    for (const s of [
      "Thank you for thiscreminder but I mo longer have this car",   // Mrs Newton, as typed
      "Hi. Please note that the car has been sold.thank you",         // Mrs Susie Knoller
      "Hi that's not my vehicle- my license plate is EJ66 VAD",       // Mrs E Weiss
      "I sold it last year",
      "this car was scrapped",
    ]) {
      expect(needs(s), s).toBe(false);
      expect(kindOf(s), s).toBe("not_owner");
      expect(triageByRule(s)?.action, s).toMatch(/reminders off|owns it now/i);
    }
  });

  it("keywords the webhook has already actioned", () => {
    expect(kindOf("STOP")).toBe("opt_out");
    expect(kindOf("Confirm")).toBe("button");
    expect(needs("")).toBe(false);
  });
});

describe("messages that do need a reply", () => {
  it("questions and bookings win over a polite opening", () => {
    for (const s of [
      "Hi, can I book my car in for Monday morning?",
      "Thanks — how much is an MOT and service?",
      "Please call me, I want to book an appointment",
      "Monday morning",                                  // Ms Eva's answer to "when suits?" — no rule places it
      "Thank you but can you fit me in this week",
    ]) {
      const t = triageByRule(s);
      // Either the rules say it needs a reply, or they decline to judge and the model is asked.
      expect(t === null || t.needsReply, s).toBeTruthy();
    }
  });

  it("a photo or voice note with no words always reaches a person", () => {
    expect(needs("", true)).toBe(true);
    expect(kindOf("", true)).toBe("question");
  });

  it("anything the rules cannot place is left to the model, not silently dropped", () => {
    expect(triageByRule("The blue one is making a noise again")).toBeNull();
  });
});
