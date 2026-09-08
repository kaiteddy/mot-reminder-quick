/**
 * Review sheet for vehicle records that share a chassis number.
 *
 * The question in every case is the same: are these two records one car or two? Today's plate
 * lookup cannot answer it, because a plate tells you what it is on NOW, not what we worked on
 * years ago — on 08/09/2026 that mistake relabelled eleven records as cars the garage has never
 * touched, including a Mini that came back as a Tesla.
 *
 * What does answer it is the mileage line. One car's odometer only ever goes up, so:
 *   - put both records' readings on one timeline; if it climbs, it is ONE car;
 *   - if a later job reads far LOWER than an earlier one, it is TWO cars;
 *   - DVSA's own test readings, free and historical, are the second opinion where the plate is
 *     still live (its history follows the vehicle, so old tests show even after a plate change).
 *
 * Ownership decides what may then be done: same owner can be merged, a car that changed hands
 * never can, because the invoices belong to whoever owned it at the time.
 *
 *   npx tsx scripts/review-duplicate-chassis.ts out.csv
 */
import "dotenv/config";
import fs from "fs";
import { Client } from "pg";
import { getMOTHistory } from "../server/motApi";

/** A reading that goes backwards by less than this is odometer noise or a typo, not another car.
 *  Set from what the data actually shows: the small drops in this population are a few hundred
 *  miles (622, 949), while the real contradictions are tens of thousands. */
const NOISE = 1500;
/** A later job reading this much lower than an earlier one cannot be the same car. */
const CONTRADICTION = 5000;

type Reading = { date: string; miles: number; source: string };

const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** Does one timeline of readings climb? Returns the worst backwards step. */
function worstDrop(readings: Reading[]): number {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  let peak = -Infinity, worst = 0;
  for (const r of sorted) {
    if (peak > -Infinity && r.miles < peak) worst = Math.max(worst, peak - r.miles);
    peak = Math.max(peak, r.miles);
  }
  return worst;
}

async function main() {
  const out = process.argv[2] || "duplicate-chassis-review-sheet.csv";
  const db = new Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
  await db.connect();

  const { rows: recs } = await db.query(`
    SELECT upper(regexp_replace(v.vin,'[^A-Za-z0-9]','','g')) AS k, v.id, v.registration, v.make, v.model,
           v."customerId", c.name AS customer, v."motExpiryDate", COALESCE(v."remindersOff",0) AS off
      FROM vehicles v LEFT JOIN customers c ON c.id = v."customerId"
     WHERE upper(regexp_replace(v.vin,'[^A-Za-z0-9]','','g')) IN (
       SELECT upper(regexp_replace(vin,'[^A-Za-z0-9]','','g')) FROM vehicles
        WHERE COALESCE(vin,'') <> '' GROUP BY 1 HAVING COUNT(*) > 1)
     ORDER BY k, v.id`);

  const { rows: hist } = await db.query(`
    SELECT "vehicleId", COALESCE("dateIssued","dateCreated") AS d, mileage
      FROM "serviceHistory" WHERE mileage IS NOT NULL AND mileage > 0 ORDER BY d`);
  const byVehicle = new Map<number, Reading[]>();
  for (const h of hist) {
    const list = byVehicle.get(h.vehicleId) ?? [];
    list.push({ date: iso(h.d), miles: Number(h.mileage), source: "ours" });
    byVehicle.set(h.vehicleId, list);
  }

  const groups = new Map<string, any[]>();
  for (const r of recs) groups.set(r.k, [...(groups.get(r.k) ?? []), r]);

  const dvsaCache = new Map<string, Reading[] | null>();
  async function dvsaReadings(reg: string): Promise<Reading[] | null> {
    const key = reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!key) return null;
    if (dvsaCache.has(key)) return dvsaCache.get(key)!;
    let res: Reading[] | null = null;
    try {
      const d: any = await getMOTHistory(key);
      if (d) res = (d.motTests || [])
        .filter((t: any) => Number(t.odometerValue) > 0)
        .map((t: any) => ({ date: iso(t.completedDate), miles: Number(t.odometerValue), source: "DVSA" }));
    } catch { res = null; }
    dvsaCache.set(key, res);
    return res;
  }

  const sheet: any[] = [];
  for (const [vin, members] of groups) {
    const lines = members.map((m: any) => ({ ...m, readings: byVehicle.get(m.id) ?? [] }));
    const withReadings = lines.filter((l: any) => l.readings.length > 0);
    const combined = lines.flatMap((l: any) => l.readings);
    const owners = new Set(members.map((m: any) => m.customerId).filter(Boolean));

    let verdict: string, why: string;
    if (withReadings.length < 2) {
      verdict = withReadings.length === 1 ? "PARTIAL — only one record has readings" : "NO EVIDENCE — no readings at all";
      why = "Cannot be judged from mileage.";
    } else {
      const drop = worstDrop(combined);
      const perCar = lines.map((l: any) => worstDrop(l.readings));
      // A record whose OWN readings fall away is a different problem from two records being
      // confused with each other: it already holds invoices from more than one car, so it needs
      // splitting rather than merging, and no comparison with its twin can be trusted until then.
      const selfContradictory = lines.filter((l: any) => worstDrop(l.readings) >= CONTRADICTION);
      if (selfContradictory.length) {
        verdict = "MIXED RECORD — one record already holds more than one car";
        why = `${selfContradictory.map((l: any) => l.registration).join(", ")} contradicts itself by ${Math.max(...perCar)} miles.`;
      } else if (drop <= NOISE) {
        verdict = "ONE CAR — the readings form a single climbing line";
        why = `No reading goes backwards by more than ${drop} miles.`;
      } else if (drop >= CONTRADICTION && Math.max(...perCar) <= NOISE) {
        verdict = "TWO CARS — the readings contradict each other";
        why = `A later job reads ${drop} miles lower than an earlier one, yet each record on its own climbs.`;
      } else {
        verdict = "UNCLEAR — the readings are messy";
        why = `Worst backwards step ${drop} miles; each record's own worst is ${perCar.join(" / ")}.`;
      }
    }

    for (const l of lines) {
      const dv = await dvsaReadings(l.registration);
      const dvsaLine = dv?.length ? dv.map((r) => `${r.date}:${r.miles}`).join(" ") : (dv ? "no tests" : "plate not at DVSA");
      sheet.push({
        verdict, why, vin,
        owners: owners.size === 1 ? "same owner" : "different owners — never merge histories",
        id: l.id, registration: l.registration, make: l.make, model: l.model,
        customer: l.customer || "", remindersOff: l.off,
        our_readings: l.readings.map((r: any) => `${r.date}:${r.miles}`).join(" ") || "none",
        dvsa_readings: dvsaLine,
      });
    }
  }

  const header = Object.keys(sheet[0]);
  fs.writeFileSync(out, [header.join(","), ...sheet.map((s) => header.map((h) => `"${String(s[h] ?? "").replace(/"/g, "'")}"`).join(","))].join("\n"));

  const tally: Record<string, number> = {};
  for (const [, m] of groups) void m;
  const seen = new Set<string>();
  for (const s of sheet) { if (seen.has(s.vin)) continue; seen.add(s.vin); tally[s.verdict] = (tally[s.verdict] || 0) + 1; }
  console.log(`groups: ${groups.size}, records: ${recs.length}`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
  console.log(`written to ${out}`);
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
