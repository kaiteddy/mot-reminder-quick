import { toast } from "sonner";

// 7zap.com — OEM parts catalogues + VIN decoder. No public API, but (verified
// while logged in, 29/07/2026) a fresh page load of
//   https://7zap.com/en/catalog/cars/{brand}/vin-decoder/#vin={VIN}
// auto-decodes the VIN and lands directly on that vehicle's full OEM catalogue
// ("VIN-based compatibility applied"). Full catalogue depth requires the user's
// 7zap login, which lives in their browser session, so plain links work.
//
// Brands whose /vin-decoder/ page returned 200 (renault was 403 — it falls back
// to the copy-VIN + generic decoder flow).
const VIN_DECODER_BRANDS = new Set([
    "audi", "bmw", "citroen", "dacia", "fiat", "ford", "honda", "hyundai",
    "jaguar", "kia", "land-rover", "lexus", "mazda", "mercedes", "mini",
    "mitsubishi", "nissan", "peugeot", "porsche", "seat", "skoda", "smart",
    "suzuki", "toyota", "vauxhall", "volkswagen", "volvo",
]);

// Fallback brand catalogue paths (used when there's no VIN on record).
const BRAND_PATHS: Record<string, string> = {
    abarth: "abarth/global", "alfa-romeo": "alfa-romeo/global", audi: "audi/europe",
    bmw: "bmw/europe", chevrolet: "chevrolet/europe", chrysler: "chrysler/global",
    citroen: "citroen/global", cupra: "cupra/europe", dacia: "dacia/europe",
    daewoo: "daewoo/europe", datsun: "datsun/europe", dodge: "dodge/global",
    fiat: "fiat/global", ford: "ford/europe", genesis: "genesis/europe",
    honda: "honda/europe", hyundai: "hyundai/europe", infiniti: "infiniti/europe",
    jaguar: "jaguar", jeep: "jeep/global", kia: "kia/europe", lancia: "lancia/global",
    "land-rover": "land-rover", mitsubishi: "mitsubishi",
    lexus: "lexus/europe", maybach: "maybach/europe", mazda: "mazda/europe",
    mercedes: "mercedes/europe", mini: "mini/europe",
    nissan: "nissan/europe", opel: "opel/global", peugeot: "peugeot/global",
    porsche: "porsche/europe", renault: "renault/europe", "rolls-royce": "rolls-royce/europe",
    saab: "saab/europe", seat: "seat/europe", skoda: "skoda/europe",
    smart: "smart/global", ssangyong: "ssangyong/europe", subaru: "subaru/europe",
    suzuki: "suzuki", toyota: "toyota/europe", vauxhall: "vauxhall/global",
    volkswagen: "volkswagen/europe", volvo: "volvo/europe",
};

// Normalise a DVLA/GA4 make string to a 7zap brand slug.
const MAKE_ALIASES: Record<string, string> = {
    "mercedes-benz": "mercedes", vw: "volkswagen", landrover: "land-rover",
    "range-rover": "land-rover",
};

function brandSlug(make?: string | null): string | null {
    let slug = (make || "").trim().toLowerCase().replace(/\s+/g, "-");
    slug = MAKE_ALIASES[slug] || slug;
    return slug || null;
}

export function sevenZapCatalogUrl(make?: string | null): string {
    const slug = brandSlug(make);
    const path = slug ? BRAND_PATHS[slug] : null;
    return path ? `https://7zap.com/en/catalog/cars/${path}/` : "https://7zap.com/en/catalog/cars/";
}

// Part pages are directly linkable too (verified logged-in 29/07/2026):
// /en/part/{brand}/{partnumber}/ resolves the OEM number to its name, offers and
// aftermarket cross-references. Only link strings that look like real OEM numbers —
// most historical GA4 "part numbers" are free text ("STARTER MOTOR", "TYRE").
export function sevenZapPartUrl(partNumber?: string | null, make?: string | null): string | null {
    const pn = (partNumber || "").trim();
    // CR#### coin batteries and R1234yf refrigerant look like OEM numbers but aren't.
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{5,}$/.test(pn) || !/\d{3,}/.test(pn) || /^CR\d{4}$/i.test(pn) || /^R1234YF$/i.test(pn)) return null;
    const slug = brandSlug(make);
    if (!slug || !BRAND_PATHS[slug]) return null;
    return `https://7zap.com/en/part/${slug}/${pn.toLowerCase().replace(/-/g, "")}/`;
}

