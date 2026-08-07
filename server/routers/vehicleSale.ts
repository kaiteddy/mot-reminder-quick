import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

/**
 * Used Car Sales Invoice — the pre-printed HMRC margin-scheme form ELI fills in when a stock
 * car is sold. Raised from Sales Stock, which pre-fills everything already known about the car;
 * the rest is typed straight onto the replica form. See client/src/components/VehicleSaleForm.tsx.
 */

// Every editable field on the form. All optional and all free text — it is a paper form, so
// what is stored is exactly what will be printed.
const FIELDS = [
  "invoiceNumber", "transactionDate", "stockNumber", "dayBookFolio", "salesman",
  "purchaserStockNumber", "purchaserDayBookFolio",
  "purchaserName", "purchaserAddress", "purchaserTelephone",
  "grossPrice", "vehicleMake", "vehicleType", "registrationNumber", "chassisNumber",
  "engineNumber", "firstRegisteredUK", "lastOwnerDetails", "mileage",
  "lessLicenceValue", "partExchangeAllowance", "deposit", "balance", "settlementNotes",
  "partExchangeMake", "partExchangeType", "partExchangeRegistration", "partExchangeChassis",
  "partExchangeEngine", "partExchangeFirstRegisteredUK",
  "sellerCertificateDate", "sellerCertificateAddress", "buyerCertificateDate",
  "sellerSignature", "buyerSignature",
] as const;

export type VehicleSaleField = (typeof FIELDS)[number];

// Accepts any string map; `save` whitelists against FIELDS before it touches the row, so an
// unknown key can never reach the update.
const fieldsSchema = z.record(z.string(), z.string().nullish());

const ukDate = (d: any) => {
  if (!d) return "";
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x.getTime()) ? "" : x.toLocaleDateString("en-GB");
};
// Money as it is written on the form: thousands separated, always two decimals.
const money = (n: any) => {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
};

/**
 * The form gives the purchaser's address three ruled lines. Anything beyond that is folded into
 * the last line WITH the postcode rather than truncated away — the postcode is the part that has
 * to be on a sales invoice, and a plain slice(0,3) was dropping it.
 */
function addressLines(address: any, postcode: any): string[] {
  const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  const pc = String(postcode || "").trim();
  if (!pc) return parts.slice(0, 3);
  const rest = parts.slice(2).join(", ");
  return [...parts.slice(0, 2), [rest, pc].filter(Boolean).join(", ")].filter(Boolean);
}

