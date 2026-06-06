import "dotenv/config";

const UKVD_CONFIG = {
    apiKey: process.env.UKVD_API_KEY || "",
    baseUrl: "https://uk.api.vehicledataglobal.com/r2/lookup"
};

export interface UKVDResponse {
    vrm: string;
    vin?: string;
    make?: string;
    model?: string;
    engineSize?: number;
    fuelType?: string;
    colour?: string;
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
    provenance?: {
        isStolen?: boolean;
        hasWriteOff?: boolean;
        hasFinance?: boolean;
        mileageAnomaly?: boolean;
        scrapped?: boolean;
        exported?: boolean;
        imported?: boolean;
    };
    raw?: any;
}

// Last UKVD response status, so callers can distinguish "no data" from an account/billing
// problem (which blocks VIN/colour for ALL lookups until the UKVD account is sorted).
let _lastUkvdStatus: string | null = null;
export const getLastUkvdStatus = () => _lastUkvdStatus;

export async function fetchUKVDData(vrm: string, isPremium: boolean = false): Promise<UKVDResponse | null> {
    _lastUkvdStatus = null;
    if (!UKVD_CONFIG.apiKey) {
        console.warn("[UKVD] No API key configured. Skipping lookup.");
        _lastUkvdStatus = "No UKVD API key configured";
        return null;
    }

    const cleanVRM = vrm.toUpperCase().replace(/\s/g, '');
    const url = new URL(UKVD_CONFIG.baseUrl);
    // Use VehicleDetailsWithImage — the package this account is actually contracted for (per the
    // UKVD usage report: 594 clean calls vs 30 BillingFailures on plain VehicleDetails) — and it
    // also returns the vehicle image. The response parser already handles VehicleImageDetails.
    const targetPackage = isPremium ? "VDICheck" : "VehicleDetailsWithImage";
    url.searchParams.append("ApiKey", UKVD_CONFIG.apiKey);
    url.searchParams.append("PackageName", targetPackage);
    url.searchParams.append("Vrm", cleanVRM);

    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            console.error(`[UKVD] API Error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();

        if (data.ResponseInformation?.StatusCode !== 0) {
            _lastUkvdStatus = data.ResponseInformation?.StatusMessage || "UKVD lookup failed";
            console.warn(`[UKVD] Lookup failed: ${_lastUkvdStatus}`);
            return null;
        }

        const results = data.Results;
        const vehicleDetails = results?.VehicleDetails;
        const modelDetails = results?.ModelDetails;
        const imageDetails = results?.VehicleImageDetails;

        const imageList = imageDetails?.VehicleImageList || imageDetails?.VehicleImageDetails?.VehicleImageList;
        const foundImageUrl = imageList?.[0]?.ImageUrl || imageDetails?.ImageFull?.ImageUrl || imageDetails?.ImageExternal?.ImageUrl;

        console.log(`[UKVD DEBUG] Found Image URL: ${foundImageUrl ? "YES" : "NO"}`);

        const modelId = modelDetails?.ModelIdentification;
        const emissions = modelDetails?.Emissions;
        const powertrain = modelDetails?.Powertrain;
        const transmission = powertrain?.Transmission || modelDetails?.Transmission;
        const weights = modelDetails?.Weights;
        const dimensions = modelDetails?.Dimensions;
        const dvlaTech = vehicleDetails?.DvlaTechnicalDetails;

        console.log(`[UKVD DEBUG] Mapping checks: modelId=${!!modelId}, emissions=${!!emissions}, powertrain=${!!powertrain}, transmission=${!!transmission}`);

        const mapped: UKVDResponse = {
            vrm: cleanVRM,
            vin: vehicleDetails?.VehicleIdentification?.Vin,
            make: modelId?.Make,
            model: modelId?.Model,
            engineSize: dvlaTech?.EngineCapacityCc || modelDetails?.Powertrain?.IceDetails?.EngineCapacityCc,
            fuelType: vehicleDetails?.VehicleIdentification?.DvlaFuelType || modelDetails?.Powertrain?.FuelType,
            colour: vehicleDetails?.VehicleIdentification?.Colour,
            imageUrl: foundImageUrl,
            dimensions: {
                height: dimensions?.HeightMm,
                width: dimensions?.WidthMm,
                length: dimensions?.LengthMm,
                wheelbase: dimensions?.WheelbaseLengthMm,
            },
            weights: {
                kerb: weights?.KerbWeightKg,
                gross: weights?.GrossVehicleWeightKg,
                unladen: weights?.UnladenWeightKg,
                payload: weights?.PayloadWeightKg,
            },
            fuelTankCapacity: modelDetails?.BodyDetails?.FuelTankCapacityLitres,
            euroStatus: emissions?.EuroStatus || dvlaTech?.EuroStatus,
            co2Emissions: emissions?.ManufacturerCo2 || dvlaTech?.Co2Emissions,
            transmission: {
                type: transmission?.TransmissionType,
                gears: transmission?.NumberOfGears,
                driveType: transmission?.DriveType,
            },
            raw: data
        };
        // Add Provenance Data
        if (results.PncDetails || results.MiaftrDetails || results.FinanceDetails || vehicleDetails?.VehicleStatus) {
            mapped.provenance = {
                isStolen: results.PncDetails?.IsStolen === true,
                hasWriteOff: Array.isArray(results.MiaftrDetails?.WriteOffRecordList) && results.MiaftrDetails.WriteOffRecordList.length > 0,
                hasFinance: Array.isArray(results.FinanceDetails?.FinanceRecordList) && results.FinanceDetails.FinanceRecordList.length > 0,
                mileageAnomaly: results.MileageCheckDetails?.MileageAnomalyDetected === true,
                scrapped: vehicleDetails?.VehicleStatus?.IsScrapped === true,
                exported: vehicleDetails?.VehicleStatus?.IsExported === true,
                imported: vehicleDetails?.VehicleStatus?.IsImported === true
            };
        }

        return mapped;
    } catch (error) {
        console.error("[UKVD] Fetch failed:", error);
        return null;
    }
}
