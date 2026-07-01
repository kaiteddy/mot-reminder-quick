import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

const nominalPair = z.object({ std: z.string(), acct: z.string() });
const configSchema = z.object({
  format: z.string(),
  combineInvoicesPayments: z.boolean(),
  paymentsFromInvoices: z.boolean(),
  sales: z.object({ simpleFormat: z.boolean(), cashAccounting: z.boolean(), paidInFullOnly: z.boolean(), nonAccountPoolAcct: z.string() }),
  expenses: z.object({ cashAccounting: z.boolean(), paidInFullOnly: z.boolean(), departmentOverride: z.string(), nonAccountPoolAcct: z.string() }),
  vehicle: z.object({ partExPoolAll: z.boolean(), partExAcct: z.string(), purchasePoolAll: z.boolean(), purchaseAcct: z.string() }),
  salesNominals: z.record(z.string(), nominalPair),
  expenseNominals: z.record(z.string(), nominalPair),
  paymentNominals: z.record(z.string(), z.string()),
  paymentMethods: z.array(z.string()),
  bankNominal: z.string(),
});

export const accountsExportRouter = router({
  getConfig: publicProcedure.query(async () => {
    const { getAccountsConfig } = await import("../services/accounts-export");
    return getAccountsConfig();
  }),

  saveConfig: publicProcedure.input(configSchema).mutation(async ({ input }) => {
    const { saveAccountsConfig } = await import("../services/accounts-export");
    await saveAccountsConfig(input as any);
    return { ok: true };
  }),

  logs: publicProcedure.query(async () => {
    const { getExportLogs } = await import("../services/accounts-export");
    return getExportLogs();
  }),

  runSales: publicProcedure
    .input(z.object({ toDate: z.string(), fromDate: z.string().optional(), markExported: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const { generateSalesExport } = await import("../services/accounts-export");
      return generateSalesExport({ toDate: input.toDate, fromDate: input.fromDate, markExported: input.markExported });
    }),

  runExpenses: publicProcedure
    .input(z.object({ toDate: z.string() }))
    .mutation(async ({ input }) => {
      const { generateExpensesExport } = await import("../services/accounts-export");
      return generateExpensesExport({ toDate: input.toDate });
    }),

  markExported: publicProcedure
    .input(z.object({ toDate: z.string() }))
    .mutation(async ({ input }) => {
      const { markSalesExported } = await import("../services/accounts-export");
      return markSalesExported(input.toDate);
    }),

  unpaidList: publicProcedure.query(async () => {
    const { getUnpaidInvoices } = await import("../services/accounts-export");
    return getUnpaidInvoices();
  }),

  searchInvoices: publicProcedure.input(z.object({ term: z.string() })).query(async ({ input }) => {
    if (!input.term.trim()) return [];
    const { searchInvoices } = await import("../services/accounts-export");
    return searchInvoices(input.term);
  }),

  setUnpaid: publicProcedure.input(z.object({ id: z.number(), unpaid: z.boolean() })).mutation(async ({ input }) => {
    const { setInvoiceUnpaid } = await import("../services/accounts-export");
    return setInvoiceUnpaid(input.id, input.unpaid);
  }),
});
