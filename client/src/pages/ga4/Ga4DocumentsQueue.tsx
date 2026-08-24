import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { ChevronDown } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import Documents from "@/pages/Documents";
import { BevelButton, DataTable, UtilityRail, isToday, soon } from "./Ga4QueueShared";

// The Job Sheets / Estimates / Invoices top-nav links used to land on the same
// Modern-styled "Live Jobs List" dashboard regardless of Classic/Modern — jarring
// next to the GA4 chrome around it. This renders the single-doc-type equivalent of
// Ga4Home's queue panel (same titlebar/actions/filter row/table) instead, full width.
const TYPE_CONFIG: Record<string, {
  docType: string; label: string; panelClass: string;
  newLabel: string; rightActions: { label: string }[];
}> = {
  JS: { docType: "JS", label: "Job Sheets", panelClass: "jobs-panel", newLabel: "New Job Sheet", rightActions: [{ label: "Print Blank JS" }, { label: "Print All JS" }] },
  ES: { docType: "ES", label: "Estimates", panelClass: "estimates-panel", newLabel: "New Estimate", rightActions: [{ label: "Print Blank Est" }, { label: "Print All Est" }] },
  SI: { docType: "SI", label: "Invoices", panelClass: "invoices-panel", newLabel: "New Invoice", rightActions: [{ label: "New Credit" }] },
};

export default function Ga4DocumentsQueue() {
  const [, setLocation] = useLocation();
  // useSearch() (not window.location.search) so nav clicks that only change the query
  // string — Job Sheets -> Estimates -> Invoices, same /classic/documents path — actually
  // re-render this component. wouter's <Route> only remounts on path changes, so a plain
  // window.location.search read left the panel frozen on whichever doc type loaded first.
  const docType = new URLSearchParams(useSearch()).get("docType") || "";
  const config = TYPE_CONFIG[docType];
  const [todayOnly, setTodayOnly] = useState(false);

  // Hooks must run unconditionally (docType can change via search-string navigation
  // without a remount) — query is just disabled when there's no dedicated config,
  // and the Documents fallback renders after.
  const { data, isLoading } = trpc.documents.list.useQuery(
    { docType: config?.docType || "JS", limit: 200, sortKey: "date", sortDir: "desc" },
    { enabled: !!config }
  );
  // "In Progress" isn't "not yet issued" — Archives is a separate, still-unimplemented manual
  // action (the button below is a placeholder), so a doc issued today must stay visible here
  // until real archiving exists. Filtering on dateIssued was hiding every doc finished today
  // the moment staff issued it.
  const rows = useMemo(() => {
    const list = data ?? [];
    return todayOnly ? list.filter((d: any) => isToday(d.dateIssued || d.dateCreated || d.createdAt)) : list;
  }, [data, todayOnly]);
  const openDoc = (id: number) => setLocation(`/classic/documents/${id}`);

  // Archives / "all" / anything else we don't have a dedicated queue view for yet —
  // fall back to the existing (Modern-styled) documents list rather than 404.
  if (!config) return <Documents />;

  return (
    <DashboardLayout>
      <main className="workspace">
        <div className="queue-column single">
          <section className={`queue-panel ${config.panelClass}`}>
            <header className="panel-titlebar">
              <div><strong>{config.label} In Progress:</strong> All <span>(Showing {rows.length} Record{rows.length === 1 ? "" : "s"})</span></div>
            </header>
            <div className="panel-actions">
              <div className="panel-actions-left">
                <BevelButton onClick={() => setLocation(`/classic/documents/new?docType=${config.docType}`)}>{config.newLabel}</BevelButton>
                <BevelButton onClick={soon("Archives")}>Archives</BevelButton>
                <BevelButton onClick={soon("Print")}>Print</BevelButton>
              </div>
              <div className="panel-actions-right">
                {config.rightActions.map((a) => <BevelButton key={a.label} onClick={soon(a.label)}>{a.label}</BevelButton>)}
              </div>
            </div>
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
            <DataTable rows={rows} loading={isLoading} onOpen={openDoc} />
          </section>
        </div>
        <UtilityRail />
      </main>
    </DashboardLayout>
  );
}
