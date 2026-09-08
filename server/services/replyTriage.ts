/**
 * Does this customer message actually need a human reply?
 *
 * The unanswered-message alerts were nagging about "Thank you" and about a beauty salon's
 * autoresponder, which trains you to ignore them — the one thing an alert must never do. So each
 * inbound message is triaged once, when it arrives, and the alerts only chase the ones a person
 * genuinely has to answer.
 *
 * Rules first, because most replies to an MOT reminder are one of a handful of things and a rule
 * is free, instant and explainable. The model is asked only about messages the rules cannot
 * place, and if it is unavailable, slow or unsure the answer is "needs a reply" — an alert you
 * did not need costs a glance, a missed booking costs a customer.
 *
 * "No reply needed" never hides anything: the message still sits in Conversations exactly as
 * before, with the reason recorded against it. Only the chasing stops.
 */

export type TriageKind =
  | "question"        // they asked something, or want to book
  | "thanks"          // an acknowledgement and nothing more
  | "auto_reply"      // a business autoresponder bounced back at us
  | "opt_out"         // STOP and friends — the webhook has already actioned it
  | "button"          // a reminder button tap, already actioned
  | "not_owner"       // sold it / not my car — no reply owed, but the car needs switching off
  | "unclear";        // could not tell, so treat as needing a reply

export type Triage = {
  needsReply: boolean;
  kind: TriageKind;
  /** One short sentence, shown on the thread and stored against the message. */
  reason: string;
  /** Something for staff to DO, even when no reply is owed. */
  action?: string;
  by: "rule" | "ai" | "fallback";
};

const clean = (s: string | null | undefined) =>
  String(s ?? "").replace(/\s+/g, " ").trim();

/** Strip the trailing punctuation and emoji people end a one-word reply with.
 *  Plain character ranges rather than \p{...}: this project compiles below ES6. */
const bare = (s: string) =>
  clean(s).toLowerCase()
    .replace(/[^\x20-\x7E]+/g, " ")   // emoji and other non-ASCII
    .replace(/\s+/g, " ")
    .replace(/[.!,\s]+$/g, "")
    .trim();

const OPT_OUT = /^(stop|stopall|unsubscribe|end|quit|start|unstop)$/i;
const BUTTON = /^(confirm|confirmed|cancel|cancel booking|reschedule|rearrange)$/i;

/** Pure acknowledgements. Deliberately anchored: "thanks, but when can you fit me in?" is a question. */
const THANKS = new RegExp(
  "^(" +
  [
    "thanks?", "thank you", "thankyou", "thanx", "ta", "cheers", "ok", "okay", "k", "kk",
    "noted", "got it", "understood", "received", "great", "perfect", "lovely", "brilliant",
    "fine", "good", "sure", "yes thanks", "no thanks", "no thank you", "all good", "will do",
    "much appreciated", "appreciated", "many thanks", "thanks very much", "thank you very much",
    "thanks a lot", "thank you so much", "thanks for the reminder", "thank you for the reminder",
    "thanks for letting me know", "thank you for letting me know", "nice one", "super", "cool",
  ].join("|") +
  ")([ ,.!]*(thanks?|thank you|very much|a lot|so much|again))*$", "i");

