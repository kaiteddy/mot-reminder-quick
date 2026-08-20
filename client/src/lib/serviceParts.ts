/**
 * ONE definition of what a service physically needs — shared by the desktop job sheet's
 * "Add service parts" dropdown (DocumentDetails ▸ ServicePartsPicker) and the mobile New Job
 * Sheet's one-tap job chips (WorkshopJobSheet), so the two can't drift the way the invoice
 * renderers once did.
 *
 * Small Service  — engine oil (qty = the engine's oil capacity), oil filter, sump plug seal,
 *                  £4.50 sundries, banded labour by engine size.
 * Major Service  — oil, oil/air/cabin filters, sump plug, £5.50 sundries (labour set by staff).
 * Air Con Re-Gas — offered only when the vehicle's tech data says it has aircon.
 *
 * Parts are priced from the partsPriceList table where a match exists; oil grade/capacity come
 * from the vehicle's SWS tech data so the oil quantity matches the engine.
 */

export type ServicePart = { description: string; quantity: number; unitPrice?: number; vatRate?: number };
export type ServiceLabour = { description: string; unitPrice: number };
export type ServiceSet = { label: string; parts: ServicePart[]; sundries?: number; labour?: ServiceLabour };

export type VehOilInfo = {
  oilSpec?: string;
  oilGrades: string[];
  oilPreferred: string[];
  oilCapacity?: any;
  airconType?: any;
  airconCapacity?: any;
};

// A part's name matches a price-list entry when every significant word (≥3 letters, so a grade
// like "5W-30" still counts) in the entry's description appears somewhere in the part's — handles
// word-order differences like "Engine Oil — 5W-30" vs. a price-list entry titled "5W-30 Engine Oil".
export function priceListMatch(desc: string, priceList: { description: string; unitPrice: string; vatRate: string | null }[]) {
  const d = desc.toLowerCase();
  const hit = priceList.find((p) => {
    const words = p.description.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    return words.length > 0 && words.every((w) => d.includes(w));
  });
  return hit ? { unitPrice: Number(hit.unitPrice), vatRate: hit.vatRate != null ? Number(hit.vatRate) : undefined } : {};
}

// Fallback only. Service labour is banded by engine size in the serviceLabourBands table —
// these two tiers apply only while that query hasn't answered.
export const SMALL_SERVICE_LABOUR_CC_CUTOFF = 2000;
export const SMALL_SERVICE_LABOUR_SMALL = 124;
export const SMALL_SERVICE_LABOUR_LARGE = 144;

/** Banded small-service labour: bands are ordered by their ceiling with the last open-ended,
 * so the first whose maxCC the engine fits under is the right one. */
export function bandedServiceLabour(cc: number, bands: any[] | undefined): number {
  if (!bands?.length) return cc < SMALL_SERVICE_LABOUR_CC_CUTOFF ? SMALL_SERVICE_LABOUR_SMALL : SMALL_SERVICE_LABOUR_LARGE;
  const hit = bands.find((b) => b.maxCC == null || cc <= Number(b.maxCC));
  return Number(hit?.labour ?? SMALL_SERVICE_LABOUR_SMALL);
}

/** Oil + aircon facts from a vehicle row's SWS tech data (vehicles.comprehensiveTechnicalData).
 * SWS lists one engine-oil row per ACEA/API standard; collapse to the distinct SAE grades
 * (e.g. 5W-30, 0W-30, 0W-20), preferred first, so every grade the engine accepts is visible. */
export function parseVehOil(vehicle: any): VehOilInfo {
  const td = (vehicle?.comprehensiveTechnicalData as any) || {};
  const oils = (td.lubricants || []).filter((l: any) => /engine oil/i.test(l?.description || ""));
  const oil = oils[0];
  const gradeOf = (s: any) => (String(s).match(/\b\d+W[-\s]?\d+\b/i) || [])[0]?.toUpperCase().replace(/\s+/g, "") || "";
  const prefG = Array.from(new Set(oils.filter((o: any) => /preferred/i.test(o?.description || "")).map((o: any) => gradeOf(o.specification)).filter(Boolean))) as string[];
  const allG = Array.from(new Set(oils.map((o: any) => gradeOf(o.specification)).filter(Boolean))) as string[];
  return {
    oilSpec: oil?.specification,
    oilGrades: [...prefG, ...allG.filter((g) => !prefG.includes(g))],
    oilPreferred: prefG,
    oilCapacity: oil?.capacity,
    airconType: td.aircon?.type,
    airconCapacity: td.aircon?.quantity ?? td.aircon?.capacity,
  };
}

/** The service sets themselves — the single source both pickers render. */
export function buildServiceSets(opts: {
  vehInfo: Partial<VehOilInfo> | undefined;
  engineCC?: any;
  priceList: any[];
  labourBands: any[] | undefined;
  grade?: string;
  /** Net labour for a Major/Full Service. No banded table exists for it — the caller passes the
   * Price Guide's per-band median of what we've actually charged (priceGuide.forRegistration →
   * fullServiceLabour.net). Absent → the labour line is left for staff to price. */
  majorLabourNet?: number | null;
}): Record<string, ServiceSet> {
  const { vehInfo, priceList } = opts;
  const priced = (description: string, quantity: number): ServicePart => ({ description, quantity, ...priceListMatch(description, priceList) });

  const oilCap = parseFloat(String(vehInfo?.oilCapacity ?? "").replace(/[^\d.]/g, "")) || 0;
  const oilLabel = opts.grade || vehInfo?.oilGrades?.[0] || vehInfo?.oilSpec || "";
  const oil = priced(oilLabel ? `Engine Oil — ${oilLabel}` : "Engine Oil", oilCap || 1);
  const oilFilter = priced("Oil Filter", 1);

  const cc = parseFloat(String(opts.engineCC ?? "").replace(/[^0-9.]/g, "")) || 0;
  const smallServiceLabour = cc > 0
    ? { description: "Small Service Labour", unitPrice: bandedServiceLabour(cc, opts.labourBands) }
    : undefined; // engine size not known yet — leave labour for staff to add rather than guess

  const sets: Record<string, ServiceSet> = {
    small: { label: "Small Service", parts: [oil, oilFilter, priced("Sump Plug Seal", 1)], sundries: 4.5, labour: smallServiceLabour },
    major: {
      label: "Major Service",
      parts: [oil, oilFilter, priced("Air Filter", 1), priced("Cabin Filter", 1), priced("Sump Plug", 1)],
      sundries: 5.5,
      labour: opts.majorLabourNet ? { description: "Major Service Labour", unitPrice: opts.majorLabourNet } : undefined,
    },
  };
  if (vehInfo?.airconType) {
    sets.aircon = {
      label: "Air Con Re-Gas",
      parts: [priced(`Air Con Re-Gas — ${vehInfo.airconType}${vehInfo.airconCapacity ? ` (${String(vehInfo.airconCapacity).trim()})` : ""}`.trim(), 1)],
    };
  }
  return sets;
}
