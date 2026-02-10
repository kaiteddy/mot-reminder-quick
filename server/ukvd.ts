import "dotenv/config";

const UKVD_CONFIG = {
    apiKey: process.env.UKVD_API_KEY || "",
    packageName: process.env.UKVD_PACKAGE_NAME || "VehicleDetailsWithImage",
    baseUrl: "https://uk.api.vehicledataglobal.com/r2/lookup"
};

export interface UKVDResponse {
    vrm: string;
    vin?: string;
    make?: string;
    model?: string;
    engineSize?: number;
    fuelType?: string;
    imageUrl?: string;
    dimensions?: {
        height?: number;
        width?: number;
        length?: number;
        wheelbase?: number;
    };
    weights?: {
        kerb?: number;
        gross?: number;
        unladen?: number;
        payload?: number;
    };
    fuelTankCapacity?: number;
    euroStatus?: string;
    co2Emissions?: number;
    transmission?: {
        type?: string;
        gears?: number;
        driveType?: string;
    };
    raw?: any;
}

export async function fetchUKVDData(vrm: string): Promise<UKVDResponse | null> {
    if (!UKVD_CONFIG.apiKey) {
        console.warn("[UKVD] No API key configured. Skipping lookup.");
        return null;
    }

    const cleanVRM = vrm.toUpperCase().replace(/\s/g, '');
    const url = new URL(UKVD_CONFIG.baseUrl);
    url.searchParams.append("ApiKey", UKVD_CONFIG.apiKey);
    url.searchParams.append("PackageName", UKVD_CONFIG.packageName);
    url.searchParams.append("Vrm", cleanVRM);

    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            console.error(`[UKVD] API Error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();

        // Response format according to spec: { Results: { VehicleDetails: { ... }, ModelDetails: { ... } } }
        if (data.ResponseInformation?.StatusCode !== 0) {
            console.warn(`[UKVD] Lookup failed: ${data.ResponseInformation?.StatusMessage}`);
            return null;
        }

        const results = data.Results;
        const vehicleDetails = results?.VehicleDetails;
        const modelDetails = results?.ModelDetails;
        const imageDetails = results?.VehicleImageDetails;

        const mapped: UKVDResponse = {
            vrm: cleanVRM,
            vin: vehicleDetails?.VehicleIdentification?.Vin,
            make: modelDetails?.ModelIdentification?.Make,
            model: modelDetails?.ModelIdentification?.Model,
            engineSize: vehicleDetails?.DvlaTechnicalDetails?.EngineCapacityCc,
            fuelType: vehicleDetails?.VehicleIdentification?.DvlaFuelType,
            imageUrl: imageDetails?.ImageFull?.ImageUrl || imageDetails?.ImageExternal?.ImageUrl,
            dimensions: {
                height: modelDetails?.Dimensions?.HeightMm,
                width: modelDetails?.Dimensions?.WidthMm,
                length: modelDetails?.Dimensions?.LengthMm,
                wheelbase: modelDetails?.Dimensions?.WheelbaseLengthMm,
            },
            weights: {
                kerb: modelDetails?.Weights?.KerbWeightKg,
                gross: modelDetails?.Weights?.GrossVehicleWeightKg,
                unladen: modelDetails?.Weights?.UnladenWeightKg,
                payload: modelDetails?.Weights?.PayloadWeightKg,
            },
            fuelTankCapacity: modelDetails?.BodyDetails?.FuelTankCapacityLitres,
            euroStatus: vehicleDetails?.DvlaTechnicalDetails?.EuroStatus,
            co2Emissions: vehicleDetails?.DvlaTechnicalDetails?.Co2Emissions,
            transmission: {
                type: modelDetails?.Transmission?.TransmissionType,
                gears: modelDetails?.Transmission?.NumberOfGears,
                driveType: modelDetails?.Transmission?.DriveType,
            },
            raw: data
        };

        return mapped;
    } catch (error) {
        console.error("[UKVD] Fetch failed:", error);
        return null;
    }
}
