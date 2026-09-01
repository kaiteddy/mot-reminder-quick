import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";

const source = z.enum(["bank", "card"]);

export const expenditureRouter = router({
  stats: protectedProcedure.query(async () => {
    const { getStats } = await import("../services/expenditure");
    return getStats();
  }),

  reconciliation: protectedProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input }) => {
      const { getReconciliation } = await import("../services/expenditure");
      return getReconciliation(input);
    }),

  transactions: protectedProcedure
    .input(z.object({
      source: source.optional(), month: z.string().optional(), category: z.string().optional(),
      unlabelledOnly: z.boolean().optional(), search: z.string().optional(),
      limit: z.number().optional(), offset: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const { listTransactions } = await import("../services/expenditure");
      return listTransactions(input);
    }),

  categories: protectedProcedure.query(async () => {
    const { getCategories } = await import("../services/expenditure");
    return getCategories();
  }),

  supplierSpend: protectedProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input }) => {
      const { getSupplierSpend } = await import("../services/expenditure");
      return getSupplierSpend(input);
    }),

  expenditureBreakdown: protectedProcedure
    .input(z.object({ from: z.string(), to: z.string(), section: z.string(), month: z.string().optional() }))
    .query(async ({ input }) => {
      const { getExpenditureBreakdown } = await import("../services/expenditure");
      return getExpenditureBreakdown(input);
    }),

  lookupReg: protectedProcedure
    .input(z.object({ registration: z.string() }))
    .mutation(async ({ input }) => {
      const { lookupReg } = await import("../services/expenditure");
      return lookupReg(input);
    }),

  reclassifyPayee: protectedProcedure
    .input(z.object({ payee: z.string(), category: z.string() }))
    .mutation(async ({ input }) => {
      const { reclassifyPayee } = await import("../services/expenditure");
      return reclassifyPayee(input);
    }),

  setCategoryVat: protectedProcedure
    .input(z.object({ name: z.string(), vatRate: z.number() }))
    .mutation(async ({ input }) => {
      const { setCategoryVat } = await import("../services/expenditure");
      return setCategoryVat(input);
    }),

  setTxnVatOverride: protectedProcedure
    .input(z.object({ id: z.number(), vatRate: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const { setTxnVatOverride } = await import("../services/expenditure");
      return setTxnVatOverride(input);
    }),

  labels: protectedProcedure
    .input(z.object({ source: source.optional() }))
    .query(async ({ input }) => {
      const { getLabels } = await import("../services/expenditure");
      return getLabels(input);
    }),

  upsertLabel: protectedProcedure
    .input(z.object({ source, counterpartyKey: z.string(), category: z.string() }))
    .mutation(async ({ input }) => {
      const { upsertLabel } = await import("../services/expenditure");
      return upsertLabel(input);
    }),

  setOverride: protectedProcedure
    .input(z.object({ id: z.number(), category: z.string().nullable() }))
    .mutation(async ({ input }) => {
      const { setOverride } = await import("../services/expenditure");
      return setOverride(input);
    }),

  setOverrideBulk: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1).max(500), category: z.string().nullable() }))
    .mutation(async ({ input }) => {
      const { setOverrideBulk } = await import("../services/expenditure");
      return setOverrideBulk(input);
    }),

  setTxnMonth: protectedProcedure
    .input(z.object({ ids: z.array(z.number()), month: z.string().nullable() }))
    .mutation(async ({ input }) => {
      const { setTxnMonth } = await import("../services/expenditure");
      return setTxnMonth(input);
    }),

  import: protectedProcedure
    .input(z.object({ source, csvText: z.string() }))
    .mutation(async ({ input }) => {
      const { importTransactions } = await import("../services/expenditure");
      return importTransactions(input);
    }),

  // ── Car trading ledger ──
  carDeals: protectedProcedure.query(async () => {
    const { getCarDeals } = await import("../services/expenditure");
    return getCarDeals();
  }),

  upsertCarDeal: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      registration: z.string().nullish(), description: z.string().nullish(),
      purchaseCost: z.number().nullish(), purchaseDate: z.string().nullish(),
      salePrice: z.number().nullish(), saleDate: z.string().nullish(),
      askingPrice: z.number().nullish(), reconditioningCost: z.number().nullish(),
      onCostVat: z.number().nullish(),
      feeBreakdown: z.object({ buyerFee: z.number().nullish(), assured: z.number().nullish(), delivery: z.number().nullish(), other: z.number().nullish() }).nullish(),
      status: z.enum(["in_stock", "sold"]).optional(), notes: z.string().nullish(),
      source: z.string().nullish(),
      salesStockId: z.number().nullish(),
    }))
    .mutation(async ({ input }) => {
      const { upsertCarDeal } = await import("../services/expenditure");
      return upsertCarDeal(input);
    }),

  deleteCarDeal: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteCarDeal } = await import("../services/expenditure");
      return deleteCarDeal(input);
    }),

  vehiclePurchases: protectedProcedure.query(async () => {
    const { getVehiclePurchases } = await import("../services/expenditure");
    return getVehiclePurchases();
  }),

  linkPurchase: protectedProcedure
    .input(z.object({ txnId: z.number(), carDealId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const { linkPurchase } = await import("../services/expenditure");
      return linkPurchase(input);
    }),
  bookDelivery: protectedProcedure
    .input(z.object({ txnId: z.number(), carDealId: z.number(), amount: z.number() }))
    .mutation(async ({ input }) => {
      const { bookDelivery } = await import("../services/expenditure");
      return bookDelivery(input);
    }),
});
