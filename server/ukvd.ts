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
    /** Set when this answer is a saved copy of a lookup already paid for: when it was bought (ISO). */
    savedAt?: string;
    raw?: any;
}

export type UkvdTyreDetails = {
    entries: Array<{ size: string; front: string[]; rear: string[]; rim?: string; offset?: string; torqueNm?: number; pcd?: string }>;
    spare?: { size: string; pressure?: string };
};

// Last UKVD response status, so callers can distinguish "no data" from an account/billing
// problem (which blocks VIN/colour for ALL lookups until the UKVD account is sorted).
let _lastUkvdStatus: string | null = null;
export const getLastUkvdStatus = () => _lastUkvdStatus;

// Billing block of the last response. Present even when the lookup finds no vehicle, so a
// caller can tell "billed, but UKVD has nothing for this reg" (never worth paying for again)
// from "not billed at all" (rate limit, network, dry account — retryable for free).
let _lastUkvdBilling: { billed: boolean; accountBalance: number | null } | null = null;
export const getLastUkvdBilling = () => _lastUkvdBilling;

// Whether a UKVD response carries usable data. StatusCode 0 is a clean success; a non-zero code
// whose message still says "Success…" (e.g. 1 = "SuccessWithResultsBlockWarnings") DOES carry a
// Results block — image, DVLA tech, populated model fields. Only a status WITHOUT "Success"
// (BillingFailure, KeyInvalid, VehicleNotFound, …) means there is nothing to use.
// Regression-tested in server/ukvd.status.test.ts — do not narrow this back to `code === 0`.
export function isUsableUkvdStatus(code: number | undefined, message: string | undefined): boolean {
    if ((code ?? 0) === 0) return true;
    return /success/i.test(String(message || ""));
}

// ─── Every paid answer is bought once ────────────────────────────────────────────────────────────
/**
 * Adam, 11/09/2026 ("Yes only once please"): the MOT check bought a fresh lookup (14p) every time
 * anyone checked a plate we held no VIN for — the header quick check included — and kept nothing,
 * so the same car was paid for again and again, and that spend never reached the costs panel.
 *
 * Every response UKVD sends is now written to "ukvdLookups" with its receipt (the cost, and the
 * account balance after it), and a later lookup of the same plate and package is answered from the
 * saved copy without calling UKVD. A billed "nothing found" is kept too, so a plate UKVD cannot
 * resolve is never paid for twice. The one exception is the full history check (VDICheck): finance,
 * stolen and write-off markers change, so a saved one is reused for 30 days, then bought fresh.
 * Pass { refresh: true } to buy regardless.
 */
export const SAVED_ANSWER_DAYS: Record<string, number | null> = { VehicleDetailsWithImage: null, TyreDetails: null, VDICheck: 30 };

/** The log row for one UKVD response, or for a repeat answered from a saved copy (`data` null). Pure. */
export function ukvdLogRow(vrm: string, pkg: string, data: any | null, saved = false) {
    const bi = data?.BillingInformation;
    const ri = data?.ResponseInformation;
    const billed = !saved && bi?.BillingResult === 0;
    return {
        vrm, package: pkg, billed, saved,
        cost: typeof bi?.TransactionCost === "number" ? bi.TransactionCost : null,
        balance: typeof bi?.AccountBalance === "number" ? bi.AccountBalance : null,
        // Only a billed answer is kept to be reused; an unbilled failure (dry account, bad key) is free to retry.
        usable: billed && isUsableUkvdStatus(ri?.StatusCode ?? 0, ri?.StatusMessage),
        status: ri?.StatusMessage ?? null,
        raw: billed ? data : null,
    };
}

let logReady: Promise<void> | null = null;

/** The database client with the lookup log in place, or null. A log problem never stops a lookup. */
async function ukvdLogClient(): Promise<any | null> {
    try {
        const { getDb } = await import("./db");
        const db: any = await getDb();
        const client = db?.$client;
        if (!client) return null;
        logReady ??= client.query(`CREATE TABLE IF NOT EXISTS "ukvdLookups" (
            id SERIAL PRIMARY KEY,
            vrm VARCHAR(16) NOT NULL,
            package VARCHAR(40) NOT NULL,
            billed BOOLEAN NOT NULL DEFAULT false,
            saved BOOLEAN NOT NULL DEFAULT false,
            cost NUMERIC(8,2),
            balance NUMERIC(10,2),
            usable BOOLEAN NOT NULL DEFAULT false,
            status TEXT,
            raw JSONB,
            "createdAt" TIMESTAMP NOT NULL DEFAULT NOW())`)
            .then(() => client.query(`CREATE INDEX IF NOT EXISTS "ukvdLookups_vrm_idx" ON "ukvdLookups" (vrm, package, "createdAt" DESC)`))
            .then(() => undefined);
        try { await logReady; } catch (e) { logReady = null; throw e; }
        return client;
    } catch (e: any) {
        console.warn("[UKVD] lookup log unavailable:", e?.message || e);
        return null;
    }
}