/** Phone as it would be written on paper: 07791 119651 / 020 8203 6449, not +447791119651. */
function nationalPhone(phone: any): string {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const core = raw.replace(/[^\d+]/g, "").replace(/^\+?44/, "").replace(/^0/, "");
  if (!/^\d{9,10}$/.test(core)) return raw;           // not a UK number — leave it as stored
  const n = "0" + core;
  if (/^07/.test(n) && n.length === 11) return `${n.slice(0, 5)} ${n.slice(5)}`;      // mobile
  if (/^02/.test(n) && n.length === 11) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`; // 02x areas
  if (/^01(1\d|\d1)/.test(n) && n.length === 11) return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  if (n.length === 11) return `${n.slice(0, 5)} ${n.slice(5)}`;
  return `${n.slice(0, 4)} ${n.slice(4)}`;
}

export const vehicleSaleRouter = router({
  // Every sales invoice raised so far, newest first — for the Sales Stock badge and the list.
  list: publicProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { vehicleSaleInvoices } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: vehicleSaleInvoices.id,
      salesStockId: vehicleSaleInvoices.salesStockId,
      docKind: vehicleSaleInvoices.docKind,
      invoiceNumber: vehicleSaleInvoices.invoiceNumber,
      transactionDate: vehicleSaleInvoices.transactionDate,
      purchaserName: vehicleSaleInvoices.purchaserName,
      registrationNumber: vehicleSaleInvoices.registrationNumber,
      vehicleMake: vehicleSaleInvoices.vehicleMake,
      vehicleType: vehicleSaleInvoices.vehicleType,
      grossPrice: vehicleSaleInvoices.grossPrice,
      updatedAt: vehicleSaleInvoices.updatedAt,
    }).from(vehicleSaleInvoices).orderBy(desc(vehicleSaleInvoices.id));
  }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const { getDb } = await import("../db");
    const { vehicleSaleInvoices } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const row = await db.select().from(vehicleSaleInvoices).where(eq(vehicleSaleInvoices.id, input.id)).limit(1).then((r: any) => r[0]);
    return row ?? null;
  }),

  /**
   * Raise a blank form against a stock car, pre-filled with everything the stocklist and the
   * matching vehicles row already know. Returns the existing invoice if one was already raised
   * for that car, so the button is safe to press twice.
   */
  createFromStock: publicProcedure
    .input(z.object({ salesStockId: z.number(), docKind: z.enum(["sale", "purchase"]).default("sale") }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { vehicleSaleInvoices, salesStock, vehicles } = await import("../../drizzle/schema");
      const { and, eq, sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Scoped to the kind: one car can legitimately have both a purchase (buying it in) and a
      // sale (selling it on), so matching on the stock car alone would hand back the wrong one.
      const existing = await db.select({ id: vehicleSaleInvoices.id }).from(vehicleSaleInvoices)
        .where(and(
          eq(vehicleSaleInvoices.salesStockId, input.salesStockId),
          eq(vehicleSaleInvoices.docKind, input.docKind),
        )).limit(1).then((r: any) => r[0]);
      if (existing) return { id: existing.id, existed: true };

      const car: any = await db.select().from(salesStock).where(eq(salesStock.id, input.salesStockId)).limit(1).then((r: any) => r[0]);
      if (!car) throw new Error("Stock car not found");

      // The garage's own vehicles row carries the engine number and first-registration date the
      // stocklist doesn't. Match on the reg with spaces stripped from both sides — stocklist regs
      // are solid, serviceHistory/vehicles regs are GA4-spaced.
      const reg = String(car.registration || "").toUpperCase().replace(/\s+/g, "");
      const veh: any = reg
        ? await db.select().from(vehicles)
            .where(sql`UPPER(REPLACE(${vehicles.registration}, ' ', '')) = ${reg}`)
            .limit(1).then((r: any) => r[0])
        : null;

      // "Type" on the form is the trim/derivative line under the make, e.g. "I10 SE CONNECT AUTO".
      const type = [car.model, car.variant].filter(Boolean).join(" ").trim() || veh?.derivative || veh?.model || "";

      const [created]: any = await db.insert(vehicleSaleInvoices).values({
        salesStockId: car.id,
        vehicleId: veh?.id ?? null,
        docKind: input.docKind,
        transactionDate: ukDate(new Date()),
        stockNumber: car.stockNumber || "",
        vehicleMake: String(car.make || veh?.make || "").toUpperCase(),
        vehicleType: type.toUpperCase(),
        registrationNumber: car.registration || "",
        chassisNumber: car.vin || veh?.vin || "",
        engineNumber: veh?.engineNo || "",
        firstRegisteredUK: ukDate(car.registrationDate || veh?.dateOfRegistration),
        mileage: car.mileage != null ? Number(car.mileage).toLocaleString("en-GB") : "",
        grossPrice: money(car.price),
        balance: money(car.price),
        sellerCertificateDate: ukDate(new Date()),
        buyerCertificateDate: ukDate(new Date()),
      }).returning({ id: vehicleSaleInvoices.id });

      return { id: created.id, existed: false };
    }),

  // Autosave: patch only the fields the form sends.
  save: publicProcedure
    .input(z.object({ id: z.number(), fields: fieldsSchema }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { vehicleSaleInvoices } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const patch = Object.fromEntries(
        Object.entries(input.fields).filter(([k]) => (FIELDS as readonly string[]).includes(k)),
      );
      if (Object.keys(patch).length) {
        await db.update(vehicleSaleInvoices).set(patch as any).where(eq(vehicleSaleInvoices.id, input.id));
      }
      return { ok: true };
    }),

  // Link the purchaser to a customer record and copy their name/address/phone onto the form.
  attachCustomer: publicProcedure
    .input(z.object({ id: z.number(), customerId: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb, getCustomerById } = await import("../db");
      const { vehicleSaleInvoices } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const c: any = await getCustomerById(input.customerId);
      if (!c) throw new Error("Customer not found");
      const fields = {
        purchaserName: String(c.name || "").toUpperCase(),
        purchaserAddress: addressLines(c.address, c.postcode).join("\n").toUpperCase(),
        purchaserTelephone: nationalPhone(c.phone),
      };
      await db.update(vehicleSaleInvoices).set({ ...fields, customerId: c.id }).where(eq(vehicleSaleInvoices.id, input.id));
      // Only the form's own text fields go back — the caller merges these straight into the
      // form state, and a numeric customerId there would fail the next autosave's validation.
      return fields;
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const { getDb } = await import("../db");
    const { vehicleSaleInvoices } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.delete(vehicleSaleInvoices).where(eq(vehicleSaleInvoices.id, input.id));
    return { ok: true };
  }),
});
