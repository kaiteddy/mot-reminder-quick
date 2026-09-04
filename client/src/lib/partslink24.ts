import { toast } from "sonner";

// partslink24.com — LexCom's dealer-grade OEM parts portal (54 brands, one login).
// Paid login lives in the user's own browser session, so plain links are the whole
// integration, exactly like 7zap (see sevenZap.ts).
//
// URL scheme, read out of partslink24's own SPA router (pl24-app bundle, 04/09/2026):
//   /pl24-app/:catalogId/:vin/:pathObject[/:companion]?lang=en
// - catalogId  = "{brand}_parts" (validServiceNameRegex /^[a-z]+(_[a-z]+)*_parts$/)
// - vin        = the VIN, or "0" for none. A VIN here makes the app's Vehicle stage call the
//                catalogue's direct-access VIN lookup and land on that car (it even logs a
//                "startedSearchWithVINUrl" event), so this is a supported entry point.
// - pathObject = "0" for none, else a base64 JSON blob {path, wid, auto} that re-opens one
//                exploded diagram (the link Adam captured had one). Its IDs are partslink24's
//                own, so we always send "0" and let the user pick the diagram.
// - companion  = optional trailing page such as "vehicle" or "search".
// partslink24's own "Chassis number" box (pl24-vinsearch-ui) builds exactly
//   /pl24-app/{service}/{VIN}/0/vehicle
// after decoding the VIN with its private /pl24-wmi/ext/api/2.0/decode (403 without a login),
// which is why we decode the WMI ourselves below.
// v1 of this module put "vehicle" in the pathObject slot ("/vw_parts/{VIN}/vehicle") — that is
// not valid JSON, the app discards it, and Adam got an error page. Always send the "0".
//
// Catalogue ("service") names come from partslink24's own manufacturer list
// (GET /pl24-manufacturer/ext/api/1.0/manufacturers/?country=gb&lang=en, public, read 04/09/2026).
// They are NOT always "{brand}_parts": Ford is split into fordp (cars) / fordt (Transit), Fiat into
// fiatp / fiatt, Mitsubishi is mmc_parts, VW Commercial is vn_parts, DS is citroenDs_parts, and
// PSA-era Vauxhall/Opel have their own psa_* catalogues. Keys are our internal brand slugs.
const SERVICE_NAMES: Record<string, string> = {
    vw: "vw_parts", vw_commercial: "vn_parts", audi: "audi_parts", seat: "seat_parts", cupra: "cupra_parts",
    skoda: "skoda_parts", porsche: "porsche_parts", bentley: "bentley_parts",
    bmw: "bmw_parts", mini: "mini_parts",
    mercedes: "mercedes_parts", mercedes_vans: "mercedesvans_parts", smart: "smart_parts",
    ford: "fordp_parts", ford_commercial: "fordt_parts",
    vauxhall: "vauxhall_parts", psa_vauxhall: "psa_vauxhall_parts", opel: "opel_parts", psa_opel: "psa_opel_parts",
    peugeot: "peugeot_parts", citroen: "citroen_parts", citroen_ds: "citroenDs_parts",
    fiat: "fiatp_parts", fiat_professional: "fiatt_parts", abarth: "abarth_parts", alfa: "alfa_parts",
    lancia: "lancia_parts", jeep: "jeep_parts",
    renault: "renault_parts", dacia: "dacia_parts", alpine: "alpine_parts",
    nissan: "nissan_parts", infiniti: "infiniti_parts", toyota: "toyota_parts", lexus: "lexus_parts",
    hyundai: "hyundai_parts", kia: "kia_parts", jaguar: "jaguar_parts", landrover: "landrover_parts",
    volvo: "volvo_parts", polestar: "polestar_parts", suzuki: "suzuki_parts", mitsubishi: "mmc_parts",
    iveco: "iveco_parts", man: "man_parts",
};

// Free-text make (DVLA / GA4 spelling) → internal slug. Keys are lower-case, single-spaced.
const MAKE_ALIASES: Record<string, string> = {
    volkswagen: "vw", "volkswagen commercial": "vw_commercial", "vw commercial": "vw_commercial",
    "volkswagen commercial vehicles": "vw_commercial",
    "mercedes-benz": "mercedes", "mercedes benz": "mercedes", merc: "mercedes", "mercedes vans": "mercedes_vans",
    "land rover": "landrover", "range rover": "landrover",
    "alfa romeo": "alfa", ds: "citroen_ds", "citroen ds": "citroen_ds", "ds automobiles": "citroen_ds",
    "fiat professional": "fiat_professional", "ford commercial": "ford_commercial",
    porche: "porsche",
};

