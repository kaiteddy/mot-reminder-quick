import { useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";
import { BarChart3, Printer, FileText, Eye, Loader2, X } from "lucide-react";

const money = (n: number) => `£${(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Report = { id: string; label: string; impl: boolean; viewOnly?: boolean };
type Group = { grouping: string; reports: Report[] };

const SALES: Group[] = [
  { grouping: "All", reports: [
    { id: "sales-summary", label: "Sales - Summary (On screen view)", impl: true, viewOnly: true },
    { id: "sales-summary", label: "Sales - Summary", impl: true },
    { id: "sales-summary-extended", label: "Sales - Summary Extended", impl: false },
  ] },
  { grouping: "All", reports: [{ id: "mot-sales-summary", label: "MOT Sales - Summary", impl: true }] },
  { grouping: "Day", reports: [
    { id: "activity-brief", label: "Activity - Brief", impl: false },
    { id: "activity-detailed", label: "Activity - Detailed", impl: false },
    { id: "activity-fixed", label: "Activity - Fixed Price Breakdown", impl: false },
    { id: "activity-tax", label: "Activity - Tax Breakdown", impl: false },
  ] },
  { grouping: "Ungrouped", reports: [
    { id: "unpaid-list", label: "Unpaid List (still outstanding)", impl: true },
    { id: "unpaid-during", label: "Unpaid During Report Date", impl: false },
  ] },
];
const PAYMENTS: Group[] = [
  { grouping: "All", reports: [
    { id: "payments-summary", label: "Payments - Summary", impl: true },
    { id: "payments-detailed", label: "Payments - Detailed", impl: false },
  ] },
];
const MISC: Group[] = [
  { grouping: "All", reports: [
    { id: "technician-summary", label: "Technician - Summary", impl: false },
    { id: "referrals-summary", label: "Referrals - Summary", impl: false },
    { id: "duplicate-invoices", label: "Duplicate Invoices in Period", impl: false },
  ] },
  { grouping: "All Makes", reports: [
    { id: "kpi-summary", label: "KPI Report Assistant Summary", impl: false },
    { id: "kpi-detailed", label: "KPI Report Assistant Detailed", impl: false },
    { id: "kpi-extra", label: "KPI Report Assistant Detailed Extra", impl: false },
  ] },
];

export default function Reports() {
  const now = new Date();
  const [tab, setTab] = useState<"sales" | "vehicle" | "expense" | "stock">("sales");
  const [from, setFrom] = useState(toISO(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(toISO(now));
  const [basedOn, setBasedOn] = useState<"issue" | "created">("issue");
  const [department, setDepartment] = useState("");
  const [active, setActive] = useState<{ id: string; autoPrint: boolean } | null>(null);

  const filters = trpc.reports.filters.useQuery(undefined, { staleTime: 5 * 60_000 });
  const departments: string[] = (filters.data as any)?.departments ?? [];

  const run = (r: Report, mode: "view" | "print" | "pdf") => {
    if (!r.impl) { toast.message(`“${r.label}” isn't built yet — tell me and I'll add it.`); return; }
    setActive({ id: r.id, autoPrint: mode !== "view" });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><BarChart3 className="h-5 w-5" /></span>
          Business Reports
        </h1>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          {([["sales", "Sales"], ["vehicle", "Vehicle Sales"], ["expense", "Expense"], ["stock", "Stock"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px ${tab === k ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{label}</button>
          ))}
        </div>

        {/* Date + filters */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-end gap-3">
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px]" /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px]" /></Field>
          <Field label="Based on">
            <select value={basedOn} onChange={(e) => setBasedOn(e.target.value as any)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px] bg-white">
              <option value="issue">Issue Date</option>
              <option value="created">Created Date</option>
            </select>
          </Field>
          {departments.length > 1 && (
            <Field label="Department">
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px] bg-white min-w-[140px]">
                <option value="">All</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {([["today", "Today"], ["thisMonth", "This month"], ["lastMonth", "Last month"], ["thisYear", "This year"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => {
                const t = new Date();
                if (k === "today") { setFrom(toISO(t)); setTo(toISO(t)); }
                else if (k === "thisMonth") { setFrom(toISO(new Date(t.getFullYear(), t.getMonth(), 1))); setTo(toISO(t)); }
                else if (k === "lastMonth") { setFrom(toISO(new Date(t.getFullYear(), t.getMonth() - 1, 1))); setTo(toISO(new Date(t.getFullYear(), t.getMonth(), 0))); }
                else { setFrom(toISO(new Date(t.getFullYear(), 0, 1))); setTo(toISO(t)); }
              }} className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-[12px] hover:bg-slate-50">{label}</button>
            ))}
          </div>
        </div>

        {tab !== "sales" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500 text-sm">
            The <b className="text-slate-700">{tab === "vehicle" ? "Vehicle Sales" : tab === "expense" ? "Expense" : "Stock"}</b> reports aren't built into the web app yet.
            {tab === "stock" && <> Your forecourt stock lives on the <a href="/sales-stock" className="text-violet-700 underline">Sales Stock</a> page.</>}
            <div className="text-[12px] text-slate-400 mt-1">Tell me what you track here and I'll add these reports.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Sales" note="All filters are applicable" groups={SALES} onRun={run} />
            <div className="space-y-4">
              <Section title="Payments" note="Department & Payment Type filters are applicable." groups={PAYMENTS} onRun={run} />
              <Section title="Miscellaneous" groups={MISC} onRun={run} />
            </div>
          </div>
        )}
      </div>

      {active && <ReportModal reportId={active.id} autoPrint={active.autoPrint} params={{ from, to, basedOn, department: department || undefined }} onClose={() => setActive(null)} />}
    </DashboardLayout>
  );
}

function Section({ title, note, groups, onRun }: { title: string; note?: string; groups: Group[]; onRun: (r: Report, mode: "view" | "print" | "pdf") => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[14px] font-semibold text-slate-700">{title}</span>
        {note && <span className="text-[11px] italic text-slate-400">{note}</span>}
      </div>
      <div className="divide-y divide-slate-100">
        <div className="grid grid-cols-[90px_1fr_auto] items-center px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-medium">
          <span>Grouping</span><span>Type</span><span className="flex gap-3 pr-1"><span className="w-8 text-center">Print</span><span className="w-8 text-center">PDF</span><span className="w-8 text-center">View</span></span>
        </div>
        {groups.map((g, gi) => (
          <div key={gi} className="grid grid-cols-[90px_1fr] items-stretch">
            <div className={`flex items-center justify-center text-[12px] font-medium border-r border-slate-100 px-2 py-2 ${/Day|Makes/.test(g.grouping) ? "bg-amber-50/60 text-amber-700" : "text-slate-500"}`}>{g.grouping}</div>
            <div className="divide-y divide-slate-50">
              {g.reports.map((r, ri) => (
                <div key={ri} className={`flex items-center justify-between px-3 py-2 ${r.impl ? "hover:bg-violet-50/40" : "opacity-60"}`}>
                  <span className="text-[13px] text-slate-700">{r.label}</span>
                  <span className="flex items-center gap-2 pr-0.5">
                    {!r.viewOnly && <IconBtn icon={<Printer className="w-4 h-4" />} title="Print" disabled={!r.impl} onClick={() => onRun(r, "print")} />}
                    {!r.viewOnly && <IconBtn icon={<FileText className="w-4 h-4" />} title="PDF" disabled={!r.impl} onClick={() => onRun(r, "pdf")} />}
                    <IconBtn icon={<Eye className="w-4 h-4" />} title="View" disabled={!r.impl} onClick={() => onRun(r, "view")} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconBtn({ icon, title, onClick, disabled }: { icon: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      className={`w-8 h-8 inline-flex items-center justify-center rounded border ${disabled ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-slate-200 text-slate-600 hover:bg-violet-100 hover:text-violet-700"}`}>{icon}</button>
  );
}

