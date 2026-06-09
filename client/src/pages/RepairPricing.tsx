import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Search, Loader2, Wrench, ExternalLink } from "lucide-react";

const money = (n: any) => Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RepairPricing() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [submitted, setSubmitted] = useState<{ query: string; make?: string; model?: string } | null>(null);

  // allow deep-linking / pre-fill from a job sheet: /repair-pricing?q=shock+absorber&make=Kia&model=Sorento
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q"); if (!q) return;
    setQuery(q); setMake(p.get("make") || ""); setModel(p.get("model") || "");
    setSubmitted({ query: q, make: p.get("make") || undefined, model: p.get("model") || undefined });
  }, []);

  const res = trpc.documents.repairPricing.useQuery(submitted ?? { query: "" }, { enabled: !!submitted, staleTime: 60_000 });
  const data = res.data as any;
  const run = () => { if (query.trim().length >= 2) setSubmitted({ query: query.trim(), make: make.trim() || undefined, model: model.trim() || undefined }); };

  const ScopeCard = ({ label, sub, s, highlight }: { label: string; sub: string; s: any; highlight?: boolean }) => (
    <div className={`rounded-lg border p-3 ${highlight ? "border-violet-300 bg-violet-50/60" : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] uppercase font-semibold text-slate-500 tracking-wide">{label}</div>
      <div className="text-[12px] text-slate-400 mb-2 truncate">{sub || "—"}</div>
      {!s || s.jobs === 0 ? <div className="text-sm text-slate-400 py-4">No matching history</div> : (
        <div className="space-y-1.5">
          <Row k="Parts" v={`£${money(s.parts.avg)}`} sub={s.parts.n ? `£${money(s.parts.min)}–£${money(s.parts.max)} · ×${s.parts.n}` : undefined} />
          <Row k="Labour" v={s.labour.n ? `£${money(s.labour.avg)}` : "—"} sub={s.labour.n ? `£${money(s.labour.min)}–£${money(s.labour.max)} · ×${s.labour.n}` : undefined} />
          <div className="flex items-baseline justify-between border-t pt-1.5 mt-1">
            <span className="text-[13px] font-semibold text-slate-700">Typical total</span>
            <span className="text-[15px] font-bold text-violet-800">£{money(s.total.avg)}</span>
          </div>
          <div className="text-[11px] text-slate-400">{s.jobs} past job{s.jobs === 1 ? "" : "s"}</div>
        </div>
      )}
    </div>
  );

  return (
    <DashboardLayout>
      <div className="max-w-[1100px] mx-auto p-4 space-y-4 text-slate-800">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Wrench className="w-5 h-5 text-violet-600" /> Repair Pricing</h1>
          <p className="text-sm text-slate-500">What you've charged before for a repair — across all cars, the same make, and the same model. Figures are NET (ex-VAT).</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
          <Field label="Repair / part" value={query} onChange={setQuery} placeholder="e.g. shock absorber" onEnter={run} autoFocus />
          <Field label="Make (optional)" value={make} onChange={setMake} placeholder="e.g. Kia" onEnter={run} />
          <Field label="Model (optional)" value={model} onChange={setModel} placeholder="e.g. Sorento" onEnter={run} />
          <button onClick={run} disabled={query.trim().length < 2}
            className="inline-flex items-center justify-center gap-1.5 bg-violet-700 text-white rounded px-4 text-sm font-medium disabled:opacity-50 hover:bg-violet-800 h-[38px]">
            {res.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Search
          </button>
        </div>

        {res.isFetching && <div className="text-center text-slate-400 py-10"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}

        {data && !res.isFetching && (
          data.jobs.length === 0 ? (
            <div className="text-center text-slate-500 py-12">No past charges found for “{submitted?.query}”. Try a simpler term — e.g. just “shock”.</div>
          ) : (
            <>
              <div className="text-[12px] text-slate-500">
                Matched on:{" "}
                {data.terms.map((t: string) => <span key={t} className="inline-block bg-slate-100 rounded px-1.5 py-0.5 mr-1 font-mono text-[11px]">{t}</span>)}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {submitted?.model && <ScopeCard label="Same model" sub={`${submitted.make || ""} ${submitted.model}`.trim()} s={data.scopes.model} highlight />}
                {submitted?.make && <ScopeCard label="Same make" sub={submitted.make} s={data.scopes.make} highlight={!submitted?.model} />}
                <ScopeCard label="All cars" sub="every past job" s={data.scopes.all} />
              </div>

              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="px-3 py-2 border-b bg-slate-50 text-[12px] font-semibold text-slate-600">Past jobs (most relevant first · {data.jobs.length})</div>
                <div className="divide-y divide-slate-100">
                  {data.jobs.map((j: any) => (
                    <div key={j.docId} className={`px-3 py-2 ${j.sameModel ? "bg-violet-50/40" : ""}`}>
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <button onClick={() => setLocation(`/documents/${j.docId}`)} className="font-medium text-slate-800 hover:text-violet-700 hover:underline flex items-center gap-1 min-w-0">
                          <span className="truncate">{(j.make || "?") + " " + (j.model || "")}</span> <ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
                        </button>
                        <div className="flex items-center gap-2.5 shrink-0">
                          {j.sameMake && <span className="text-[10px] uppercase font-semibold text-violet-700 bg-violet-100 rounded px-1.5 py-0.5">{j.sameModel ? "same model" : "same make"}</span>}
                          <span className="text-slate-400 text-[12px]">{j.date ? new Date(j.date).toLocaleDateString("en-GB") : ""}</span>
                          <span className="font-bold w-16 text-right">£{money(j.repairNet)}</span>
                        </div>
                      </div>
                      <div className="mt-1 pl-0.5 space-y-0.5">
                        {j.parts.map((p: any, i: number) => <LineRow key={"p" + i} tag="Part" tone="bg-amber-100 text-amber-700" desc={p.description} qty={p.qty} net={p.net} />)}
                        {j.labour.map((l: any, i: number) => <LineRow key={"l" + i} tag="Labour" tone="bg-sky-100 text-sky-700" desc={l.description} qty={l.qty} net={l.net} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )
        )}
      </div>
    </DashboardLayout>
  );
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between text-[13px]">
      <span className="text-slate-600">{k}</span>
      <span className="font-semibold text-slate-800">{v}{sub && <span className="text-slate-400 font-normal text-[11px] ml-1">({sub})</span>}</span>
    </div>
  );
}

function LineRow({ tag, tone, desc, qty, net }: { tag: string; tone: string; desc: string; qty: number; net: number }) {
  return (
    <div className="flex items-center justify-between text-[12px] text-slate-600 gap-2">
      <span className="flex items-center gap-1.5 min-w-0"><span className={`text-[9px] uppercase font-semibold rounded px-1 py-0.5 ${tone}`}>{tag}</span><span className="truncate">{desc || "—"}{qty > 1 ? ` ×${qty}` : ""}</span></span>
      <span className="shrink-0">£{money(net)}</span>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, onEnter, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; onEnter: () => void; autoFocus?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-500 mb-0.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }}
        className="w-full bg-white border border-slate-300 rounded px-2 text-[14px] outline-none focus:border-violet-500 h-[38px]" />
    </div>
  );
}
