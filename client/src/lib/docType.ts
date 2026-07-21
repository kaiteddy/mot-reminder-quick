// Single source of truth for GA4 document-type labels, ordering and colour so every list in the
// app (Quick Search — both Modern and Classic, the Documents list, a vehicle/document's own
// History tab) shows the same colour for the same type. Hex values are sampled off live GA4
// reference screenshots (job sheet plum/purple, invoice dark petrol teal, estimate green).
export const DOC_TYPE_LABEL: Record<string, string> = {
  SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note", XS: "Excess", PA: "Purchase", VS: "Vehicle Sale",
};
export const DOC_TYPE_PLURAL: Record<string, string> = {
  JS: "Job Sheets", ES: "Estimates", SI: "Invoices", CR: "Credit Notes", XS: "Excess", VS: "Vehicle Sales", PA: "Purchases",
};
export const DOC_TYPE_ORDER = ["JS", "ES", "SI", "CR", "XS", "VS", "PA"];
export const DOC_TYPE_HEX: Record<string, string> = {
  JS: "#4a1f5e", SI: "#155263", ES: "#15803d", CR: "#b91c1c", XS: "#a21caf", VS: "#78716c", PA: "#57534e",
};
export const DOC_TYPE_TINT: Record<string, string> = {
  JS: "#efe6f5", SI: "#e2eef1", ES: "#e3f5ea", CR: "#fbe4e4", XS: "#f6e3f7", VS: "#eeece9", PA: "#ece9e6",
};
export const DOC_TYPE_TAILWIND: Record<string, string> = {
  JS: "bg-purple-100 text-purple-800", SI: "bg-sky-100 text-sky-800", ES: "bg-emerald-100 text-emerald-800",
  CR: "bg-red-100 text-red-800", XS: "bg-fuchsia-100 text-fuchsia-800", VS: "bg-stone-200 text-stone-700", PA: "bg-stone-100 text-stone-600",
};
export const DOC_TYPE_ICON_CLASS: Record<string, string> = {
  JS: "text-purple-500", SI: "text-sky-500", ES: "text-emerald-500", CR: "text-red-500", XS: "text-fuchsia-500", VS: "text-stone-500", PA: "text-stone-400",
};

/** Splits a list of docs (each with a `docType`) into type-labelled buckets in a fixed, sensible
 *  order (Job Sheets, Estimates, Invoices, …) — a type with no matches just isn't in the result. */
export function groupByDocType<T extends { docType?: string | null }>(docs: T[]): { type: string; label: string; docs: T[] }[] {
  const byType = new Map<string, T[]>();
  for (const d of docs) { const t = d.docType || "?"; if (!byType.has(t)) byType.set(t, []); byType.get(t)!.push(d); }
  const ordered = DOC_TYPE_ORDER.filter((t) => byType.has(t)).map((t) => ({ type: t, label: DOC_TYPE_PLURAL[t] || t, docs: byType.get(t)! }));
  for (const [t, docsForType] of byType) if (!DOC_TYPE_ORDER.includes(t)) ordered.push({ type: t, label: DOC_TYPE_LABEL[t] || t, docs: docsForType });
  return ordered;
}
