import { toast } from "sonner";

// 7zap.com — OEM parts catalogues + VIN decoder. No public API, so we deep-link:
// with a VIN we copy it to the clipboard and open the VIN decoder (paste + search);
// otherwise we open the brand's own catalogue. Full catalogue depth requires the
// user's 7zap login, which lives in their browser session, so plain links work.
const BRAND_PATHS: Record<string, string> = {
    abarth: "abarth/global", "alfa-romeo": "alfa-romeo/global", audi: "audi/europe",
    bmw: "bmw/europe", chevrolet: "chevrolet/europe", chrysler: "chrysler/global",
    citroen: "citroen/global", cupra: "cupra/europe", dacia: "dacia/europe",
    daewoo: "daewoo/europe", datsun: "datsun/europe", dodge: "dodge/global",
    fiat: "fiat/global", ford: "ford/europe", genesis: "genesis/europe",
    honda: "honda/europe", hyundai: "hyundai/europe", infiniti: "infiniti/europe",
    jeep: "jeep/global", kia: "kia/europe", lancia: "lancia/global",
    lexus: "lexus/europe", maybach: "maybach/europe", mazda: "mazda/europe",
    mercedes: "mercedes/europe", "mercedes-benz": "mercedes/europe", mini: "mini/europe",
    nissan: "nissan/europe", opel: "opel/global", peugeot: "peugeot/global",
    porsche: "porsche/europe", renault: "renault/europe", "rolls-royce": "rolls-royce/europe",
    saab: "saab/europe", seat: "seat/europe", skoda: "skoda/europe",
    smart: "smart/global", ssangyong: "ssangyong/europe", subaru: "subaru/europe",
    suzuki: "suzuki", toyota: "toyota/europe", vauxhall: "vauxhall/global",
    volkswagen: "volkswagen/europe", volvo: "volvo/europe",
};

export function sevenZapCatalogUrl(make?: string | null): string {
    const slug = (make || "").trim().toLowerCase().replace(/\s+/g, "-");
    const path = BRAND_PATHS[slug];
    return path ? `https://7zap.com/en/catalog/cars/${path}/` : "https://7zap.com/en/catalog/cars/";
}

/** Copy the VIN (if we have one) and open the most useful 7zap page in a new tab. */
export function openSevenZap(vin?: string | null, make?: string | null) {
    if (vin) {
        navigator.clipboard.writeText(vin);
        toast.success("VIN copied — paste it into the 7zap search box");
        setTimeout(() => window.open("https://7zap.com/en/vin-decoder/", "_blank"), 300);
    } else {
        toast.info(`Opening the ${make || "7zap"} parts catalogue (no VIN on record)`);
        setTimeout(() => window.open(sevenZapCatalogUrl(make), "_blank"), 300);
    }
}