// World Manufacturer Identifier (VIN chars 1-3) → slug, or a list of candidates where several
// catalogues share a prefix. Every car is unique and its VIN says who built it, so this beats
// the free-text make (GA4 holds "VW", "VOLKSWAGEN POLO", "Porche" …). The first candidate is the
// default; the make text or the model text (see COMMERCIAL_MODELS) picks another.
const WMI_BRANDS: Record<string, string | string[]> = {
    // VW group
    WVW: "vw", WVG: "vw", "1VW": "vw", "3VW": "vw", "9BW": "vw", AAV: "vw", XW8: "vw",
    WV1: ["vw_commercial", "vw"], WV2: ["vw_commercial", "vw"], WV3: ["vw_commercial", "vw"],
    WAU: "audi", WA1: "audi", WUA: "audi", TRU: "audi",
    VSS: ["seat", "cupra"], VSZ: ["seat", "cupra"],
    TMB: "skoda", TMP: "skoda",
    WP0: "porsche", WP1: "porsche",
    SCB: "bentley",
    // BMW group
    WBA: "bmw", WBS: "bmw", WBY: "bmw", WBX: "bmw", WB1: "bmw", "5UX": "bmw", "5YM": "bmw",
    WMW: "mini", WMZ: "mini",
    // Mercedes / smart
    WDB: "mercedes", WDC: "mercedes", WDD: "mercedes", W1K: "mercedes", W1N: "mercedes", WMX: "mercedes",
    "4JG": "mercedes", "55S": "mercedes",
    WDF: ["mercedes_vans", "mercedes"], W1V: ["mercedes_vans", "mercedes"],
    WME: "smart",
    // Ford (cars and Transits share WF0 — the model text decides)
    WF0: ["ford", "ford_commercial"], WF1: "ford", "1FA": "ford", "1FM": "ford", "1FT": "ford_commercial",
    // Vauxhall / Opel: W0L = GM era, VXK = PSA era, W0V = either
    W0L: ["vauxhall", "opel"], W0V: ["vauxhall", "psa_vauxhall", "opel", "psa_opel"], VXK: ["psa_vauxhall", "psa_opel"],
    // Other Stellantis
    VF3: "peugeot", VR3: "peugeot", VF7: "citroen", VR7: "citroen", VR1: "citroen_ds",
    ZFA: ["fiat", "fiat_professional", "abarth"], ZAR: "alfa", ZLA: "lancia",
    "1C4": "jeep", "1J4": "jeep", ZAC: "jeep",
    // Renault group
    VF1: "renault", UU1: "dacia", VFA: "alpine",
    // Nissan / Infiniti
    SJN: "nissan", JN1: "nissan", JN8: "nissan", VSK: "nissan", JNK: "infiniti", SJK: "infiniti",
    // Toyota / Lexus
    SB1: "toyota", JT1: "toyota", JTD: "toyota", JTE: "toyota", JTM: "toyota", JTN: "toyota", NMT: "toyota", VNK: "toyota",
    JTH: "lexus", JTJ: "lexus",
    // Hyundai / Kia
    KMH: "hyundai", TMA: "hyundai", NLH: "hyundai", KNA: "kia", KND: "kia", U5Y: "kia", U6Y: "kia",
    // JLR
    SAJ: "jaguar", SAL: "landrover",
    // Volvo / Polestar
    YV1: "volvo", YV4: "volvo", LVY: "volvo", LPS: "polestar", YSM: "polestar",
    // Japanese others
    JSA: "suzuki", TSM: "suzuki", JMB: "mitsubishi", JA3: "mitsubishi", MMC: "mitsubishi",
    // Commercial
    ZCF: "iveco", WMA: "man",
};

// Where one WMI covers both a car and a van catalogue, the model name settles it.
const COMMERCIAL_MODELS: Record<string, RegExp> = {
    ford_commercial: /\b(transit|tourneo|ranger|courier|connect|custom)\b/i,
    fiat_professional: /\b(ducato|doblo|dobl[oò] cargo|fiorino|scudo|talento|qubo)\b/i,
    vw_commercial: /\b(transporter|caravelle|multivan|crafter|caddy|amarok|california|\bt[456]\b|\bid\.? ?buzz)\b/i,
    mercedes_vans: /\b(sprinter|vito|viano|citan|v-class|v class|eqv|x-class)\b/i,
};

