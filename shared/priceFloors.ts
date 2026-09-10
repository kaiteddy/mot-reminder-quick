/**
 * The house price for a job-sheet line, and whether the line is priced below it.
 *
 * ONE rule for the three places that need it, so they can't drift apart the way the two copies of
 * the old floor matcher could: the desktop job sheet's warning (DocumentDetails ▸ ItemsEditor), the
 * mobile job sheet's (WorkshopJobSheet), and the server's clamp on part suggestions (db.ts
 * suggestParts).
 *
 * Where a house price comes from:
 *  - Engine oil, per litre — the price list's row for the line's grade (its Min £ where one is set,
 *    else its list price). A grade the list doesn't carry (0W-30, 5W-40…), or a line naming no grade
 *    on a car whose grade isn't known, takes the dearest listed oil: the price the job sheet's
 *    Service tick puts on it (serviceParts buildServiceSets).
 *  - Small / Major Service labour, for the line — the serviceLabourBands band for the car's engine
 *    size (jobKey interimService / fullService); with no engine size on the job, the lowest band.
 *  - Anything else — a price-list row with a Min £ whose words all appear in the line, in any order
 *    and as whole words, so "Oil Filter" catches "FILTER - OIL" but not "Coil Spring". The most
 *    specific matching row wins.
 *
 * Warn only, never block (the house style): a goodwill price stays possible, it just can't go out
 * unnoticed. Invoice 91172 (YL67KWC, 10/09/2026) was issued with its 0W-30 oil at £11.95/L against
 * £13.95 and its Major Service labour at £134 against the £155 band, and nothing warned: the floor
 * rows are named "5W-30 Engine Oil" while the tick writes "Engine Oil — 5W-30", a grade off the list
 * had no floor at all, and labour lines were never checked.
 */

export type PriceListRow = { description?: string | null; unitPrice?: unknown; minPrice?: unknown };
export type LabourBand = { maxCC?: unknown; label?: string | null; labour?: unknown };
export type FloorLine = { itemType?: string | null; description?: string | null; quantity?: unknown; unitPrice?: unknown };

export type PriceFloor = {
  kind: "oil" | "labour" | "rule";
  /** The house price — per unit (a litre of oil, one part) or for the whole line (labour). */
  min: number;
  per: "unit" | "line";
  /** Where the figure comes from, in words, for the warning. */
  why: string;
};

export type FloorContext = {
  priceList?: PriceListRow[] | null;
  /** serviceLabourBands, jobKey "interimService" — prices Small Service labour. */
  interimBands?: LabourBand[] | null;
  /** serviceLabourBands, jobKey "fullService" — prices Major Service labour. */
  fullBands?: LabourBand[] | null;
  engineCC?: unknown;
  /** The car's own oil grade from its tech data, for an oil line that doesn't name one. */
  carOilGrade?: string | null;
};

/** "£12.95", "12.95", 12.95 → 12.95; anything unreadable → 0. */
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// An SAE engine-oil grade however it gets typed: "5W-30", "5w/30", "5w_30", "5W30", "5 w 30", the
// "5/30" shorthand, "Ow-20" with a letter O. The winter number is held to engine grades (0–25W), so
// gear oil (75W-90) never reads as engine oil, and the hot number to real grades, so a tyre size
// (205/55) doesn't either.
const GRADE = /(^|[^a-z0-9.])(0|o|5|10|15|20|25)(\s*w\s*[-–—\/_]?\s*|\s*[-–—\/_]\s*)(8|12|16|20|30|40|50|60)(?![0-9])/gi;
const GRADE_WORD = /^sae\d+w\d+$/;

/** Lower-cases the text and rewrites each grade as a single word ("sae5w30"), collecting them. */
function canonical(text: string, grades?: string[]) {
  return text.toLowerCase().replace(GRADE, (m: string, pre: string, winter: string, mid: string, hot: string) => {
    if (winter === "o" && !mid.includes("w")) return m; // "o/s" is offside, not a grade
    const w = winter === "o" ? "0" : winter;
    grades?.push(`${w}W-${hot}`);
    return `${pre} sae${w}w${hot} `;
  });
}

/** Whole words, each grade kept as one — what every match here compares. */
function words(text: unknown): string[] {
  return canonical(String(text ?? "")).split(/[^a-z0-9]+/).filter(Boolean);
}

