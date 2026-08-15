import { useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";
import { BarChart3, Printer, FileText, Eye, Loader2, X } from "lucide-react";

const money = (n: number) => { const v = n || 0; return `${v < 0 ? "-" : ""}£${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Report = { id: string; label: string; impl: boolean; viewOnly?: boolean };
type Group = { grouping: string; reports: Report[] };

const SALES: Group[] = [
  { grouping: "All", reports: [
    { id: "sales-summary", label: "Sales - Summary (On screen view)", impl: true, viewOnly: true },
    { id: "sales-summary", label: "Sales - Summary", impl: true },
    { id: "sales-summary-issued", label: "Sales - Summary of Sales Issued (GA4 format)", impl: true },
    { id: "sales-summary-extended", label: "Sales - Summary Extended", impl: true },
    { id: "sales-ledger-month", label: "Sales - Summary Ledger (by Month)", impl: true },
    { id: "sales-by-month", label: "Sales - Detailed Ledger (by Month)", impl: true },
    { id: "sales-breakdown-month", label: "Sales - Breakdown (by Month)", impl: true },
    { id: "sales-tax-breakdown-month", label: "Sales - Customer Tax Breakdown (by Month)", impl: true },
  ] },
  { grouping: "All", reports: [{ id: "mot-sales-summary", label: "MOT Sales - Summary", impl: true }] },
  { grouping: "Day", reports: [
    { id: "activity-brief", label: "Activity - Brief", impl: true },
    { id: "activity-detailed", label: "Activity - Detailed", impl: true },
    { id: "activity-fixed", label: "Activity - Fixed Price Breakdown", impl: true },
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

  // Pick a year and tick the months you want. The reports take a single date range, so the
  // selection spans from the first ticked month to the last — tick May, June and July and you
  // get 01 May → 31 Jul. The by-month reports then break that back out a row per month.
  const [year, setYear] = useState(now.getFullYear());
  const [months, setMonths] = useState<number[]>([]);
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  const applyMonths = (sel: number[], y = year) => {
    setMonths(sel);
    if (!sel.length) return;
    const lo = Math.min(...sel), hi = Math.max(...sel);
    setFrom(toISO(new Date(y, lo, 1)));
    setTo(toISO(new Date(y, hi + 1, 0)));   // day 0 of the next month = last day of this one
  };
  const toggleMonth = (m: number) =>
    applyMonths(months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b));
  // Typing in the date boxes wins — drop the month selection so the two can't disagree.
  const setFromManual = (v: string) => { setMonths([]); setFrom(v); };
  const setToManual = (v: string) => { setMonths([]); setTo(v); };

  // Tick more than one month and each is reported separately rather than as one long range —
  // three months gives three reports, each starting on its own sheet when printed.
  const periods = months.length > 1
    ? months.map((m) => ({
        from: toISO(new Date(year, m, 1)),
        to: toISO(new Date(year, m + 1, 0)),
        label: `${MONTHS[m]} ${year}`,
      }))
    : null;

  const filters = trpc.reports.filters.useQuery(undefined, { staleTime: 5 * 60_000 });
  const departments: string[] = (filters.data as any)?.departments ?? [];

  const utils = trpc.useUtils();

  const run = async (r: Report, mode: "view" | "print" | "pdf") => {
    if (!r.impl) { toast.message(`“${r.label}” isn't built yet — tell me and I'll add it.`); return; }
    // This one has a server-rendered PDF that reproduces GA4's own layout, so the PDF button
    // downloads that rather than printing the on-screen table.
    if (mode === "pdf" && (r.id === "sales-summary-issued" || r.id === "sales-summary-extended")) {
      try {
        const res: any = await utils.reports.salesSummaryPDF.fetch({
          from, to, basedOn, department: department || undefined,
          extended: r.id === "sales-summary-extended",
        });
        const bytes = atob(res.content);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
        const a = document.createElement("a");
        a.href = url; a.download = res.filename || "Sales Summary.pdf";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch (e: any) {
        toast.error("Couldn't build the PDF: " + (e?.message || ""));
      }
      return;
    }
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
          <Field label="From"><input type="date" value={from} onChange={(e) => setFromManual(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px]" /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setToManual(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-300 text-[13px]" /></Field>
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

          {/* Year + months: tick the months to report on */}
          <div className="w-full border-t border-slate-100 pt-3 flex flex-wrap items-end gap-3">
            <Field label="Year">
              <select
                value={year}
                onChange={(e) => { const y = Number(e.target.value); setYear(y); applyMonths(months, y); }}
                className="h-9 px-2 rounded-lg border border-slate-300 text-[13px] bg-white"
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Months">
              <div className="flex flex-wrap items-center gap-1">
                {MONTHS.map((label, m) => {
                  const on = months.includes(m);
                  return (
                    <button
                      key={m} type="button" onClick={() => toggleMonth(m)}
                      aria-pressed={on}
                      className={`h-9 w-11 rounded-lg border text-[12px] font-medium ${on
                        ? "border-violet-600 bg-violet-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >{label}</button>
                  );
                })}
                <span className="w-2" />
                <button type="button" onClick={() => applyMonths([0,1,2,3,4,5,6,7,8,9,10,11])}
                  className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-[12px] hover:bg-slate-50">Whole year</button>
                <button type="button" onClick={() => setMonths([])} disabled={!months.length}
                  className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-[12px] hover:bg-slate-50 disabled:opacity-40">Clear</button>
              </div>
            </Field>
            {months.length > 1 && (
              <span className="text-[11px] text-slate-500 pb-2">
                {MONTHS[Math.min(...months)]}–{MONTHS[Math.max(...months)]} {year}
                {months.length !== Math.max(...months) - Math.min(...months) + 1 && " (range spans the gaps)"}
              </span>
            )}
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

      {active && <ReportModal reportId={active.id} autoPrint={active.autoPrint} periods={periods} params={{ from, to, basedOn, department: department || undefined }} onClose={() => setActive(null)} />}
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

