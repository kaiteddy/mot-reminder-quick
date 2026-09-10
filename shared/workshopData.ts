/**
 * Everything the technical data service (SWS "E3", HaynesPro data, paid with GA4 credits) holds
 * for a car beyond oils, air con and tyres — read into plain rows the app can store and show.
 *
 * Why: one technical lookup costs 2.5 credits and covers every request for that car for the rest
 * of the day, yet the app kept only four things and threw the rest away. Found 10/09/2026 on an
 * Audi Q7: the adjustments answer it already downloaded held 11 groups (torque settings, brake
 * limits, wheel alignment, electrical, cooling, full capacities…) and four more requests returned
 * fuse box maps, the diagnostic port location, engine part locations and technical drawings.
 * Service schedules, warning lights, wiring diagrams, bulletins and recalls come back EMPTY from
 * this service's data interface, so they are not here.
 *
 * Pure: no network, no database. The raw answers are HaynesPro JSON wrapped as
 * [ { TechnicalData: … } ], and any "list" can arrive as a single object when it has one item.
 */

export type WorkshopRow = { label: string; value: string | null; unit: string | null; note: string | null; image: string | null; depth: number };
export type WorkshopGroup = { name: string; rows: WorkshopRow[] };
export type FuseItem = { ref: string; amps: number | null; what: string; kind: "fuse" | "maxi fuse" | "relay" };
export type FuseBox = { name: string; mapImage: string | null; whereImage: string | null; notes: string[]; items: FuseItem[] };
export type PartLocation = { title: string; image: string | null; notes: string[]; parts: { ref: string; name: string }[] };
export type DrawingGroup = { name: string; drawings: { title: string; image: string }[] };
export type DiagnosticPort = { note: string | null; image: string | null };

export type WorkshopData = {
  version: 1;
  source: "sws-e3";
  fetchedAt: string;
  adjustments: WorkshopGroup[];
  fuses: FuseBox[];
  diagnosticPort: DiagnosticPort[];
  locations: PartLocation[];
  drawings: DrawingGroup[];
  /** Groups the service answered with nothing for this car, so the page can say so honestly. */
  empty: string[];
};

const list = (v: any): any[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

/** The payload inside HaynesPro's wrapper, whichever of its shapes arrived. */
export function unwrapTechnicalData(json: any): any {
  if (json === null || json === undefined || json === "") return null;
  const first = Array.isArray(json) ? json[0] : json?.["0"] ?? json;
  return first?.TechnicalData ?? first ?? null;
}

/** Text as a person should read it: <br> becomes " / ", other tags and placeholder words go. */
export function cleanText(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v)
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return !s || /^(none|null|undefined)$/i.test(s) ? null : s;
}

/** HaynesPro writes units in brackets, "(mm)"; show "mm". */
const cleanUnit = (v: any): string | null => {
  const s = cleanText(v);
  return s ? s.replace(/^\((.*)\)$/, "$1").trim() || null : null;
};

/** Only a real web address counts as a picture; the service sends the word "None" otherwise. */
const cleanImage = (v: any): string | null => {
  const s = cleanText(v);
  return s && /^https:\/\//i.test(s) ? s : null;
};

export function parseAdjustments(json: any): WorkshopGroup[] {
  const td = unwrapTechnicalData(json);
  const groups: WorkshopGroup[] = [];
  for (const g of list(td?.ExtAdjustment)) {
    const name = cleanText(g?.name);
    if (!name) continue;
    const rows: WorkshopRow[] = [];
    const walk = (item: any, depth: number) => {
      const label = cleanText(item?.name);
      if (label) {
        rows.push({ label, value: cleanText(item?.value), unit: cleanUnit(item?.unit), note: cleanText(item?.remark), image: cleanImage(item?.imageName), depth });
      }
      for (const sub of list(item?.subAdjustments?.item)) walk(sub, label ? depth + 1 : depth);
    };
    for (const item of list(g?.subAdjustments?.item)) walk(item, 0);
    if (rows.length) groups.push({ name, rows });
  }
  return groups;
}

const FUSE_KIND: Record<string, FuseItem["kind"]> = { fus: "fuse", fux: "maxi fuse", rel: "relay" };

export function parseFuseLocations(json: any): FuseBox[] {
  const td = unwrapTechnicalData(json);
  const boxes: FuseBox[] = [];
  for (const b of list(td?.ExtLocationSystem)) {
    const notes: string[] = [];
    const items: FuseItem[] = [];
    for (const it of list(b?.items?.item)) {
      const what = cleanText(it?.description);
      if (!what) continue;
      if (it?.type === "loc") { notes.push(what); continue; }
      const amps = Number(it?.value);
      items.push({ ref: String(it?.location ?? "").trim(), amps: Number.isFinite(amps) && amps > 0 ? amps : null, what, kind: FUSE_KIND[it?.type] ?? "fuse" });
    }
    const name = cleanText(b?.description);
    if (!name && !items.length) continue;
    boxes.push({ name: name ?? "Fuse box", mapImage: cleanImage(b?.itemsLocationMimeDataName), whereImage: cleanImage(b?.systemLocationMimeDataName), notes, items });
  }
  return boxes;
}

