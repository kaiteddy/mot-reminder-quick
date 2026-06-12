import { describe, it, expect } from "vitest";
import { isUsableUkvdStatus } from "./ukvd";

// Regression guard for the bug where UKVD's "SuccessWithResultsBlockWarnings" (StatusCode 1) was
// treated as a failure, throwing away the whole response (image + tech data) for older vehicles.
describe("isUsableUkvdStatus", () => {
  it("accepts a clean success (code 0)", () => {
    expect(isUsableUkvdStatus(0, "Success")).toBe(true);
  });

  it("accepts success-with-warnings — the bug we fixed", () => {
    expect(isUsableUkvdStatus(1, "SuccessWithResultsBlockWarnings")).toBe(true);
  });

  it("accepts any other Success* variant", () => {
    expect(isUsableUkvdStatus(2, "SuccessWithImageBlockWarnings")).toBe(true);
  });

  it("rejects a billing failure", () => {
    expect(isUsableUkvdStatus(5, "BillingFailure")).toBe(false);
  });

  it("rejects an invalid API key", () => {
    expect(isUsableUkvdStatus(2, "KeyInvalid")).toBe(false);
  });

  it("rejects vehicle-not-found", () => {
    expect(isUsableUkvdStatus(3, "VehicleNotFound")).toBe(false);
  });

  it("treats a missing/undefined code as usable (defensive)", () => {
    expect(isUsableUkvdStatus(undefined, "Success")).toBe(true);
  });

  it("rejects a non-zero code with an empty message", () => {
    expect(isUsableUkvdStatus(9, "")).toBe(false);
  });
});
