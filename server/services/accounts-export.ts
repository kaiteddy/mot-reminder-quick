/**
 * Accounts CSV Data Exports — replicates GA4's "Accounts CSV Data Exports" module.
 *
 * Produces up to three Sage-50-style import files per export:
 *   - Customers Records.csv      (Sage Customer Record import)
 *   - Audit Trail Invoices.csv   (Sage Audit Trail Transactions — SI / SC)
 *   - Audit Trail Payments.csv   (Sage Audit Trail Transactions — SA receipts)
 *
 * The invoice file groups each invoice's line items into nominal categories (Labour / Parts /
 * MOT / Sundries / Lubricants / Paint / Excess) using the breakdown columns, or a single grand-
 * total line in "Simple" mode. A balancing line is emitted when the categories don't reconcile to
 * the invoice net/tax (e.g. invoice-level discounts), so every invoice's lines always total the
 * document — the customer ledger balances on import.
 *
 * NOTE: matched to the documented Sage 50 import layout, not a captured GA4 sample. Test-import one
 * file into the accounts package before relying on it; column order is centralised here for tweaks.
 */
import { getDb, getAppSetting, saveAppSetting } from "../db";
import { serviceHistory, customers, payments } from "../../drizzle/schema";
import { and, eq, inArray, isNull, lte, gte, sql } from "drizzle-orm";

export type NominalPair = { std: string; acct: string };
export type AccountsConfig = {
  format: string;
  combineInvoicesPayments: boolean;
  sales: { simpleFormat: boolean; cashAccounting: boolean; paidInFullOnly: boolean; nonAccountPoolAcct: string };
  expenses: { cashAccounting: boolean; paidInFullOnly: boolean; departmentOverride: string; nonAccountPoolAcct: string };
  vehicle: { partExPoolAll: boolean; partExAcct: string; purchasePoolAll: boolean; purchaseAcct: string };
  salesNominals: Record<string, NominalPair>;
  expenseNominals: Record<string, NominalPair>;
  paymentNominals: Record<string, string>; // payment method -> bank nominal
  paymentMethods: string[];
  bankNominal: string;
};

export const DEFAULT_CONFIG: AccountsConfig = {
  format: "Sage Default Format",
  combineInvoicesPayments: false,
  sales: { simpleFormat: false, cashAccounting: false, paidInFullOnly: false, nonAccountPoolAcct: "" },
  expenses: { cashAccounting: false, paidInFullOnly: false, departmentOverride: "1", nonAccountPoolAcct: "" },
  vehicle: { partExPoolAll: false, partExAcct: "PXACC1", purchasePoolAll: false, purchaseAcct: "VPACC1" },
  salesNominals: {
    labour: { std: "4000", acct: "4000" }, labourSublet: { std: "4000", acct: "4000" },
    parts: { std: "4000", acct: "4000" }, mot: { std: "4000", acct: "4000" }, motSublet: { std: "4000", acct: "4000" },
    sundries: { std: "4000", acct: "4000" }, lubricants: { std: "4000", acct: "4000" }, paint: { std: "4000", acct: "4000" },
    excess: { std: "4000", acct: "4000" }, vehiclePartEx: { std: "5001", acct: "5001" },
    vehiclePurchase: { std: "5000", acct: "5000" }, vehicleSale: { std: "4000", acct: "4000" }, surcharge: { std: "4000", acct: "4000" },
  },
  expenseNominals: { default: { std: "5000", acct: "5000" } },
  paymentNominals: {},
  paymentMethods: ["Amex", "BACS", "Business Cheque", "Card", "Cash", "Credit Card", "Debit Card", "Mastercard", "Paypal", "Personal Cheque", "Visa Credit", "Visa Debit"],
  bankNominal: "1200",
};

const SETTINGS_KEY = "accountsExport";
const LOG_KEY = "accountsExportLog";

