/**
 * Stock cars: the vehicle record when it arrives, the pre-sale prep sheet when it sells.
 *
 * A `vehicles` row is otherwise only ever born when the workshop books a job on the car. Buying
 * a car, listing it and selling it all write to salesStock / carDeals / vehicleSaleInvoices, and
 * `globalSearch` (server/db.ts) reads none of those — it searches customers, vehicles and
 * serviceHistory only. So a car bought at auction was invisible to the search box by
 * registration for as long as we owned it: on 09/09/2026, 13 of 29 stock cars were in that
 * state, DS15 EZM among them, sold to a buyer who had no customer record either.
 *
 * The two halves happen at different moments, and conflating them was the mistake:
 *
 *   1. `ensureStockVehicle` — when a car ENTERS stock. Creates the vehicle row and nothing else.
 *      The car is ours and it exists, so it should be findable from day one; but no inspection
 *      has happened yet, and a job sheet claiming otherwise would be a fabricated record.
 *
 *   2. `ensurePreSalePrep` — when a car is SOLD. That is when the car is prepared: MOT and
 *      service, so it goes out up to date. The sheet is where that work gets recorded.
 *
 *   3. `transferStockVehicleToBuyer` — when the buyer is attached, so the MOT reminder follows
 *      the car to whoever is now driving it.
 *
 * None of these is ever allowed to fail the purchase, the sync or the sale that triggered it.
 */
import { looksLikeRegistration, normRegKey } from "../../shared/vehicleIdentity";

/** The garage's own account — GA4 ELI002. Stock belongs to it until a customer buys it. */
export const INTERNAL_ACCOUNT_NUMBER = "ELI002";

export const PRE_SALES_INSPECTION = "PRE-SALES INSPECTION";

export type StockIdentity = {
  make?: string | null; model?: string | null; variant?: string | null; colour?: string | null;
  fuelType?: string | null; vin?: string | null; engineNo?: string | null;
  registrationDate?: Date | string | null; motExpiryDate?: Date | string | null;
  taxStatus?: string | null; taxDueDate?: Date | string | null;
};

/** The internal account, looked up by account number rather than hardcoded to an id. */
export async function internalAccount(): Promise<{ id: number; name: string; accountNumber: string } | null> {
  const { getDb } = await import("../db");
  const { customers } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ id: customers.id, name: customers.name, accountNumber: customers.accountNumber })
    .from(customers).where(eq(customers.accountNumber, INTERNAL_ACCOUNT_NUMBER)).limit(1);
  return row ? { id: row.id, name: row.name ?? "", accountNumber: row.accountNumber ?? INTERNAL_ACCOUNT_NUMBER } : null;
}

/**
 * Give a car entering stock its `vehicles` record, owned by the garage, so it can be found by
 * registration for as long as we have it. Creates no document. Never throws.
 */
export async function ensureStockVehicle(input: { registration: string; stock?: StockIdentity }):
  Promise<{ vehicleId: number | null; created: boolean; why?: string }> {
  try {
    const reg = normRegKey(input.registration);
    if (!looksLikeRegistration(reg)) return { vehicleId: null, created: false, why: `"${input.registration}" is not a registration` };

    const { getDb } = await import("../db");
    const { vehicles } = await import("../../drizzle/schema");
    const { eq, sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { vehicleId: null, created: false, why: "database unavailable" };

    const s = input.stock ?? {};
    // Only fields with a real value: never blank out what a DVLA or paid lookup already found
    // on an existing row ([[webapp-autosave-identity-race]]).
    const fields: Record<string, any> = {};
    for (const [col, v] of [["make", s.make], ["model", s.model], ["derivative", s.variant], ["colour", s.colour],
      ["fuelType", s.fuelType], ["vin", s.vin], ["engineNo", s.engineNo], ["dateOfRegistration", s.registrationDate],
      ["motExpiryDate", s.motExpiryDate], ["taxStatus", s.taxStatus], ["taxDueDate", s.taxDueDate]] as const) {
      if (v != null && v !== "") fields[col] = v;
    }

    // Match on the registration with spaces stripped from both sides — stocklist regs come off
    // the website scrape mixed ("WK15 VLY" / "LX69XGS"), vehicles regs are DVLA-solid
    // ([[reg-format-split-matching]]).
    const [existing] = await db.select({ id: vehicles.id }).from(vehicles)
      .where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1);
    if (existing) {
      if (Object.keys(fields).length) await db.update(vehicles).set(fields).where(eq(vehicles.id, existing.id));
      return { vehicleId: existing.id, created: false, why: "already had a vehicle record" };
    }

    const account = await internalAccount();
    const [made] = await db.insert(vehicles).values({
      registration: reg, customerId: account?.id ?? null, ...fields,
      notes: "Created automatically when the car entered Sales Stock, so it can be found by registration while we own it.",
    } as any).returning({ id: vehicles.id });
    return { vehicleId: made.id, created: true };
  } catch (e: any) {
    return { vehicleId: null, created: false, why: `failed: ${e?.message || e}` };
  }
}

export type PrepResult = { vehicleId: number | null; docId: number | null; docNo: string | null; created: boolean; why?: string };

/**
 * Raise the pre-sale prep job sheet for a car that has just been sold — the MOT and service that
 * send it out up to date — unless it already has one. Never throws.
 */
