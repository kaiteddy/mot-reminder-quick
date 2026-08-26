import "dotenv/config";

const UKVD_CONFIG = {
    apiKey: process.env.UKVD_API_KEY || "",
    baseUrl: "https://uk.api.vehicledataglobal.com/r2/lookup"
};

export interface UKVDResponse {
    vrm: string;
    vin?: string;
    /** Stamped on the engine itself. Nothing free returns this — only the paid lookup. */
    engineNumber?: string;
    /** First registered in the UK, as a full date. DVLA's free API only ever gives the month. */
    firstRegisteredUk?: string;
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

// Whether a UKVD response carries usable data. StatusCode 0 is a clean success; a non-zero code
// whose message still says "Success…" (e.g. 1 = "SuccessWithResultsBlockWarnings") DOES carry a
// Results block — image, DVLA tech, populated model fields. Only a status WITHOUT "Success"
// (BillingFailure, KeyInvalid, VehicleNotFound, …) means there is nothing to use.
// Regression-tested in server/ukvd.status.test.ts — do not narrow this back to `code === 0`.
export function isUsableUkvdStatus(code: number | undefined, message: string | undefined): boolean {
    if ((code ?? 0) === 0) return true;
    return /success/i.test(String(message || ""));
}

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
        // UKVD throttles a run of back-to-back lookups with a 429. Returning null there would be
        // read as "this vehicle has no data" and the car silently skipped — seen for real when
        // backfilling stock: 5 consecutive regs came back empty purely from rate limiting, and all
        // 5 returned full data on a spaced retry. A 429 is never a billed lookup, so retrying it
        // costs nothing.
        let response!: Response;
        for (let attempt = 1; ; attempt++) {
            response = await fetch(url.toString());
            if (response.status !== 429 || attempt >= 3) break;
            const retryAfter = Number(response.headers.get("retry-after")) * 1000;
            await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter : attempt * 4000));
            console.warn(`[UKVD] rate limited on ${cleanVRM} — retry ${attempt} of 2`);
        }
        if (!response.ok) {
            const why = response.status === 429 ? "rate limited (not billed)" : response.statusText;
            _lastUkvdStatus = `UKVD ${response.status}: ${why}`;
            console.error(`[UKVD] API Error: ${response.status} ${why}`);
            return null;
        }

        const data = await response.json();

        const _status = data.ResponseInformation?.StatusMessage || "";
        const _code = data.ResponseInformation?.StatusCode ?? 0;
        if (!isUsableUkvdStatus(_code, _status)) {
            _lastUkvdStatus = _status || "UKVD lookup failed";
            console.warn(`[UKVD] Lookup failed: ${_lastUkvdStatus}`);
            return null;
        }
        if (_code !== 0) console.warn(`[UKVD] ${_status} — using results with warnings`);

        const results = data.Results;
        const vehicleDetails = results?.VehicleDetails;
        const modelDetails = results?.ModelDetails;
        const imageDetails = results?.VehicleImageDetails;

        const imageList = imageDetails?.VehicleImageList || imageDetails?.VehicleImageDetails?.VehicleImageList;
        let foundImageUrl = imageList?.[0]?.ImageUrl || imageDetails?.ImageFull?.ImageUrl || imageDetails?.ImageExternal?.ImageUrl;
        // When UKVD has no photo it returns a ".../missing" placeholder (and the image block's own
        // StatusCode is non-zero, e.g. 2 = NoResultsFound). Treat that as no image, not a real one.
        if (foundImageUrl && /\/missing(?:[?#]|$)/i.test(String(foundImageUrl))) foundImageUrl = null;
        if (foundImageUrl && (imageDetails?.StatusCode ?? 0) !== 0) foundImageUrl = null;

        console.log(`[UKVD DEBUG] Found Image URL: ${foundImageUrl ? "YES" : "NO"}`);

        const modelId = modelDetails?.ModelIdentification;
        const emissions = modelDetails?.Emissions;
        const powertrain = modelDetails?.Powertrain;
        const transmission = powertrain?.Transmission || modelDetails?.Transmission;
        const weights = modelDetails?.Weights;
        const dimensions = modelDetails?.Dimensions;
        const dvlaTech = vehicleDetails?.DvlaTechnicalDetails;

        console.log(`[UKVD DEBUG] Mapping checks: modelId=${!!modelId}, emissions=${!!emissions}, powertrain=${!!powertrain}, transmission=${!!transmission}`);

        // UKVD returns the literal string "NULL" for fields it can't resolve (common on grey
        // imports) — coerce those to undefined so they never get stored as a real make/model/colour.
        const nz = (x: any) => { const s = x == null ? "" : String(x).trim(); return (!s || /^null$/i.test(s)) ? undefined : s; };
        const mapped: UKVDResponse = {
            vrm: cleanVRM,
            vin: nz(vehicleDetails?.VehicleIdentification?.Vin),
            engineNumber: nz(vehicleDetails?.VehicleIdentification?.EngineNumber),
            // Registered-in-the-UK is the one the sales invoice asks for; an import's first
            // registration abroad is earlier and would be the wrong date to print.
            firstRegisteredUk: nz(vehicleDetails?.VehicleIdentification?.DateFirstRegisteredInUk)
                ?? nz(vehicleDetails?.VehicleIdentification?.DateFirstRegistered),
            make: nz(modelId?.Make),
            model: nz(modelId?.Model),
            engineSize: dvlaTech?.EngineCapacityCc || modelDetails?.Powertrain?.IceDetails?.EngineCapacityCc,
            fuelType: nz(vehicleDetails?.VehicleIdentification?.DvlaFuelType || modelDetails?.Powertrain?.FuelType),
            colour: nz(vehicleDetails?.VehicleIdentification?.Colour),
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


/** Paid tyre-pressure fallback (TyreDetails package, 8p/lookup on this account) for cars the
 *  SWS adjustments data doesn't cover. Returns the same shape sws.ts stores, plus wheel
 *  torque/PCD when UKVD has them. Pressures arrive in bar+psi; we store bar - the UI derives psi. */
export async function fetchTyreDetailsUKVD(vrm: string): Promise<{
    entries: Array<{ size: string; front: string[]; rear: string[]; rim?: string; offset?: string; torqueNm?: number; pcd?: string }>;
    spare?: { size: string; pressure?: string };
} | null> {
    if (!UKVD_CONFIG.apiKey) return null;
    const cleanVRM = vrm.toUpperCase().replace(/\s/g, "");
    const url = new URL(UKVD_CONFIG.baseUrl);
    url.searchParams.append("ApiKey", UKVD_CONFIG.apiKey);
    url.searchParams.append("PackageName", "TyreDetails");
    url.searchParams.append("Vrm", cleanVRM);
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const data = await response.json();
    if (!isUsableUkvdStatus(data.ResponseInformation?.StatusCode ?? 0, data.ResponseInformation?.StatusMessage)) return null;
    const list = data.Results?.TyreDetails?.TyreDetailsList || [];
    const entries: any[] = [];
    const seen = new Set<string>();
    for (const item of list) {
        const f = item?.Front?.Tyre, r = item?.Rear?.Tyre;
        const size = [f?.SizeDescription, [f?.LoadIndex, f?.SpeedIndex].filter(Boolean).join("")].filter(Boolean).join(" ");
        const bar = (t: any) => [t?.Pressure?.TyrePressure?.Bar, t?.Pressure?.TyrePressureLaden?.Bar].filter((x: any) => x != null).map(String);
        const front = bar(f), rear = bar(r);
        if (!size || (!front.length && !rear.length)) continue;
        const key = `${size}|${front.join(",")}|${rear.join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
            size, front, rear,
            rim: item?.Front?.Rim?.SizeDescription || undefined,
            offset: item?.Front?.Rim?.OffsetMm != null ? String(item.Front.Rim.OffsetMm) : undefined,
            torqueNm: item?.Fixing?.TorqueNm ?? undefined,
            pcd: item?.Hub?.Pcd || undefined,
        });
    }
    return entries.length ? { entries } : null;
}
