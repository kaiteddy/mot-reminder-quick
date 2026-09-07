/** What counts as a serviceable item, and how to spot one on a job.
 *
 *  A car's job history answers "what did we invoice" but not "when was the brake fluid last
 *  changed" — that is buried in the line items of a job from three years ago. These patterns pull
 *  the second answer out of the first, so the servicing view can say when each item was last done
 *  and how far the car has run since.
 *
 *  Matched against every line description on the job AND the job's own description, lower-cased.
 *  Order matters: the first match wins, so the specific sits above the general (a "fuel filter"
 *  must not be read as an oil filter, and "brake fluid" must not be read as brake pads).
 */
export type ServiceItem = {
  key: string; label: string;
  group: "Service" | "Fluids" | "Filters" | "Wear" | "Other";
  test: RegExp;
  /** Guide interval. Deliberately generic — a manufacturer schedule beats it every time, and the
   *  view says so. Items replaced when they wear out (pads, tyres, battery) carry neither. */
  everyMiles?: number; everyMonths?: number;
};

export const SERVICE_ITEMS: ServiceItem[] = [
  // Whole services first — a "major service" implies the oil and filters under it.
  { key: "majorService", label: "Major service", group: "Service", test: /\b(major|full)\s+service\b/, everyMiles: 20000, everyMonths: 24 },
  { key: "smallService", label: "Small service", group: "Service", test: /\b(small|interim|basic|minor)\s+service\b/, everyMiles: 10000, everyMonths: 12 },
  { key: "service", label: "Service", group: "Service", test: /\bservice\b(?!\s*(check|charge|centre))/, everyMiles: 10000, everyMonths: 12 },

  { key: "cambelt", label: "Cambelt / timing belt", group: "Wear", test: /\b(cam\s?belt|timing\s?belt|timing\s?chain|water\s?pump\s*(&|and)?\s*timing)\b/, everyMiles: 80000, everyMonths: 60 },
  { key: "auxBelt", label: "Aux / drive belt", group: "Wear", test: /\b(aux(iliary)?\s?belt|drive\s?belt|fan\s?belt|serpentine)\b/, everyMiles: 60000, everyMonths: 60 },

  { key: "brakeFluid", label: "Brake fluid", group: "Fluids", test: /brake\s*fluid/, everyMonths: 24 },
  { key: "coolant", label: "Coolant / antifreeze", group: "Fluids", test: /\b(anti[-\s]?freeze|coolant)\b/, everyMiles: 60000, everyMonths: 60 },
  { key: "gearboxOil", label: "Gearbox / transmission oil", group: "Fluids", test: /\b(gearbox|transmission|diff(erential)?)\s*(oil|fluid)\b/, everyMiles: 60000 },
  { key: "powerSteering", label: "Power steering fluid", group: "Fluids", test: /power\s*steer\w*\s*(fluid|oil)/ },
  { key: "adblue", label: "AdBlue", group: "Fluids", test: /ad\s?blue/ },
  // Engine oil last of the fluids, so "gearbox oil" and "brake fluid" are claimed first.
  { key: "engineOil", label: "Engine oil", group: "Fluids", test: /\b(engine\s*oil|\d{1,2}w[\s/-]?\d{2}|castrol|fully\s*synth)/, everyMiles: 10000, everyMonths: 12 },

  { key: "oilFilter", label: "Oil filter", group: "Filters", test: /oil\s*filter/, everyMiles: 10000, everyMonths: 12 },
  { key: "airFilter", label: "Air filter", group: "Filters", test: /air\s*filter/, everyMiles: 20000, everyMonths: 24 },
  { key: "fuelFilter", label: "Fuel filter", group: "Filters", test: /(fuel|diesel)\s*filter/, everyMiles: 40000, everyMonths: 48 },
  { key: "pollenFilter", label: "Pollen / cabin filter", group: "Filters", test: /(pollen|cabin|interior)\s*filter/, everyMiles: 20000, everyMonths: 24 },

  { key: "sparkPlugs", label: "Spark plugs", group: "Wear", test: /spark\s*plug|glow\s*plug/, everyMiles: 40000, everyMonths: 48 },
  { key: "brakePads", label: "Brake pads", group: "Wear", test: /brake\s*pad/ },
  { key: "brakeDiscs", label: "Brake discs", group: "Wear", test: /brake\s*disc|brake\s*rotor/ },
  { key: "tyres", label: "Tyres", group: "Wear", test: /\btyre\b/ },
  { key: "battery", label: "Battery", group: "Wear", test: /\bbattery\b/ },
  { key: "wipers", label: "Wiper blades", group: "Wear", test: /wiper\s*(blade|rubber)?/ },
  { key: "clutch", label: "Clutch", group: "Wear", test: /\bclutch\b/ },
  { key: "exhaust", label: "Exhaust", group: "Wear", test: /\bexhaust\b|\bcat(alytic)?\b|\bdpf\b/ },

  // No interval on purpose. A re-gas happens when the air-con stops blowing cold or a customer
  // asks for it, not on a schedule, so calling it "62 months over" is noise in the one section
  // that should only hold real work. Knowing when it was last gassed is still worth having, so it
  // keeps its line under "no set interval".
  { key: "airCon", label: "Air con re-gas", group: "Other", test: /air\s*con|a\/?c\s*(re-?gas|regas|service)|re-?gas/ },
  { key: "geometry", label: "Wheel alignment", group: "Other", test: /align|track\w*|geometry|four\s*wheel/ },
];

/** Which serviceable items a piece of text mentions. */
export function itemsIn(text: string | null | undefined): string[] {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return [];
  const keys = SERVICE_ITEMS.filter((i) => i.test.test(t)).map((i) => i.key);
  // "Small Service" satisfies the bare /service/ too, and listing both puts the same job on two
  // rows. The named service wins.
  return keys.includes("smallService") || keys.includes("majorService")
    ? keys.filter((k) => k !== "service") : keys;
}
