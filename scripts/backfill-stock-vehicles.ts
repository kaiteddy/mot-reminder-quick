/**
 * Backfill: give every Sales Stock car a `vehicles` record, and link the buyer on cars we've sold.
 *
 *   npx tsx scripts/backfill-stock-vehicles.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/backfill-stock-vehicles.ts --go   # apply (writes a JSON backup first)
 *
 * Why this exists (09/09/2026): a vehicle record is only ever born when the workshop books a job
 * on the car. Nothing else creates one — not buying it, not listing it, not selling it. So a car
 * bought at auction and sold straight off the forecourt never gets one, and because
 * `globalSearch` (server/db.ts) only reads customers/vehicles/serviceHistory, that car is
 * invisible to the search box no matter what you type. 13 of 29 stock cars were in that state,
 * including DS15 EZM — sold to a buyer who had no customer record either.
 *
 * The forward fix is the pre-sales inspection job sheet (server/services/preSalesInspection.ts),
 * which creates the record as a side effect of `saveDocument`. This script only repairs the cars
 * that predate it. It deliberately does NOT invent inspection job sheets for them: those
 * inspections either happened on paper or not at all, and a job sheet dated today claiming
 * otherwise would be a fabricated record.
 *
 * Ownership: a car still in stock belongs to the ELI MOTORS LTD internal account (ELI002), which
 * is optedOut + noVehicleReminders, so nothing here starts sending MOT reminders to ourselves.
 * A car we've sold is re-pointed to its buyer, so the buyer gets the reminders instead.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";
import { splitAddress, joinAddress } from "../shared/address";

const APPLY = process.argv.includes("--go");
const normReg = (s: any) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** GA4-style account number: first 3 letters of the surname + next unused 3-digit sequence. */
async function nextAccountNumber(c: pg.Client, name: string) {
  const source = (name.trim().split(/\s+/).pop() || name).replace(/[^A-Za-z]/g, "");
  const prefix = (source.slice(0, 3) || "CUS").toUpperCase().padEnd(3, "X");
  const { rows } = await c.query(
    `SELECT "accountNumber" AS a FROM customers WHERE "accountNumber" ILIKE $1
     UNION ALL SELECT "accountNumber" FROM "serviceHistory" WHERE "accountNumber" ILIKE $1`,
    [`${prefix}%`],
  );
  let max = 0;
  for (const r of rows) {
    const digits = String(r.a || "").slice(3).replace(/\D/g, "");
    if (digits) max = Math.max(max, parseInt(digits, 10));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
await c.connect();

const [eli] = (await c.query(`SELECT id, name FROM customers WHERE "accountNumber" = 'ELI002' LIMIT 1`)).rows;
if (!eli) throw new Error("internal account ELI002 (ELI MOTORS LTD) not found — refusing to guess an owner");
console.log(`internal account: #${eli.id} ${eli.name}`);

// Stock cars with no vehicles row, matched on the normalised registration both sides
// ([[reg-format-split-matching]]: salesStock regs come off the website scrape and are mixed
// "WK15 VLY" / "LX69XGS", vehicles regs are DVLA-solid).
const missing = (await c.query(`
  SELECT s.id AS "stockId", s.registration, s.make, s.model, s.variant, s.colour, s."fuelType",
         s.vin, s."engineNo", s."registrationDate", s."motExpiryDate", s."taxStatus", s."taxDueDate",
         s.mileage, s.status
  FROM "salesStock" s
  LEFT JOIN vehicles v ON REPLACE(UPPER(v.registration), ' ', '') = REPLACE(UPPER(s.registration), ' ', '')
  WHERE v.id IS NULL AND s.registration IS NOT NULL AND s.registration <> ''
  ORDER BY s.registration
`)).rows as any[];

// Sale invoices naming a buyer we never turned into a customer.
const orphanSales = (await c.query(`
  SELECT i.id, i."invoiceNumber", i."registrationNumber", i."purchaserName", i."purchaserAddress",
         i."purchaserTelephone", i."purchaserEmail", i."customerId", i."vehicleId"
  FROM "vehicleSaleInvoices" i
  WHERE i."docKind" = 'sale' AND i."customerId" IS NULL
    AND COALESCE(TRIM(i."purchaserName"), '') <> ''
`)).rows as any[];

console.log(`\nstock cars with no vehicle record: ${missing.length}`);
for (const m of missing) {
  const buyer = orphanSales.find((s) => normReg(s.registrationNumber) === normReg(m.registration));
  console.log(`  ${normReg(m.registration).padEnd(8)} ${String(m.status).padEnd(13)} ${[m.make, m.model].filter(Boolean).join(" ") || "(no details)"}${buyer ? `  -> buyer: ${buyer.purchaserName}` : ""}`);
}
console.log(`\nsale invoices with an unlinked buyer: ${orphanSales.length}`);
for (const s of orphanSales) console.log(`  inv ${s.invoiceNumber || "(none)"} ${normReg(s.registrationNumber)} — ${s.purchaserName}`);

if (!APPLY) { console.log("\ndry-run; re-run with --go to apply"); await c.end(); process.exit(0); }

// Alongside the other data-cleanup backups, which .gitignore already keeps out of this
// PUBLIC repo — the record names a real customer.
const backupDir = path.join(process.cwd(), "scripts", ".cleanup-backups");
fs.mkdirSync(backupDir, { recursive: true });
const created: any = { at: new Date().toISOString(), vehicles: [], customers: [], invoiceLinks: [] };

for (const m of missing) {
  const reg = normReg(m.registration);
  const buyer = orphanSales.find((s) => normReg(s.registrationNumber) === normReg(m.registration));

  let ownerId = eli.id;
  if (buyer) {
    // The buyer owns the car now — create them, so the MOT reminder reaches the right person.
    const accountNumber = await nextAccountNumber(c, buyer.purchaserName);
    const address = joinAddress(splitAddress(String(buyer.purchaserAddress || "").replace(/\s*\n+\s*/g, ", ")));
    const [cust] = (await c.query(
      `INSERT INTO customers (name, email, phone, address, "accountNumber", "externalId", notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [buyer.purchaserName, buyer.purchaserEmail || null, buyer.purchaserTelephone || null,
       address || null, accountNumber, `WEB-CUST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
       `Created 09/09/2026 by backfill-stock-vehicles from vehicle sale invoice ${buyer.invoiceNumber || `#${buyer.id}`}.`],
    )).rows;
    ownerId = cust.id;
    created.customers.push({ id: cust.id, name: buyer.purchaserName, accountNumber });
    console.log(`  + customer #${cust.id} ${buyer.purchaserName} (${accountNumber})`);
  }

  const [veh] = (await c.query(
    `INSERT INTO vehicles (registration, make, model, derivative, colour, "fuelType", vin, "engineNo",
                           "dateOfRegistration", "motExpiryDate", "taxStatus", "taxDueDate", "customerId", notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [reg, m.make || null, m.model || null, m.variant || null, m.colour || null, m.fuelType || null,
     m.vin || null, m.engineNo || null, m.registrationDate, m.motExpiryDate, m.taxStatus, m.taxDueDate,
     ownerId,
     `Created 09/09/2026 by backfill-stock-vehicles from Sales Stock #${m.stockId} (status ${m.status}) — the car had no vehicle record, so it could not be found by registration.`],
  )).rows;
  created.vehicles.push({ id: veh.id, registration: reg, stockId: m.stockId, customerId: ownerId });
  console.log(`  + vehicle #${veh.id} ${reg} -> customer #${ownerId}`);

  if (buyer) {
    await c.query(`UPDATE "vehicleSaleInvoices" SET "customerId" = $1, "vehicleId" = $2, "updatedAt" = now() WHERE id = $3`,
      [ownerId, veh.id, buyer.id]);
    created.invoiceLinks.push({ invoiceId: buyer.id, customerId: ownerId, vehicleId: veh.id });
    console.log(`  + sale invoice #${buyer.id} linked to customer #${ownerId} / vehicle #${veh.id}`);
  }
}

const file = path.join(backupDir, `backfill-stock-vehicles-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(created, null, 2));
console.log(`\ncreated ${created.vehicles.length} vehicles, ${created.customers.length} customers, ${created.invoiceLinks.length} invoice links`);
console.log(`record of what was written: ${file}`);
await c.end();
