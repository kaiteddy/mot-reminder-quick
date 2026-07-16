import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { RegPlate } from "@/components/RegPlate";

const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");
const money = (v: string | number | null) =>
  v == null ? "-" : `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function InProgressList({ title, mod, docType, rows, loading, onOpen, onNew }: {
  title: string; mod: string; docType: string; rows: any[]; loading: boolean; onOpen: (id: number) => void; onNew: () => void;
}) {
  return (
    <div className="ga4-panel">
      <div className={`${mod} flex items-center justify-between px-3 py-1.5 text-white text-[13px] font-semibold`} style={{ background: "var(--ga4-accent)" }}>
        <span>{title}</span>
        <button type="button" onClick={onNew} className="ga4-btn !text-[11px] !py-0.5">New</button>
      </div>
      <div className="overflow-x-auto">
        <table className="ga4-listgrid">
          <thead>
            <tr>
              <th>Doc No</th><th>Date</th><th>Registration</th><th>Make &amp; Model</th><th>Customer</th><th className="text-right">Total</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-4 text-slate-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="text-center py-4 text-slate-500">Nothing in progress</td></tr>}
            {rows.map((d) => (
              <tr key={d.id} onClick={() => onOpen(d.id)}>
                <td className="font-medium">{d.docNo || "-"}</td>
                <td>{fmtDate(d.dateIssued || d.dateCreated || d.createdAt)}</td>
                <td>{d.registration ? <RegPlate reg={d.registration} /> : "—"}</td>
                <td>{[d.make, d.model].filter(Boolean).join(" ") || "—"}</td>
                <td>{d.customerName || "—"}</td>
                <td className="text-right">{money(d.totalGross)}</td>
                <td>{d.docStatus || "New"}</td>
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

  const jsInProgress = (jobSheets ?? []).filter((d: any) => !d.dateIssued).slice(0, 15);
  const siInProgress = (invoices ?? []).filter((d: any) => !d.dateIssued).slice(0, 15);

  const openDoc = (id: number) => setLocation(`/classic/documents/${id}`);

  return (
    <DashboardLayout>
      <div className="p-3 space-y-3">
        <InProgressList
          title="Job Sheets In Progress" mod="ga4-mod-jobsheets" docType="JS"
          rows={jsInProgress} loading={jsLoading} onOpen={openDoc}
          onNew={() => setLocation("/classic/documents/new?docType=JS")}
        />
        <InProgressList
          title="Invoices In Progress" mod="ga4-mod-invoices" docType="SI"
          rows={siInProgress} loading={siLoading} onOpen={openDoc}
          onNew={() => setLocation("/classic/documents/new?docType=SI")}
        />
      </div>
    </DashboardLayout>
  );
}
