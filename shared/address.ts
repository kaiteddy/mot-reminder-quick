/**
 * UK postal addresses, tidied and split into the document's fields.
 *
 * Customer addresses reach the app in several shapes and none of them is clean:
 *   - GA4 imports joined the old system's House / Road / Locality / Town fields, leaving runs of
 *     spaces where a field was blank ("12 Temple Fortune    Finchley Road, London").
 *   - Web-created customers are "houseNo, road, locality, town, county" comma-joined, so the
 *     house number sits in its own comma segment ("12, Finchley Road, London").
 *   - Some carry the postcode on the end, or a locality typed twice.
 * Attaching such a customer to a job used to drop the WHOLE string into the Road box and leave
 * House No / Locality / Town empty — unreadable on screen and wrong on the printed invoice.
 *
 * `splitAddress` turns any of those into { houseNo, road, locality, town, county, postcode };
 * `tidyAddressLine` is the light version for display of text already in a field.
 */

export type AddressParts = {
  houseNo: string;
  road: string;
  locality: string;
  town: string;
  county: string;
  /** Only set when a postcode was found on the end of the address text. */
  postcode: string;
};

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** Collapse runs of whitespace, trim, and drop empty comma segments (", ," → ","). */
export function tidyAddressLine(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:, )+/g, ", ")
    .replace(/^, |, $/g, "")
    .trim();
}

/** "12", "12A", "12-14", "Flat 4", "Flat 4, 49"-style leading house designators. */
const HOUSE_NO = /^((?:flat|apartment|apt|unit|suite|room)\s+\S+|\d+[a-z]?(?:\s*[-\/]\s*\d+[a-z]?)?)\b\s*/i;

/** "Leicester, Leicestershire" is town + county, not locality + town. */
const isCounty = (s: string) => /shire$|^(?:greater london|middlesex|essex|kent|surrey|sussex|east sussex|west sussex|norfolk|suffolk|devon|cornwall|dorset|somerset|cumbria|durham|county durham|merseyside|tyne and wear|west midlands|greater manchester|isle of wight|rutland|northumberland)$/i.test(s.trim());

/** "Tenterden Grove", "Bell Lane", "47 Finchley Lane" — a street, so never a town line. */
const looksLikeStreet = (s: string) =>
  /^(?:flat|apartment|apt|unit|suite|room)?\s*\d/i.test(s.trim())
  // Deliberately NOT hill/green/park/end/vale: Mill Hill, Golders Green, Finsbury Park, Crouch End
  // and Maida Vale are localities, and a locality must stay a locality.
  || /\b(?:road|rd|street|st|lane|ln|avenue|ave|grove|drive|dr|way|close|crescent|cres|gardens|gdns|place|pl|terrace|square|sq|walk|mews|row|rise|parade|approach|broadway|court|house|lodge|mansions|villas|cottage|chambers|heights|tower)\.?$/i.test(s.trim());

/** Title-case a part that arrived fully upper- or lower-case; leave mixed case alone. */
function niceCase(s: string): string {
  if (!s || s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-'(])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
}

export function splitAddress(address: string | null | undefined, knownPostcode?: string | null): AddressParts {
  const out: AddressParts = { houseNo: "", road: "", locality: "", town: "", county: "", postcode: "" };
  let text = tidyAddressLine(address);
  if (!text) return out;

  // A postcode on the end belongs in its own field, not on an address line.
  const pcMatch = text.match(new RegExp(UK_POSTCODE.source + "\\s*$", "i"));
  if (pcMatch) {
    out.postcode = `${pcMatch[1]} ${pcMatch[2]}`.toUpperCase();
    text = tidyAddressLine(text.slice(0, pcMatch.index));
  }
  // …and a postcode we already hold must not be repeated as a town/county line.
  const known = String(knownPostcode || "").replace(/\s+/g, "").toUpperCase();

  let parts = text.split(",").map((p) => p.trim()).filter(Boolean)
    .filter((p) => !known || p.replace(/\s+/g, "").toUpperCase() !== known);
  // Dedupe a locality typed twice ("Hendon, Hendon, London"), and a later segment that merely
  // repeats part of an earlier one ("51 Flat 1 Finchley Lane, Flat 1, Hendon").
  parts = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  parts = parts.filter((p, i) => !parts.slice(0, i).some((q) => q.toLowerCase().includes(p.toLowerCase())));
  if (!parts.length) return out;

  // House number / building. Three shapes:
  //   "12, Finchley Road, …"               — the number is its own segment (web-created records)
  //   "5 Acacia Court, 1 Brent Green, …"   — a numbered building, then the numbered street: the
  //                                          whole first segment is the "house", the street keeps
  //                                          its number so it prints as "1 Brent Green"
  //   "12 Finchley Road, …"                — number at the start of the first segment
  const numbered = (t: string) => /^(?:flat|apartment|apt|unit|suite|room)?\s*\d/i.test(t);
  if (parts.length > 1 && /^(?:flat|apartment|apt|unit|suite|room)?\s*\d+[a-z]?(?:\s*[-\/]\s*\d+[a-z]?)?$/i.test(parts[0])) {
    out.houseNo = parts.shift()!;
  } else if (parts.length > 2 && numbered(parts[0]) && numbered(parts[1])) {
    out.houseNo = parts.shift()!;
  } else {
    const m = parts[0].match(HOUSE_NO);
    if (m && m[1].length < parts[0].length) {
      out.houseNo = m[1];
      parts[0] = parts[0].slice(m[0].length).trim();
      // "79 79 Bridge Lane" — the number typed twice.
      if (parts[0].toLowerCase().startsWith(out.houseNo.toLowerCase() + " ")) parts[0] = parts[0].slice(out.houseNo.length).trim();
    }
  }

  // What is left reads road, locality, town, county — from the front, with the LAST segment
  // always the town when there are exactly two, since "Finchley Road, London" is far more
  // common than a road with a locality and no town.
  out.road = parts.shift() || "";
  // A building followed by its street ("Winsford Court, Tenterden Grove") is ONE address line:
  // keep the street with the road rather than promoting it to the town.
  while (parts.length && looksLikeStreet(parts[0]) && !isCounty(parts[0])) out.road += `, ${parts.shift()}`;
  if (parts.length === 1) out.town = parts[0];
  else if (parts.length === 2) { if (isCounty(parts[1])) [out.town, out.county] = parts; else [out.locality, out.town] = parts; }
  else if (parts.length >= 3) { out.locality = parts.slice(0, parts.length - 2).join(", "); out.town = parts[parts.length - 2]; out.county = parts[parts.length - 1]; }

  out.road = niceCase(out.road); out.locality = niceCase(out.locality); out.town = niceCase(out.town); out.county = niceCase(out.county);
  return out;
}

/** The single-line form used for customer records: "12 Finchley Road, Hendon, London". */
export function joinAddress(p: Partial<AddressParts>): string {
  const houseAndRoad = [p.houseNo, p.road].filter(Boolean).join(" ");
  return tidyAddressLine([houseAndRoad, p.locality, p.town, p.county].filter(Boolean).join(", "));
}