// Longest match first so "mercedes vans" beats "mercedes".
const MAKE_KEYS = [...Object.keys(MAKE_ALIASES), ...Object.keys(SERVICE_NAMES)].sort((a, b) => b.length - a.length);

function makeSlug(make?: string | null): string | null {
    const text = (make || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!text) return null;
    // Exact, then "starts with" so "MERCEDES-BENZ A CLASS" / "SEAT Leon" / "VOLKSWAGEN POLO" resolve.
    for (const k of MAKE_KEYS) {
        if (text === k || text.startsWith(k + " ") || text.startsWith(k + "-")) return MAKE_ALIASES[k] || k;
    }
    return null;
}

function cleanVin(vin?: string | null): string {
    return (vin || "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Internal brand slug for this car: VIN manufacturer code first; make/model text to break ties or as fallback. */
export function partslink24Brand(vin?: string | null, make?: string | null, model?: string | null): string | null {
    const v = cleanVin(vin);
    const fromMake = makeSlug(make);
    const wmi = v.length >= 3 ? WMI_BRANDS[v.slice(0, 3)] : undefined;
    if (!wmi) return fromMake;
    const candidates = Array.isArray(wmi) ? wmi : [wmi];
    // 1. A van model name (Transit, Ducato, Transporter, Vito …) picks the commercial catalogue.
    const text = `${make || ""} ${model || ""}`;
    for (const c of candidates) if (COMMERCIAL_MODELS[c]?.test(text)) return c;
    // 2. A make that names one candidate outright (CUPRA vs SEAT, OPEL vs VAUXHALL) wins.
    if (fromMake && candidates.includes(fromMake)) return fromMake;
    // 3. Otherwise the car catalogue; a van slug only wins on evidence above.
    return candidates.find((c) => !COMMERCIAL_MODELS[c]) ?? candidates[0];
}

export function partslink24Service(vin?: string | null, make?: string | null, model?: string | null): string | null {
    const brand = partslink24Brand(vin, make, model);
    return brand ? SERVICE_NAMES[brand] ?? null : null;
}

const CATALOG_PICKER = "https://www.partslink24.com/pl24-app/catalog/vehicle";

/** Vehicle page (VIN applied, category tree open) — null when the brand can't be told. */
export function partslink24VehicleUrl(vin?: string | null, make?: string | null, model?: string | null): string | null {
    const v = cleanVin(vin);
    const service = partslink24Service(v, make, model);
    if (!v || !service) return null;
    // Exactly what partslink24's own "Chassis number" box builds (pl24-vinsearch-ui): /{service}/{vin}/0/vehicle
    return `https://www.partslink24.com/pl24-app/${service}/${encodeURIComponent(v)}/0/vehicle?lang=en`;
}

// partslink24 sends frame-blocking headers like 7zap, so it can't be embedded in-app.
// Same floating popup pattern, its own window name so it doesn't fight the 7zap window.
export function openPartslink24Popup(url: string) {
    const w = Math.min(1280, window.screen.availWidth - 80);
    const h = Math.min(900, window.screen.availHeight - 80);
    const left = Math.max(0, (window.screen.availWidth - w) / 2);
    const top = Math.max(0, (window.screen.availHeight - h) / 2);
    const win = window.open(url, "partslink24Popup", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    win?.focus();
}

/** Open the most useful partslink24 page for this vehicle in a floating popup. */
export function openPartslink24(vin?: string | null, make?: string | null, model?: string | null) {
    const url = partslink24VehicleUrl(vin, make, model);
    const v = cleanVin(vin);
    if (url) {
        toast.success(`Opening partslink24 for ${v}…`);
        openPartslink24Popup(url);
    } else if (v) {
        navigator.clipboard?.writeText(v).catch(() => {});
        toast.success("VIN copied — pick the brand on partslink24 and paste it into the VIN box");
        openPartslink24Popup(CATALOG_PICKER);
    } else {
        toast.info("Opening partslink24 (no VIN on record)");
        openPartslink24Popup(CATALOG_PICKER);
    }
}