export async function getAccountsConfig(): Promise<AccountsConfig> {
  const saved = (await getAppSetting(SETTINGS_KEY)) as Partial<AccountsConfig> | null;
  if (!saved) return structuredClone(DEFAULT_CONFIG);
  // shallow+nested merge so new default keys appear even on old saved blobs
  return {
    ...DEFAULT_CONFIG, ...saved,
    sales: { ...DEFAULT_CONFIG.sales, ...(saved.sales || {}) },
    expenses: { ...DEFAULT_CONFIG.expenses, ...(saved.expenses || {}) },
    vehicle: { ...DEFAULT_CONFIG.vehicle, ...(saved.vehicle || {}) },
    salesNominals: { ...DEFAULT_CONFIG.salesNominals, ...(saved.salesNominals || {}) },
    expenseNominals: { ...DEFAULT_CONFIG.expenseNominals, ...(saved.expenseNominals || {}) },
    paymentNominals: { ...DEFAULT_CONFIG.paymentNominals, ...(saved.paymentNominals || {}) },
    paymentMethods: saved.paymentMethods?.length ? saved.paymentMethods : DEFAULT_CONFIG.paymentMethods,
  };
}

export async function saveAccountsConfig(cfg: AccountsConfig): Promise<void> {
  await saveAppSetting(SETTINGS_KEY, cfg);
}

export async function getExportLogs(): Promise<any[]> {
  return ((await getAppSetting(LOG_KEY)) as any[]) || [];
}
async function appendLog(entry: any): Promise<void> {
  const logs = await getExportLogs();
  logs.unshift({ ...entry, at: new Date().toISOString() });
  await saveAppSetting(LOG_KEY, logs.slice(0, 200));
}

// ---- CSV helpers ----
const q = (v: any): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (headers: string[], rows: (string | number)[][]): string =>
  [headers.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\r\n") + "\r\n";
const money = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
const ukDate = (d: Date | string | null): string => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};
const num = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
const taxCode = (net: number, tax: number) => (Math.abs(tax) > 0.005 ? "T1" : "T9");

// Derive a Sage account reference for a document.
function accountRef(doc: any, cfg: AccountsConfig): string {
  const acc = String(doc.accountNumber || "").trim().toUpperCase();
  if (acc) return acc;
  if (cfg.sales.nonAccountPoolAcct) return cfg.sales.nonAccountPoolAcct.toUpperCase();
  const name = String(doc.customerName || doc.custSurname || "CASH").replace(/[^A-Za-z]/g, "").toUpperCase();
  return ((name.slice(0, 3) || "CSH") + String(doc.customerId || doc.id || "")).slice(0, 8);
}

const SALES_DOC_TYPES = ["SI", "XS", "CR"]; // CR = credit note -> SC
const SAGE_TYPE: Record<string, string> = { SI: "SI", XS: "SI", CR: "SC" };

const AUDIT_HEADERS = ["Type", "Account Reference", "Nominal A/C Ref", "Department Code", "Date", "Reference", "Details", "Net Amount", "Tax Code", "Tax Amount"];
const CUSTOMER_HEADERS = ["Account Reference", "Company Name", "Address 1", "Address 2", "Address 3", "Address 4", "Address 5", "Telephone", "Contact Name", "Email Address"];

// Category → (column prefix, nominal key) for the breakdown export.
const CATEGORIES: { key: string; nominal: string; net: string; tax: string }[] = [
  { key: "Labour", nominal: "labour", net: "subLabourNet", tax: "subLabourTax" },
  { key: "Parts", nominal: "parts", net: "subPartsNet", tax: "subPartsTax" },
  { key: "MOT", nominal: "mot", net: "subMotNet", tax: "subMotTax" },
  { key: "Sundries", nominal: "sundries", net: "fixedItem1Net", tax: "fixedItem1Tax" },
  { key: "Lubricants", nominal: "lubricants", net: "fixedItem2Net", tax: "fixedItem2Tax" },
  { key: "Paint & Mat.", nominal: "paint", net: "fixedItem3Net", tax: "fixedItem3Tax" },
  { key: "Excess", nominal: "excess", net: "excessNet", tax: "excessTax" },
];

export type ExportResult = {
  files: { name: string; content: string }[];
  counts: { customers: number; invoices: number; invoiceLines: number; payments: number };
  folder: string;
};