/** The first SAE grade the text names, as "5W-30"; null when it names none. */
export function oilGrade(text: unknown): string | null {
  const grades: string[] = [];
  canonical(String(text ?? ""), grades);
  return grades[0] ?? null;
}

// An "oil" line with any of these words is something other than engine oil by the litre: a part of
// the oil system, another fluid, an additive, or the job itself.
const NOT_ENGINE_OIL = new Set([
  "filter", "filters", "seal", "seals", "washer", "gasket", "ring", "leak", "leaks", "cooler", "pump", "sensor",
  "switch", "valve", "cap", "filler", "pipe", "pipes", "hose", "hoses", "tube", "sump", "plug", "pan", "dipstick",
  "pressure", "level", "housing", "separator", "breather", "trap", "thermostat", "jet", "jets", "line", "lines",
  "drain", "tank", "catch",
  "gearbox", "transmission", "gear", "diff", "differential", "axle", "atf", "dsg", "cvt", "haldex", "transfer",
  "brake", "steering", "hydraulic", "shock", "damper", "fork", "compressor", "pag", "chain", "stroke",
  "flush", "additive", "treatment", "cleaner", "stop", "change", "service", "labour", "light", "warning", "spray",
]);

/** Engine oil sold by the litre: the line names oil, and engine/motor or an engine grade, and none of
 * NOT_ENGINE_OIL — so "Castrol 5w/30 Engine Oil", "Ow-20 Synthetic Oil" and "Engine Oil — 0W-30" are,
 * and "Oil Filter", "Gearbox Oil" and "Engine Oil Flush" aren't. */
export function isEngineOil(description: unknown): boolean {
  const w = words(description);
  if (!w.includes("oil") && !w.includes("oils")) return false;
  if (w.some((x) => NOT_ENGINE_OIL.has(x))) return false;
  return w.includes("engine") || w.includes("motor") || w.some((x) => GRADE_WORD.test(x));
}

// Words in a price-list oil row that describe oil in general rather than a product. The rest of a
// row's words ("Castrol", "Edge", "C3") must appear in a line for that row to price it.
const OIL_GENERIC = new Set(["engine", "oil", "oils", "motor", "sae", "fully", "semi", "synthetic", "litre", "litres", "liter", "liters", "ltr", "ltrs", "l"]);

