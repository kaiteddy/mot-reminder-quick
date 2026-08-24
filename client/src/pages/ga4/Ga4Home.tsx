import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ChevronUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { BevelButton, DataTable, UtilityRail, isToday, soon } from "./Ga4QueueShared";

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

export default function Ga4Home() {
  const [, setLocation] = useLocation();
  const [jobsCollapsed, setJobsCollapsed] = useState(false);
  const { data: jobSheets, isLoading: jsLoading } = trpc.documents.list.useQuery({ docType: "JS", limit: 200, sortKey: "date", sortDir: "desc" });
  const { data: invoices, isLoading: siLoading } = trpc.documents.list.useQuery({ docType: "SI", limit: 200, sortKey: "date", sortDir: "desc" });

  // "In Progress" isn't "not yet issued" — Archives is a separate, still-unimplemented manual
  // action (the button above is a placeholder), so a doc issued today must stay visible here
  // until real archiving exists. Filtering on dateIssued was hiding every invoice/job sheet
  // finished today the moment staff issued it.
  const jsInProgress = jobSheets ?? [];
  const siInProgress = invoices ?? [];

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
