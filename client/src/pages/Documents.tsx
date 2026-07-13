import { useState, Fragment } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Search, Trash2, Loader2, X, ChevronUp, ChevronDown, ChevronsUpDown, GripVertical } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { RegPlate } from "@/components/RegPlate";
import { ManufacturerLogo } from "@/components/ManufacturerLogo";

const TYPE_LABEL: Record<string, string> = {
  SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note",
  XS: "Excess", PA: "Payment", VS: "Vehicle Sale", VP: "Vehicle Purchase",
};
const TYPE_COLOR: Record<string, string> = {
  SI: "bg-green-100 text-green-800", ES: "bg-blue-100 text-blue-800",
  JS: "bg-amber-100 text-amber-800", CR: "bg-red-100 text-red-800",
};
const FILTERS = [
  { key: "JS", label: "Job Sheets" },
  { key: "all", label: "All" },
  { key: "SI", label: "Invoices" },
  { key: "ES", label: "Estimates" },
  { key: "CR", label: "Credit Notes" },
];

const DATE_FILTERS = [
  { key: "", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
];
const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Monday-start week (UK convention). Range is applied against the same "effective date"
// (dateIssued, else dateCreated) as the Date column/sort — see getDocuments in server/db.ts.
function dateFilterRange(key: string): { dateFrom?: string; dateTo?: string } {
  if (!key) return {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
  switch (key) {
    case "today": return { dateFrom: toISODate(today), dateTo: toISODate(today) };
    case "yesterday": { const y = addDays(today, -1); return { dateFrom: toISODate(y), dateTo: toISODate(y) }; }
    case "thisWeek": { const mon = mondayOf(today); return { dateFrom: toISODate(mon), dateTo: toISODate(addDays(mon, 6)) }; }
    case "lastWeek": { const mon = mondayOf(addDays(today, -7)); return { dateFrom: toISODate(mon), dateTo: toISODate(addDays(mon, 6)) }; }
    default: return {};
  }
}

// Drag-to-reorder columns — "type" only ever shows on the "All" tab (see docType checks below),
// but stays in the saved order so it lands back where you put it when All is selected again.
type ColKey = "docNo" | "type" | "date" | "customer" | "reg" | "vehicle" | "job" | "total" | "balance" | "status";
const DEFAULT_COLUMN_ORDER: ColKey[] = ["docNo", "type", "date", "customer", "reg", "vehicle", "job", "total", "balance", "status"];
const COLUMN_ORDER_KEY = "eli.docColumnOrder";
function loadColumnOrder(): ColKey[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_ORDER_KEY) || "null");
    if (Array.isArray(saved)) {
      // Reconcile against the current column set — drop stale keys, append any new ones so a
      // future column addition doesn't just silently vanish for someone with a saved order.
      const kept = saved.filter((k): k is ColKey => DEFAULT_COLUMN_ORDER.includes(k));
      const missing = DEFAULT_COLUMN_ORDER.filter((k) => !kept.includes(k));
      if (kept.length) return [...kept, ...missing];
    }
  } catch { /* ignore corrupt localStorage */ }
  return DEFAULT_COLUMN_ORDER;
}

// label/align/sort-column for each header — sortCol is the key `documents.list` accepts, undefined
// for columns (Job) that have no server-side sort.
const COLUMN_META: Record<ColKey, { label: string; align?: "right"; sortCol?: string }> = {
  docNo: { label: "Doc No", sortCol: "docNo" },
  type: { label: "Type", sortCol: "type" },
  date: { label: "Date", sortCol: "date" },
  customer: { label: "Customer", sortCol: "customer" },
  reg: { label: "Reg", sortCol: "registration" },
  vehicle: { label: "Vehicle", sortCol: "vehicle" },
  job: { label: "Job" },
  total: { label: "Total", align: "right", sortCol: "total" },
  balance: { label: "Balance", align: "right", sortCol: "balance" },
  status: { label: "Status", sortCol: "status" },
};

