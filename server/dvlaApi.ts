/**
 * DVLA Vehicle Enquiry API Service
 * Fetches vehicle details from DVLA Open Data API
 */

interface DVLAVehicle {
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
  ];
  
  return patterns.some(pattern => pattern.test(cleanReg));
}

export async function getVehicleDetails(registration: string): Promise<DVLAVehicle | null> {
  const apiKey = process.env.DVLA_API_KEY;

  if (!apiKey) {
    console.warn("[DVLA] API key not configured - skipping DVLA lookup");
    return null; // Return null instead of throwing to allow graceful degradation
  }

  // Clean registration (remove spaces, convert to uppercase)
  const cleanReg = registration.replace(/\s+/g, "").toUpperCase();
  
  // Validate registration format
  if (!isValidUKRegistration(cleanReg)) {
    console.log(`[DVLA] Invalid UK registration format: ${cleanReg}`);
    return null;
  }

  try {
    const response = await fetch("https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        registrationNumber: cleanReg,
      }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[DVLA] Vehicle not found: ${cleanReg}`);
        return null; // Vehicle not found
      }
      if (response.status === 400) {
        console.log(`[DVLA] Bad request for ${cleanReg} - possibly invalid registration or API key issue`);
        return null; // Return null for bad requests instead of throwing
      }
      if (response.status === 403) {
        console.warn(`[DVLA] API key authentication failed`);
        return null;
      }
      if (response.status === 429) {
        console.warn(`[DVLA] Rate limit exceeded`);
        return null;
      }
      
      console.error(`[DVLA] API error ${response.status}: ${response.statusText}`);
      return null; // Graceful degradation
    }

    const data: DVLAVehicle = await response.json();
    console.log(`[DVLA] Successfully fetched details for ${cleanReg}`);
    return data;
  } catch (error) {
    console.error(`[DVLA] Error fetching vehicle details for ${cleanReg}:`, error);
    return null; // Return null instead of throwing to allow graceful degradation
  }
}