export function parseDiagnosticPort(json: any): DiagnosticPort[] {
  const td = unwrapTechnicalData(json);
  return list(td?.ExtEobdLocation)
    .map((p: any) => ({ note: cleanText(p?.location), image: cleanImage(p?.mimeDataName) }))
    .filter((p) => p.note || p.image);
}

export function parseEngineLocations(json: any): PartLocation[] {
  const td = unwrapTechnicalData(json);
  const out: PartLocation[] = [];
  for (const s of list(td?.ExtLocationSystem)) {
    const notes: string[] = [];
    const parts: { ref: string; name: string }[] = [];
    for (const it of list(s?.items?.item)) {
      const name = cleanText(it?.description);
      if (!name) continue;
      if (it?.type === "loc") notes.push(name);
      else parts.push({ ref: String(it?.location ?? "").trim(), name });
    }
    const title = cleanText(s?.description);
    const image = cleanImage(s?.itemsLocationMimeDataName) ?? cleanImage(s?.systemLocationMimeDataName);
    if (!title && !image && !parts.length) continue;
    out.push({ title: title ?? "Component locations", image, notes, parts });
  }
  return out;
}

export function parseDrawings(json: any): DrawingGroup[] {
  const td = unwrapTechnicalData(json);
  const out: DrawingGroup[] = [];
  for (const g of list(td?.ExtDrawing)) {
    const drawings: { title: string; image: string }[] = [];
    const walk = (d: any, fallback: string) => {
      const title = cleanText(d?.description) ?? fallback;
      const image = cleanImage(d?.mimeDataName);
      if (image) drawings.push({ title, image });
      for (const sub of list(d?.subDrawings?.item)) walk(sub, title);
    };
    const name = cleanText(g?.description) ?? "Drawings";
    walk(g, name);
    if (drawings.length) out.push({ name, drawings });
  }
  return out;
}

/** The raw answers, as text or parsed JSON; a missing or blank answer simply counts as empty. */
export type WorkshopAnswers = { adjustments?: any; fuses?: any; diagnosticPort?: any; locations?: any; drawings?: any };

const asJson = (v: any): any => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t || t === "[]") return null;
  try { return JSON.parse(t); } catch { return null; }
};

export function buildWorkshopData(answers: WorkshopAnswers, now: Date = new Date()): WorkshopData {
  const data: WorkshopData = {
    version: 1,
    source: "sws-e3",
    fetchedAt: now.toISOString(),
    adjustments: parseAdjustments(asJson(answers.adjustments)),
    fuses: parseFuseLocations(asJson(answers.fuses)),
    diagnosticPort: parseDiagnosticPort(asJson(answers.diagnosticPort)),
    locations: parseEngineLocations(asJson(answers.locations)),
    drawings: parseDrawings(asJson(answers.drawings)),
    empty: [],
  };
  if (!data.adjustments.length) data.empty.push("Adjustments and torque settings");
  if (!data.fuses.length) data.empty.push("Fuse boxes");
  if (!data.diagnosticPort.length) data.empty.push("Diagnostic port");
  if (!data.locations.length) data.empty.push("Part locations");
  if (!data.drawings.length) data.empty.push("Drawings");
  return data;
}

/** True when the service gave nothing at all for the car. */
export const workshopIsEmpty = (w: WorkshopData | null | undefined): boolean =>
  !w || (!w.adjustments.length && !w.fuses.length && !w.diagnosticPort.length && !w.locations.length && !w.drawings.length);

/**
 * Rows to show for a search. A match on a heading brings everything beneath it — "Wheel bolts" is a
 * heading, and its figures sit under it as "Stage 1 = 90 Nm" — and a match on a figure brings the
 * headings above it, so a number is never shown without saying what it is for.
 */
export function matchingRows(rows: WorkshopRow[], filter: string): WorkshopRow[] {
  const f = filter.trim().toLowerCase();
  if (!f) return rows;
  const text = (r: WorkshopRow) => `${r.label} ${r.value ?? ""} ${r.note ?? ""}`.toLowerCase();
  const keep = new Set<number>();
  rows.forEach((r, i) => {
    if (!text(r).includes(f)) return;
    keep.add(i);
    for (let j = i + 1; j < rows.length && rows[j].depth > r.depth; j++) keep.add(j);
    let depth = r.depth;
    for (let j = i - 1; j >= 0 && depth > 0; j--) if (rows[j].depth < depth) { keep.add(j); depth = rows[j].depth; }
  });
  return rows.filter((_, i) => keep.has(i));
}

/** How many real entries rows hold: a figure, a diagram or a note all count; bare headings do not. */
export const entryCount = (rows: WorkshopRow[]): number => rows.filter((r) => r.value || r.image || r.note).length;

/**
 * The rows that belong to one row: everything after it that sits deeper, up to the next row at its
 * own level. A torque diagram hangs off a heading such as "Cylinder head"; its tightening stages
 * are the rows beneath it, and they should print with the diagram.
 */
export function rowsBeneath(rows: WorkshopRow[], index: number): WorkshopRow[] {
  const own = rows[index];
  if (!own) return [];
  const out: WorkshopRow[] = [];
  for (let i = index + 1; i < rows.length && rows[i].depth > own.depth; i++) out.push(rows[i]);
  return out;
}
