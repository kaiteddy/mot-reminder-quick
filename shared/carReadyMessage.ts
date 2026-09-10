/**
 * "Your car is ready to collect" + a plain-English note on what its MOT found.
 *
 * Shared by the server, which sends it, and the job sheet's Car ready dialog, which previews it,
 * so what staff read is what the customer gets. Pure functions only — nothing here may touch the
 * network or the database.
 *
 * The note travels two ways and has to survive both:
 *   - as variable {{3}} of the vehicle_ready_mot_notes WhatsApp template, where Twilio refuses a
 *     value over 256 characters (error 50529) and WhatsApp refuses a newline inside one;
 *   - inside a plain text, where a single curly quote or dash moves the whole message from GSM-7
 *     to UCS-2 and roughly triples what it costs to send.
 * So the note is one line of plain ASCII, under 256 characters, every time.
 */

/** Held under Twilio's 256-character ceiling for one template variable. */
export const MOT_NOTE_MAX = 250;

/** The fixed wording either side of the note — the same in the text and in the WhatsApp template. */
export const MOT_NOTE_LEAD = "Notes from its MOT:";
export const MOT_NOTE_CLOSE = "We are happy to explain any of this, and nothing is done without your go-ahead.";

/** Typographic characters folded to plain equivalents; anything else outside printable ASCII dropped. */
export function toPlainText(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[    ]/g, " ")
    .replace(/[^\x20-\x7E\n\r\t]/g, "");
}

/** Sentences split at . ! or ? followed by a space — so "1.6mm" stays whole. */
function sentencesOf(s: string): string[] {
  const out: string[] = [];
  const re = /[.!?]+\s+/g;
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out.push(s.slice(from, m.index + m[0].length).trim());
    from = m.index + m[0].length;
  }
  if (from < s.length) out.push(s.slice(from).trim());
  return out.filter(Boolean);
}

/** At most `max` characters, ending on a whole sentence; one sentence too long on its own is cut at a word. */
export function capAtSentence(s: string, max = MOT_NOTE_MAX): string {
  if (s.length <= max) return s;
  let out = "";
  for (const sentence of sentencesOf(s)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:-]+$/, "")}.`;
}

/** A capital letter at the start of every sentence. */
export function capitaliseSentences(s: string): string {
  return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

/**
 * The note exactly as it may be sent: one line of plain ASCII, sentences capitalised and closed,
 * never over `max`. Safe to apply twice.
 */
export function cleanMotNote(raw: string | null | undefined, max = MOT_NOTE_MAX): string {
  let s = toPlainText(raw).replace(/\s+/g, " ").trim();
  // Opened with the lead-in the message already carries, it would print twice.
  s = s.replace(/^notes? (?:from|on) (?:its|the|your) mot\s*[:-]?\s*/i, "");
  if (!s) return "";
  s = capitaliseSentences(s);
  if (!/[.!?]$/.test(s)) s = `${s}.`;
  return capAtSentence(s, max);
}

/** The paragraph that carries the note. Takes the note as given — clean it first. */
export function motNoteBlock(note: string): string {
  return `${MOT_NOTE_LEAD} ${note} ${MOT_NOTE_CLOSE}`;
}

/**
 * Put a paragraph in straight after the sentence saying the car is ready to collect. A message
 * reworded so that sentence can't be found gets it at the end instead — the note is never lost.
 */
export function insertAfterReadySentence(message: string, block: string): string {
  const base = String(message ?? "").trim();
  if (!block) return base;
  const m = /ready to collect[^.!?]*[.!?]/i.exec(base);
  if (!m) return base ? `${base}\n\n${block}` : block;
  const end = m.index + m[0].length;
  const rest = base.slice(end).trim();
  return `${base.slice(0, end)}\n\n${block}${rest ? `\n\n${rest}` : ""}`;
}

/** The car-ready message with its MOT note, as the customer reads it. No note, no change. */
export function withMotNote(message: string, note: string | null | undefined): string {
  const clean = cleanMotNote(note);
  return clean ? insertAfterReadySentence(message, motNoteBlock(clean)) : String(message ?? "").trim();
}

export type CarReadyRoute =
  | { channel: "template"; template: "vehicle_ready" | "vehicle_ready_mot_notes" }
  | { channel: "text" };

/**
 * How a car-ready message goes out. A note only reaches WhatsApp inside the template built to carry
 * it — sent through the plain vehicle_ready template it would silently vanish — so until the notes
 * template is approved, a message with a note goes as text: WhatsApp takes that inside the 24-hour
 * window, and the status callback re-sends it as an SMS outside it.
 */
export function carReadyRoute(p: { hasNote: boolean; readyTemplate: boolean; notesTemplate: boolean }): CarReadyRoute {
  if (p.hasNote) return p.notesTemplate ? { channel: "template", template: "vehicle_ready_mot_notes" } : { channel: "text" };
  return p.readyTemplate ? { channel: "template", template: "vehicle_ready" } : { channel: "text" };
}

/** SMS segments for a GSM-7 text: 160 characters fit in one; once split, each part holds 153. */
export function smsSegments(text: string): number {
  let n = 0;
  for (const ch of String(text ?? "")) n += "^{}\\[]~|".includes(ch) ? 2 : 1;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}
