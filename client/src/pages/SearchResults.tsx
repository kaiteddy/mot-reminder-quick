import { useMemo } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Search, User, Car, FileText, Loader2 } from "lucide-react";
import { RegPlate } from "@/components/RegPlate";

const DOC_LABEL: Record<string, string> = { SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note", XS: "Excess", PA: "Purchase", VS: "Sale" };

// Full-page results for the header search — everything matching the query (not the capped dropdown).
export default function SearchResults() {
  const [, setLocation] = useLocation();
  const q = useMemo(() => new URLSearchParams(window.location.search).get("q")?.trim() || "", []);

  const res = trpc.documents.globalSearch.useQuery({ query: q, full: true }, { enabled: q.length >= 2, staleTime: 30_000 });
  const data = res.data as any;
  const counts = data ? { c: data.customers.length, v: data.vehicles.length, d: data.documents.length } : { c: 0, v: 0, d: 0 };
  const total = counts.c + counts.v + counts.d;
  const go = (path: string) => setLocation(path);

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-5xl">
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
            {data.customers.map((c: any) => (
              <div key={"c" + c.id} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/50">
                <button type="button" onClick={() => go(`/customers/${c.id}`)} className="w-full flex items-start gap-3 px-4 pt-2.5 pb-1 text-left">
                  <User className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-slate-800">{c.name}</span>
                    {[c.phone, c.postcode, c.address].filter(Boolean).length > 0 && (
                      <span className="block text-[12px] text-slate-500">{[c.phone, c.postcode, c.address].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                </button>
                {c.vehicles?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5 pl-[40px]">
                    {c.vehicles.map((v: any) => (
                      <button key={v.registration} type="button"
                        onClick={(e) => { e.stopPropagation(); go(`/view-vehicle/${encodeURIComponent(v.registration)}`); }}
                        title={`Open ${v.registration}${[v.make, v.model].filter(Boolean).length ? ` — ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}`}
                        className="transition-transform hover:scale-105">
                        <RegPlate reg={v.registration} size="xs" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {counts.v > 0 && (
          <Section title="Vehicles" count={counts.v} icon={<Car className="w-4 h-4 text-sky-600" />}>
            {data.vehicles.map((v: any) => (
              <button key={"v" + v.id} type="button" onClick={() => go(`/view-vehicle/${encodeURIComponent(v.registration)}`)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-violet-50/50 border-b border-slate-100 last:border-0">
                <Car className="w-4 h-4 text-sky-600 shrink-0" />
                <RegPlate reg={v.registration} />
                <span className="text-[13px] text-slate-600 truncate">{[[v.make, v.model].filter(Boolean).join(" "), v.ownerName].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </Section>
        )}

        {counts.d > 0 && (
          <Section title="Live Jobs" count={counts.d} icon={<FileText className="w-4 h-4 text-slate-500" />}>
            {data.documents.map((d: any) => (
              <button key={"d" + d.id} type="button" onClick={() => go(`/documents/${d.id}`)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-violet-50/50 border-b border-slate-100 last:border-0">
                <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="text-[13px] font-medium text-slate-800">{`${DOC_LABEL[d.docType] || d.docType || "Doc"} ${d.docNo || ""}`.trim()}</span>
                {d.registration && <RegPlate reg={d.registration} size="xs" />}
                <span className="text-[12px] text-slate-500 truncate">{[d.customerName, d.accountNumber].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
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
      <div>{children}</div>
    </div>
  );
}
