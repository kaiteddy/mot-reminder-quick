import { describe, it, expect } from "vitest";
import { normRegKey, vehicleIdentityStale, vehicleIdentityForSave } from "../shared/vehicleIdentity";

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
