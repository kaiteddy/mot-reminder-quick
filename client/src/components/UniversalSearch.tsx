import { useState, useRef, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Search, Loader2, User, Car, FileText, X } from "lucide-react";
import { RegPlate } from "./RegPlate";
import { DOC_TYPE_TAILWIND, DOC_TYPE_ICON_CLASS, groupByDocType } from "@/lib/docType";
import { workSummary } from "@/lib/workSummary";

const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

// Multiple matching documents for the same car repeat its reg/make/customer on every row —
// group them under one vehicle header (same pattern as the Customers group's plate chips) so
// the reg/owner reads once and each doc just adds its type/number/date underneath.
function groupDocuments(docs: any[]) {
  const groups: { key: string; registration: string | null; vehicleLabel: string; customerName: string; customerPhone: string; docs: any[] }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const d of docs) {
    const key = d.registration ? `r:${String(d.registration).toUpperCase().replace(/\s+/g, "")}` : `d:${d.id}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, registration: d.registration || null, vehicleLabel: [d.make, d.model].filter(Boolean).join(" "), customerName: d.customerName || "", customerPhone: d.customerPhone || "", docs: [] };
      byKey.set(key, g); groups.push(g);
    }
    if (!g.customerPhone && d.customerPhone) g.customerPhone = d.customerPhone;
    g.docs.push(d);
  }
  return groups;
}

// Omni-search across customers, vehicles and jobs. Type a name/surname, phone, address,
// registration, make/model, doc number or account number → pick a result to view it.
export default function UniversalSearch({ placeholder = "Search customers, vehicles, registrations, jobs…", autoFocus }: { placeholder?: string; autoFocus?: boolean }) {
  const [, setLocation] = useLocation();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 220); return () => clearTimeout(t); }, [term]);

  const res = trpc.documents.globalSearch.useQuery({ query: debounced }, { enabled: debounced.length >= 2, staleTime: 30_000 });
  const data = res.data as any;
  const hasResults = data && (data.customers.length || data.vehicles.length || data.documents.length);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, []);

  const go = (path: string) => { setOpen(false); setTerm(""); setDebounced(""); setLocation(path); };

  return (
    <div ref={wrapRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input value={term} autoFocus={autoFocus}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => term.trim().length >= 2 && setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" && term.trim().length >= 2) go(`/search?q=${encodeURIComponent(term.trim())}`); }}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-9 rounded-lg border border-slate-300 bg-white text-[14px] outline-none focus:border-violet-500" />
      {term && <button type="button" onClick={() => { setTerm(""); setDebounced(""); setOpen(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}

      {open && debounced.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl">
          {res.isFetching && !data && <div className="p-4 text-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Searching…</div>}
          {data && !hasResults && <div className="p-4 text-center text-slate-400 text-sm">No matches for “{debounced}”.</div>}

          {data?.customers?.length > 0 && (
            <Group title="Customers">
              {data.customers.map((c: any) => (
                <div key={"c" + c.id} className="border-b border-slate-50 last:border-0 hover:bg-violet-50">
                  {/* name/details → the customer record */}
                  <button type="button" onClick={() => go(`/customers/${c.id}`)} className="w-full flex items-start gap-2.5 px-3 pt-2 pb-0.5 text-left">
                    <span className="shrink-0 mt-0.5"><User className="w-4 h-4 text-violet-600" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-slate-800 truncate">{c.name}</span>
                      {[c.phone, c.postcode, c.address].filter(Boolean).length > 0 && (
                        <span className="block text-[11px] text-slate-500 truncate">{[c.phone, c.postcode, c.address].filter(Boolean).join(" · ")}</span>
                      )}
                    </span>
                  </button>
                  {/* each plate → that vehicle's record */}
                  {c.vehicles?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 px-3 pb-2 pl-[30px]">
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
            </Group>
          )}
          {data?.vehicles?.length > 0 && (
            <Group title="Vehicles">
              {data.vehicles.map((v: any) => (
                <Item key={"v" + v.id} icon={<Car className="w-4 h-4 text-sky-600" />} onClick={() => go(`/view-vehicle/${encodeURIComponent(v.registration)}`)}
                  main={<RegPlate reg={v.registration} />}
                  sub={<>
                    {(v.make || v.model) && <span className="block truncate">{[v.make, v.model].filter(Boolean).join(" ")}</span>}
                    {(v.ownerName || v.ownerPhone) && (
                      <span className="block truncate text-slate-400">
                        {[v.ownerName, v.ownerPhone].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </>} />
              ))}
            </Group>
          )}
          {data?.documents?.length > 0 && (
            // Not just "Live Jobs" — matches can be issued invoices, old credit notes, anything
            // — so this group is titled the same as Classic's Quick Search: Documents.
            <Group title="Documents">
              {groupDocuments(data.documents).map((g) => (
                <div key={g.key} className="border-b border-slate-50 last:border-0">
                  <div className="px-3 pt-2 pb-1">
                    <div className="flex items-center gap-2">
                      {g.registration && <RegPlate reg={g.registration} size="xs" />}
                      {g.vehicleLabel && <span className="min-w-0 flex-1 text-[12px] text-slate-700 truncate">{g.vehicleLabel}</span>}
                    </div>
                    {(g.customerName || g.customerPhone) && (
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {g.customerName && <span className="font-medium text-slate-600">{g.customerName}</span>}
                        {g.customerName && g.customerPhone && <span className="text-slate-300"> · </span>}
                        {g.customerPhone && <span>{g.customerPhone}</span>}
                      </div>
                    )}
                  </div>
                  <div className="pb-1.5">
                    {groupByDocType(g.docs).map((tg) => (
                      <div key={tg.type}>
                        <div className="pl-[30px] pr-3 pt-1 pb-1">
                          <span className={`inline-block text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${DOC_TYPE_TAILWIND[tg.type] || "bg-slate-100 text-slate-500"}`}>{tg.label}</span>
                        </div>
                        {tg.docs.map((d) => {
                          const w = workSummary(d.description);
                          return (
                            <button key={d.id} type="button" onClick={() => go(`/documents/${d.id}`)}
                              className="w-full flex flex-col gap-1 pl-[30px] pr-3 py-1.5 text-left hover:bg-violet-50">
                              <span className="flex items-center gap-2">
                                <FileText className={`w-3.5 h-3.5 shrink-0 ${DOC_TYPE_ICON_CLASS[d.docType || ""] || "text-slate-400"}`} />
                                <span className="min-w-0 flex-1 text-[13px] text-slate-800 truncate">{d.ga4Number || d.docNo || ""}</span>
                                <span className="shrink-0 text-[11px] text-slate-400">{fmtDate(d.dateIssued || d.date)}</span>
                              </span>
                              {w && (w.badges.length > 0 || w.summary) && (
                                <span className="flex items-center gap-1 flex-wrap pl-[19px]">
                                  {w.badges.map((b) => <span key={b.label} className={`text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 ${b.cls}`}>{b.label}</span>)}
                                  {w.summary && <span className="text-[11px] text-slate-400 truncate">{w.summary}</span>}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Group>
          )}
          {data && hasResults && (
            <button type="button" onClick={() => go(`/search?q=${encodeURIComponent(term.trim())}`)}
              className="w-full sticky bottom-0 bg-white border-t border-slate-200 px-3 py-2 text-[12px] font-medium text-violet-700 hover:bg-violet-50 text-center">
              See all results for “{debounced}” →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div><div className="px-3 py-1.5 text-[10px] uppercase font-semibold text-slate-400 bg-slate-50 sticky top-0">{title}</div>{children}</div>;
}

function Item({ icon, main, sub, extra, onClick }: { icon: ReactNode; main: ReactNode; sub?: ReactNode; extra?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-violet-50 border-b border-slate-50 last:border-0">
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-slate-800 truncate">{main}</span>
        {sub && <span className="block text-[11px] text-slate-500 mt-0.5">{sub}</span>}
        {extra}
      </span>
    </button>
  );
}