// "Find this part": 7zap's catalogue hash accepts &section={slug} (verified 29/07/2026 on
// the Cayenne — both top-level "chassis-systems" and second-level "lubrication-system"
// open with that branch expanded and its diagram cards on screen). The classifier is
// 7zap's own and identical across brands, so a part description can be keyword-mapped to
// a section and the popup lands one click from the exploded diagram.
const SECTION_RULES: [RegExp, string][] = [
    [/\boil (filter|pump|cooler|pressure|seal)|sump\b/i, "lubrication-system"],
    [/coolant|radiator|water pump|thermostat|expansion tank|cooling fan|heater hose/i, "cooling-system"],
    [/fuel (pump|filter|rail|tank)|injector/i, "fuel-system"],
    [/air filter|turbo|intercooler|throttle|intake|boost/i, "intake-turbocharging"],
    [/exhaust|catalytic|\bcat\b|\bdpf\b|lambda|\begr\b|silencer|muffler|back box/i, "exhaust-emission-control"],
    [/head gasket|camshaft|valve cover|rocker|tappet|spark plug|glow plug|ignition coil/i, "cylinder-head"],
    [/piston|crankshaft|timing (chain|belt)|conrod|engine mount|flywheel/i, "engine-block"],
    [/clutch|gearbox|driveshaft|drive shaft|cv (joint|boot)|differential|transfer box|axle|propshaft/i, "transmission-drivetrain"],
    [/shock|absorber|coil spring|strut|control arm|wishbone|ball joint|bush|stabilis|stabiliz|anti.?roll|\barb\b|top mount|air suspension/i, "suspension"],
    [/steering|track rod|tie rod|\brack\b|\beps\b/i, "steering"],
    [/brake|disc|\bpad|caliper|\babs\b|handbrake|master cylinder/i, "brake-system"],
    [/wheel bearing|\bhub\b|wheel (bolt|nut|stud)/i, "wheels-hubs-fasteners"],
    [/battery|alternator|starter|wiper|washer pump|horn|\becu\b|\bsensor\b|switch|loom|wiring/i, "electrical-electronic"],
    [/bumper|\bwing\b|bonnet|\bdoor\b|mirror|headlight|headlamp|\blamp\b|\bbulb\b|grille|windscreen|window|tailgate|boot lid/i, "body-exterior"],
    [/\bseat|seatbelt|airbag|dashboard|trim|carpet|headliner|console/i, "interior-safety"],
];

export function sevenZapSectionFor(description?: string | null): string | null {
    const d = (description || "").trim();
    if (!d) return null;
    for (const [re, slug] of SECTION_RULES) if (re.test(d)) return slug;
    return null;
}

/** "Find" a part: popup into the vehicle's VIN catalogue with the right section expanded. */
export function findPartOn7zap(description?: string | null, vin?: string | null, make?: string | null) {
    const cleanVin = (vin || "").trim().toUpperCase();
    const slug = brandSlug(make);
    if (!cleanVin || !slug || !VIN_DECODER_BRANDS.has(slug)) {
        // No VIN (or unsupported brand) — fall back to the standard catalogue open.
        openSevenZap(vin, make);
        return;
    }
    const section = sevenZapSectionFor(description);
    toast.success(section
        ? `Finding "${(description || "").trim()}" — opening the ${section.replace(/-/g, " ")} diagrams…`
        : "Opening the vehicle's catalogue — pick the system for this part");
    openSevenZapPopup(`https://7zap.com/en/catalog/cars/${slug}/vin-decoder/#vin=${encodeURIComponent(cleanVin)}${section ? `&section=${section}` : ""}`);
}

// 7zap sends x-frame-options: SAMEORIGIN, so it can't be shown in an in-app iframe/modal.
// The next best thing is a floating popup window over the app — big enough for the exploded
// diagrams, reused on every click (same window name), and it shares the user's 7zap login.
export function openSevenZapPopup(url: string) {
    const w = Math.min(1200, window.screen.availWidth - 80);
    const h = Math.min(880, window.screen.availHeight - 80);
    const left = Math.max(0, (window.screen.availWidth - w) / 2);
    const top = Math.max(0, (window.screen.availHeight - h) / 2);
    const win = window.open(url, "sevenZapPopup", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    win?.focus();
}

/** Open the most useful 7zap page for this vehicle in a floating popup. */
export function openSevenZap(vin?: string | null, make?: string | null) {
    const cleanVin = (vin || "").trim().toUpperCase();
    const slug = brandSlug(make);
    if (cleanVin && slug && VIN_DECODER_BRANDS.has(slug)) {
        toast.success(`Opening the ${make} OEM catalogue for this VIN…`);
        openSevenZapPopup(`https://7zap.com/en/catalog/cars/${slug}/vin-decoder/#vin=${encodeURIComponent(cleanVin)}`);
    } else if (cleanVin) {
        navigator.clipboard?.writeText(cleanVin).catch(() => {});
        toast.success("VIN copied — paste it into the 7zap search box");
        openSevenZapPopup("https://7zap.com/en/vin-decoder/");
    } else {
        toast.info(`Opening the ${make || "7zap"} parts catalogue (no VIN on record)`);
        openSevenZapPopup(sevenZapCatalogUrl(make));
    }
}
