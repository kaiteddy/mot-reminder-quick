/**
 * Shared "split & clean" rule for messy phone fields, used by BOTH:
 *   - scripts/clean-phone-names.ts  (one-off cleanup of existing rows)
 *   - scripts/sync-ga4.ts           (GA4 import, so new customers come in clean)
 *
 * Handles the GA4 data-entry habit of mashing a contact name onto a number,
 * e.g. "07846653685MARIA" or "ELISSA07961371785" -> clean number + the name.
 */
import { normalizePhoneNumber } from "../utils/phoneUtils";

export const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr"]);                 // bare title = noise, not a contact
export const LABELS = new Set(["fax", "inv", "invoice", "tel", "work", "office", "home", "mob", "mobile", "cell", "call", "phone", "no", "na", "number"]); // field labels

export const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
export const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);

/** Split "<number><name>" OR "<name><number>" (optional separator) into { num, alpha }. */
export function splitPhoneName(raw: string): { num: string; alpha: string } | null {
  const s = (raw || "").trim();
  let m = s.match(/^([+(]?\d[\d\s()+\-]*\d)\s*[\/*,;:.\-]?\s*([A-Za-z][A-Za-z0-9 .'\-]*)$/); // number then name
  if (m) return { num: m[1], alpha: m[2].trim() };
  m = s.match(/^([A-Za-z][A-Za-z .'\-]*?)\s*[\/*,;:.\-]?\s*([+(]?0?\d[\d\s()+\-]{5,}\d)$/);   // name then number
  if (m) return { num: m[2], alpha: m[1].trim() };
  return null;
}

/** True if the alpha part is a meaningful contact name (not a title/label/noise). */
export function isRealName(alpha: string): boolean {
  const lc = alpha.toLowerCase().replace(/[^a-z ]/g, "").trim();
  return !!lc && lc.length >= 2 && !TITLES.has(lc) && !LABELS.has(lc);
}

/**
 * Clean ONE raw phone field: split off any mashed-in name, normalise the number.
 * Returns { phone, name } — phone is +44/E.164 (or null if unusable); name is the
 * extracted contact name (or null if none / it was a title/label).
 */
/**
 * Normalize a number, recovering bare London landlines. GA4 stores London numbers
 * without their `020` area code (e.g. "8346 8981"), which fails validation and gets
 * dropped. A bare 8-digit number whose local part starts 3, 7 or 8 is exactly the
 * subscriber part of an 020 number, so retry with the prefix. Scoped to contact
 * cleanup only (not the reminder-send path), and only fires when the plain number
 * is invalid, so it never rewrites an already-valid number.
 */
function normalizeWithLondonFallback(num: string | null | undefined): string | null {
  const v = normalizePhoneNumber(num);
  if (v.normalized) return v.normalized;
  const digits = String(num || "").replace(/\D/g, "");
  if (/^[378]\d{7}$/.test(digits)) {
    const v2 = normalizePhoneNumber("020" + digits);
    if (v2.normalized) return v2.normalized;
  }
  return null;
}

export function cleanNumberAndName(raw: string | null | undefined): { phone: string | null; name: string | null } {
  if (!raw) return { phone: null, name: null };
  const s = String(raw).trim();
  if (/[A-Za-z]/.test(s)) {
    const split = splitPhoneName(s);
    if (!split) return { phone: null, name: null };
    const normalized = normalizeWithLondonFallback(split.num);
    return { phone: normalized, name: normalized && isRealName(split.alpha) ? titleCase(split.alpha) : null };
  }
  const normalized = normalizeWithLondonFallback(s);
  return { phone: normalized, name: null };
}

/**
 * Build a customer's primary phone + additional contacts from all their raw GA4 number
 * fields. Mobile is preferred as primary (matching the old getPhoneNumber). Extra valid
 * numbers become altContacts (with any recovered name). De-duped by last-10 digits. A name
 * recovered from the primary is kept as a contact only if it isn't already in the customer's name.
 */
export function buildCustomerContacts(
  rawNumbers: (string | null | undefined)[],
  customerName: string | null | undefined,
): { phone: string | null; altContacts: { name: string; phone: string }[] } {
  const custLc = (customerName || "").toLowerCase();
  const cleaned: { phone: string; name: string | null; isMobile: boolean }[] = [];
  const seen = new Set<string>();
  for (const raw of rawNumbers) {
    const { phone, name } = cleanNumberAndName(raw);
    if (!phone) continue;
    const key = last10(phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ phone, name, isMobile: /^\+447/.test(phone) });
  }
  if (!cleaned.length) return { phone: null, altContacts: [] };

  let pIdx = cleaned.findIndex((x) => x.isMobile);
  if (pIdx < 0) pIdx = 0;
  const primary = cleaned[pIdx];
  const rest = cleaned.filter((_, i) => i !== pIdx);

  const altContacts: { name: string; phone: string }[] = [];
  if (primary.name && !custLc.includes(primary.name.toLowerCase())) altContacts.push({ name: primary.name, phone: primary.phone });
  for (const r of rest) altContacts.push({ name: r.name || "", phone: r.phone });

  return { phone: primary.phone, altContacts };
}
