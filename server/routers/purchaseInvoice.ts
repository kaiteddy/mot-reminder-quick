import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

/**
 * Logging a bought car from its purchase invoice.
 *
 * Two steps on purpose: `parse` reads the PDF and says what it found, `commit` writes it. The
 * figures land in the margin-scheme books, so nothing is saved until it has been looked at.
 */

const feeSchema = z.record(z.string(), z.number());

export const purchaseInvoiceRouter = router({
  /** Read a PDF and report what's in it, alongside DVLA's view of the same registration. */
  parse: publicProcedure
    .input(z.object({
      // ~5MB of base64; an auction invoice is a few tens of KB
      fileBase64: z.string().max(7_000_000),
      fileName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { parsePurchaseInvoice } = await import("../services/purchaseInvoice");
      const buf = Buffer.from(input.fileBase64, "base64");
      const parsed = parsePurchaseInvoice(buf);

      // Independent check on the identity. The invoice is typed by a human at the auction house;
      // DVLA is the registry. Disagreement usually means the wrong car, so it's surfaced rather
      // than silently trusted either way.
      let dvla: any = null;
      const mismatches: string[] = [];
      if (parsed.registration) {
        try {
          const { getVehicleDetails } = await import("../dvlaApi");
          const d: any = await getVehicleDetails(parsed.registration.replace(/\s+/g, ""));
          if (d) {
            dvla = {
              make: d.make ?? null, colour: d.colour ?? null, fuelType: d.fuelType ?? null,
              engineCapacity: d.engineCapacity ?? null, yearOfManufacture: d.yearOfManufacture ?? null,
              monthOfFirstRegistration: d.monthOfFirstRegistration ?? null,
              taxStatus: d.taxStatus ?? null, motStatus: d.motStatus ?? null,
            };
            const eq = (a?: string | null, b?: string | null) =>
              !a || !b || a.trim().toUpperCase() === b.trim().toUpperCase();
            if (!eq(parsed.make, dvla.make)) mismatches.push(`Make: invoice says ${parsed.make}, DVLA says ${dvla.make}`);
            if (!eq(parsed.colour, dvla.colour)) mismatches.push(`Colour: invoice says ${parsed.colour}, DVLA says ${dvla.colour}`);
            const invMonth = parsed.firstRegistered?.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
            if (invMonth && dvla.monthOfFirstRegistration) {
              const asMonth = `20${invMonth[3]}-${invMonth[2]}`;
              if (asMonth !== dvla.monthOfFirstRegistration) {
                mismatches.push(`First registered: invoice says ${parsed.firstRegistered}, DVLA says ${dvla.monthOfFirstRegistration}`);
              }
            }
          } else {
            mismatches.push("DVLA has no record for this registration.");
          }
        } catch (e: any) {
          mismatches.push(`Couldn't reach DVLA to check this (${e?.message ?? "error"}).`);
        }
      }

      // Already logged? Same car at the same price is almost certainly the same purchase.
      let existingDealId: number | null = null;
      if (parsed.registration && parsed.purchaseCost != null) {
        const { getDb } = await import("../db");
        const { carDeals } = await import("../../drizzle/schema");
        const { and, eq, sql } = await import("drizzle-orm");
        const db = await getDb();
        if (db) {
          const [dup] = await db.select({ id: carDeals.id }).from(carDeals)
            .where(and(
              sql`UPPER(REPLACE(${carDeals.registration}, ' ', '')) = ${parsed.registration.replace(/\s+/g, "").toUpperCase()}`,
              eq(carDeals.purchaseCost, String(parsed.purchaseCost)),
            )).limit(1);
          existingDealId = dup?.id ?? null;
        }
      }

      return { parsed, dvla, mismatches, existingDealId };
    }),

  /**
   * Write the purchase. Creates the Sales Stock row first so the deal can point at it, and
   * marks it IN PREP — a car off an auction invoice isn't on the forecourt yet.
   */
  commit: publicProcedure
    .input(z.object({
      registration: z.string().trim().min(1),
      make: z.string().trim().optional(),
      model: z.string().trim().optional(),
      variant: z.string().trim().optional(),
      colour: z.string().trim().optional(),
      vin: z.string().trim().optional(),
      mileage: z.number().int().nonnegative().optional(),
      firstRegistered: z.string().optional(),   // dd/mm/yy as printed
      motExpiry: z.string().optional(),
      purchaseCost: z.number().nonnegative(),
      purchaseDate: z.string().optional(),      // dd/mm/yy as printed
      fees: feeSchema.default({}),
      marginScheme: z.boolean().default(true),
      source: z.string().trim().default("BCA"),
      invoiceNumber: z.string().trim().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { carDeals, salesStock } = await import("../../drizzle/schema");
      const { ukDateToDate } = await import("../services/purchaseInvoice");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const reg = input.registration.toUpperCase().trim();
      const regKey = reg.replace(/\s+/g, "");
      const feesTotal = Object.values(input.fees).reduce((a, b) => a + b, 0);

      // Don't create a second forecourt row for a car already in stock.
      const [existingStock] = await db.select({ id: salesStock.id }).from(salesStock)
        .where(sql`UPPER(REPLACE(${salesStock.registration}, ' ', '')) = ${regKey}`).limit(1);

      let salesStockId = existingStock?.id ?? null;
      if (!salesStockId) {
        const [created] = await db.insert(salesStock).values({
          registration: reg,
          vin: input.vin || null,
          make: (input.make || "").toUpperCase() || null,
          model: (input.model || "").toUpperCase() || null,
          variant: input.variant || null,
          colour: (input.colour || "").toUpperCase() || null,
          mileage: input.mileage ?? null,
          registrationDate: ukDateToDate(input.firstRegistered),
          motExpiryDate: ukDateToDate(input.motExpiry),
          status: "IN PREP",
        }).returning({ id: salesStock.id });
        salesStockId = created.id;
      }

      const noteParts = [
        input.invoiceNumber ? `${input.source} invoice ${input.invoiceNumber}` : null,
        input.marginScheme ? "Margin scheme (second-hand goods)" : "Standard-rated",
        input.notes || null,
      ].filter(Boolean);

      const [deal] = await db.insert(carDeals).values({
        registration: reg,
        description: [input.make, input.model, input.variant].filter(Boolean).join(" ").slice(0, 160) || null,
        purchaseCost: String(input.purchaseCost),
        purchaseDate: ukDateToDate(input.purchaseDate) ?? new Date(),
        reconditioningCost: feesTotal ? String(feesTotal) : null,
        // The vehicle carries no reclaimable VAT under the margin scheme, and on this invoice
        // the fees were zero-rated too — so nothing is assumed here.
        onCostVat: null,
        feeBreakdown: input.fees,
        status: "in_stock",
        salesStockId,
        stdRated: input.marginScheme ? 0 : 1,
        source: input.source,
        notes: noteParts.join(" · ") || null,
      }).returning({ id: carDeals.id });

      return { dealId: deal.id, salesStockId, createdStock: !existingStock };
    }),
});
