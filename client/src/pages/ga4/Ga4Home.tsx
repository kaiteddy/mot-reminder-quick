import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Settings, Phone } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { RegPlate } from "@/components/RegPlate";

const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");
const money = (v: string | number | null) =>
  v == null ? "-" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isToday = (d: string | Date | null) => { if (!d) return false; const x = new Date(d), n = new Date(); return x.toDateString() === n.toDateString(); };
const soon = (label: string) => () => toast.message(`${label} isn't wired up in Classic view yet.`);

// One "In Progress" panel — chrome/columns match the real GA4 Home screen exactly
// (title bar + record count + gear, toolbar row, Created/date filter row, T/Doc No/Date/
// Registration/Make & Model/Customer/Lab#/Total/Status/phone/Open grid).
function InProgressPanel({ title, mod, docLabel, rows, allCount, loading, onOpen, onNew }: {
  title: string; mod: string; docLabel: string; rows: any[]; allCount: number; loading: boolean;
  onOpen: (id: number) => void; onNew: () => void;
}) {
  const [todayOnly, setTodayOnly] = useState(false);
  const shown = todayOnly ? rows.filter((d) => isToday(d.dateIssued || d.dateCreated || d.createdAt)) : rows;

  return (
    <div className="ga4-panel">
      <div className={`${mod} flex items-center justify-between px-3 py-1.5 text-white text-[13px] font-semibold`} style={{ background: "var(--ga4-accent)" }}>
        <span>{title}: All (Showing {shown.length} Record{shown.length === 1 ? "" : "s"})</span>
        <button type="button" onClick={soon("Panel settings")} className="opacity-80 hover:opacity-100" title="Settings"><Settings className="w-3.5 h-3.5" /></button>
      </div>

      <div className="flex items-center gap-2 px-2 py-1 border-b" style={{ background: "#f2f0ea", borderColor: "#c3c0b8" }}>
        <button type="button" onClick={onNew} className="ga4-btn">New {docLabel}</button>
        <button type="button" onClick={soon("Archives")} className="ga4-btn">Archives</button>
        <button type="button" onClick={soon("Print")} className="ga4-btn">Print</button>
        <div className="flex-1" />
        <button type="button" onClick={soon("Print Blank " + docLabel)} className="ga4-btn">Print Blank {docLabel}</button>
        <button type="button" onClick={soon("Print All")} className="ga4-btn">Print All</button>
      </div>

      <div className="flex items-center gap-3 px-2 py-1 border-b text-[11.5px]" style={{ background: "#f8f7f4", borderColor: "#c3c0b8", color: "#4a4a4a" }}>
        <span>Created</span>
        <button type="button" onClick={() => setTodayOnly((v) => !v)} className={`ga4-btn !py-0.5 ${todayOnly ? "!bg-blue-100" : ""}`}>Today</button>
        <button type="button" onClick={soon("Date Range")} className="ga4-btn !py-0.5">Date Range ▾</button>
        <button type="button" onClick={soon("Status filter")} className="ga4-btn !py-0.5">Status ▾</button>
        <span className="ml-auto text-slate-500">{allCount} total in progress</span>
      </div>

      <div className="overflow-x-auto">
        <table className="ga4-listgrid">
          <thead>
            <tr>
              <th>T</th><th>Doc No</th><th>Date</th><th>Registration</th><th>Make &amp; Model</th><th>Customer</th>
              <th className="text-right">Lab#</th><th className="text-right">Total</th><th>Status</th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={11} className="text-center py-4 text-slate-500">Loading…</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={11} className="text-center py-4 text-slate-500">Nothing in progress</td></tr>}
            {shown.map((d) => (
              <tr key={d.id} onClick={() => onOpen(d.id)}>
                <td className="font-semibold" style={{ color: "var(--ga4-accent)" }}>{d.docType}</td>
                <td className="font-medium">{d.docNo || "-"}</td>
                <td>{fmtDate(d.dateIssued || d.dateCreated || d.createdAt)}</td>
                <td>{d.registration ? <RegPlate reg={d.registration} /> : "—"}</td>
                <td>{[d.make, d.model].filter(Boolean).join(" ") || "—"}</td>
                <td>{d.customerName || "—"}</td>
                <td className="text-right text-slate-400">~</td>
                <td className="text-right">{money(d.totalGross)}</td>
                <td className="text-slate-500">~</td>
                <td onClick={(e) => e.stopPropagation()}>{d.phone && <Phone className="w-3 h-3 text-slate-400" />}</td>
                <td onClick={(e) => { e.stopPropagation(); onOpen(d.id); }} className="font-semibold" style={{ color: "#1d4ed8", cursor: "pointer" }}>Open</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Ga4Home() {
  const [, setLocation] = useLocation();
  const { data: jobSheets, isLoading: jsLoading } = trpc.documents.list.useQuery({ docType: "JS", limit: 200, sortKey: "date", sortDir: "desc" });
  const { data: invoices, isLoading: siLoading } = trpc.documents.list.useQuery({ docType: "SI", limit: 200, sortKey: "date", sortDir: "desc" });

  const jsInProgress = useMemo(() => (jobSheets ?? []).filter((d: any) => !d.dateIssued), [jobSheets]);
  const siInProgress = useMemo(() => (invoices ?? []).filter((d: any) => !d.dateIssued), [invoices]);

  const openDoc = (id: number) => setLocation(`/classic/documents/${id}`);

  return (
    <DashboardLayout>
      <div className="p-3 space-y-3">
        <InProgressPanel
          title="Job Sheets In Progress" mod="ga4-mod-jobsheets" docLabel="Job Sheet"
          rows={jsInProgress} allCount={jsInProgress.length} loading={jsLoading} onOpen={openDoc}
          onNew={() => setLocation("/classic/documents/new?docType=JS")}
        />
        <InProgressPanel
          title="Invoices In Progress" mod="ga4-mod-invoices" docLabel="Invoice"
          rows={siInProgress} allCount={siInProgress.length} loading={siLoading} onOpen={openDoc}
          onNew={() => setLocation("/classic/documents/new?docType=SI")}
        />
      </div>
    </DashboardLayout>
  );
}
