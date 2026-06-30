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
});
