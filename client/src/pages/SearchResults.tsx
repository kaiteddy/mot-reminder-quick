import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Search, User, Car, FileText, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { RegPlate } from "@/components/RegPlate";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const DOC_LABEL: Record<string, string> = { SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note", XS: "Excess", PA: "Purchase", VS: "Sale" };

type Col = { key: string; label: string; sortable?: boolean; sortVal?: (r: any) => any; cell: (r: any) => React.ReactNode; className?: string };

// A compact, click-to-sort table. Each column supplies a cell renderer and (optionally) a value to
// sort on. Rows are clickable; cells with their own buttons stopPropagation so they don't open the row.
function DataTable({ rows, columns, onRowClick, getKey, initialKey }: { rows: any[]; columns: Col[]; onRowClick: (r: any) => void; getKey: (r: any) => string; initialKey?: string }) {
  const [sortKey, setSortKey] = useState(initialKey || columns[0].key);
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey) || columns[0];
    const val = (r: any) => (col.sortVal ? col.sortVal(r) : "");
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const n = (typeof va === "number" && typeof vb === "number") ? va - vb : String(va).toLowerCase().localeCompare(String(vb).toLowerCase());
      return dir === "asc" ? n : -n;
    });
  }, [rows, sortKey, dir, columns]);

  const toggle = (key: string) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir("asc"); }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50 hover:bg-slate-50">
          {columns.map((c) => (
            <TableHead key={c.key} onClick={c.sortable ? () => toggle(c.key) : undefined}
              className={`text-[11px] uppercase tracking-wide text-slate-500 ${c.sortable ? "cursor-pointer select-none hover:text-slate-800" : ""} ${c.className || ""}`}>
              <span className="inline-flex items-center gap-1">{c.label}
                {c.sortable && sortKey === c.key && (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={getKey(r)} className="cursor-pointer hover:bg-violet-50/50" onClick={() => onRowClick(r)}>
            {columns.map((c) => <TableCell key={c.key} className={`align-middle ${c.className || ""}`}>{c.cell(r)}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Full-page results for the header search — everything matching, in sortable columns.
export default function SearchResults() {
  const [, setLocation] = useLocation();
  const q = useMemo(() => new URLSearchParams(window.location.search).get("q")?.trim() || "", []);
  const go = (path: string) => setLocation(path);

  const res = trpc.documents.globalSearch.useQuery({ query: q, full: true }, { enabled: q.length >= 2, staleTime: 30_000 });
  const data = res.data as any;
  const counts = data ? { c: data.customers.length, v: data.vehicles.length, d: data.documents.length } : { c: 0, v: 0, d: 0 };
  const total = counts.c + counts.v + counts.d;

  const plateRow = (vehicles: any[]) => (
    <div className="flex flex-wrap gap-1">
      {vehicles.map((v: any) => (
        <button key={v.registration} type="button" title={`Open ${v.registration}`}
          onClick={(e) => { e.stopPropagation(); go(`/view-vehicle/${encodeURIComponent(v.registration)}`); }}
          className="transition-transform hover:scale-105"><RegPlate reg={v.registration} size="xs" /></button>
      ))}
    </div>
  );

  const customerCols: Col[] = [
    { key: "name", label: "Name", sortable: true, sortVal: (c) => c.name || "", cell: (c) => <span className="font-medium text-slate-800 whitespace-nowrap">{c.name}</span> },
    { key: "phone", label: "Phone", sortable: true, sortVal: (c) => c.phone || "", cell: (c) => <span className="font-mono text-[12px] text-slate-600">{c.phone || "—"}</span> },
    { key: "postcode", label: "Postcode", sortable: true, sortVal: (c) => c.postcode || "", cell: (c) => <span className="text-slate-600 whitespace-nowrap">{c.postcode || "—"}</span> },
    { key: "address", label: "Address", sortable: true, sortVal: (c) => c.address || "", cell: (c) => <span className="text-slate-500 block truncate max-w-[280px]" title={c.address || ""}>{c.address || "—"}</span> },
    { key: "vehicles", label: "Vehicles", sortable: true, sortVal: (c) => (c.vehicles?.length || 0), cell: (c) => c.vehicles?.length ? plateRow(c.vehicles) : <span className="text-slate-400">—</span> },
  ];
  const vehicleCols: Col[] = [
    { key: "reg", label: "Registration", sortable: true, sortVal: (v) => v.registration || "", cell: (v) => <RegPlate reg={v.registration} /> },
    { key: "vehicle", label: "Make / Model", sortable: true, sortVal: (v) => [v.make, v.model].filter(Boolean).join(" "), cell: (v) => <span className="text-slate-700">{[v.make, v.model].filter(Boolean).join(" ") || "—"}</span> },
    { key: "owner", label: "Owner", sortable: true, sortVal: (v) => v.ownerName || "", cell: (v) => <span className="text-slate-600">{v.ownerName || "—"}</span> },
  ];
  const docCols: Col[] = [
    { key: "type", label: "Type", sortable: true, sortVal: (d) => DOC_LABEL[d.docType] || d.docType || "", cell: (d) => <span className="font-medium text-slate-700">{DOC_LABEL[d.docType] || d.docType || "Doc"}</span> },
    { key: "no", label: "No.", sortable: true, sortVal: (d) => d.docNo || "", cell: (d) => <span className="font-mono text-[12px] text-slate-600">{d.docNo || "—"}</span> },
    { key: "reg", label: "Reg", sortable: true, sortVal: (d) => d.registration || "", cell: (d) => d.registration ? <RegPlate reg={d.registration} size="xs" /> : <span className="text-slate-400">—</span> },
    { key: "customer", label: "Customer", sortable: true, sortVal: (d) => d.customerName || "", cell: (d) => <span className="text-slate-700">{d.customerName || "—"}</span> },
    { key: "date", label: "Date", sortable: true, sortVal: (d) => d.date ? new Date(d.date).getTime() : 0, cell: (d) => <span className="text-slate-600 whitespace-nowrap">{d.date ? new Date(d.date).toLocaleDateString("en-GB") : "—"}</span> },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Search className="h-5 w-5" /></span>
            Search results
          </h1>
          {q && <p className="text-muted-foreground mt-1 text-sm">{res.isFetching && !data ? "Searching" : `${total} match${total === 1 ? "" : "es"}`} for <span className="font-medium text-slate-700">“{q}”</span></p>}
        </div>

        {q.length < 2 && <p className="text-sm text-muted-foreground">Type at least 2 characters in the search bar.</p>}
        {res.isFetching && !data && <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Searching…</div>}
        {data && total === 0 && <div className="py-12 text-center text-slate-400">No matches for “{q}”.</div>}

        {counts.c > 0 && (
          <Section title="Customers" count={counts.c} icon={<User className="w-4 h-4 text-violet-600" />}>
            <DataTable rows={data.customers} columns={customerCols} getKey={(c) => "c" + c.id} onRowClick={(c) => go(`/customers/${c.id}`)} />
          </Section>
        )}
        {counts.v > 0 && (
          <Section title="Vehicles" count={counts.v} icon={<Car className="w-4 h-4 text-sky-600" />}>
            <DataTable rows={data.vehicles} columns={vehicleCols} getKey={(v) => "v" + v.id} initialKey="reg" onRowClick={(v) => go(`/view-vehicle/${encodeURIComponent(v.registration)}`)} />
          </Section>
        )}
        {counts.d > 0 && (
          <Section title="Live Jobs" count={counts.d} icon={<FileText className="w-4 h-4 text-slate-500" />}>
            <DataTable rows={data.documents} columns={docCols} getKey={(d) => "d" + d.id} initialKey="date" onRowClick={(d) => go(`/documents/${d.id}`)} />
          </Section>
        )}
      </div>
    </DashboardLayout>
  );
}

function Section({ title, count, icon, children }: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        {icon}<span className="text-[13px] font-semibold text-slate-700">{title}</span>
        <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600">{count}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
