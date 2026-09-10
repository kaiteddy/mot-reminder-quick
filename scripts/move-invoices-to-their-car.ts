/**
 * Put invoices back on the record of the car they were actually done on.
 *
 *   npx tsx scripts/move-invoices-to-their-car.ts        # DRY RUN — checks and reports, writes nothing
 *   npx tsx scripts/move-invoices-to-their-car.ts --go   # move (backs up every invoice first)
 *
 * Adam, 10/09/2026: "Fix this = The 38 invoices on the wrong cars." Re-checked invoice by invoice
 * before moving, and the rule applied to every one is:
 *   - each car's jobs belong on the record of the plate that car wears TODAY (his one-plate rule),
 *   - the invoice's mileage must continue that car's own line,
 *   - DVLA must confirm which plate the car wears now, or show that neither plate is live,
 *   - no invoice may land on a different customer's car.
 *
 * Seven pairs pass (36 invoices). Three from the original list do not and are left alone:
 *   LJ04MEB/LJ04KKU, BLF1S/LN53UGK and J44XXY/OV03OUU are each ONE car on one mileage line that
 *   was sold between different customers; the old split had cut them at a typed-wrong figure
 *   (76,418; a guessed 64,000; 63,965) rather than at a change of car.
 *
 * Only serviceHistory.vehicleId moves. The plate written on each invoice stays as it was on the day,
 * line items follow their invoice, nothing is created or deleted, and both records get a note.
 * Every invoice must still sit on the expected record, or that whole group is skipped.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

const GO = process.argv.includes("--go");

type Plan = { fromId: number; fromReg: string; toId: number; toReg: string; docs: number[]; why: string };

const PLAN: Plan[] = [
  { fromId: 150033, fromReg: "P1ADD", toId: 6960, toReg: "LR14NUC", docs: [11976, 14917, 17176, 17380, 17968, 18071, 19683, 19858, 19859, 22214],
    why: "Mr Addleson's 2014 Nissan Qashqai, which wore P1ADD from 2015 to 2019: its 1st to 4th year services, 5,928 to 21,587 miles, continuing to this car's 21,587 in August 2019. DVLA shows the Qashqai as LR14NUC today; P1ADD is on no vehicle." },
  { fromId: 150040, fromReg: "MOB3", toId: 10361, toReg: "MT21HGN", docs: [28278, 28684, 29706, 30819, 31304],
    why: "Mr Rich's 2021 Peugeot 3008 while it wore MOB3, 2022 to 2024: first and second year services, 6,042 to 18,660 miles, continuing to this car's 23,109 in June 2025. DVLA shows the 3008 as MT21HGN today; MOB3 is now on a 2025 Hyundai." },
  { fromId: 2237, fromReg: "Y25AFE", toId: 1523, toReg: "EN57BBE", docs: [4726, 5452, 7631, 8465, 11422, 14425, 17103],
    why: "Mr Yefet's Lexus IS250 while it wore Y25AFE, 2012 to 2017: 27,070 to 43,658 miles (one reading typed as 37,155), continuing from this car's 24,196 at its pre-sales check in January 2012. DVLA shows the IS250 as EN57BBE today; Y25AFE is now on a 2018 Lexus." },
  { fromId: 1050044, fromReg: "S8 BEP", toId: 4343, toReg: "RY58EOC", docs: [16881, 19541, 22052, 22409, 24368, 26037, 27466],
    why: "Sixtrees' second Lexus IS250, bought after its pre-sales check here at 25,154 miles in August 2015, while it wore S8 BEP from 2016 to 2021: 30,995 to 44,611 miles. The 2011-2014 jobs on S8 BEP are an earlier IS250 and stay there; the two May 2022 jobs at 30,900 miles fit the CT200h that took the plate next. DVLA knows neither RY58EOC nor this car today." },
  { fromId: 1050129, fromReg: "R3 BAL", toId: 5726, toReg: "SK14MXX", docs: [11802, 14413, 17026],
    why: "Mrs Abramson's 2014 Chrysler Grand Voyager while it wore R3 BAL, 2015 to 2016: 4,530 to 17,425 miles, continuing to this car's 20,000 in October 2017. The 2012-2014 jobs are her earlier Voyager and stay on R3 BAL. DVLA shows this car as SK14MXX today." },
  { fromId: 5563, fromReg: "EA07YCS", toId: 4932, toReg: "V417DYK", docs: [18478, 18794],
    why: "Mrs Steinbock's 2007 Honda Jazz before her plate V417DYK went onto it: its pre-sales check at 21,926 miles and her first job at 22,000 in 2017, continuing to 23,149 under V417DYK in 2018. DVLA shows the Jazz as V417DYK today, so its whole history belongs here; the 2016 jobs at 124,700 miles are her previous car." },
  { fromId: 8645, fromReg: "CL03JET", toId: 6879, toReg: "MH16OVW", docs: [26739, 28033],
    why: "Mrs Shiers' 2016 VW Polo while it wore CL03JET: 23,640 miles in July 2021 and a job in May 2022 (typed as 38,163), continuing from this car's 17,490 in August 2020. DVLA shows the Polo as MH16OVW today. Miss Mila's July 2022 job stays on CL03JET." },
];

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  const c = new Client({ connectionString: url });
  await c.connect();
  const today = new Date().toISOString().slice(0, 10);
  const ukToday = new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London" });
  const norm = (s: string) => String(s || "").toUpperCase().split("*")[0].replace(/[^A-Z0-9]/g, "");

  console.log(`\n===== MOVE INVOICES TO THEIR CAR ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  const backup: any[] = [];
  let moved = 0, skippedGroups = 0;

  for (const p of PLAN) {
    const { rows: vs } = await c.query(`SELECT id, registration FROM vehicles WHERE id = ANY($1::int[])`, [[p.fromId, p.toId]]);
    const from = vs.find((v: any) => v.id === p.fromId), to = vs.find((v: any) => v.id === p.toId);
    const { rows: docs } = await c.query(
      `SELECT id, "docType", "docNo", "vehicleId", COALESCE("dateIssued","dateCreated")::date d, mileage, registration FROM "serviceHistory" WHERE id = ANY($1::int[]) ORDER BY d`, [p.docs]);
    const problems: string[] = [];
    if (!from || norm(from.registration) !== norm(p.fromReg)) problems.push(`record #${p.fromId} is not ${p.fromReg}`);
    if (!to || norm(to.registration) !== norm(p.toReg)) problems.push(`record #${p.toId} is not ${p.toReg}`);
    if (docs.length !== p.docs.length) problems.push(`found ${docs.length} of ${p.docs.length} invoices`);
    const strays = docs.filter((d: any) => d.vehicleId !== p.fromId);
    if (strays.length) problems.push(`${strays.length} invoice(s) no longer on ${p.fromReg}`);

    const list = docs.map((d: any) => `${d.docType} ${d.docNo}`).join(", ");
    console.log(`\n  ${p.fromReg} → ${p.toReg}: ${docs.length} invoice(s) ${problems.length ? "SKIPPED: " + problems.join("; ") : "OK"}`);
    console.log(`    ${list}`);
    if (problems.length) { skippedGroups++; continue; }
    if (!GO) { moved += docs.length; continue; }

    await c.query("BEGIN");
    try {
      const r = await c.query(`UPDATE "serviceHistory" SET "vehicleId" = $1 WHERE id = ANY($2::int[]) AND "vehicleId" = $3`, [p.toId, p.docs, p.fromId]);
      if (r.rowCount !== p.docs.length) throw new Error(`expected to move ${p.docs.length}, moved ${r.rowCount}`);
      await c.query(`UPDATE vehicles SET notes = COALESCE(notes || E'\n\n','') || $2 WHERE id = $1`,
        [p.toId, `${p.docs.length} invoice(s) moved here ${ukToday} from the ${p.fromReg} record (${list}). ${p.why}`]);
      await c.query(`UPDATE vehicles SET notes = COALESCE(notes || E'\n\n','') || $2 WHERE id = $1`,
        [p.fromId, `${p.docs.length} invoice(s) moved ${ukToday} to ${p.toReg}, the car they were done on (${list}). ${p.why}`]);
      await c.query("COMMIT");
      backup.push({ ...p, before: docs });
      moved += p.docs.length;
    } catch (e) { await c.query("ROLLBACK"); throw e; }
  }

  if (GO && backup.length) {
    const dir = path.join(process.cwd(), "scripts", ".cleanup-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `move-invoices-to-their-car-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\n✓ moved ${moved} invoice(s) in ${backup.length} group(s); ${skippedGroups} group(s) skipped; backed up to ${file}`);
  } else {
    console.log(`\n${GO ? "moved" : "would move"} ${moved} invoice(s); ${skippedGroups} group(s) skipped${GO ? "" : " — re-run with --go to apply"}`);
  }
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
