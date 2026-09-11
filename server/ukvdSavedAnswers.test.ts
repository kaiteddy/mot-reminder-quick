/**
 * UKVD lookups are bought once: what gets logged, and what is kept to be reused. Pure.
 */
import { describe, it, expect } from "vitest";
import { ukvdLogRow, mapUkvdResponse, SAVED_ANSWER_DAYS } from "./ukvd";

// The receipt UKVD sent back for KT66VLG on 10/09/2026.
const billedAnswer = {
  BillingInformation: { AccountType: 1, BillingResult: 0, AccountBalance: 140.55, TransactionCost: 0.14, BillingResultMessage: "Success" },
  RequestInformation: { SearchTerm: "KT66VLG", PackageName: "VehicleDetailsWithImage" },
  ResponseInformation: { StatusCode: 0, StatusMessage: "Success" },
  Results: { ModelDetails: { ModelIdentification: { Make: "FORD", Model: "FIESTA" } }, VehicleDetails: { VehicleIdentification: { Vin: "WF0DXXGAKDGR12345", Colour: "NULL" } } },
};

describe("ukvdLogRow", () => {
  it("keeps a billed answer with its cost and the balance after it", () => {
    const r = ukvdLogRow("KT66VLG", "VehicleDetailsWithImage", billedAnswer);
    expect(r).toMatchObject({ billed: true, saved: false, cost: 0.14, balance: 140.55, usable: true, status: "Success" });
    expect(r.raw).toBe(billedAnswer);
  });

  it("keeps a billed 'nothing found' so that plate is never paid for twice, but not as usable data", () => {
    const r = ukvdLogRow("1497SM", "VehicleDetailsWithImage", { ...billedAnswer, ResponseInformation: { StatusCode: 4, StatusMessage: "VehicleNotFound" } });
    expect(r).toMatchObject({ billed: true, usable: false, status: "VehicleNotFound" });
    expect(r.raw).not.toBeNull();
  });

  it("keeps nothing from an unbilled failure, which is free to try again", () => {
    const r = ukvdLogRow("KT66VLG", "VehicleDetailsWithImage", { BillingInformation: { BillingResult: 2 }, ResponseInformation: { StatusCode: 9, StatusMessage: "BillingFailure" } });
    expect(r).toMatchObject({ billed: false, usable: false, raw: null });
  });

  it("logs a repeat answered from a saved copy as saved, never as billed", () => {
    expect(ukvdLogRow("KT66VLG", "VehicleDetailsWithImage", null, true)).toMatchObject({ billed: false, saved: true, cost: null, raw: null });
  });
});

describe("saved answers", () => {
  it("reuses vehicle details and tyres for good, but a history check only for 30 days", () => {
    expect(SAVED_ANSWER_DAYS.VehicleDetailsWithImage).toBeNull();
    expect(SAVED_ANSWER_DAYS.TyreDetails).toBeNull();
    expect(SAVED_ANSWER_DAYS.VDICheck).toBe(30);
  });

  it("maps a saved copy exactly as it mapped the live answer", () => {
    const m = mapUkvdResponse(billedAnswer, "KT66VLG");
    expect(m).toMatchObject({ vrm: "KT66VLG", make: "FORD", model: "FIESTA", vin: "WF0DXXGAKDGR12345" });
    expect(m.colour).toBeUndefined();
    expect(mapUkvdResponse({}, "X").vrm).toBe("X");
  });
});
