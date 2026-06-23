import { useState, useRef, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Search, Loader2, User, Car, FileText, X } from "lucide-react";
import { RegPlate } from "./RegPlate";

const DOC_LABEL: Record<string, string> = { SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note", XS: "Excess", PA: "Purchase", VS: "Sale" };

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
                <Item key={"c" + c.id} icon={<User className="w-4 h-4 text-violet-600" />} onClick={() => go(`/customers/${c.id}`)}
                  main={c.name} sub={[c.phone, c.postcode, c.address].filter(Boolean).join(" · ")}
                  extra={c.vehicles?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      {c.vehicles.map((v: any) => (
                        <span key={v.registration} className="inline-flex items-center gap-1" title={[v.make, v.model].filter(Boolean).join(" ")}>
                          <RegPlate reg={v.registration} size="xs" />
                        </span>
                      ))}
                    </div>
                  )} />
              ))}
            </Group>
          )}
          {data?.vehicles?.length > 0 && (
            <Group title="Vehicles">
              {data.vehicles.map((v: any) => (
                <Item key={"v" + v.id} icon={<Car className="w-4 h-4 text-sky-600" />} onClick={() => go(`/view-vehicle/${encodeURIComponent(v.registration)}`)}
                  main={<RegPlate reg={v.registration} />} sub={[[v.make, v.model].filter(Boolean).join(" "), v.ownerName].filter(Boolean).join(" · ")} />
              ))}
            </Group>
          )}
          {data?.documents?.length > 0 && (
            <Group title="Live Jobs">
              {data.documents.map((d: any) => (
                <Item key={"d" + d.id} icon={<FileText className="w-4 h-4 text-slate-500" />} onClick={() => go(`/documents/${d.id}`)}
                  main={`${DOC_LABEL[d.docType] || d.docType || "Doc"} ${d.docNo || ""}`.trim()}
                  sub={<span className="inline-flex items-center gap-1.5">{d.registration && <RegPlate reg={d.registration} size="xs" />}<span>{[d.customerName, d.accountNumber].filter(Boolean).join(" · ")}</span></span>} />
              ))}
            </Group>
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
        {sub && <span className="block text-[11px] text-slate-500 truncate">{sub}</span>}
        {extra}
      </span>
    </button>
  );
}
