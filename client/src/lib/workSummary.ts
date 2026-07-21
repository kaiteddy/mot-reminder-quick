// Colour-coded work types detected from a job's free-text notes, so you recognise what a car's
// in for by colour at a glance. Anything not matched shows as a short grey summary. Shared by
// the Documents list and the Quick Search dropdowns so a job reads the same way everywhere.
export const WORK_TYPES: { label: string; re: RegExp; cls: string }[] = [
  { label: "MOT", re: /\bmot\b/i, cls: "bg-blue-100 text-blue-700" },
  { label: "SERVICE", re: /\bservice\b/i, cls: "bg-emerald-100 text-emerald-700" },
  { label: "TYRES", re: /\btyres?\b|\bpuncture\b/i, cls: "bg-amber-100 text-amber-800" },
  { label: "BRAKES", re: /\bbrakes?\b|\bpads?\b|\bdiscs?\b/i, cls: "bg-red-100 text-red-700" },
  { label: "CLUTCH", re: /\bclutch\b/i, cls: "bg-purple-100 text-purple-700" },
  { label: "AIRCON", re: /air ?con|\ba\/c\b|re-?gas|condenser/i, cls: "bg-cyan-100 text-cyan-700" },
  { label: "BATTERY", re: /\bbatter/i, cls: "bg-yellow-100 text-yellow-800" },
  { label: "CAMBELT", re: /cam ?belt|timing (belt|chain)/i, cls: "bg-orange-100 text-orange-700" },
  { label: "EXHAUST", re: /\bexhaust\b|\bdpf\b/i, cls: "bg-stone-200 text-stone-700" },
  { label: "DIAGNOSTIC", re: /diagnos|investigat|warning light|\bfault\b|\bepc\b/i, cls: "bg-indigo-100 text-indigo-700" },
  { label: "RECOVERY", re: /recover/i, cls: "bg-rose-100 text-rose-700" },
  { label: "SUSPENSION", re: /suspension|shock absorber|\bwishbone\b/i, cls: "bg-teal-100 text-teal-700" },
];

export function workSummary(desc?: string | null): { badges: { label: string; cls: string }[]; summary: string } | null {
  if (!desc) return null;
  const text = desc.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const badges: { label: string; cls: string }[] = [];
  for (const wt of WORK_TYPES) if (wt.re.test(text)) badges.push({ label: wt.label, cls: wt.cls });
  // keep the readable detail; only strip the generic MOT/Service filler so it isn't duplicated by the badge
  const rest = text
    .replace(/\bcarry out\b/gi, "")
    .replace(/\bmot\b/gi, "")
    .replace(/\b(small|full|major|interim|main|annual)?\s*service\b/gi, "")
    .replace(/^[\s\-–—•,.:()]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const summary = rest.length > 2 ? (rest.length > 46 ? rest.slice(0, 44).replace(/\s+\S*$/, "") + "…" : rest) : "";
  return { badges, summary };
}
