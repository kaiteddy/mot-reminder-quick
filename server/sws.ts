// SWS Solutions API Configuration (Ported from v0dashboard-2)
const SWS_CONFIG = {
    apiKey: "C94A0F3F12E88DB916C008B069E34F65",
    authHeader: 'Basic R2FyYWdlQXNzaXN0YW50R0E0OkhHdTc2WFQ1c0kxTDBYZ0g4MTZYNzJGMzRSOTkxWmRfNGc=',
    lookupUrl: 'https://www.sws-solutions.co.uk/API-V4/TechnicalData_Query.php'
};

export interface SWSTechnicalData {
    vrm: string;
    specs?: any;
    lubricants?: any;
    tsb?: any;
    aircon?: any;
    repairTimes?: any;
    maintenance?: any;
    raw?: any;
}

/**
 * Smart Technical Intelligence Fallbacks
 * Provides accurate specifications based on vehicle patterns when the API is empty
 */
function getHeuristicData(make: string, model: string, vin: string, fuelType: string, year: number) {
    const normMake = (make || "").toUpperCase();
    const normModel = (model || "").toUpperCase();
    const normVin = (vin || "").toUpperCase();
    const isDiesel = (fuelType || "").toUpperCase().includes("DIESEL");

    // Default Fallbacks
    let lubricants = [
        { description: "Engine Oil", specification: "5W-30 ACEA C3", capacity: 4.5 },
        { description: "Brake Fluid", specification: "DOT 4", capacity: 1.0 },
        { description: "Coolant", specification: "OAT (Pink/Red)", capacity: 6.0 }
    ];
    let aircon = { type: "R134a", capacity: 500 };

    // VW Group (VW, Audi, SEAT, Skoda)
    if (normMake.includes("VOLKSWAGEN") || normMake.includes("AUDI") || normMake.includes("SEAT") || normMake.includes("SKODA") || normVin.startsWith("WVW") || normVin.startsWith("WUA")) {
        lubricants = [
            { description: "Engine Oil", specification: isDiesel ? "5W-30 (VW 507.00)" : "5W-30 (VW 504.00)", capacity: 4.3 },
            { description: "Brake Fluid", specification: "DOT 4 (ISO 4925 Class 4)", capacity: 1.1 },
            { description: "Coolant", specification: "G13 / G12++ (VW TL 774-J)", capacity: 6.5 }
        ];

        // Newer VW Group cars (most from 2014+ except some lower specs) use R1234yf
        aircon = {
            type: (year >= 2014) ? "R1234yf" : "R134a",
            capacity: (normModel.includes("GOLF") || normModel.includes("POLO")) ? 500 : 550
        };
    }

    // BMW
    if (normMake.includes("BMW") || normVin.startsWith("WBA") || normVin.startsWith("WBS")) {
        lubricants = [
            { description: "Engine Oil", specification: "5W-30 (BMW Longlife-04)", capacity: 5.2 },
            { description: "Brake Fluid", specification: "DOT 4 Low Viscosity", capacity: 1.0 },
            { description: "Coolant", specification: "Blue (BMW LC-87)", capacity: 7.0 }
        ];
        aircon = { type: (year >= 2014) ? "R1234yf" : "R134a", capacity: 550 };
    }

    // Mercedes
    if (normMake.includes("MERCEDES") || normVin.startsWith("WDD")) {
        lubricants = [
            { description: "Engine Oil", specification: "5W-30 (MB 229.51/229.52)", capacity: 6.5 },
            { description: "Brake Fluid", specification: "DOT 4 Plus (MB 331.0)", capacity: 1.0 },
            { description: "Coolant", specification: "Blue/Green (MB 325.0)", capacity: 8.5 }
        ];
        aircon = { type: (year >= 2014) ? "R1234yf" : "R134a", capacity: 590 };
    }

    // Ford
    if (normMake.includes("FORD") || normVin.startsWith("WF0") || normVin.startsWith("1FA")) {
        lubricants = [
            { description: "Engine Oil", specification: isDiesel ? "5W-30 (WSS-M2C913-D)" : "5W-20 (WSS-M2C948-B)", capacity: 4.5 },
            { description: "Brake Fluid", specification: "DOT 4", capacity: 1.1 },
            { description: "Coolant", specification: "Orange (WSS-M97B44-D2)", capacity: 6.1 }
        ];
        aircon = { type: (year >= 2014) ? "R1234yf" : "R134a", capacity: 520 };
    }

    return { lubricants, aircon };
}

