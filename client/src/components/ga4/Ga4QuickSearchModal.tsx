import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ga4Spaced } from "@/components/RegPlate";

const DOC_LABEL: Record<string, string> = { SI: "SI", ES: "ES", JS: "JS", CR: "CR", XS: "XS", VS: "VS" };
const fmtDate = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

// GA4 Classic's Quick Search results — a floating window (title bar, dark search
// row, grouped results tables) matching the real app exactly, not the modern app's
// dropdown-under-the-input (see UniversalSearch.tsx). Same trpc.documents.globalSearch
// query as that component, just laid out to match GA4's fixed-column result tables.
export default function Ga4QuickSearchModal({ query, onClose }: { query: string; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const [term, setTerm] = useState(query);
  const [debounced, setDebounced] = useState(query.trim());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const res = trpc.documents.globalSearch.useQuery({ query: debounced }, { enabled: debounced.length >= 2, staleTime: 15_000 });
  const data = res.data as any;
  const hasResults = data && (data.documents?.length || data.vehicles?.length || data.customers?.length);

  // Server already returns documents most-recent-first (issued, falling back to created) — this
  // just lets staff flip to oldest-first without a round trip, since the page is already fetched.
  const [docsOldestFirst, setDocsOldestFirst] = useState(false);
  const documents = useMemo(() => {
    const list = data?.documents ?? [];
    return docsOldestFirst ? [...list].reverse() : list;
  }, [data?.documents, docsOldestFirst]);

  const go = (path: string) => { onClose(); setLocation(path); };

  return (
    <div className="qs-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qs-modal">
        <div className="qs-titlebar">
          <span>Quick Search</span>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="qs-searchbar">
          <input
            value={term}
            autoFocus
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setDebounced(term.trim())}
          />
          <button type="button" onClick={() => setDebounced(term.trim())} aria-label="Search"><Search size={14} /></button>
        </div>
        <div className="qs-results">
          {debounced.length < 2 && <div className="qs-hint">Type at least 2 characters…</div>}
          {debounced.length >= 2 && res.isFetching && !data && <div className="qs-hint">Searching…</div>}
          {debounced.length >= 2 && data && !hasResults && <div className="qs-hint">No matches for “{debounced}”.</div>}

          {documents.length > 0 && (
            <>
              <div className="qs-section-head">
                Documents{" "}
                <span>({documents.length < (data.documentsTotal ?? documents.length)
                  ? `showing most recent ${documents.length} of ${data.documentsTotal.toLocaleString()} — refine your search to narrow this down`
                  : `showing ${documents.length}`})</span>
              </div>
              <div className="qs-row qs-col-head qs-row-documents" aria-hidden="true">
                <span>Doc No</span>
                <button type="button" className="qs-sort-toggle" onClick={() => setDocsOldestFirst((v) => !v)} title={docsOldestFirst ? "Showing oldest first — click for most recent first" : "Showing most recent first — click for oldest first"}>
                  Date {docsOldestFirst ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                <span>Customer</span><span>Vehicle</span>
              </div>
              {documents.map((d: any) => (
                <button key={`d${d.id}`} type="button" className="qs-row qs-row-documents" onClick={() => go(`/classic/documents/${d.id}`)}>
                  <span>{DOC_LABEL[d.docType] || d.docType} {d.ga4Number || d.docNo}</span>
                  <span>{fmtDate(d.dateIssued || d.date)}</span>
                  <span>{d.customerName || "—"}</span>
                  <span>{[d.registration ? ga4Spaced(d.registration) : null, [d.make, d.model].filter(Boolean).join(" ") || null].filter(Boolean).join(" - ") || "—"}</span>
                </button>
              ))}
              <div className="qs-row qs-row-empty qs-row-documents" aria-hidden="true"><span /><span /><span /><span /></div>
            </>
          )}

          {data?.vehicles?.length > 0 && (
            <>
              <div className="qs-section-head">Vehicles <span>(showing {data.vehicles.length})</span></div>
              <div className="qs-row qs-col-head qs-row-vehicles" aria-hidden="true"><span>Registration</span><span>Vehicle</span><span>Owner</span></div>
              {data.vehicles.map((v: any) => (
                <button key={`v${v.id}`} type="button" className="qs-row qs-row-vehicles" onClick={() => go(`/classic/view-vehicle/${encodeURIComponent(v.registration)}`)}>
                  <span>{ga4Spaced(v.registration)}</span>
                  <span>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</span>
                  <span>{v.ownerName || "—"}</span>
                </button>
              ))}
              <div className="qs-row qs-row-empty qs-row-vehicles" aria-hidden="true"><span /><span /><span /></div>
            </>
          )}

          {data?.customers?.length > 0 && (
            <>
              <div className="qs-section-head">Customers <span>(showing {data.customers.length})</span></div>
              <div className="qs-row qs-col-head qs-row-customers" aria-hidden="true"><span>Name</span><span>Mobile</span><span>Address</span></div>
              {data.customers.map((c: any) => (
                <button key={`c${c.id}`} type="button" className="qs-row qs-row-customers" onClick={() => go(`/classic/customers/${c.id}`)}>
                  <span>{c.name || "—"}</span>
                  <span>{c.phone || "—"}</span>
                  <span>{c.address || c.postcode || "—"}</span>
                </button>
              ))}
              <div className="qs-row qs-row-empty qs-row-customers" aria-hidden="true"><span /><span /><span /></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