/** Build the Sales export (Customers, Audit Trail Invoices, Audit Trail Payments). */
export async function generateSalesExport(opts: {
  toDate: string; fromDate?: string; markExported: boolean; onlyUnexported?: boolean;
}): Promise<ExportResult> {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const cfg = await getAccountsConfig();

  const conds: any[] = [inArray(serviceHistory.docType, SALES_DOC_TYPES)];
  // export on issue date up to the period end
  conds.push(lte(serviceHistory.dateIssued, new Date(opts.toDate + "T23:59:59.999")));
  if (opts.fromDate) conds.push(gte(serviceHistory.dateIssued, new Date(opts.fromDate + "T00:00:00")));
  if (opts.onlyUnexported !== false) conds.push(isNull((serviceHistory as any).accountsExportedAt));
  if (cfg.sales.paidInFullOnly) conds.push(sql`COALESCE(${serviceHistory.balance}::numeric,0) <= 0.005`);

  const docs: any[] = await db.select().from(serviceHistory).where(and(...conds)).orderBy(serviceHistory.dateIssued, serviceHistory.docNo);

  // ---- Audit Trail Invoices ----
  const invRows: (string | number)[][] = [];
  const custRefs = new Map<string, any>(); // ref -> doc (for customer file)
  let invoiceCount = 0;
  for (const d of docs) {
    const ref = accountRef(d, cfg);
    if (!custRefs.has(ref)) custRefs.set(ref, d);
    const type = SAGE_TYPE[d.docType] || "SI";
    const dept = String(d.department || "1");
    const date = ukDate(d.dateIssued || d.dateCreated);
    const reference = String(d.docNo || "");
    const details = `${d.docType} ${d.docNo}`.trim();
    const totalNet = num(d.totalNet), totalTax = num(d.totalTax);
    const useAcct = !!String(d.accountNumber || "").trim();
    const nom = (k: string) => (cfg.salesNominals[k] ? (useAcct ? cfg.salesNominals[k].acct : cfg.salesNominals[k].std) : "4000");

    let netSum = 0, taxSum = 0;
    const pushLine = (nominal: string, net: number, tax: number, det: string) => {
      if (Math.abs(net) < 0.005 && Math.abs(tax) < 0.005) return;
      invRows.push([type, ref, nominal, dept, date, reference, det, money(net), taxCode(net, tax), money(tax)]);
      netSum += net; taxSum += tax;
    };

    if (cfg.sales.simpleFormat) {
      pushLine(nom("labour"), totalNet, totalTax, details);
    } else {
      for (const c of CATEGORIES) {
        const net = num(d[c.net]), tax = num(d[c.tax]);
        if (Math.abs(net) > 0.005 || Math.abs(tax) > 0.005) pushLine(nom(c.nominal), net, tax, `${details} ${c.key}`);
      }
      // balancing line so the invoice's lines always total the document net/tax (discounts/rounding)
      const dn = +(totalNet - netSum).toFixed(2), dt = +(totalTax - taxSum).toFixed(2);
      if (Math.abs(dn) > 0.005 || Math.abs(dt) > 0.005) pushLine(nom("labour"), dn, dt, `${details} Discount/Adj`);
    }
    if (netSum !== 0 || taxSum !== 0 || cfg.sales.simpleFormat) invoiceCount++;
  }

  // ---- Customers Records ----
  // batch-load every referenced customer in one query (avoids an N+1 on large first-time exports)
  const custIds = Array.from(new Set(Array.from(custRefs.values()).map((d: any) => d.customerId).filter(Boolean))) as number[];
  const custById = new Map<number, any>();
  for (let i = 0; i < custIds.length; i += 1000) {
    const batch = await db.select().from(customers).where(inArray(customers.id, custIds.slice(i, i + 1000)));
    for (const c of batch) custById.set(c.id, c);
  }
  const custRows: (string | number)[][] = [];
  for (const [ref, d] of Array.from(custRefs.entries())) {
    const c: any = d.customerId ? custById.get(d.customerId) || null : null;
    // customers table holds a single address blob; the document carries the granular fields, prefer those
    const addr = [
      d.custHouseNo && d.custRoad ? `${d.custHouseNo} ${d.custRoad}` : (d.custRoad || c?.address || ""),
      d.custLocality, d.custTown, d.custCounty, d.custPostcode || c?.postcode,
    ];
    custRows.push([
      ref,
      (c?.name || d.company || d.customerName || "").trim(),
      ...addr.map((a: any) => (a || "").toString().trim()),
      (c?.phone || d.custMobile || d.custTelephone || "").trim(),
      (d.customerName || c?.name || "").trim(),
      (c?.email || d.custEmail || "").trim(),
    ]);
  }

  // ---- Audit Trail Payments ----
  const payRows: (string | number)[][] = [];
  let payCount = 0;
  const docIds = docs.map((d) => d.id);
  if (docIds.length) {
    const pays: any[] = await db.select().from(payments).where(inArray(payments.documentId, docIds));
    const byDoc = new Map<number, any>(docs.map((d) => [d.id, d]));
    for (const p of pays) {
      const d = byDoc.get(p.documentId); if (!d) continue;
      const amt = num(p.amount); if (Math.abs(amt) < 0.005) continue;
      const bank = cfg.paymentNominals[String(p.method || "").trim()] || cfg.bankNominal;
      payRows.push(["SA", accountRef(d, cfg), bank, String(d.department || "1"), ukDate(p.paymentDate || d.dateIssued), String(d.docNo || ""), `Payment ${d.docNo || ""}`.trim(), money(amt), "T9", "0.00"]);
      payCount++;
    }
  }

  // ---- mark exported ----
  if (opts.markExported && docIds.length) {
    for (let i = 0; i < docIds.length; i += 500) {
      const batch = docIds.slice(i, i + 500);
      await db.update(serviceHistory).set({ accountsExportedAt: new Date() } as any).where(inArray(serviceHistory.id, batch));
    }
    await appendLog({ type: "sales", toDate: opts.toDate, fromDate: opts.fromDate || null, invoices: invoiceCount, invoiceLines: invRows.length, payments: payCount, customers: custRows.length });
  }

  const folder = `Sales ${ukDate(new Date()).replace(/\//g, "-")}`;
  return {
    files: [
      { name: "Customers Records.csv", content: csv(CUSTOMER_HEADERS, custRows) },
      { name: "Audit Trail Invoices.csv", content: csv(AUDIT_HEADERS, invRows) },
      { name: "Audit Trail Payments.csv", content: csv(AUDIT_HEADERS, payRows) },
    ],
    counts: { customers: custRows.length, invoices: invoiceCount, invoiceLines: invRows.length, payments: payCount },
    folder,
  };
}

