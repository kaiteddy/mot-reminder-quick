import { protectedProcedure, router } from "../_core/trpc";
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
  "purchaserName", "purchaserAddress", "purchaserTelephone", "purchaserEmail",
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
  list: protectedProcedure.query(async () => {
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

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
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
  /**
   * Raise a PURCHASE invoice for a car that is not on the forecourt yet — one bought directly
   * from a customer, where there is no auction invoice to read and no stock row to hang it on.
   *
   * Matches the plate before it creates anything: a car already in stock gets its existing row,
   * so buying in a car we have seen before does not mint a second forecourt record. The
   * registration is normalised (upper-cased, spaces stripped) because the same plate is written
   * both ways across GA4 and the web app.
   */
  createPurchaseForRegistration: protectedProcedure
    .input(z.object({ registration: z.string().min(2) }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { salesStock, vehicles } = await import("../../drizzle/schema");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const reg = input.registration.toUpperCase().trim();
      const regKey = reg.replace(/\s+/g, "");

      // Never a second forecourt row for a plate we already hold.
      let [stock]: any[] = await db.select({ id: salesStock.id }).from(salesStock)
        .where(sql`UPPER(REPLACE(${salesStock.registration}, ' ', '')) = ${regKey}`).limit(1);
      const existed = !!stock;

      if (!stock) {
        // Borrow whatever the vehicles table already knows, so the form opens pre-filled rather
        // than blank for a car that has been through the workshop before.
        const [known]: any[] = await db.select().from(vehicles)
          .where(sql`UPPER(REPLACE(${vehicles.registration}, ' ', '')) = ${regKey}`).limit(1);
        [stock] = await db.insert(salesStock).values({
          registration: reg,
          make: known?.make ?? null,
          model: known?.model ?? null,
          status: "IN PREP",
        } as any).returning({ id: salesStock.id });
      }

      // Deliberately does NOT raise the document itself — the caller then invokes
      // createFromStock({ docKind: "purchase" }), which already returns an existing purchase
      // document rather than duplicating one. Calling a sibling procedure from inside this one
      // would need a context we do not have here.
      return { salesStockId: stock.id, created: !existed };
    }),

  createFromStock: protectedProcedure
    .input(z.object({ salesStockId: z.number(), docKind: z.enum(["sale", "purchase"]).default("sale") }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { vehicleSaleInvoices, salesStock, vehicles } = await import("../../drizzle/schema");
      const { and, eq, sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Scoped to the kind: one car can legitimately have both a purchase (buying it in) and a
      // sale (selling it on), so matching on the stock car alone would hand back the wrong one.
      const existing = await db.select().from(vehicleSaleInvoices)
        .where(and(
          eq(vehicleSaleInvoices.salesStockId, input.salesStockId),
          eq(vehicleSaleInvoices.docKind, input.docKind),
        )).limit(1).then((r: any) => r[0]);

      const car: any = await db.select().from(salesStock).where(eq(salesStock.id, input.salesStockId)).limit(1).then((r: any) => r[0]);
      if (!car) throw new Error("Stock car not found");

      if (existing) {
        // The Mark-sold popup may have (re)priced the car since this invoice was raised. Refresh
        // the invoice only while its price is still a system-seeded value (blank or the asking
        // price) — a figure someone typed on the form is theirs and stays.
        if (input.docKind === "sale" && car.soldPrice != null) {
          const want = money(car.soldPrice);
          const seeded = ["", money(car.price)];
          if (want !== existing.grossPrice && seeded.includes(existing.grossPrice ?? "")) {
            const patch: any = { grossPrice: want };
            if (!existing.balance || existing.balance === existing.grossPrice) patch.balance = want;
            await db.update(vehicleSaleInvoices).set(patch).where(eq(vehicleSaleInvoices.id, existing.id));
          }
        }
        return { id: existing.id, existed: true };
      }

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
        // The stock row's own engine number comes from the paid UKVD lookup and exists even for a
        // car with no workshop history, so it leads; the vehicle record is the fallback.
        engineNumber: car.engineNo || veh?.engineNo || "",
        firstRegisteredUK: ukDate(car.registrationDate || veh?.dateOfRegistration),
        mileage: car.mileage != null ? Number(car.mileage).toLocaleString("en-GB") : "",
        // A sale invoice bills what the car actually SOLD for (the Mark-sold popup's figure);
        // the asking price only stands in while no sold price has been recorded yet.
        grossPrice: money(input.docKind === "sale" ? (car.soldPrice ?? car.price) : car.price),
        balance: money(input.docKind === "sale" ? (car.soldPrice ?? car.price) : car.price),
        sellerCertificateDate: ukDate(new Date()),
        buyerCertificateDate: ukDate(new Date()),
      }).returning({ id: vehicleSaleInvoices.id });

      return { id: created.id, existed: false };
    }),

  /**
   * Names as they appear on past workshop documents. Catches buyers like "MR DAVID SNODIN" who
   * exist only as a typed name on a GA4 invoice, never as a customer record — the customer
   * search can't find them, but the paperwork can. Fills the name only; there is no customer
   * record behind these, so no address/phone comes with them.
   */
  searchNames: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const q = input.query.trim();
      if (q.length < 2) return [];
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return [];
      const { sql } = await import("drizzle-orm");
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
      const conds = sql.join(tokens.map((t) => sql`sh."customerName" ILIKE ${"%" + t + "%"}`), sql` AND `);
      const rows: any[] = (await db.execute(sql`
        SELECT sh."customerName" AS name,
               MAX(COALESCE(sh."dateIssued", sh."dateCreated")) AS last,
               (ARRAY_AGG(sh.registration ORDER BY COALESCE(sh."dateIssued", sh."dateCreated") DESC NULLS LAST))[1] AS reg
        FROM "serviceHistory" sh
        WHERE sh."customerName" IS NOT NULL AND sh."customerName" <> '' AND ${conds}
        GROUP BY 1
        ORDER BY last DESC NULLS LAST
        LIMIT 5`)).rows ?? [];
      return rows.map((r: any) => ({ name: String(r.name), reg: String(r.reg || "") }));
    }),

  // Autosave: patch only the fields the form sends.
  save: protectedProcedure
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

      // Feed a PURCHASE back into the car's own record. Buying a car in is usually the first
      // time we hold it at all, so the details typed onto this form are the only ones that
      // exist — previously they stayed locked in the invoice and the forecourt row kept just a
      // registration. Only ever FILLS BLANKS: a value already on the stock row was either
      // synced or entered deliberately, and the invoice must not overwrite it.
      const [doc]: any[] = await db.select({
        salesStockId: vehicleSaleInvoices.salesStockId,
        docKind: vehicleSaleInvoices.docKind,
      }).from(vehicleSaleInvoices).where(eq(vehicleSaleInvoices.id, input.id)).limit(1);

      if (doc?.docKind === "purchase" && doc.salesStockId) {
        const { salesStock } = await import("../../drizzle/schema");
        const [car]: any[] = await db.select().from(salesStock)
          .where(eq(salesStock.id, doc.salesStockId)).limit(1);
        if (car) {
          const f: any = input.fields;
          const blank = (v: any) => v === null || v === undefined || String(v).trim() === "";
          const back: Record<string, any> = {};
          if (blank(car.make) && !blank(f.vehicleMake)) back.make = String(f.vehicleMake).slice(0, 100);
          if (blank(car.model) && !blank(f.vehicleType)) back.model = String(f.vehicleType).slice(0, 100);
          if (blank(car.vin) && !blank(f.chassisNumber)) back.vin = String(f.chassisNumber).slice(0, 50);
          if (blank(car.registration) && !blank(f.registrationNumber)) {
            back.registration = String(f.registrationNumber).toUpperCase().slice(0, 20);
          }
          // Mileage is free text on the form ("54,120 miles") but an integer on the stock row.
          if (car.mileage == null && !blank(f.mileage)) {
            const m = parseInt(String(f.mileage).replace(/[^0-9]/g, ""), 10);
            if (Number.isFinite(m) && m > 0) back.mileage = m;
          }
          if (Object.keys(back).length) {
            await db.update(salesStock).set(back as any).where(eq(salesStock.id, doc.salesStockId));
          }

          // ...and into the car-trading ledger behind /reconciliation, which reads carDeals.
          // Without this the purchase shows on the forecourt but never in the P&L, so a car
          // bought from a customer looked like it cost nothing. Keyed on the stock car so
          // repeated auto-saves update one row rather than stacking up duplicate deals.
          const money = (v: any) => {
            const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
            return Number.isFinite(n) && n > 0 ? n : null;
          };
          // The form writes dates as dd/mm/yyyy; Date.parse reads that as US order or not at all.
          const asDate = (v: any) => {
            const m = String(v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
            if (!m) return null;
            const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
            // Midday UTC, not local midnight: in BST local midnight is 23:00 the day BEFORE in
            // UTC, which stored 14/08 as the 13th. Purchase dates land in the P&L by month, so
            // a day's drift can move a car into the wrong period.
            const d = new Date(Date.UTC(yr, Number(m[2]) - 1, Number(m[1]), 12, 0, 0));
            return isNaN(d.getTime()) ? null : d;
          };
          const cost = money(f.grossPrice);
          const bought = asDate(f.transactionDate);
          const seller = String(f.lastOwnerDetails ?? "").trim().split(/\r?\n/)[0] || null;

          if (cost || bought || seller) {
            const { carDeals } = await import("../../drizzle/schema");
            const [deal]: any[] = await db.select({ id: carDeals.id }).from(carDeals)
              .where(eq(carDeals.salesStockId, doc.salesStockId)).limit(1);
            const vals: Record<string, any> = {};
            if (cost != null) vals.purchaseCost = String(cost);
            if (bought) vals.purchaseDate = bought;
            if (seller) vals.source = seller.slice(0, 100);
            if (deal) {
              await db.update(carDeals).set(vals as any).where(eq(carDeals.id, deal.id));
            } else {
              await db.insert(carDeals).values({
                registration: (car.registration ?? f.registrationNumber ?? "").toUpperCase().slice(0, 20),
                salesStockId: doc.salesStockId,
                status: "in stock",
                purchaseInvoiceRef: "Purchase invoice",
                ...vals,
              } as any);
            }
          }
        }
      }
      return { ok: true };
    }),

  // Link the purchaser to a customer record and copy their name/address/phone onto the form.
  attachCustomer: protectedProcedure
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
        // Left as typed — an email is case-sensitive after the @ on some servers, and it is the
        // one thing on this block that isn't shouted in capitals.
        purchaserEmail: String(c.email || "").trim(),
      };
      await db.update(vehicleSaleInvoices).set({ ...fields, customerId: c.id }).where(eq(vehicleSaleInvoices.id, input.id));
      // Only the form's own text fields go back — the caller merges these straight into the
      // form state, and a numeric customerId there would fail the next autosave's validation.
      return fields;
    }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const { getDb } = await import("../db");
    const { vehicleSaleInvoices } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.delete(vehicleSaleInvoices).where(eq(vehicleSaleInvoices.id, input.id));
    return { ok: true };
  }),
});
