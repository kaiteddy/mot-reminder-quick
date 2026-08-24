/**
 * Manufacturer service schemes, so "what's the difference?" can be answered in the customer's
 * own language rather than ours.
 *
 * A Mercedes owner doesn't ask for an interim service, they ask whether theirs is due an A or a
 * B. Same with BMW's separate countdowns and VAG's fixed-versus-longlife. This maps those names
 * onto the two services we actually sell, so the conversation works both ways.
 *
 * IMPORTANT — this is a conversational guide, not a spec sheet. It is generic manufacturer
 * knowledge, NOT read from the car in front of you: the real schedule varies by model, year,
 * engine and how the last one was recorded. Anything that has to be right (a specific interval,
 * whether THIS car needs plugs this time) comes from the technical data for that vehicle, and
 * the note under each entry says so.
 */
export type ServiceScheme = {
  /** Uppercased make, as stored on the vehicle record. */
  makes: string[];
  scheme: string;
  minor: { name: string; maps: string; detail: string };
  major: { name: string; maps: string; detail: string };
  /** The thing worth saying out loud that isn't obvious from the two rows above. */
  note: string;
};

export const SERVICE_SCHEMES: ServiceScheme[] = [
  {
    makes: ["MERCEDES-BENZ", "MERCEDES"],
    scheme: "Service A / Service B",
    minor: {
      name: "Service A",
      maps: "our interim",
      detail: "Engine oil and oil filter, fluid levels topped up, full vehicle inspection, tyre and brake check, service indicator reset.",
    },
    major: {
      name: "Service B",
      maps: "our full",
      detail: "Everything in Service A plus the cabin/dust filter, and the air filter where the schedule calls for it. Brake fluid runs on its own two-year clock.",
    },
    note: "They alternate — A, then B, then A. The car's display tells you which is next, so ask the customer what it says.",
  },
  {
    makes: ["BMW", "MINI"],
    scheme: "Condition Based Servicing (CBS)",
    minor: {
      name: "Oil Service",
      maps: "our interim",
      detail: "Engine oil and oil filter, plus the standard checks.",
    },
    major: {
      name: "Vehicle Check / Inspection",
      maps: "our full",
      detail: "Adds the air filter, micro (cabin) filter and the wider inspection.",
    },
    note: "BMW counts each item down separately — oil, filters, brake fluid and plugs each have their own due date on the dash, so a car can need one and not the others.",
  },
  {
    makes: ["VOLKSWAGEN", "AUDI", "SKODA", "SEAT"],
    scheme: "Fixed or Longlife (variable)",
    minor: {
      name: "Oil Service",
      maps: "our interim",
      detail: "Engine oil and oil filter, levels and checks.",
    },
    major: {
      name: "Inspection Service",
      maps: "our full",
      detail: "Adds the air filter and pollen filter, with a fuller inspection.",
    },
    note: "Two regimes: Fixed is every 12 months, Longlife stretches to about 2 years on the car's own calculation. Longlife needs the correct long-life oil spec — worth checking which the car is set to.",
  },
  {
    makes: ["TOYOTA", "LEXUS"],
    scheme: "Intermediate / Full",
    minor: { name: "Intermediate", maps: "our interim", detail: "Engine oil and oil filter with the standard checks." },
    major: { name: "Full", maps: "our full", detail: "Adds the air and pollen filters." },
    note: "Usually every 12 months or 10,000 miles, whichever comes first.",
  },
  {
    makes: ["HONDA"],
    scheme: "Maintenance Minder (A / B plus sub-codes)",
    minor: { name: "Code A", maps: "our interim", detail: "Engine oil change." },
    major: { name: "Code B", maps: "our full", detail: "Oil and filter plus inspection; the numbered sub-codes add air filter, cabin filter, brake fluid and so on." },
    note: "The dash shows a letter and numbers together, like B1 or A12 — the numbers are what decide the extras, so read the whole code.",
  },
  {
    makes: ["FORD"],
    scheme: "Interim / Full (Ford Service Activity Schedule)",
    minor: { name: "Interim", maps: "our interim", detail: "Oil and oil filter plus checks." },
    major: { name: "Full / Scheduled", maps: "our full", detail: "Adds air and pollen filters; fuel filter on some diesels." },
    note: "Many Fords run a 12,500-mile or 12-month schedule, with the brake fluid on a two-year cycle.",
  },
  {
    makes: ["KIA", "HYUNDAI"],
    scheme: "Fixed schedule",
    minor: { name: "Interim", maps: "our interim", detail: "Oil and oil filter plus checks." },
    major: { name: "Full", maps: "our full", detail: "Adds air and cabin filters." },
    note: "Both carry long manufacturer warranties (7 years Kia, 5 Hyundai) — keeping to the schedule and recording it is what protects that.",
  },
];

/** The scheme for a make, or null when we've nothing specific — better to say nothing than to
 * describe a scheme the manufacturer doesn't use. */
export function schemeForMake(make?: string | null): ServiceScheme | null {
  const m = String(make || "").trim().toUpperCase();
  if (!m) return null;
  return SERVICE_SCHEMES.find((s) => s.makes.some((x) => m === x || m.startsWith(x))) || null;
}

/** What separates our interim from our full, whatever the badge on the front. Taken from what
 * the jobs actually carry: across 1,240 interims and 267 full services an oil filter is on 100%
 * of both, while the air and pollen filters are on 100% of full services and 3% of interims. */
export const SERVICE_DIFFERENCE = {
  same: [
    "Engine oil drained and replaced with the correct grade",
    "Oil filter replaced",
    "Sump plug seal where needed",
    "Levels topped up, tyres, brakes and lights checked over",
    "Service light reset",
  ],
  onlyFull: [
    "Air filter replaced — the engine's intake filter",
    "Pollen / cabin filter replaced — the one the heater blows through",
  ],
  notIncluded: [
    "Brake fluid — its own 2-year job, priced separately",
    "Spark plugs — mileage-based, on well under 5% of services",
    "Fuel filter — diesel-only and rare on our schedule",
  ],
};
