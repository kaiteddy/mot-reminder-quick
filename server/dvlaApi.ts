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
export async function getVehicleDetails(registration: string): Promise<DVLAVehicle | null> {
  const apiKey = process.env.DVLA_API_KEY;

  if (!apiKey) {
    throw new Error("DVLA API key not configured");
  }

  // Clean registration (remove spaces, convert to uppercase)
  const cleanReg = registration.replace(/\s+/g, "").toUpperCase();

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
        return null; // Vehicle not found
      }
      throw new Error(`DVLA API error: ${response.statusText}`);
    }

    const data: DVLAVehicle = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching DVLA vehicle details:", error);
    throw error;
  }
}
