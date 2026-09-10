/**
 * DVLA Vehicle Enquiry API Service
 * Fetches vehicle details from DVLA Open Data API
 */

export interface DVLAVehicle {
  registrationNumber: string;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
  motExpiryDate?: string; // DVLA provides MOT expiry date!
  make?: string;
  model?: string;
  yearOfManufacture?: number;
  engineCapacity?: number;
  co2Emissions?: number;
  fuelType?: string;
  markedForExport?: boolean;
  colour?: string;
  typeApproval?: string;
  dateOfLastV5CIssued?: string;
  monthOfFirstRegistration?: string;
  euroStatus?: string;
  realDrivingEmissions?: string;
  wheelplan?: string;
  revenueWeight?: number;
  artEndDate?: string;
}

/**
 * Fetch vehicle details from DVLA API
 */
/**
 * Validate UK registration number format
 */
function isValidUKRegistration(registration: string): boolean {
  const cleanReg = registration.replace(/\s+/g, "").toUpperCase();

  // UK registration patterns:
  // Current format: AB12 CDE (2 letters, 2 numbers, 3 letters)
  // Prefix format: A123 BCD (1 letter, 1-3 numbers, 3 letters)
  // Suffix format: ABC 123D (3 letters, 1-3 numbers, 1 letter)
  const patterns = [
    /^[A-Z]{2}\d{2}[A-Z]{3}$/, // Current (AB12CDE)
    /^[A-Z]\d{1,3}[A-Z]{3}$/, // Prefix (A123BCD)
    /^[A-Z]{3}\d{1,3}[A-Z]$/, // Suffix (ABC123D)
    /^[A-Z]{1,3}\d{1,4}$/, // Dateless (ABC1234)
    /^\d{1,4}[A-Z]{1,3}$/, // Dateless Reversed (1234ABC)
  ];

  return patterns.some(pattern => pattern.test(cleanReg));
}

/**
 * What DVLA actually said. `getVehicleDetails` flattens every failure to null, which cannot tell
 * "DVLA has no record of this plate" from "our key was rejected" from "we were rate limited" —
 * and the refresh then stamped all of them as checked. Anything that records DVLA's answer on a
 * vehicle should use this instead.
 */
export type DvlaOutcome = "found" | "not_found" | "invalid_plate" | "rate_limited" | "auth_failed" | "no_key" | "error";
export type DvlaLookup = { outcome: DvlaOutcome; httpStatus?: number; data?: DVLAVehicle };

export async function lookupVehicle(registration: string): Promise<DvlaLookup> {
  const apiKey = process.env.DVLA_API_KEY;
  if (!apiKey) return { outcome: "no_key" };
  const cleanReg = String(registration || "").replace(/\s+/g, "").toUpperCase();
  if (!isValidUKRegistration(cleanReg)) return { outcome: "invalid_plate" };
  try {
    const response = await fetch("https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ registrationNumber: cleanReg }),
    });
    const httpStatus = response.status;
    if (response.ok) return { outcome: "found", httpStatus, data: (await response.json()) as DVLAVehicle };
    if (httpStatus === 404) return { outcome: "not_found", httpStatus };
    if (httpStatus === 400) return { outcome: "invalid_plate", httpStatus };
    if (httpStatus === 401 || httpStatus === 403) return { outcome: "auth_failed", httpStatus };
    if (httpStatus === 429) return { outcome: "rate_limited", httpStatus };
    return { outcome: "error", httpStatus };
  } catch {
    return { outcome: "error" };
  }
}

export async function getVehicleDetails(registration: string): Promise<DVLAVehicle | null> {
  const r = await lookupVehicle(registration);
  if (r.outcome === "found") {
    console.log(`[DVLA] Successfully fetched details for ${registration.replace(/\s+/g, "").toUpperCase()}`);
    return r.data ?? null;
  }
  if (r.outcome === "no_key") console.warn("[DVLA] API key not configured - skipping DVLA lookup");
  else if (r.outcome === "auth_failed") console.warn("[DVLA] API key authentication failed");
  else if (r.outcome === "rate_limited") console.warn("[DVLA] Rate limit exceeded");
  else if (r.outcome === "not_found") console.log(`[DVLA] Vehicle not found: ${registration}`);
  else if (r.outcome === "error") console.error(`[DVLA] API error ${r.httpStatus ?? ""} for ${registration}`);
  return null; // Graceful degradation, as before
}
