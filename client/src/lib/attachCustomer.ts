/**
 * Putting an existing customer record on a document (job sheet or invoice). The Find customer
 * search, the Classic find-customer picker, "Use this customer" under a phone number and the reg
 * lookup bringing in the car's owner all go through here, so they can never drift apart on what
 * "attach" means.
 */
import { splitAddress } from "@shared/address";

export const TITLES = ["MR", "MRS", "MS", "MISS", "DR", "PROF", "REV", "SIR"];

export function splitName(full?: string) {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  let title = "";
  if (parts.length > 1 && TITLES.includes(parts[0].toUpperCase().replace(/\./g, ""))) title = parts.shift()!;
  // A lone word that's itself a title (e.g. a record saved as just "Mr") belongs in Title,
  // not Surname — otherwise it renders as if "Mr" were someone's actual surname.
  if (parts.length === 1 && TITLES.includes(parts[0].toUpperCase().replace(/\./g, ""))) title = parts.shift()!;
  const surname = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || "");
  const forename = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
  return { title, forename, surname };
}

/** The customer record's one-line address, split into the document's House No / Road /
 *  Locality / Town / County boxes (and the postcode, if it was on the end of the text). A record
 *  with no address leaves whatever the form already holds. */
export function customerAddressPatch(c: any, f: any) {
  if (!String(c?.address || "").trim()) return { custPostcode: c?.postcode || f.custPostcode };
  const a = splitAddress(c.address, c.postcode);
  return {
    custHouseNo: a.houseNo, custRoad: a.road, custLocality: a.locality, custTown: a.town, custCounty: a.county,
    custPostcode: c.postcode || a.postcode || f.custPostcode,
  };
}

/** Every box on the document that belongs to the linked customer, apart from the name, which
 *  attaching always overwrites. A customer record has no company or mobile field at all, and most
 *  have no email, so nothing guarantees the next record refills any of them. */
const CUSTOMER_BOXES_CLEARED = {
  company: "", accountNumber: "",
  custHouseNo: "", custRoad: "", custLocality: "", custTown: "", custCounty: "", custPostcode: "",
  custTelephone: "", custMobile: "", custEmail: "",
};

/**
 * Whether attaching `c` replaces a DIFFERENT customer already linked to the document form `f`.
 *
 * `autoLinkedId` is a link the page's autosave made on its own. A second after staff start typing
 * on a document with no customer, the save links it to the record it creates from those details,
 * or to the car's owner, and neither record's details go on screen. To staff that document still
 * has no customer, so attaching one is the first link and keeps what they typed.
 */
export function replacesLinkedCustomer(f: any, c: any, autoLinkedId?: number | null): boolean {
  const linked = Number(f.customerId) || 0;
  return linked > 0 && linked !== Number(c.id) && linked !== autoLinkedId;
}

/**
 * The boxes that attaching customer `c` changes on the document form `f`, and only those, so the
 * reg lookup can spread them into its own update.
 *
 * With no customer linked yet, a box the record leaves blank keeps what staff typed before they
 * found the record. Replacing a different customer clears that customer's boxes first: kept, their
 * email, phone and address end up on the new customer's job sheet or invoice, and the Email and
 * Car ready buttons send to them.
 */
export function customerAttachDelta(f: any, c: any, autoLinkedId?: number | null) {
  const cleared = replacesLinkedCustomer(f, c, autoLinkedId) ? CUSTOMER_BOXES_CLEARED : {};
  const from = { ...f, ...cleared };
  const sn = splitName(c.name);
  return {
    ...cleared,
    customerId: c.id,
    customerName: c.name || from.customerName,
    custTitle: sn.title, custForename: sn.forename, custSurname: sn.surname,
    custEmail: c.email || from.custEmail,
    custTelephone: c.phone || from.custTelephone,
    ...customerAddressPatch(c, from),
  };
}

/** Everything that must change on the document when a customer is picked for it. */
export function attachCustomerPatch(f: any, c: any, autoLinkedId?: number | null) {
  const next = { ...f, ...customerAttachDelta(f, c, autoLinkedId) };
  // Re-linking to a different customer must also refresh their account number — otherwise the
  // doc keeps showing whichever customer it was linked to before.
  return { ...next, accountNumber: c.accountNumber || next.accountNumber };
}

/** The boxes a warning names, by the word staff use for them. */
const NAMED_BOXES: [label: string, boxes: string[]][] = [
  ["email", ["custEmail"]],
  ["phone", ["custTelephone", "custMobile"]],
  ["address", ["custHouseNo", "custRoad", "custLocality", "custTown", "custCounty"]],
  ["postcode", ["custPostcode"]],
  ["company", ["company"]],
];

/**
 * What to tell staff when replacing a customer left boxes blank because the new record has nothing
 * for them, so an empty Email box reads as "ask the customer" rather than as the page losing it.
 * Null when nothing the document showed went blank. Warn only: nothing here stops a save.
 */
export function relinkWarning(f: any, c: any, autoLinkedId?: number | null): string | null {
  if (!replacesLinkedCustomer(f, c, autoLinkedId)) return null;
  const next = attachCustomerPatch(f, c, autoLinkedId);
  const filled = (o: any, boxes: string[]) => boxes.some((k) => String(o[k] ?? "").trim() !== "");
  const blanked = NAMED_BOXES.filter(([, boxes]) => filled(f, boxes) && !filled(next, boxes)).map(([label]) => label);
  if (!blanked.length) return null;
  const list = blanked.length === 1 ? blanked[0] : `${blanked.slice(0, -1).join(", ")} or ${blanked[blanked.length - 1]}`;
  const previous = ([f.custTitle, f.custForename, f.custSurname].filter(Boolean).join(" ") || f.customerName || "").trim();
  return `${c.name || "The new customer"} has no ${list} on file — left blank rather than keep ${previous ? `${previous}'s` : "the previous customer's"}.`;
}