// Small/interim/minor service labour is banded as interimService, major/full as fullService. The two
// words must sit together, either way round with at most a dash or bracket between, so "Full Brake
// Service" or "Air Con Service, full regas" isn't read as a full service.
const INTERIM_SERVICE = /\b(small|interim|minor)\s*[-–—:(]?\s*service\b|\bservice\s*[-–—:(]?\s*(small|interim|minor)\b/i;
const FULL_SERVICE = /\b(major|full)\s*[-–—:(]?\s*service\b|\bservice\s*[-–—:(]?\s*(major|full)\b/i;

/** The labour band a line is priced from, if it's service labour. A line naming both kinds is held
 * to the lower (interim) band. */
export function serviceLabourJob(description: unknown): "interimService" | "fullService" | null {
  const d = String(description ?? "");
  if (INTERIM_SERVICE.test(d)) return "interimService";
  if (FULL_SERVICE.test(d)) return "fullService";
  return null;
}

/** Bands ordered by their (inclusive) engine-size ceiling, the open-ended one last. */
function orderedBands(bands: LabourBand[] | null | undefined) {
  return (bands || [])
    .map((b) => ({ maxCC: b.maxCC == null || b.maxCC === "" ? null : num(b.maxCC), label: String(b.label ?? "").trim(), labour: num(b.labour) }))
    .filter((b) => b.labour > 0)
    .sort((a, b) => (a.maxCC ?? Number.MAX_SAFE_INTEGER) - (b.maxCC ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Reads the price list and labour bands once, and returns the house price for a line — null when
 * nothing prices it. Advisories ("Other" lines) are never priced.
 */
export function priceFloors(ctx: FloorContext): (line: FloorLine) => PriceFloor | null {
  const rows = (ctx.priceList || []).filter((r) => String(r?.description ?? "").trim());
  const oils = rows
    .filter((r) => isEngineOil(r.description))
    .map((r) => ({
      name: String(r.description).trim(),
      grade: oilGrade(r.description),
      price: num(r.minPrice) > 0 ? num(r.minPrice) : num(r.unitPrice),
      brand: words(r.description).filter((w) => !OIL_GENERIC.has(w) && !GRADE_WORD.test(w)),
    }))
    .filter((o) => o.price > 0);
  const dearest = oils.reduce<(typeof oils)[number] | null>((a, b) => (!a || b.price > a.price ? b : a), null);
  // Oil rows are priced by grade above; every other row with a Min £ is a floor on its words.
  const rules = rows
    .filter((r) => num(r.minPrice) > 0 && !isEngineOil(r.description))
    .map((r) => ({ name: String(r.description).trim(), words: words(r.description), min: num(r.minPrice) }))
    .filter((r) => r.words.length);
  const bands = { interimService: orderedBands(ctx.interimBands), fullService: orderedBands(ctx.fullBands) };
  const cc = parseFloat(String(ctx.engineCC ?? "").replace(/[^0-9.]/g, "")) || 0;
  const carGrade = oilGrade(ctx.carOilGrade);

  return (line) => {
    const type = String(line.itemType ?? "");
    const description = String(line.description ?? "").trim();
    if (!description || /^other$/i.test(type)) return null;
    const lineWords = new Set(words(description));
    const labour = /^labour$/i.test(type);

    if (labour) {
      const job = serviceLabourJob(description);
      if (job) {
        const list = bands[job];
        if (!list.length) return null;
        const name = job === "fullService" ? "Major Service labour" : "Small Service labour";
        if (!cc) {
          const lowest = list.reduce((a, b) => (b.labour < a.labour ? b : a));
          return { kind: "labour", min: lowest.labour, per: "line", why: `${name}'s lowest band — the job has no engine size` };
        }
        const band = list.find((b) => b.maxCC == null || cc <= b.maxCC);
        return band ? { kind: "labour", min: band.labour, per: "line", why: `${name}${band.label ? `, ${band.label}` : ""} (${cc}cc)` } : null;
      }
    } else if (dearest && isEngineOil(description)) {
      const named = oilGrade(description);
      const grade = named ?? carGrade;
      const mostSpecific = (list: typeof oils) =>
        list.filter((o) => o.brand.every((w) => lineWords.has(w)))
          .sort((a, b) => b.brand.length - a.brand.length || b.name.length - a.name.length)[0];
      const hit = (grade ? mostSpecific(oils.filter((o) => o.grade === grade)) : undefined) ?? mostSpecific(oils.filter((o) => !o.grade));
      if (hit) {
        return {
          kind: "oil", min: hit.price, per: "unit",
          why: !named && hit.grade ? `the price list's ${hit.name} — the line names no grade, and this car takes ${hit.grade}` : `the price list's ${hit.name}`,
        };
      }
      return {
        kind: "oil", min: dearest.price, per: "unit",
        why: named
          ? `${named} isn't on the price list, so it takes the dearest listed oil, ${dearest.name}`
          : grade
            ? `the line names no grade, and this car's ${grade} isn't on the price list, so it takes the dearest listed oil, ${dearest.name}`
            : `the line names no grade, so it takes the dearest listed oil, ${dearest.name}`,
      };
    }

    let best: (typeof rules)[number] | undefined;
    for (const r of rules) {
      if (!r.words.every((w) => lineWords.has(w))) continue;
      if (!best || r.words.length > best.words.length || (r.words.length === best.words.length && r.name.length > best.name.length)) best = r;
    }
    return best ? { kind: "rule", min: best.min, per: labour ? "line" : "unit", why: `the price list's minimum for ${best.name}` } : null;
  };
}

const quantity = (line: FloorLine) => {
  const q = num(line.quantity);
  return q > 0 ? q : 1;
};

/** Whether a line is charged below its house price: the unit price for oil and parts, hours × rate
 * for labour. A £0 line is left to the "no price" warning, and a line discount isn't counted — it
 * shows in its own column. */
export function belowPriceFloor(line: FloorLine, floor: PriceFloor | null | undefined): floor is PriceFloor {
  if (!floor) return false;
  const price = num(line.unitPrice);
  if (!(price > 0)) return false;
  const charged = floor.per === "line" ? price * quantity(line) : price;
  return charged < floor.min - 0.004;
}

/** The unit price that brings a line up to its house price — for labour, the rate at which hours ×
 * rate reaches it, rounded up to the penny so it can't land a penny short. */
export function priceAtFloor(line: FloorLine, floor: PriceFloor): number {
  if (floor.per === "unit") return floor.min;
  return Math.ceil(Number(((floor.min / quantity(line)) * 100).toFixed(6))) / 100;
}