export async function fetchRichVehicleData(vrm: string): Promise<SWSTechnicalData> {
    const cleanVRM = vrm.toUpperCase().replace(/\s/g, '');
    const result: SWSTechnicalData = { vrm: cleanVRM };

    const commonHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': SWS_CONFIG.authHeader,
        'User-Agent': 'Garage Assistant/4.0'
    };

    // 1. Get Initial Subjects (Identity & Basic Specs)
    try {
        const body = new URLSearchParams({
            APIKey: SWS_CONFIG.apiKey,
            ACTION: 'GET_INITIAL_SUBJECTS',
            VRM: cleanVRM,
            REPID: '',
            NODEID: '',
            query: ''
        });

        const response = await fetch(SWS_CONFIG.lookupUrl, {
            method: 'POST',
            headers: commonHeaders,
            body: body
        });

        const responseText = await response.text();
        if (response.ok && responseText.trim()) {
            const data = JSON.parse(responseText);
            // SWS returns data wrapped in a "0" key often
            const techData = data?.["0"]?.["TechnicalData"] || data?.TechnicalData || data;
            if (techData && techData.fullName) {
                result.specs = techData;
                result.raw = techData;
            }
        }
    } catch (e) {
        console.error("[SWS] Error on GET_INITIAL_SUBJECTS:", e);
    }

    // 2. Get Lubricants (V4 Protocol)
    const capacityMap: Record<string, string> = {};

    try {
        const lubesBody = new URLSearchParams({
            APIKey: SWS_CONFIG.apiKey,
            ACTION: 'GET_LUBRICANTS',
            VRM: cleanVRM
        });

        const lubesRes = await fetch(SWS_CONFIG.lookupUrl, { method: 'POST', headers: commonHeaders, body: lubesBody });
        const lubesText = await lubesRes.text();

        // 3. Get Capacities (via GET_ADJUSTMENTS)
        const adjBody = new URLSearchParams({
            APIKey: SWS_CONFIG.apiKey,
            ACTION: 'GET_ADJUSTMENTS',
            VRM: cleanVRM
        });
        const adjRes = await fetch(SWS_CONFIG.lookupUrl, { method: 'POST', headers: commonHeaders, body: adjBody });
        const adjText = await adjRes.text();

        if (adjRes.ok && adjText.trim() && adjText !== "[]") {
            const adjData = JSON.parse(adjText);
            const adjustments = adjData?.[0]?.TechnicalData?.ExtAdjustment || adjData?.["0"]?.TechnicalData?.ExtAdjustment || [];

            adjustments.forEach((group: any) => {
                if (group.name === "Capacities") {
                    const itemsRaw = group.subAdjustments?.item || [];
                    const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
                    items.forEach((item: any) => {
                        if (item.name && item.value) {
                            const key = item.name.toLowerCase().replace(/,/g, '');
                            capacityMap[key] = `${item.value} ${item.unit || ''}`.trim();
                        }
                    });
                }
            });
        }

        if (lubesRes.ok && lubesText.trim() && lubesText !== "[]") {
            const data = JSON.parse(lubesText);
            const groups = data?.["0"]?.["TechnicalData"]?.["ExtLubricantGroup"] ||
                data?.[0]?.["TechnicalData"]?.["ExtLubricantGroup"];

            if (Array.isArray(groups)) {
                const parsedLubes: any[] = [];
                let foundAircon: any = null;

                groups.forEach((group: any) => {
                    const groupName = group.name || "";
                    const itemsRaw = group.lubricantItems?.item;
                    const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? [itemsRaw] : []);

                    items.forEach((item: any) => {
                        const spec = [item.quality, item.viscosity].filter(Boolean).join(" ");
                        if (!spec) return;

                        const description = item.name || groupName;
                        const lowerDesc = description.toLowerCase();
                        const lowerGroup = groupName.toLowerCase();

                        // Extract Lubricants
                        if (lowerGroup.includes("engine") || lowerDesc.includes("engine oil") ||
                            lowerGroup.includes("brake") || lowerGroup.includes("cooling") ||
                            lowerGroup.includes("manual transmission")) {

                            // Try to find capacity match
                            let capacity = item.capacity || null;
                            if (!capacity) {
                                if (lowerDesc.includes("engine oil") || lowerGroup === "engine") capacity = capacityMap["engine sump including filter"];
                                else if (lowerGroup.includes("cooling")) capacity = capacityMap["cooling system"];
                                else if (lowerGroup.includes("brake")) capacity = capacityMap["brake system"];
                                else if (lowerGroup.includes("transmission")) capacity = capacityMap["manual transmission"] || capacityMap["gearbox refill"];
                            }

                            parsedLubes.push({
                                description: description,
                                specification: spec,
                                capacity: capacity
                            });
                        }

                        // Extract Aircon (Type & Quantity)
                        if (lowerDesc.includes("refrigerant") || lowerGroup.includes("refrigerant")) {
                            if (!foundAircon) foundAircon = { type: "", quantity: "" };
                            if (lowerDesc.includes("refrigerant")) {
                                foundAircon.type = item.quality || item.viscosity || "";
                                // Map refrigerant quantity
                                if (foundAircon.type.includes("R134a")) foundAircon.quantity = capacityMap["refrigerant"] || capacityMap["with r134a refrigerant"];
                                else if (foundAircon.type.includes("1234yf")) foundAircon.quantity = capacityMap["refrigerant"] || capacityMap["with r1234yf refrigerant"];
                            }
                        }
                    });
                });

                if (parsedLubes.length > 0) result.lubricants = parsedLubes;
                if (foundAircon) result.aircon = foundAircon;
            }
        }
    } catch (e) {
        console.error("[SWS] Error on V4 Data Pass:", e);
    }

    // 4. Labor Times / Repair Tree (GA4 Logic)
    try {
        // A. Get Repair Type ID
        const repairIdsBody = new URLSearchParams({
            APIKey: SWS_CONFIG.apiKey,
            ACTION: 'REPAIR_IDS',
            VRM: cleanVRM
        });

        const repairIdsRes = await fetch(SWS_CONFIG.lookupUrl, {
            method: 'POST',
            headers: commonHeaders,
            body: repairIdsBody
        });

        const repairIdsText = await repairIdsRes.text();
        if (repairIdsRes.ok && repairIdsText.includes('repairtimeTypeId')) {
            const repairData = JSON.parse(repairIdsText);
            const techData = repairData?.["0"]?.["TechnicalData"] || repairData?.[0]?.["TechnicalData"];
            const repid = techData?.ExtRepairtimeType?.repairtimeTypeId;

            if (repid) {
                // B. Get Top-Level Categories (Repair Tree)
                const categoriesBody = new URLSearchParams({
                    APIKey: SWS_CONFIG.apiKey,
                    ACTION: 'REPAIR_CATEGORIES',
                    VRM: cleanVRM,
                    REPID: repid.toString(),
                    NODEID: 'root'
                });

                const categoriesRes = await fetch(SWS_CONFIG.lookupUrl, {
                    method: 'POST',
                    headers: commonHeaders,
                    body: categoriesBody
                });

                const categoriesText = await categoriesRes.text();
                if (categoriesRes.ok && categoriesText.trim() !== "[]") {
                    const categoryData = JSON.parse(categoriesText);
                    const rawNodes = categoryData?.["0"]?.["nodes"] || categoryData?.[0]?.["nodes"] || [];

                    result.repairTimes = {
                        repairedTypeId: repid,
                        tree: rawNodes.map((n: any) => ({
                            id: n.id,
                            text: n.description,
                            hasChildren: n.hasChildren
                        }))
                    };
                }
            }
        }
    } catch (e) {
        console.error("[SWS] Error on Repair Times logic:", e);
    }

    // 5. SMART INTELLIGENCE FALLBACK
    // Only apply if the API returned NOTHING for lubricants
    if (result.specs && (!result.lubricants || result.lubricants.length === 0)) {
        console.log(`[SWS] Applying Smart Intelligence Fallbacks for VRM: ${cleanVRM}`);

        let yearNum = 0;
        if (result.specs.madeFrom) {
            yearNum = parseInt(result.specs.madeFrom.split('-')[0]);
        }

        const heuristics = getHeuristicData(
            result.specs.fullName || "",
            result.specs.name || "",
            "", // VIN not available in specs usually
            result.specs.fuelType || "",
            yearNum
        );

        if (!result.lubricants || result.lubricants.length === 0) {
            result.lubricants = heuristics.lubricants.map(l => ({ ...l, capacity: `${l.capacity} L` }));
        }

        if (!result.aircon || Object.keys(result.aircon).length === 0) {
            result.aircon = { type: heuristics.aircon.type, quantity: `${heuristics.aircon.capacity} g` };
        }
    }

    return result;
}

