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
