import { describe, it, expect } from "vitest";
import { normRegKey, vehicleIdentityStale, vehicleIdentityForSave, looksLikeRegistration } from "../shared/vehicleIdentity";

// Regression for the 24/08/2026 corruption: staff looked up mistyped LL14YDJ (a Peugeot 3008),
// corrected the reg to LL14LDJ (a Vauxhall Mokka), and the 1s debounced auto-save fired while
// the ~30s lookup was still in flight — so saveDocument received registration=LL14LDJ with the
// form's stale Peugeot identity fields and stamped them onto the Mokka's vehicle row.
const peugeot = {
  make: "PEUGEOT", model: "3008", derivative: "ALLURE", colour: "GREY",
  fuelType: "DIESEL", engineCC: "1560", engineNo: "PSA123", engineCode: "BHZ",
  vin: "VF3XXXXXXXXX00001", paintCode: "KTP", keyCode: "K1", radioCode: "R1",
};

describe("normRegKey", () => {
  it("uppercases and strips everything but letters/digits", () => {
    expect(normRegKey("ll14 ldj")).toBe("LL14LDJ");
    expect(normRegKey(" LL14-LDJ ")).toBe("LL14LDJ");
    expect(normRegKey(undefined)).toBe("");
  });
});

describe("vehicleIdentityStale", () => {
  it("flags identity captured for a different reg than the one being saved", () => {
    expect(vehicleIdentityStale("LL14LDJ", "LL14YDJ")).toBe(true);
  });
  it("accepts matching provenance regardless of spacing/case", () => {
    expect(vehicleIdentityStale("LL14 LDJ", "ll14ldj")).toBe(false);
  });
  it("trusts payloads without a provenance tag (older clients, internal copies)", () => {
    expect(vehicleIdentityStale("LL14LDJ", undefined)).toBe(false);
  });
});

describe("vehicleIdentityForSave", () => {
  it("drops the whole identity block when it belongs to another reg (the LL14LDJ incident)", () => {
    expect(vehicleIdentityForSave({ registration: "LL14LDJ", vehicleReg: "LL14YDJ", vehicle: peugeot })).toEqual({});
  });

  it("passes the identity through when the provenance matches", () => {
    const vf = vehicleIdentityForSave({ registration: "LL14 YDJ", vehicleReg: "LL14YDJ", vehicle: peugeot });
    expect(vf.make).toBe("PEUGEOT");
    expect(vf.vin).toBe("VF3XXXXXXXXX00001");
    expect(vf.engineCC).toBe(1560); // numeric conversion preserved
  });

  it("keeps legacy behaviour for payloads without vehicleReg", () => {
    const vf = vehicleIdentityForSave({ registration: "LL14LDJ", vehicle: { make: "VAUXHALL", model: "MOKKA" } });
    expect(vf).toEqual({ make: "VAUXHALL", model: "MOKKA" });
  });

  it("filters undefined fields but keeps empty strings for the caller's blank-filter", () => {
    const vf = vehicleIdentityForSave({ registration: "LL14LDJ", vehicleReg: "LL14LDJ", vehicle: { make: "VAUXHALL", colour: "" } });
    expect(vf).toEqual({ make: "VAUXHALL", colour: "" });
  });

  it("returns nothing when there is no vehicle block at all", () => {
    expect(vehicleIdentityForSave({ registration: "LL14LDJ" })).toEqual({});
  });

  it("turns an unparseable engineCC into null (matching the old saveDocument behaviour)", () => {
    const vf = vehicleIdentityForSave({ registration: "A1", vehicleReg: "A1", vehicle: { engineCC: "abc" } });
    expect(vf.engineCC).toBeNull();
  });
});

// saveDocument creates a car that is new to the garage on an AUTO-save only when this block has
// something in it (the modern job sheet has no manual Save, so every save is an auto-save).
// Job sheet 93668, 08/09/2026: a looked-up BMW X7 on LS73OCU never got a vehicle row, so the
// printed sheet — which reads the car off the linked vehicle — came out blank.
describe("what an auto-save may create a vehicle from", () => {
  it("a completed lookup carries the details, so the car can be created", () => {
    const vf = vehicleIdentityForSave({
      registration: "LS73 OCU",
      vehicleReg: "LS73OCU",
      vehicle: { make: "BMW", model: "X7 M60I XDRIVE MHEV AUTO", vin: "WBA32EM0509T18736", engineCC: "4395", colour: "BLACK" },
    });
    expect(vf.make).toBe("BMW");
    expect(Object.keys(vf).length).toBeGreaterThan(0);
  });

  it("a half-typed plate carries nothing, so it still cannot mint a vehicle", () => {
    // The form blanks every identity field the moment the reg is edited, which is why the
    // 1s auto-save mid-typing once created 204 vehicles named "KY", "KY6", "KY62".
    const vf = vehicleIdentityForSave({
      registration: "KY6",
      vehicleReg: "KY6",
      vehicle: { make: "", model: "", vin: "", colour: "", engineCC: "" },
    });
    expect(Object.keys(vf).filter((k) => (vf as any)[k] !== "" && (vf as any)[k] != null).length).toBe(0);
  });

  it("details belonging to a different reg are refused, so no car is created from them", () => {
    expect(vehicleIdentityForSave({ registration: "LL14LDJ", vehicleReg: "YE64XWB", vehicle: peugeot })).toEqual({});
  });
});

// A registration that cannot be a plate must never mint a vehicle. Six records exist for one
// Jeep because "AVI. LEVY" was typed into the box and a car was created at nearly every keystroke.
describe("looksLikeRegistration", () => {
  it("accepts real plates, including the short private ones", () => {
    for (const r of ["LS17YLX", "A123TUC", "A123 TUC", "1431NE", "FCA12", "R3BAL", "DL07GWN", "KV08NJX", "EU16ZRA"]) {
      expect(looksLikeRegistration(r), r).toBe(true);
    }
  });

  it("rejects what actually gets typed into the box", () => {
    for (const r of ["A", "AVI", "AVI. L", "AVI. LEV", "AVI. LEVY", "", "   ", "MRS BLOOM", "CASH", "-"]) {
      expect(looksLikeRegistration(r), r).toBe(false);
    }
  });
});