export async function ensureUkvdLookupLog(): Promise<void> {
    await ukvdLogClient();
}

async function logUkvdCall(vrm: string, pkg: string, data: any | null, saved = false): Promise<void> {
    const client = await ukvdLogClient();
    if (!client) return;
    const r = ukvdLogRow(vrm, pkg, data, saved);
    try {
        await client.query(
            `INSERT INTO "ukvdLookups" (vrm, package, billed, saved, cost, balance, usable, status, raw) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [r.vrm, r.package, r.billed, r.saved, r.cost, r.balance, r.usable, r.status, r.raw == null ? null : JSON.stringify(r.raw)]);
    } catch (e: any) {
        console.warn(`[UKVD] could not log the ${pkg} lookup for ${vrm}:`, e?.message || e);
    }
}

type SavedAnswer = { raw: any; usable: boolean; status: string | null; at: Date };

async function savedUkvdAnswer(vrm: string, pkg: string): Promise<SavedAnswer | null> {
    const client = await ukvdLogClient();
    if (!client) return null;
    try {
        const days = SAVED_ANSWER_DAYS[pkg] ?? null;
        const { rows } = await client.query(
            `SELECT raw, usable, status, "createdAt" FROM "ukvdLookups"
              WHERE vrm = $1 AND package = $2 AND billed AND NOT saved
                AND ($3::int IS NULL OR "createdAt" > (now() AT TIME ZONE 'UTC') - make_interval(days => $3::int))
              ORDER BY "createdAt" DESC LIMIT 1`, [vrm, pkg, days]);
        if (rows[0]) return { raw: rows[0].raw, usable: !!rows[0].usable && !!rows[0].raw, status: rows[0].status, at: new Date(rows[0].createdAt) };
        if (days != null) return null;
        // Lookups bought before the log existed were kept on the vehicle itself.
        const { rows: kept } = await client.query(
            `SELECT "comprehensiveTechnicalData"->'ukvd'->'raw' AS raw, "swsLastUpdated" AS at FROM vehicles
              WHERE REPLACE(UPPER(registration), ' ', '') = $1
                AND "comprehensiveTechnicalData"->'ukvd'->'raw'->'RequestInformation'->>'PackageName' = $2
              ORDER BY "swsLastUpdated" DESC NULLS LAST LIMIT 1`, [vrm, pkg]);
        return kept[0]?.raw ? { raw: kept[0].raw, usable: true, status: null, at: kept[0].at ? new Date(kept[0].at) : new Date() } : null;
    } catch (e: any) {
        console.warn(`[UKVD] could not read saved ${pkg} answers for ${vrm}:`, e?.message || e);
        return null;
    }
}

/** UKVD's response shape → ours. Pure. */
export function mapUkvdResponse(data: any, cleanVRM: string): UKVDResponse {
    const results = data?.Results;
    const vehicleDetails = results?.VehicleDetails;
    const modelDetails = results?.ModelDetails;
    const imageDetails = results?.VehicleImageDetails;

    const imageList = imageDetails?.VehicleImageList || imageDetails?.VehicleImageDetails?.VehicleImageList;
    let foundImageUrl = imageList?.[0]?.ImageUrl || imageDetails?.ImageFull?.ImageUrl || imageDetails?.ImageExternal?.ImageUrl;
    // When UKVD has no photo it returns a ".../missing" placeholder (and the image block's own
    // StatusCode is non-zero, e.g. 2 = NoResultsFound). Treat that as no image, not a real one.
    if (foundImageUrl && /\/missing(?:[?#]|$)/i.test(String(foundImageUrl))) foundImageUrl = null;
    if (foundImageUrl && (imageDetails?.StatusCode ?? 0) !== 0) foundImageUrl = null;

    const modelId = modelDetails?.ModelIdentification;
    const emissions = modelDetails?.Emissions;
    const powertrain = modelDetails?.Powertrain;
    const transmission = powertrain?.Transmission || modelDetails?.Transmission;
    const weights = modelDetails?.Weights;
    const dimensions = modelDetails?.Dimensions;
    const dvlaTech = vehicleDetails?.DvlaTechnicalDetails;

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
    if (results?.PncDetails || results?.MiaftrDetails || results?.FinanceDetails || vehicleDetails?.VehicleStatus) {
        mapped.provenance = {
            isStolen: results?.PncDetails?.IsStolen === true,
            hasWriteOff: Array.isArray(results?.MiaftrDetails?.WriteOffRecordList) && results.MiaftrDetails.WriteOffRecordList.length > 0,
            hasFinance: Array.isArray(results?.FinanceDetails?.FinanceRecordList) && results.FinanceDetails.FinanceRecordList.length > 0,
            mileageAnomaly: results?.MileageCheckDetails?.MileageAnomalyDetected === true,
            scrapped: vehicleDetails?.VehicleStatus?.IsScrapped === true,
            exported: vehicleDetails?.VehicleStatus?.IsExported === true,
            imported: vehicleDetails?.VehicleStatus?.IsImported === true
        };
    }
    return mapped;
}

export async function fetchUKVDData(vrm: string, isPremium: boolean = false, opts: { refresh?: boolean } = {}): Promise<UKVDResponse | null> {
    _lastUkvdStatus = null;
    _lastUkvdBilling = null;
    if (!UKVD_CONFIG.apiKey) {
        console.warn("[UKVD] No API key configured. Skipping lookup.");
        _lastUkvdStatus = "No UKVD API key configured";
        return null;
    }

    const cleanVRM = vrm.toUpperCase().replace(/\s/g, '');
    // Use VehicleDetailsWithImage — the package this account is actually contracted for (per the
    // UKVD usage report: 594 clean calls vs 30 BillingFailures on plain VehicleDetails) — and it
    // also returns the vehicle image. The response parser already handles VehicleImageDetails.
    const targetPackage = isPremium ? "VDICheck" : "VehicleDetailsWithImage";

    if (!opts.refresh) {
        const saved = await savedUkvdAnswer(cleanVRM, targetPackage);
        if (saved) {
            await logUkvdCall(cleanVRM, targetPackage, null, true);
            _lastUkvdBilling = { billed: false, accountBalance: null };
            if (!saved.usable) {
                _lastUkvdStatus = saved.status || "UKVD had no data for this vehicle";
                return null;
            }
            return { ...mapUkvdResponse(saved.raw, cleanVRM), savedAt: saved.at.toISOString() };
        }
    }

    const url = new URL(UKVD_CONFIG.baseUrl);
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
        await logUkvdCall(cleanVRM, targetPackage, data);

        const bi = data.BillingInformation;
        _lastUkvdBilling = {
            billed: bi?.BillingResult === 0,
            accountBalance: typeof bi?.AccountBalance === "number" ? bi.AccountBalance : null,
        };

        const _status = data.ResponseInformation?.StatusMessage || "";
        const _code = data.ResponseInformation?.StatusCode ?? 0;
        if (!isUsableUkvdStatus(_code, _status)) {
            _lastUkvdStatus = _status || "UKVD lookup failed";
            console.warn(`[UKVD] Lookup failed: ${_lastUkvdStatus}`);
            return null;
        }
        if (_code !== 0) console.warn(`[UKVD] ${_status} — using results with warnings`);

        return mapUkvdResponse(data, cleanVRM);
    } catch (error) {
        console.error("[UKVD] Fetch failed:", error);
        return null;
    }
}

/** TyreDetails response → the shape sws.ts stores. Pure. */
export function parseTyreDetails(data: any): UkvdTyreDetails | null {
    const list = data?.Results?.TyreDetails?.TyreDetailsList || [];
    const entries: UkvdTyreDetails["entries"] = [];
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

/** Paid tyre-pressure fallback (TyreDetails package, 8p/lookup on this account) for cars the
 *  SWS adjustments data doesn't cover. Returns the same shape sws.ts stores, plus wheel
 *  torque/PCD when UKVD has them. Pressures arrive in bar+psi; we store bar - the UI derives psi.
 *  Bought once per plate, like every UKVD answer (see SAVED_ANSWER_DAYS). */
export async function fetchTyreDetailsUKVD(vrm: string, opts: { refresh?: boolean } = {}): Promise<UkvdTyreDetails | null> {
    if (!UKVD_CONFIG.apiKey) return null;
    const cleanVRM = vrm.toUpperCase().replace(/\s/g, "");
    if (!opts.refresh) {
        const saved = await savedUkvdAnswer(cleanVRM, "TyreDetails");
        if (saved) {
            await logUkvdCall(cleanVRM, "TyreDetails", null, true);
            return saved.usable ? parseTyreDetails(saved.raw) : null;
        }
    }
    const url = new URL(UKVD_CONFIG.baseUrl);
    url.searchParams.append("ApiKey", UKVD_CONFIG.apiKey);
    url.searchParams.append("PackageName", "TyreDetails");
    url.searchParams.append("Vrm", cleanVRM);
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const data = await response.json();
    await logUkvdCall(cleanVRM, "TyreDetails", data);
    if (!isUsableUkvdStatus(data.ResponseInformation?.StatusCode ?? 0, data.ResponseInformation?.StatusMessage)) return null;
    return parseTyreDetails(data);
}