function ReportModal({ reportId, params, autoPrint, onClose }: { reportId: string; params: any; autoPrint: boolean; onClose: () => void }) {
  const res = trpc.reports.run.useQuery({ reportId, ...params }, { staleTime: 10_000 });
  const data = res.data as any;
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: data?.title || "Report" });
  const printedRef = useRef(false);
  useEffect(() => { if (autoPrint && data && !res.isFetching && !printedRef.current) { printedRef.current = true; setTimeout(() => handlePrint(), 300); } }, [autoPrint, data, res.isFetching]);

  const cell = (v: any, kind?: string) => kind === "money" ? (v == null ? "" : money(Number(v))) : kind === "int" ? (v == null ? "" : Number(v).toLocaleString("en-GB")) : (v ?? "");

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mt-8 mb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{data?.title || "Report"}</h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => handlePrint()} disabled={!data?.rows?.length} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-300 text-[13px] hover:bg-slate-50 disabled:opacity-50"><Printer className="w-4 h-4" /> Print</button>
            <button type="button" onClick={onClose} className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div ref={printRef} className="p-5">
          <h2 className="text-lg font-bold text-slate-800 hidden print:block mb-1">{data?.title}</h2>
          <p className="text-[12px] text-slate-500 mb-3">{params.from} → {params.to} · by {params.basedOn === "created" ? "created" : "issue"} date{data?.subtitle ? ` — ${data.subtitle}` : ""}</p>
          {res.isFetching && !data ? (
            <div className="py-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Running report…</div>
          ) : data?.note ? (
            <p className="py-8 text-center text-slate-500 text-sm">{data.note}</p>
          ) : !data?.rows?.length ? (
            <p className="py-8 text-center text-slate-400 text-sm">No data for this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                  {data.columns.map((c: any) => <th key={c.key} className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row: any, i: number) => (
                  <tr key={i} className="border-t border-slate-100">
                    {data.columns.map((c: any) => <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right tabular-nums" : "text-slate-700"}`}>{cell(row[c.key], c.kind)}</td>)}
                  </tr>
                ))}
                {data.totals && (
                  <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50/60">
                    {data.columns.map((c: any) => <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{cell(data.totals[c.key], c.kind)}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</span>{children}</div>;
}