const money = (v: string | number | null) =>
  v == null ? "-" : `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");

// Colour-coded work types detected from a job's free-text notes, so you recognise what a car's
// in for by colour at a glance. Anything not matched shows as a short grey summary.
const WORK_TYPES: { label: string; re: RegExp; cls: string }[] = [
  { label: "MOT", re: /\bmot\b/i, cls: "bg-blue-100 text-blue-700" },
  { label: "SERVICE", re: /\bservice\b/i, cls: "bg-emerald-100 text-emerald-700" },
  { label: "TYRES", re: /\btyres?\b|\bpuncture\b/i, cls: "bg-amber-100 text-amber-800" },
  { label: "BRAKES", re: /\bbrakes?\b|\bpads?\b|\bdiscs?\b/i, cls: "bg-red-100 text-red-700" },
  { label: "CLUTCH", re: /\bclutch\b/i, cls: "bg-purple-100 text-purple-700" },
  { label: "AIRCON", re: /air ?con|\ba\/c\b|re-?gas|condenser/i, cls: "bg-cyan-100 text-cyan-700" },
  { label: "BATTERY", re: /\bbatter/i, cls: "bg-yellow-100 text-yellow-800" },
  { label: "CAMBELT", re: /cam ?belt|timing (belt|chain)/i, cls: "bg-orange-100 text-orange-700" },
  { label: "EXHAUST", re: /\bexhaust\b|\bdpf\b/i, cls: "bg-stone-200 text-stone-700" },
  { label: "DIAGNOSTIC", re: /diagnos|investigat|warning light|\bfault\b|\bepc\b/i, cls: "bg-indigo-100 text-indigo-700" },
  { label: "RECOVERY", re: /recover/i, cls: "bg-rose-100 text-rose-700" },
  { label: "SUSPENSION", re: /suspension|shock absorber|\bwishbone\b/i, cls: "bg-teal-100 text-teal-700" },
];
const workSummary = (desc?: string | null): { badges: { label: string; cls: string }[]; summary: string } | null => {
  if (!desc) return null;
  const text = desc.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const badges: { label: string; cls: string }[] = [];
  for (const wt of WORK_TYPES) if (wt.re.test(text)) badges.push({ label: wt.label, cls: wt.cls });
  // keep the readable detail; only strip the generic MOT/Service filler so it isn't duplicated by the badge
  const rest = text
    .replace(/\bcarry out\b/gi, "")
    .replace(/\bmot\b/gi, "")
    .replace(/\b(small|full|major|interim|main|annual)?\s*service\b/gi, "")
    .replace(/^[\s\-–—•,.:()]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const summary = rest.length > 2 ? (rest.length > 46 ? rest.slice(0, 44).replace(/\s+\S*$/, "") + "…" : rest) : "";
  return { badges, summary };
};

export default function Documents() {
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState("JS");
  const [dateFilter, setDateFilter] = useState("");
  const { dateFrom, dateTo } = dateFilterRange(dateFilter);
  const [, setLocation] = useLocation();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const utils = trpc.useUtils();

  // click a column header to sort; click the active one again to flip direction
  const sortBy = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Drag a column header's grip handle to reorder — persisted per-browser so it sticks on reload.
  const [columnOrder, setColumnOrder] = useState<ColKey[]>(loadColumnOrder);
  const [draggedCol, setDraggedCol] = useState<ColKey | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColKey | null>(null);
  const reorderColumns = (from: ColKey, to: ColKey) => {
    if (from === to) return;
    setColumnOrder((cols) => {
      const next = cols.filter((c) => c !== from);
      next.splice(next.indexOf(to), 0, from);
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  };

  const { data: stats } = trpc.documents.stats.useQuery();
  const { data: docs, isLoading } = trpc.documents.list.useQuery({ search, docType, limit: 200, sortKey, sortDir, dateFrom, dateTo });
  const { data: addrStats } = trpc.documents.addressLookupStats.useQuery();
  const del = trpc.documents.delete.useMutation();

  const typeCount = (code: string) => stats?.byType.find((t) => t.docType === code)?.n ?? 0;

  const rows: any[] = docs ?? [];
  const allSelected = rows.length > 0 && rows.every((d) => selected.has(d.id));
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (rows.every((d) => s.has(d.id)) ? new Set() : new Set(rows.map((d) => d.id))));
  const clearSel = () => setSelected(new Set());

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} document${ids.length === 1 ? "" : "s"}? This permanently removes them and their line items & payments. This cannot be undone.`)) return;
    try {
      await del.mutateAsync({ ids });
      await Promise.all([utils.documents.list.invalidate(), utils.documents.stats.invalidate()]);
      clearSel();
      toast.success(`Deleted ${ids.length} document${ids.length === 1 ? "" : "s"}`);
    } catch (e: any) { toast.error("Delete failed: " + (e.message || "")); }
  }

  // "Type" is redundant once filtered to a single doc type — every row would say the same thing.
  const visibleColumns = columnOrder.filter((k) => k !== "type" || docType === "all");

  function renderCell(key: ColKey, d: any) {
    switch (key) {
      case "docNo":
        return <TableCell className="font-medium">{d.ga4Number || d.docNo || "-"}</TableCell>;
      case "type":
        return (
          <TableCell>
            <Badge variant="secondary" className={TYPE_COLOR[d.docType] || ""}>
              {TYPE_LABEL[d.docType] || d.docType || "?"}
            </Badge>
          </TableCell>
        );
      case "date":
        return <TableCell>{fmtDate(d.dateIssued || d.dateCreated || d.createdAt)}</TableCell>;
      case "customer":
        return (
          <TableCell className="max-w-[200px]">
            <div className="truncate uppercase">{d.customerName || <span className="text-muted-foreground">—</span>}</div>
            {d.phone && (
              <div
                title={d.phone}
                onClick={(e) => e.stopPropagation()}
                className="w-fit max-w-full origin-bottom-left cursor-text truncate rounded text-[11px] text-muted-foreground transition-transform duration-150 hover:relative hover:z-40 hover:-translate-y-2 hover:scale-[1.9] hover:cursor-none hover:rounded-md hover:border hover:bg-white hover:px-1.5 hover:py-0.5 hover:font-semibold hover:text-slate-900 hover:shadow-lg"
              >
                {d.phone}
              </div>
            )}
          </TableCell>
        );
      case "reg":
        return <TableCell>{d.registration ? <RegPlate reg={d.registration} /> : <span className="text-muted-foreground">—</span>}</TableCell>;
      case "vehicle":
        return (
          <TableCell className="max-w-[200px] text-sm text-slate-600">
            {d.make || d.model ? (
              <div className="flex items-center gap-1.5" title={[d.make, d.model].filter(Boolean).join(" ")}>
                <ManufacturerLogo make={d.make} size="sm" />
                <span className="min-w-0 flex-1 truncate">{[d.make, d.model].filter(Boolean).join(" ")}</span>
              </div>
            ) : <span className="text-muted-foreground">—</span>}
          </TableCell>
        );
      case "job":
        return (
          <TableCell className="max-w-[180px]">
            {(() => {
              const w = workSummary(d.description);
              if (!w || (w.badges.length === 0 && !w.summary)) return <span className="text-muted-foreground">—</span>;
              return (
                <div className="flex flex-wrap items-center gap-1" title={d.description || undefined}>
                  {w.badges.map((b) => (
                    <span key={b.label} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span>
                  ))}
                  {w.summary && <span className="truncate text-[11px] text-slate-500">{w.summary}</span>}
                </div>
              );
            })()}
          </TableCell>
        );
      case "total":
        return <TableCell className="text-right">{money(d.totalGross)}</TableCell>;
      case "balance":
        return (
          <TableCell className="text-right">
            {d.balance != null && Number(d.balance) > 0
              ? <span className="text-red-600 font-medium">{money(d.balance)}</span>
              : money(d.balance)}
          </TableCell>
        );
      case "status":
        return <TableCell><span className="text-xs text-muted-foreground">{d.docStatus || "-"}</span></TableCell>;
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Documents</h1>
            <p className="text-muted-foreground mt-2">
              Job sheets, invoices, estimates &amp; credit notes
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button onClick={() => setLocation("/documents/new")} className="gap-2">
              <FileText className="w-4 h-4" /> New Job Sheet
            </Button>
            {addrStats && (
              <span className="text-xs text-muted-foreground" title="Ideal Postcodes credits used (≈4p each)">
                Address lookups: <b className="text-foreground">{addrStats.thisMonth}</b> this month · {addrStats.total} total{addrStats.total ? ` (≈£${(addrStats.total * 0.04).toFixed(2)})` : ""}
              </span>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total" value={stats?.total} />
          <StatCard label="Invoices" value={typeCount("SI")} />
          <StatCard label="Estimates" value={typeCount("ES")} />
          <StatCard label="Job Sheets" value={typeCount("JS")} />
          <StatCard label="Credit Notes" value={typeCount("CR")} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" /> Live Jobs List
            </CardTitle>
            <CardDescription>Search anything — customer, name, surname, address, registration, make/model or job number — then pick a result to view it</CardDescription>
            <div className="flex flex-col gap-3 pt-3">
              {/* Filters the table below (respecting whichever tab is active) as you type — this is
                  NOT the global cross-system search (that's UniversalSearch, in the top nav). */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customers, vehicles, registrations, jobs…"
                  className="w-full h-10 pl-9 pr-9 rounded-lg border border-slate-300 bg-white text-[14px] outline-none focus:border-violet-500"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Tabs value={docType} onValueChange={setDocType} className="flex-1 min-w-0">
                  <TabsList className="w-full">
                    {FILTERS.map((f) => (
                      <TabsTrigger key={f.key} value={f.key} className="flex-1">{f.label}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
                  className="h-9 shrink-0 rounded-md border border-input bg-white px-2.5 text-sm outline-none focus:border-violet-500">
                  {DATE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selected.size > 0 && (
              <div className="flex items-center justify-between gap-2 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <span className="text-sm font-medium text-red-800">{selected.size} selected</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={clearSel}><X className="w-4 h-4 mr-1" /> Clear</Button>
                  <Button variant="destructive" size="sm" onClick={deleteSelected} disabled={del.isPending}>
                    {del.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />} Delete{selected.size > 1 ? ` (${selected.size})` : ""}
                  </Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} className="accent-violet-600 w-4 h-4 align-middle cursor-pointer" />
                    </TableHead>
                    {visibleColumns.map((key) => {
                      const meta = COLUMN_META[key];
                      return (
                        <TableHead
                          key={key}
                          draggable
                          onDragStart={() => setDraggedCol(key)}
                          onDragEnter={() => draggedCol && draggedCol !== key && setDragOverCol(key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.preventDefault(); if (draggedCol) reorderColumns(draggedCol, key); setDraggedCol(null); setDragOverCol(null); }}
                          onDragEnd={() => { setDraggedCol(null); setDragOverCol(null); }}
                          className={`${meta.align === "right" ? "text-right" : ""} cursor-grab active:cursor-grabbing ${dragOverCol === key ? "bg-violet-100" : ""} ${draggedCol === key ? "opacity-40" : ""}`}
                          title="Drag to reorder columns"
                        >
                          <div className={`flex items-center gap-1 ${meta.align === "right" ? "flex-row-reverse" : ""}`}>
                            <GripVertical className="w-3 h-3 text-slate-300 shrink-0" />
                            {meta.sortCol
                              ? <SortButton label={meta.label} col={meta.sortCol} align={meta.align} {...{ sortKey, sortDir, sortBy }} />
                              : <span>{meta.label}</span>}
                          </div>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  )}
                  {!isLoading && (docs?.length ?? 0) === 0 && (
                    <TableRow><TableCell colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted-foreground">No documents found</TableCell></TableRow>
                  )}
                  {docs?.map((d: any) => (
                    <TableRow key={d.id} className={`cursor-pointer hover:bg-muted/50 ${selected.has(d.id) ? "bg-violet-50" : ""}`} onClick={() => setLocation(`/documents/${d.id}`)}>
                      <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${d.docNo || d.id}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="accent-violet-600 w-4 h-4 align-middle cursor-pointer" />
                      </TableCell>
                      {visibleColumns.map((key) => <Fragment key={key}>{renderCell(key, d)}</Fragment>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {(docs?.length ?? 0) >= 200 && (
              <p className="text-xs text-muted-foreground mt-3">Showing first 200 — refine your search to narrow results.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

// The sortable button that goes INSIDE a header cell — the cell itself (with its drag handle) is
// rendered by the caller so every column, sortable or not, shares one drag-to-reorder wrapper.
function SortButton({ label, col, sortKey, sortDir, sortBy, align }: { label: string; col: string; sortKey: string; sortDir: "asc" | "desc"; sortBy: (k: string) => void; align?: "right" }) {
  const active = sortKey === col;
  return (
    <button
      onClick={() => sortBy(col)}
      className={`inline-flex items-center gap-1 cursor-pointer select-none hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-foreground font-semibold" : ""}`}
      title={`Sort by ${label}`}
    >
      {label}
      {active ? (sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />) : <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />}
    </button>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <p className="text-xl sm:text-2xl font-bold whitespace-nowrap tabular-nums">{value?.toLocaleString("en-GB") ?? "—"}</p>
        <p className="text-xs text-muted-foreground whitespace-nowrap">{label}</p>
      </CardContent>
    </Card>
  );
}
