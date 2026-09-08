// Vehicle-identity provenance guard.
//
// The document form carries a block of vehicle-identity fields (make/model/VIN/…) that
// saveDocument stamps onto whichever vehicle row matches the payload's registration. Those two
// travel independently in the form: staff can correct the reg while the identity fields still
// describe the PREVIOUS car (a ~30s SWS/DVLA lookup refills them much later than the 1s
// debounced auto-save fires). On 24/08/2026 exactly that stamped a Peugeot 3008's identity onto
// Vauxhall Mokka LL14LDJ. The client therefore tags its payloads with `vehicleReg` — the reg the
// identity fields were populated for — and the server refuses the identity block when it doesn't
// match the reg being saved.

/** Registration comparison key: uppercase, alphanumerics only ("ll14 ldj" → "LL14LDJ"). */
export const normRegKey = (r?: string) => String(r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Could this text be a UK registration at all?
 *
 * Every UK plate, current, prefix, suffix or dateless, mixes letters and digits: "LS17YLX",
 * "A123TUC", "1431NE", "FCA12". Nothing that is all letters can be one. That single test is what
 * separates a plate from what actually gets typed into the box — a customer's name. Six records
 * exist for one Jeep because somebody typed "AVI. LEVY" and a vehicle was minted at "A", "AVI",
 * "AVI. L", "AVI. LEV" and again at the full name; 144 vehicles carry a "registration" that
 * cannot be one. Deliberately NOT a length rule: 466 of this garage's plates are short private
 * ones, and one of them has 43 invoices against it.
 */
export function looksLikeRegistration(reg?: string | null): boolean {
  const r = String(reg || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return r.length >= 2 && r.length <= 8 && /[A-Z]/.test(r) && /[0-9]/.test(r);
}

/** True when the payload's vehicle-identity fields provably describe a DIFFERENT reg than the
 *  one being saved. Payloads without `vehicleReg` (older clients, internal copies) are trusted. */
export const vehicleIdentityStale = (registration?: string, vehicleReg?: string): boolean =>
  vehicleReg !== undefined && normRegKey(vehicleReg) !== normRegKey(registration);

const undef = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The vehicle-identity fields a document save is allowed to write onto the matched/created
 *  vehicle row — empty when the provenance check says they belong to a different car. */
export function vehicleIdentityForSave(input: { registration?: string; vehicleReg?: string; vehicle?: Record<string, any> }): Record<string, any> {
  const v = input.vehicle;
  if (!v || vehicleIdentityStale(input.registration, input.vehicleReg)) return {};
  return undef({
    make: v.make, model: v.model, colour: v.colour,
    fuelType: v.fuelType, engineCC: v.engineCC ? Number(v.engineCC) || null : v.engineCC,
    engineNo: v.engineNo, engineCode: v.engineCode, vin: v.vin,
    derivative: v.derivative,
    paintCode: v.paintCode, keyCode: v.keyCode, radioCode: v.radioCode,
  });
}
