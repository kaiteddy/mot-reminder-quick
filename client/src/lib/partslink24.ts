import { toast } from "sonner";

// partslink24.com — LexCom's dealer-grade OEM parts portal (54 brands, one login).
// Paid login lives in the user's own browser session, so plain links are the whole
// integration, exactly like 7zap (see sevenZap.ts).
//
// URL scheme (captured from Adam's live session on 03/09/2026, VW Golf WVWZZZ1JZ3W073551):
//   https://www.partslink24.com/pl24-app/{service}/{VIN}/{state}/vehicle
// where {state} is an OPTIONAL base64url JSON blob such as
//   {"path":"/p5vwag/extern/graphnav/bom/vin?category=03950&illustration=971-060
//            &illustrationNormalized=971060&lang=en&serviceName=vw_parts&vin=…",
//    "wid":"bomlist","auto":true}
// that auto-opens one exploded diagram's parts list. Category/illustration IDs are
// partslink24's own, so we can't build them from our data — we link to the vehicle page
// (VIN pre-applied, full category tree) and let the user pick the diagram.
// The state-less form /pl24-app/{service}/{VIN}/vehicle is what partslink24 itself puts in
// its login redirect, so it survives the login round-trip.
//
// Catalogue ("service") names are the brand slug + "_parts": vw_parts was captured from the
// session, and the public demo tiles on partslink24.com open bmw_parts and mercedes_parts
// the same way (checked 03/09/2026). BRAND_SLUGS is every brand tile on that page. The
// /{service}/{VIN}/vehicle route is only proven for vw_parts — the pl24-app front end is
// shared across brands, so the rest are expected to behave the same.
const BRAND_SLUGS = new Set([
    "abarth", "alfa", "alpine", "audi", "bentley", "bmw", "bmw_classic", "bmw_motorrad",
    "bmw_motorrad_classic", "citroen", "citroen_ds", "cupra", "dacia", "fiat", "fiat_professional",
    "ford", "ford_commercial", "hyundai", "infiniti", "iveco", "jaguar", "jeep", "kia", "lancia",
    "landrover", "lexus", "man", "mercedes", "mercedes_benz_classic", "mercedes_trucks",
    "mercedes_unimog", "mercedes_vans", "mini", "mini_classic", "mitsubishi", "nissan", "opel",
    "opel_legacy", "peugeot", "polestar", "porsche", "porsche_classic", "renault", "seat", "skoda",
    "smart", "suzuki", "toyota", "vauxhall", "vauxhall_legacy", "vw", "vw_classic",
    "vw_nutzfahrzeuge", "volvo",
]);

// Free-text make (DVLA / GA4 spelling) → partslink24 slug. Keys are lower-case, single-spaced.
const MAKE_ALIASES: Record<string, string> = {
    volkswagen: "vw", "volkswagen commercial": "vw_nutzfahrzeuge", "vw commercial": "vw_nutzfahrzeuge",
    "volkswagen commercial vehicles": "vw_nutzfahrzeuge",
    "mercedes-benz": "mercedes", "mercedes benz": "mercedes", merc: "mercedes", "mercedes vans": "mercedes_vans",
    "land rover": "landrover", "range rover": "landrover",
    "alfa romeo": "alfa", ds: "citroen_ds", "citroen ds": "citroen_ds", "ds automobiles": "citroen_ds",
    "fiat professional": "fiat_professional", "ford commercial": "ford_commercial",
    porche: "porsche",
};

// World Manufacturer Identifier (VIN chars 1-3) → slug, or a list of candidates where two
// catalogues share a prefix (SEAT/Cupra, Fiat/Abarth, Opel/Vauxhall, Mercedes cars/vans …).
// Every car is unique and its VIN says who built it, so this beats the free-text make
// (GA4 holds "VW", "VOLKSWAGEN POLO", "Porche" …). The first candidate is the default; the
// make text picks another only when it names one.
const WMI_BRANDS: Record<string, string | string[]> = {
    // VW group
    WVW: "vw", WVG: "vw", "1VW": "vw", "3VW": "vw", "9BW": "vw", AAV: "vw", XW8: "vw",
    WV1: ["vw_nutzfahrzeuge", "vw"], WV2: ["vw_nutzfahrzeuge", "vw"], WV3: ["vw_nutzfahrzeuge", "vw"],
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
    // Ford
    WF0: ["ford", "ford_commercial"], WF1: "ford", "1FA": "ford", "1FM": "ford", "1FT": "ford_commercial",
    // Stellantis
    W0L: ["vauxhall", "opel"], W0V: ["vauxhall", "opel"], VXK: ["vauxhall", "opel"],
    VF3: "peugeot", VR3: "peugeot", VF7: "citroen", VR7: "citroen", VR1: "citroen_ds",
    ZFA: ["fiat", "abarth", "fiat_professional"], ZAR: "alfa", ZLA: "lancia",
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

// Longest match first so "mercedes vans" beats "mercedes" and "land rover" beats nothing.
const MAKE_KEYS = [...Object.keys(MAKE_ALIASES), ...Array.from(BRAND_SLUGS)].sort((a, b) => b.length - a.length);

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

/** partslink24 brand slug for this car: VIN manufacturer code first, make text to break ties or as fallback. */
export function partslink24Brand(vin?: string | null, make?: string | null): string | null {
    const v = cleanVin(vin);
    const fromMake = makeSlug(make);
    const wmi = v.length >= 3 ? WMI_BRANDS[v.slice(0, 3)] : undefined;
    if (wmi) {
        const candidates = Array.isArray(wmi) ? wmi : [wmi];
        return fromMake && candidates.includes(fromMake) ? fromMake : candidates[0];
    }
    return fromMake;
}

export function partslink24Service(vin?: string | null, make?: string | null): string | null {
    const brand = partslink24Brand(vin, make);
    return brand ? `${brand}_parts` : null;
}

const CATALOG_PICKER = "https://www.partslink24.com/pl24-app/catalog/vehicle";

/** Vehicle page (VIN applied, category tree open) — null when the brand can't be told. */
export function partslink24VehicleUrl(vin?: string | null, make?: string | null): string | null {
    const v = cleanVin(vin);
    const service = partslink24Service(v, make);
    if (!v || !service) return null;
    return `https://www.partslink24.com/pl24-app/${service}/${encodeURIComponent(v)}/vehicle`;
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
export function openPartslink24(vin?: string | null, make?: string | null) {
    const url = partslink24VehicleUrl(vin, make);
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
