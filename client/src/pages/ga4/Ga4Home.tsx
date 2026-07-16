import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Phone } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");
const money = (v: string | number | null) =>
  v == null ? "-" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isToday = (d: string | Date | null) => { if (!d) return false; const x = new Date(d), n = new Date(); return x.toDateString() === n.toDateString(); };
const soon = (label: string) => () => toast.message(`${label} isn't wired up in Classic view yet.`);

const tableColumns = [
  { label: "T", className: "col-type" },
  { label: "Doc No", className: "col-doc" },
  { label: "Date", className: "col-date" },
  { label: "Registration", className: "col-reg" },
  { label: "Make & Model", className: "col-model" },
  { label: "Customer", className: "col-customer" },
  { label: "Lab#", className: "col-lab" },
  { label: "Total", className: "col-total" },
  { label: "Status", className: "col-status" },
  { label: "", className: "col-phone" },
  { label: "", className: "col-open" },
];

function BevelButton({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <button type="button" className={`bevel-button ${className}`} onClick={onClick}>{children}</button>;
}

// Real GA4 desktop table, wired to live data (the reference shell it was ported
// from left every row blank — see index.css's "Reference-locked shell chrome").
function DataTable({ rows, loading, onOpen }: { rows: any[]; loading: boolean; onOpen: (id: number) => void }) {
  return (
    <div className="data-table-wrap" role="region" aria-label="Documents">
      <table className="data-table">
        <thead>
          <tr>{tableColumns.map((c, i) => <th key={i} className={c.className}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={11} style={{ textAlign: "center", color: "#777" }}>Loading…</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "#777" }}>Nothing in progress</td></tr>}
          {rows.map((d) => (
            <tr key={d.id} onClick={() => onOpen(d.id)}>
              <td className="col-type">{d.docType}</td>
              <td className="col-doc">{d.docNo || "-"}</td>
              <td className="col-date">{fmtDate(d.dateIssued || d.dateCreated || d.createdAt)}</td>
              <td className="col-reg">{d.registration || "—"}</td>
              <td className="col-model">{[d.make, d.model].filter(Boolean).join(" ") || "—"}</td>
              <td className="col-customer">{d.customerName || "—"}</td>
              <td className="col-lab">~</td>
              <td className="col-total">{money(d.totalGross)}</td>
              <td className="col-status"><span className="status-placeholder">~ <ChevronDown size={10} /></span></td>
              <td className="col-phone">{d.phone && <Phone size={12} className="phone-placeholder" style={{ display: "inline" }} />}</td>
              <td className="col-open"><button type="button" className="open-button" onClick={(e) => { e.stopPropagation(); onOpen(d.id); }}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueuePanel({ type, rows, allCount, loading, collapsed, onCollapse, onOpen, onNew }: {
  type: "jobs" | "invoices"; rows: any[]; allCount: number; loading: boolean; collapsed: boolean;
  onCollapse: () => void; onOpen: (id: number) => void; onNew: () => void;
}) {
  const isJobs = type === "jobs";
  const [todayOnly, setTodayOnly] = useState(false);
  const shown = todayOnly ? rows.filter((d) => isToday(d.dateIssued || d.dateCreated || d.createdAt)) : rows;

  return (
    <section className={`queue-panel ${isJobs ? "jobs-panel" : "invoices-panel"} ${collapsed ? "collapsed" : ""}`}>
      <header className="panel-titlebar">
        <div><strong>{isJobs ? "Job Sheets In Progress:" : "Invoices In Progress:"}</strong> All <span>(Showing {shown.length} Record{shown.length === 1 ? "" : "s"})</span></div>
        {isJobs && (
          <button className="collapse-button" type="button" onClick={onCollapse} aria-label={collapsed ? "Expand job sheets" : "Collapse job sheets"}>
            {collapsed ? <ChevronDown size={14} /> : <><ChevronUp size={12} /><ChevronDown size={12} /></>}
          </button>
        )}
      </header>
      {!collapsed && (
        <>
          <div className="panel-actions">
            <div className="panel-actions-left">
              <BevelButton onClick={onNew}>{isJobs ? "New Job Sheet" : "New Invoice"}</BevelButton>
              <BevelButton onClick={soon("Archives")}>Archives</BevelButton>
              <BevelButton onClick={soon("Print")}>Print</BevelButton>
            </div>
            <div className="panel-actions-right">
              {isJobs ? (
                <>
                  <BevelButton onClick={soon("Print Blank JS")}>Print Blank JS</BevelButton>
                  <BevelButton onClick={soon("Print All JS")}>Print All JS</BevelButton>
                </>
              ) : (
                <BevelButton onClick={soon("New Credit")}>New Credit</BevelButton>
              )}
            </div>
          </div>
          {isJobs && (
            <div className="filter-row">
              <BevelButton className="filter-created">Created</BevelButton>
              <BevelButton onClick={soon("From date")}>From</BevelButton>
              <BevelButton onClick={soon("To date")}>To</BevelButton>
              <BevelButton className="filter-clear" onClick={soon("Clear dates")}>X</BevelButton>
              <BevelButton onClick={() => setTodayOnly((v) => !v)} className={todayOnly ? "pressed" : ""}>Today</BevelButton>
              <BevelButton className="filter-dropdown" onClick={soon("Date Range")}>Date Range <ChevronDown size={12} /></BevelButton>
              <BevelButton className="filter-dropdown" onClick={soon("Status filter")}>Status <ChevronDown size={12} /></BevelButton>
              <BevelButton className="filter-clear" onClick={soon("Clear status")}>X</BevelButton>
            </div>
          )}
          <DataTable rows={shown} loading={loading} onOpen={onOpen} />
        </>
      )}
    </section>
  );
}

function UtilityRail() {
  const [notesTab, setNotesTab] = useState<"global" | "user">("global");
  const [notes, setNotes] = useState("");
  return (
    <aside className="utility-rail">
      <section className="rail-panel reminders-panel">
        <h2>Reminders</h2>
        <div className="rail-grid">
          {["Due", "Errors", "Failed", "Expired"].map((label) => (
            <div className="rail-row" key={label}><span>{label}</span><b>—</b></div>
          ))}
        </div>
      </section>

      <section className="rail-panel stock-panel">
        <h2>Stock Order Info</h2>
        <div className="rail-grid">
          {["Required Stock", "Orders to Process", "Returns to Process", "Due Delivery"].map((label) => (
            <div className="rail-row" key={label}><span>{label}</span><b>—</b></div>
          ))}
        </div>
      </section>

      <section className="rail-panel notes-panel">
        <div className="notes-tabs" role="tablist">
          <button type="button" className={notesTab === "global" ? "active" : ""} onClick={() => setNotesTab("global")}>Global Notes</button>
          <button type="button" className={notesTab === "user" ? "active" : ""} onClick={() => setNotesTab("user")}>User Notes</button>
        </div>
        <textarea
          aria-label={notesTab === "global" ? "Global Notes" : "User Notes"}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          spellCheck={false}
        />
        <div className="notes-footer">
          <BevelButton onClick={() => toast.message("Notes aren't wired up in Classic view yet.")}>Save Notes</BevelButton>
          <button type="button" className="refresh-notes" onClick={() => setNotes("")} aria-label="Clear notes">↻</button>
        </div>
      </section>
    </aside>
  );
}

export default function Ga4Home() {
  const [, setLocation] = useLocation();
  const [jobsCollapsed, setJobsCollapsed] = useState(false);
  const { data: jobSheets, isLoading: jsLoading } = trpc.documents.list.useQuery({ docType: "JS", limit: 200, sortKey: "date", sortDir: "desc" });
  const { data: invoices, isLoading: siLoading } = trpc.documents.list.useQuery({ docType: "SI", limit: 200, sortKey: "date", sortDir: "desc" });

  const jsInProgress = useMemo(() => (jobSheets ?? []).filter((d: any) => !d.dateIssued), [jobSheets]);
  const siInProgress = useMemo(() => (invoices ?? []).filter((d: any) => !d.dateIssued), [invoices]);

  const openDoc = (id: number) => setLocation(`/classic/documents/${id}`);

  return (
    <DashboardLayout>
      <main className="workspace">
        <div className="queue-column">
          <QueuePanel
            type="jobs" rows={jsInProgress} allCount={jsInProgress.length} loading={jsLoading}
            collapsed={jobsCollapsed} onCollapse={() => setJobsCollapsed((v) => !v)}
            onOpen={openDoc} onNew={() => setLocation("/classic/documents/new?docType=JS")}
          />
          <QueuePanel
            type="invoices" rows={siInProgress} allCount={siInProgress.length} loading={siLoading}
            collapsed={false} onCollapse={() => undefined}
            onOpen={openDoc} onNew={() => setLocation("/classic/documents/new?docType=SI")}
          />
        </div>
        <UtilityRail />
      </main>
    </DashboardLayout>
  );
}