export async function ensurePreSalePrep(input: {
  registration: string;
  stock?: StockIdentity;
  source?: string;         // "marked sold on the forecourt list" — recorded on the sheet
}): Promise<PrepResult> {
  const skip = (why: string): PrepResult => ({ vehicleId: null, docId: null, docNo: null, created: false, why });
  try {
    const reg = normRegKey(input.registration);
    if (!looksLikeRegistration(reg)) return skip(`"${input.registration}" is not a registration`);

    const { getDb, saveDocument } = await import("../db");
    const { serviceHistory, serviceLineItems, vehicles } = await import("../../drizzle/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return skip("database unavailable");

    // Already prepped? Match the sheet's own reg AND the linked vehicle's, because a document's
    // reg column can be blank or GA4-spaced while the vehicle's is DVLA-solid.
    const [existing] = await db.select({ id: serviceHistory.id, docNo: serviceHistory.docNo, vehicleId: serviceHistory.vehicleId })
      .from(serviceHistory)
      .leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
      .where(and(
        eq(serviceHistory.docType, "JS"),
        sql`(REPLACE(UPPER(${serviceHistory.registration}), ' ', '') = ${reg}
             OR REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg})`,
        sql`EXISTS (SELECT 1 FROM ${serviceLineItems} WHERE ${serviceLineItems.documentId} = ${serviceHistory.id}
                     AND UPPER(${serviceLineItems.description}) LIKE ${`%${PRE_SALES_INSPECTION}%`})`,
      )).limit(1);
    if (existing) return { vehicleId: existing.vehicleId ?? null, docId: existing.id, docNo: existing.docNo ?? null, created: false, why: "already has one" };

    const account = await internalAccount();
    if (!account) return skip(`internal account ${INTERNAL_ACCOUNT_NUMBER} not found`);

    const s = input.stock ?? {};
    const saved: any = await saveDocument({
      docType: "JS",
      registration: reg,
      customerId: account.id,
      // saveDocument copies neither of these off the customer record, and a job sheet with a
      // blank customer prints blank and reads as unassigned in the documents list.
      customerName: account.name,
      accountNumber: account.accountNumber,
      // `vehicleReg` matching `registration` marks these fields as this car's, so saveDocument
      // writes them onto the vehicle it upserts rather than discarding them as stale.
      vehicleReg: reg,
      vehicle: {
        make: s.make || undefined, model: s.model || undefined, derivative: s.variant || undefined,
        colour: s.colour || undefined, fuelType: s.fuelType || undefined,
        vin: s.vin || undefined, engineNo: s.engineNo || undefined,
      },
      description: `Pre-sale preparation — MOT and service so the car goes out up to date${input.source ? ` (${input.source})` : ""}.`,
      // Priced at zero for the technician to fill in: this is the work list, not a claim about
      // what was done. The MOT line is zero-rated and stays that way whatever it is priced at
      // ([[mot-is-always-zero-rated]]) — an MOT is never standard-rated.
      lineItems: [
        { itemType: "Labour", description: PRE_SALES_INSPECTION, quantity: 1, unitPrice: 0, subNet: 0, taxAmount: 0, vatRate: 0 },
        { itemType: "Labour", description: "SERVICE", quantity: 1, unitPrice: 0, subNet: 0, taxAmount: 0, vatRate: 0 },
        { itemType: "Labour", description: "MOT", quantity: 1, unitPrice: 0, subNet: 0, taxAmount: 0, vatRate: 0 },
      ],
    });

    const docId = saved?.id ?? null;
    if (!docId) return skip("saveDocument returned no document id");
    // saveDocument returns only { id, customerId, accountNumber } — read back what it linked.
    const [row] = await db.select({ vehicleId: serviceHistory.vehicleId, docNo: serviceHistory.docNo })
      .from(serviceHistory).where(eq(serviceHistory.id, docId)).limit(1);
    return { vehicleId: row?.vehicleId ?? null, docId, docNo: row?.docNo ?? null, created: true };
  } catch (e: any) {
    return skip(`failed: ${e?.message || e}`);
  }
}

/**
 * Hand a sold car to its buyer, so MOT reminders go to the person now driving it.
 * Only ever moves a car off the internal account (or off no owner at all) — a car already
 * registered to a third party is left alone, exactly as `saveDocument`'s adoption rule does.
 */
export async function transferStockVehicleToBuyer(registration: string, buyerCustomerId: number): Promise<{ moved: boolean; vehicleId?: number }> {
  const { getDb } = await import("../db");
  const { vehicles } = await import("../../drizzle/schema");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { moved: false };
  const reg = normRegKey(registration);
  if (!looksLikeRegistration(reg)) return { moved: false };
  const internalId = (await internalAccount())?.id ?? null;

  const [veh] = await db.select({ id: vehicles.id, customerId: vehicles.customerId }).from(vehicles)
    .where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1);
  if (!veh) return { moved: false };
  if (veh.customerId != null && veh.customerId !== internalId) return { moved: false, vehicleId: veh.id };
  if (veh.customerId === buyerCustomerId) return { moved: false, vehicleId: veh.id };

  await db.update(vehicles).set({ customerId: buyerCustomerId }).where(sql`${vehicles.id} = ${veh.id}`);
  return { moved: true, vehicleId: veh.id };
}
