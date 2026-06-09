import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Trash2, Loader2, X, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import UniversalSearch from "@/components/UniversalSearch";

const TYPE_LABEL: Record<string, string> = {
  SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note",
  XS: "Excess", PA: "Payment", VS: "Vehicle Sale", VP: "Vehicle Purchase",
};
const TYPE_COLOR: Record<string, string> = {
  SI: "bg-green-100 text-green-800", ES: "bg-blue-100 text-blue-800",
  JS: "bg-amber-100 text-amber-800", CR: "bg-red-100 text-red-800",
};
const FILTERS = [
  { key: "all", label: "All" },
  { key: "SI", label: "Invoices" },
  { key: "ES", label: "Estimates" },
  { key: "JS", label: "Job Sheets" },
  { key: "CR", label: "Credit Notes" },
];

const money = (v: string | number | null) =>
  v == null ? "-" : `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");

export default function Documents() {
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState("all");
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

  const { data: stats } = trpc.documents.stats.useQuery();
  const { data: docs, isLoading } = trpc.documents.list.useQuery({ search, docType, limit: 200, sortKey, sortDir });
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
            <div className="flex flex-col sm:flex-row gap-3 pt-3">
              <div className="relative flex-1">
                <UniversalSearch placeholder="Search customers, vehicles, registrations, jobs…" />
              </div>
              <div className="flex gap-2 flex-wrap">
                {FILTERS.map((f) => (
                  <Button
                    key={f.key}
                    variant={docType === f.key ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDocType(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
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
                    <SortHead label="Doc No" col="docNo" {...{ sortKey, sortDir, sortBy }} />
                    <SortHead label="Type" col="type" {...{ sortKey, sortDir, sortBy }} />
                    <SortHead label="Date" col="date" {...{ sortKey, sortDir, sortBy }} />
                    <SortHead label="Customer" col="customer" {...{ sortKey, sortDir, sortBy }} />
                    <SortHead label="Vehicle" col="vehicle" {...{ sortKey, sortDir, sortBy }} />
                    <SortHead label="Total" col="total" align="right" {...{ sortKey, sortDir, sortBy }} />
                    <SortHead label="Balance" col="balance" align="right" {...{ sortKey, sortDir, sortBy }} />
                    <SortHead label="Status" col="status" {...{ sortKey, sortDir, sortBy }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  )}
                  {!isLoading && (docs?.length ?? 0) === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No documents found</TableCell></TableRow>
                  )}
                  {docs?.map((d: any) => (
                    <TableRow key={d.id} className={`cursor-pointer hover:bg-muted/50 ${selected.has(d.id) ? "bg-violet-50" : ""}`} onClick={() => setLocation(`/documents/${d.id}`)}>
                      <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${d.docNo || d.id}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="accent-violet-600 w-4 h-4 align-middle cursor-pointer" />
                      </TableCell>
                      <TableCell className="font-medium">{d.docNo || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={TYPE_COLOR[d.docType] || ""}>
                          {TYPE_LABEL[d.docType] || d.docType || "?"}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDate(d.dateIssued || d.dateCreated)}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{d.customerName || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <span className="font-mono">{d.registration || "—"}</span>
                        {d.make && <span className="text-muted-foreground text-xs ml-1">{d.make} {d.model}</span>}
                      </TableCell>
                      <TableCell className="text-right">{money(d.totalGross)}</TableCell>
                      <TableCell className="text-right">
                        {d.balance != null && Number(d.balance) > 0
                          ? <span className="text-red-600 font-medium">{money(d.balance)}</span>
                          : money(d.balance)}
                      </TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{d.docStatus || "-"}</span></TableCell>
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

function SortHead({ label, col, sortKey, sortDir, sortBy, align }: { label: string; col: string; sortKey: string; sortDir: "asc" | "desc"; sortBy: (k: string) => void; align?: "right" }) {
  const active = sortKey === col;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        onClick={() => sortBy(col)}
        className={`inline-flex items-center gap-1 cursor-pointer select-none hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-foreground font-semibold" : ""}`}
        title={`Sort by ${label}`}
      >
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />) : <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />}
      </button>
    </TableHead>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-bold">{value?.toLocaleString("en-GB") ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