function ReportModal({ reportId, params, autoPrint, periods, onClose }: { reportId: string; params: any; autoPrint: boolean; periods: { from: string; to: string; label: string }[] | null; onClose: () => void }) {
  const multi = !!periods?.length;
  // Only one of these actually runs — the other is disabled so it never fires a second query.
  const single = trpc.reports.run.useQuery({ reportId, ...params }, { staleTime: 10_000, enabled: !multi });
  const many = trpc.reports.runMulti.useQuery(
    { reportId, periods: periods || [], basedOn: params.basedOn, department: params.department },
    { staleTime: 10_000, enabled: multi });
  const res = multi ? many : single;
  const parts: { label: string; from: string; to: string; result: any }[] = multi
    ? ((many.data as any[]) || [])
    : (single.data ? [{ label: "", from: params.from, to: params.to, result: single.data }] : []);
  const data = parts[0]?.result as any;
  const printRef = useRef<HTMLDivElement>(null);

  // Shrink the report to fit a single A4 sheet. Measure at the printed width (a sheet is much
  // narrower than the modal, so on-screen height would under-estimate), then hand the ratio to
  // the print stylesheet as a zoom. `zoom` is used rather than `transform: scale()` because it
  // actually reduces layout height — a transform leaves the original height behind and the page
  // still breaks in two.
  const fitToOnePage = () => {
    const el = printRef.current;
    if (!el) return;
    const PAGE_W = 718;   // A4 portrait at 96dpi (794px) less 10mm margins each side
    const PAGE_H = 1047;  // A4 portrait (1123px) less 10mm top and bottom
    const prevWidth = el.style.width;
    el.style.width = `${PAGE_W}px`;
    // With several months each gets its own sheet, so scale to the TALLEST month rather than to
    // the combined height — otherwise three months would shrink to a third of the size.
    const periodEls = Array.from(el.querySelectorAll<HTMLElement>(".report-period"));
    const needed = periodEls.length > 1
      ? Math.max(...periodEls.map((p) => p.scrollHeight))
      : el.scrollHeight;
    el.style.width = prevWidth;
    // Never enlarge, and don't shrink past legibility — a long listing is allowed to run on.
    const scale = Math.max(0.55, Math.min(1, (PAGE_H - 8) / Math.max(needed, 1)));
    el.style.setProperty("--print-scale", String(Math.round(scale * 1000) / 1000));
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: data?.title || "Report",
    onBeforePrint: () => { fitToOnePage(); return Promise.resolve(); },
  });
  const printedRef = useRef(false);
  useEffect(() => { if (autoPrint && data && !res.isFetching && !printedRef.current) { printedRef.current = true; setTimeout(() => handlePrint(), 300); } }, [autoPrint, data, res.isFetching]);

  const cell = (v: any, kind?: string) => kind === "money" ? (v == null ? "" : money(Number(v))) : kind === "int" ? (v == null ? "" : Number(v).toLocaleString("en-GB")) : (v ?? "");

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl mt-8 mb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{data?.title || "Report"}</h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => handlePrint()} disabled={!data?.rows?.length && !data?.sections?.length} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-300 text-[13px] hover:bg-slate-50 disabled:opacity-50"><Printer className="w-4 h-4" /> Print</button>
            <button type="button" onClick={onClose} className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div ref={printRef} className="p-5 report-print">
          <style>{`
            @media print {
              @page { size: A4 portrait; margin: 10mm; }
              /* Scale set by fitToOnePage() just before the dialog opens. */
              .report-print { zoom: var(--print-scale, 1); padding: 0 !important; }
              /* Each month starts a fresh sheet, so three months print as three reports. */
              .report-print .report-period + .report-period { break-before: page; page-break-before: always; }
              /* Keep a block and its heading together, and never split a row across sheets. */
              .report-print .ga4-block { break-inside: avoid; page-break-inside: avoid; }
              .report-print tr, .report-print .ga4-row { break-inside: avoid; page-break-inside: avoid; }
              .report-print thead { display: table-header-group; }
            }
          `}</style>
          {res.isFetching && !parts.length ? (
            <div className="py-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Running report{multi ? `s for ${periods!.length} months` : ""}…</div>
          ) : parts.map((p, pi) => {
            const d = p.result as any;
            return (
            <div key={pi} className="report-period">
              <h2 className={`text-lg font-bold text-slate-800 mb-1 ${multi ? "" : "hidden print:block"}`}>
                {d?.title}{p.label ? ` — ${p.label}` : ""}
              </h2>
              <p className="text-[12px] text-slate-500 mb-3">{p.from} → {p.to} · by {params.basedOn === "created" ? "created" : "issue"} date{d?.subtitle ? ` — ${d.subtitle}` : ""}</p>
              {d?.note ? (
                <p className="py-8 text-center text-slate-500 text-sm">{d.note}</p>
              ) : d?.sections ? (
                <GA4Summary sections={d.sections} />
              ) : !d?.rows?.length ? (
                <p className="py-8 text-center text-slate-400 text-sm">No data for this period.</p>
              ) : (
                <ReportTable data={d} cell={cell} />
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The generic column/row table — one report's worth. */
function ReportTable({ data, cell }: { data: any; cell: (v: any, kind?: string) => any }) {
  return (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                  {data.columns.map((c: any) => <th key={c.key} className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row: any, i: number) => (
                  row._group ? (
                    <tr key={i} className="bg-slate-100/80"><td colSpan={data.columns.length} className="px-3 py-2 font-bold text-slate-800">{row._group}</td></tr>
                  ) : row._subtotal ? (
                    <tr key={i} className="border-t border-slate-300 font-semibold bg-slate-50/40">
                      {data.columns.map((c: any) => <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right tabular-nums" : "text-slate-600"}`}>{c.key === "customer" ? "Sub Totals" : (["balance", "net", "tax", "gross", "running"].includes(c.key) ? cell(row[c.key], c.kind) : "")}</td>)}
                    </tr>
                  ) : (
                    <tr key={i} className="border-t border-slate-100">
                      {data.columns.map((c: any) => <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right tabular-nums" : "text-slate-700"}`}>{cell(row[c.key], c.kind)}</td>)}
                    </tr>
                  )
                ))}
                {data.totals && (
                  <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50/60">
                    {data.columns.map((c: any) => <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{cell(data.totals[c.key], c.kind)}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
            </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</span>{children}</div>;
}

/** GA4's "Summary of Sales Issued" layout: one boxed block per section, each with its own three
 *  column captions. Renders the same `sections` payload the PDF uses, so screen and print agree. */
function GA4Summary({ sections }: { sections: any[] }) {
  const fmt = (v: any, kind?: string) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (kind === "int") return Number(v).toLocaleString("en-GB");
    const num = Number(v);
    return `${num < 0 ? "-" : ""}${Math.abs(num).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const cellBase = "px-2 py-1 text-[13px] tabular-nums text-right align-middle";

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      {sections.map((sec, si) => (
        <div key={si} className="ga4-block">
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] items-end pb-1">
            <div className="text-[13px] font-semibold text-slate-800">{sec.title ?? ""}</div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="text-[12px] text-slate-500 text-center">{sec.captions?.[i] ?? ""}</div>
            ))}
          </div>
          <div className="border-l border-slate-300">
            {sec.rows.map((r: any, ri: number) => (
              <div key={ri} className="ga4-row grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                <div className={`px-2 py-1 text-[13px] flex items-center gap-2 ${r.label || r.qty !== undefined ? "border border-slate-200 border-l-0" : ""} ${r.total ? "justify-end font-semibold" : ""} ${r.bold && !r.total ? "font-semibold" : ""}`}>
                  <span className={r.total ? "" : "text-slate-700"}>{r.label}</span>
                  {r.qty !== undefined && (
                    <span className="ml-auto flex items-baseline gap-1">
                      <span className="text-[10px] text-slate-400">Qty</span>
                      {/* Counts print whole (13 MOTs); labour hours keep their decimals (52.25). */}
                      <span className="text-[12px] italic tabular-nums">{Number.isInteger(r.qty) ? String(r.qty) : fmt(r.qty)}</span>
                    </span>
                  )}
                </div>
                {[0, 1, 2].map((i) => {
                  const v = r.v?.[i];
                  // GA4 rules every cell of a labelled row, empty or not — Cash/Cheque with no
                  // takings still get their boxes. Only the trailing caption rows (Credited,
                  // Outstanding), which carry no label, box just the cells they use.
                  const boxed = r.label ? true : v !== null && v !== undefined;
                  return (
                    <div key={i} className={`${cellBase} ${boxed ? "border border-slate-200 border-l-0" : ""} ${r.bold ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                      {fmt(v, r.kind)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] italic text-slate-400 pt-1">
        Receipt breakdown includes all transactions for the invoices included in this report, regardless of receipt dates.
      </p>
    </div>
  );
}
