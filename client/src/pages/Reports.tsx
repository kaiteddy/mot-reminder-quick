import { useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useReactToPrint } from "react-to-print";
import { BarChart3, Printer, Loader2 } from "lucide-react";

const DOC_LABEL: Record<string, string> = {
  SI: "Invoices", ES: "Estimates", JS: "Job Sheets", CR: "Credit Notes",
  XS: "Excess", PA: "Purchases", VS: "Vehicle Sales", VP: "Vehicle Purchases",
};
const money = (n: number) => `£${(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Reports() {
  const now = new Date();
  const [from, setFrom] = useState(toISO(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(toISO(now));
  const [basedOn, setBasedOn] = useState<"issue" | "created">("issue");
  const [department, setDepartment] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  const res = trpc.reports.salesSummary.useQuery(
    { from, to, basedOn, department: department || undefined },
    { enabled: !!from && !!to, staleTime: 30_000 },
  );
  const data = res.data as any;
  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: `Sales Summary ${from} to ${to}` });

  // Sales = invoices + excess − credit notes; estimates / job sheets are shown but not counted as revenue.
  const REVENUE = new Set(["SI", "XS"]);
  const NEGATIVE = new Set(["CR"]);
  const rows: any[] = data?.rows ?? [];
  const totals = useMemo(() => {
    let net = 0, tax = 0, gross = 0, count = 0, parts = 0, labour = 0, mot = 0;
    for (const r of rows) {
      const sign = NEGATIVE.has(r.docType) ? -1 : 1;
      if (REVENUE.has(r.docType) || NEGATIVE.has(r.docType)) { net += sign * r.net; tax += sign * r.tax; gross += sign * r.gross; count += r.count; parts += sign * r.partsNet; labour += sign * r.labourNet; mot += sign * r.motNet; }
    }
    return { net, tax, gross, count, parts, labour, mot };
  }, [rows]);

  const preset = (kind: "thisMonth" | "lastMonth" | "thisYear") => {
    const t = new Date();
    if (kind === "thisMonth") { setFrom(toISO(new Date(t.getFullYear(), t.getMonth(), 1))); setTo(toISO(t)); }
    else if (kind === "lastMonth") { setFrom(toISO(new Date(t.getFullYear(), t.getMonth() - 1, 1))); setTo(toISO(new Date(t.getFullYear(), t.getMonth(), 0))); }
    else { setFrom(toISO(new Date(t.getFullYear(), 0, 1))); setTo(toISO(t)); }
  };

  const ordered = [...rows].sort((a, b) => (DOC_LABEL[a.docType] || a.docType || "").localeCompare(DOC_LABEL[b.docType] || b.docType || ""));

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><BarChart3 className="h-5 w-5" /></span>
              Business Reports
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">Sales summary for a date range. More reports (payments, technician, unpaid, KPI…) to follow.</p>
          </div>
          <button type="button" onClick={() => handlePrint()} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[13px] font-medium hover:bg-slate-50 disabled:opacity-50">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-end gap-3">
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px]" /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px]" /></Field>
          <Field label="Based on">
            <select value={basedOn} onChange={(e) => setBasedOn(e.target.value as any)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px] bg-white">
              <option value="issue">Issue Date</option>
              <option value="created">Created Date</option>
            </select>
          </Field>
          {(data?.departments?.length ?? 0) > 1 && (
            <Field label="Department">
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px] bg-white min-w-[140px]">
                <option value="">All</option>
                {(data?.departments ?? []).map((d: string) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {(["thisMonth", "lastMonth", "thisYear"] as const).map((k) => (
              <button key={k} type="button" onClick={() => preset(k)} className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-[12px] hover:bg-slate-50">
                {k === "thisMonth" ? "This month" : k === "lastMonth" ? "Last month" : "This year"}
              </button>
            ))}
          </div>
        </div>

        {/* Report */}
        <div ref={printRef} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-700">Sales — Summary</span>
            <span className="text-[12px] text-slate-500">{from} → {to} · by {basedOn === "issue" ? "issue" : "created"} date{department ? ` · ${department}` : ""}</span>
          </div>

          {res.isFetching && !data ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div>
          ) : !rows.length ? (
            <div className="py-12 text-center text-slate-400">No documents in this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="text-left font-medium px-4 py-2">Type</th>
                    <th className="text-right font-medium px-4 py-2">Count</th>
                    <th className="text-right font-medium px-4 py-2">Net</th>
                    <th className="text-right font-medium px-4 py-2">VAT</th>
                    <th className="text-right font-medium px-4 py-2">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((r) => (
                    <tr key={r.docType} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-700">{DOC_LABEL[r.docType] || r.docType || "—"}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{r.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(r.net)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(r.tax)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(r.gross)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50/60">
                    <td className="px-4 py-2.5">Net Sales (invoices + excess − credit notes)</td>
                    <td className="px-4 py-2.5 text-right">{totals.count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(totals.net)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(totals.tax)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{money(totals.gross)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Composition */}
              <div className="grid grid-cols-3 gap-3 p-4 border-t border-slate-100">
                <Split label="Parts (net)" value={totals.parts} />
                <Split label="Labour (net)" value={totals.labour} />
                <Split label="MOT (net)" value={totals.mot} />
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</span>{children}</div>;
}
function Split({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</div>
      <div className="text-lg font-bold text-slate-800 tabular-nums">{money(value)}</div>
    </div>
  );
}