/** Expenses export — the webapp holds no expense-manager documents yet, so files are emitted empty. */
export async function generateExpensesExport(opts: { toDate: string }): Promise<ExportResult> {
  return {
    files: [
      { name: "Supplier Records.csv", content: csv(CUSTOMER_HEADERS, []) },
      { name: "Audit Trail Invoices.csv", content: csv(AUDIT_HEADERS, []) },
      { name: "Audit Trail Payments.csv", content: csv(AUDIT_HEADERS, []) },
    ],
    counts: { customers: 0, invoices: 0, invoiceLines: 0, payments: 0 },
    folder: `Expenses ${ukDate(new Date()).replace(/\//g, "-")}`,
  };
}

/** Mark all sales docs up to a date as already-exported, without generating files. */
export async function markSalesExported(toDate: string): Promise<{ marked: number }> {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const rows: any[] = await db.select({ id: serviceHistory.id }).from(serviceHistory).where(
    and(inArray(serviceHistory.docType, SALES_DOC_TYPES), lte(serviceHistory.dateIssued, new Date(toDate + "T23:59:59.999")), isNull((serviceHistory as any).accountsExportedAt)),
  );
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) await db.update(serviceHistory).set({ accountsExportedAt: new Date() } as any).where(inArray(serviceHistory.id, ids.slice(i, i + 500)));
  await appendLog({ type: "mark", toDate, marked: ids.length });
  return { marked: ids.length };
}
