import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

const source = z.enum(["bank", "card"]);

export const expenditureRouter = router({
  stats: publicProcedure.query(async () => {
    const { getStats } = await import("../services/expenditure");
    return getStats();
  }),

  reconciliation: publicProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input }) => {
      const { getReconciliation } = await import("../services/expenditure");
      return getReconciliation(input);
    }),

  transactions: publicProcedure
    .input(z.object({
      source: source.optional(), month: z.string().optional(), category: z.string().optional(),
      unlabelledOnly: z.boolean().optional(), search: z.string().optional(),
      limit: z.number().optional(), offset: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const { listTransactions } = await import("../services/expenditure");
      return listTransactions(input);
    }),

  categories: publicProcedure.query(async () => {
    const { getCategories } = await import("../services/expenditure");
    return getCategories();
  }),

  supplierSpend: publicProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input }) => {
      const { getSupplierSpend } = await import("../services/expenditure");
      return getSupplierSpend(input);
    }),

  setCategoryVat: publicProcedure
    .input(z.object({ name: z.string(), vatRate: z.number() }))
    .mutation(async ({ input }) => {
      const { setCategoryVat } = await import("../services/expenditure");
      return setCategoryVat(input);
    }),

  setTxnVatOverride: publicProcedure
    .input(z.object({ id: z.number(), vatRate: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const { setTxnVatOverride } = await import("../services/expenditure");
      return setTxnVatOverride(input);
    }),

  labels: publicProcedure
    .input(z.object({ source: source.optional() }))
    .query(async ({ input }) => {
      const { getLabels } = await import("../services/expenditure");
      return getLabels(input);
    }),

  upsertLabel: publicProcedure
    .input(z.object({ source, counterpartyKey: z.string(), category: z.string() }))
    .mutation(async ({ input }) => {
      const { upsertLabel } = await import("../services/expenditure");
      return upsertLabel(input);
    }),

  setOverride: publicProcedure
    .input(z.object({ id: z.number(), category: z.string().nullable() }))
    .mutation(async ({ input }) => {
      const { setOverride } = await import("../services/expenditure");
      return setOverride(input);
    }),

  import: publicProcedure
    .input(z.object({ source, csvText: z.string() }))
    .mutation(async ({ input }) => {
      const { importTransactions } = await import("../services/expenditure");
      return importTransactions(input);
    }),

  // ── Car trading ledger ──
  carDeals: publicProcedure.query(async () => {
    const { getCarDeals } = await import("../services/expenditure");
    return getCarDeals();
  }),

  upsertCarDeal: publicProcedure
    .input(z.object({
      id: z.number().optional(),
      registration: z.string().nullish(), description: z.string().nullish(),
      purchaseCost: z.number().nullish(), purchaseDate: z.string().nullish(),
      salePrice: z.number().nullish(), saleDate: z.string().nullish(),
      askingPrice: z.number().nullish(), reconditioningCost: z.number().nullish(),
      status: z.enum(["in_stock", "sold"]).optional(), notes: z.string().nullish(),
    }))
    .mutation(async ({ input }) => {
      const { upsertCarDeal } = await import("../services/expenditure");
      return upsertCarDeal(input);
    }),

  deleteCarDeal: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteCarDeal } = await import("../services/expenditure");
      return deleteCarDeal(input);
    }),

  vehiclePurchases: publicProcedure.query(async () => {
    const { getVehiclePurchases } = await import("../services/expenditure");
    return getVehiclePurchases();
  }),

  linkPurchase: publicProcedure
    .input(z.object({ txnId: z.number(), carDealId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const { linkPurchase } = await import("../services/expenditure");
      return linkPurchase(input);
    }),
});