/** A machine answered us. */
const AUTO_REPLY = [
  /thank you for contacting/i,
  /out of (the )?office/i,
  /automatic(ally)? (reply|response|generated)/i,
  /this is an automated/i,
  /auto[- ]?reply/i,
  /i am currently (away|unavailable)/i,
  /do not reply to this message/i,
  /your message has been received/i,
  /we (will|'ll) get back to you as soon as/i,
];

/** They no longer have the car. No reply owed, but the reminders must stop. */
const NOT_OWNER = [
  // "longer have/own" on its own, because people mistype the "no": Mrs Newton wrote
  // "I mo longer have this car" and a rule that insisted on "no longer" missed it.
  /\blonger\b[^.]{0,15}\b(have|own|drive|got|keep)\b/i,
  /\b(no longer|dont|don'?t|do not|doesn'?t)\b[^.]{0,25}\b(have|own|drive|got)\b/i,
  /\b(has been|have|i|we)\s*(now)?\s*sold\b/i,
  /\bsold (it|the car|this car|that car|my car|the vehicle)\b/i,
  /\bnot (my|our|his|her|their) (car|vehicle|reg|registration|number plate|plate)\b/i,
  /\b(that|this|it)'?s not (my|our) (car|vehicle)\b/i,
  /\bwrong (car|vehicle|reg|registration|number)\b/i,
  /\bscrapped\b/i,
  /\bwritten off\b/i,
  /\bpart[- ]exchanged?\b/i,
];

/** Unmistakably wants something back from us. Checked BEFORE the softer rules. */
const NEEDS_REPLY = [
  /\?/,                                              // any question mark
  /\b(can|could|would|will|do|does|is|are|when|what|how much|how many|why|where|who)\b.{0,40}\?/i,
  /\b(book|booking|appointment|slot|fit me in|come in|bring it in|drop it off)\b/i,
  /\b(how much|price|cost|quote|charge)\b/i,
  /\b(call|ring|phone) me\b/i,
  /\b(please|pls|plz)\b.{0,30}\b(call|ring|book|confirm|let me know|advise|send)\b/i,
];

/**
 * Decide from the text alone. Returns null when the rules cannot place it, which is the model's
 * cue. Exported so the rules can be tested without a network call.
 */
export function triageByRule(body: string | null | undefined, hasMedia = false): Triage | null {
  const text = clean(body);
  const b = bare(text);

  if (!text && !hasMedia) return { needsReply: false, kind: "thanks", reason: "Empty message — nothing to answer.", by: "rule" };
  if (OPT_OUT.test(b)) return { needsReply: false, kind: "opt_out", reason: "Opt-out keyword — already actioned automatically.", by: "rule" };
  if (BUTTON.test(b)) return { needsReply: false, kind: "button", reason: "Reminder button tap — already recorded against the booking.", by: "rule" };

  // A photo or voice note with no words always deserves a person.
  if (!text && hasMedia) return { needsReply: true, kind: "question", reason: "Sent a photo or voice note with no message.", by: "rule" };

  // Asking for something wins over everything below: "thanks, can I book Monday?" is a question.
  if (NEEDS_REPLY.some((r) => r.test(text))) {
    return { needsReply: true, kind: "question", reason: "Asks a question or wants to book.", by: "rule" };
  }
  if (AUTO_REPLY.some((r) => r.test(text))) {
    return { needsReply: false, kind: "auto_reply", reason: "Automatic reply from their phone or business.", by: "rule" };
  }
  if (NOT_OWNER.some((r) => r.test(text))) {
    return {
      needsReply: false, kind: "not_owner",
      reason: "Says they no longer have this car.",
      action: "Switch reminders off for this car, or check who owns it now.",
      by: "rule",
    };
  }
  if (THANKS.test(b)) return { needsReply: false, kind: "thanks", reason: "A thank-you with nothing to answer.", by: "rule" };

  return null;
}

const SYSTEM = [
  "You triage messages customers send to a UK garage (ELI Motors, Hendon) after an MOT or service reminder.",
  "Decide only one thing: does a member of staff need to write back?",
  "Needs a reply: questions, booking requests, prices, complaints, anything expecting an answer, or anything unclear.",
  "Does not need a reply: a plain thank-you or acknowledgement, an automatic out-of-office, or telling us they no longer have the car (that needs an action, not an answer).",
  "When in doubt, say a reply is needed. Keep the reason to one short sentence a busy person can read at a glance.",
].join(" ");

/**
 * Full triage: rules, then the model for what is left. Never throws — a failure here must not
 * stop a message being stored or an alert being raised, so the fallback is "needs a reply".
 */
export async function triageMessage(input: { body?: string | null; hasMedia?: boolean }): Promise<Triage> {
  const byRule = triageByRule(input.body, !!input.hasMedia);
  if (byRule) return byRule;

  try {
    const { hasAIKey, getRuntimeProvider, AI_MODEL } = await import("./aiProvider");
    if (!hasAIKey()) {
      return { needsReply: true, kind: "unclear", reason: "Couldn't judge this one automatically — read it and decide.", by: "fallback" };
    }
    const { generateObject } = await import("ai");
    const { z } = await import("zod");
    const provider = getRuntimeProvider();
    const { object } = await generateObject({
      model: provider(AI_MODEL),
      system: SYSTEM,
      schema: z.object({
        needsReply: z.boolean(),
        kind: z.enum(["question", "thanks", "auto_reply", "not_owner", "unclear"]),
        reason: z.string().max(160),
      }),
      messages: [{ role: "user", content: `Customer message:\n"""${clean(input.body).slice(0, 800)}"""` }],
    });
    const o = object as { needsReply: boolean; kind: TriageKind; reason: string };
    return {
      needsReply: !!o.needsReply,
      kind: o.kind || "unclear",
      reason: clean(o.reason) || (o.needsReply ? "Looks like it needs an answer." : "Looks like nothing to answer."),
      action: o.kind === "not_owner" ? "Switch reminders off for this car, or check who owns it now." : undefined,
      by: "ai",
    };
  } catch (e: any) {
    console.warn("[Triage] falling back to needs-reply:", e?.message);
    return { needsReply: true, kind: "unclear", reason: "Couldn't judge this one automatically — read it and decide.", by: "fallback" };
  }
}
