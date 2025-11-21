/**
 * MOT History API Service
 * Integrates with DVSA MOT History API to fetch vehicle MOT data
 */

interface MOTApiConfig {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  scopeUrl: string;
  tokenUrl: string;
}

interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface MOTTest {
  completedDate: string;
  testResult: string;
  expiryDate?: string;
  odometerValue?: string;
  odometerUnit?: string;
  motTestNumber?: string;
  defects?: Array<{
    text: string;
    type: string;
    dangerous?: boolean;
  }>;
}

interface MOTHistory {
  registration: string;
  make?: string;
  model?: string;
  primaryColour?: string;
  fuelType?: string;
  motTests?: MOTTest[];
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get OAuth access token for MOT API
 */
async function getAccessToken(config: MOTApiConfig): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scopeUrl,
    grant_type: "client_credentials",
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data: AccessTokenResponse = await response.json();
  
  // Cache token (expires in seconds, convert to milliseconds and subtract 60s buffer)
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return data.access_token;
}

/**
 * Fetch MOT history for a vehicle registration
 */
export async function getMOTHistory(registration: string): Promise<MOTHistory | null> {
  const config: MOTApiConfig = {
    clientId: process.env.DVSA_CLIENT_ID || "",
    clientSecret: process.env.DVSA_CLIENT_SECRET || "",
    apiKey: process.env.DVSA_API_KEY || "",
    scopeUrl: process.env.DVSA_SCOPE_URL || "",
    tokenUrl: process.env.DVSA_TOKEN_URL || "",
  };

  // Validate config
  if (!config.clientId || !config.clientSecret || !config.apiKey) {
    throw new Error("MOT API credentials not configured");
  }

  // Clean registration (remove spaces, convert to uppercase)
  const cleanReg = registration.replace(/\s+/g, "").toUpperCase();

  try {
    const accessToken = await getAccessToken(config);

    const response = await fetch(
      `https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?registration=${cleanReg}`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "x-api-key": config.apiKey,
          "Accept": "application/json+v6",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Vehicle not found
      }
      throw new Error(`MOT API error: ${response.statusText}`);
    }

    const data: any[] = await response.json();
    
    if (!data || data.length === 0) {
      return null;
    }
    
    const vehicle = data[0];
    
    // Transform MOT tests to include defects
    if (vehicle.motTests) {
      vehicle.motTests = vehicle.motTests.map((test: any) => ({
        completedDate: test.completedDate,
        testResult: test.testResult,
        expiryDate: test.expiryDate,
        odometerValue: test.odometerValue,
        odometerUnit: test.odometerUnit,
        motTestNumber: test.motTestNumber,
        defects: test.rfrAndComments?.map((item: any) => ({
          text: item.text,
          type: item.type,
          dangerous: item.dangerous || false,
        })) || [],
      }));
    }
    
    return vehicle as MOTHistory;
  } catch (error) {
    console.error("Error fetching MOT history:", error);
    throw error;
  }
}

/**
 * Get the latest MOT expiry date from MOT history
 */
export function getLatestMOTExpiry(motHistory: MOTHistory): Date | null {
  if (!motHistory.motTests || motHistory.motTests.length === 0) {
    return null;
  }

  // Find the most recent PASS test with an expiry date
  const passedTests = motHistory.motTests
    .filter(test => test.testResult === "PASSED" && test.expiryDate)
    .sort((a, b) => new Date(b.completedDate).getTime() - new Date(a.completedDate).getTime());

  if (passedTests.length > 0 && passedTests[0]?.expiryDate) {
    return new Date(passedTests[0].expiryDate);
  }

  return null;
}
