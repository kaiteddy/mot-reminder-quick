import { useState, useMemo, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Car, RefreshCw, Loader2, ExternalLink, Gauge, CalendarClock, ShieldCheck, Search, AlertTriangle, Eye } from "lucide-react";

const money = (n: any) => Number(n || 0).toLocaleString("en-GB");
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("en-GB") : "";

function motStatus(motExpiryDate: any) {
  if (!motExpiryDate) return { label: "No MOT data", tone: "slate" as const, bad: false };
  const days = Math.round((new Date(motExpiryDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: `Expired ${fmtDate(motExpiryDate)}`, tone: "red" as const, bad: true };
  if (days <= 30) return { label: `Due ${fmtDate(motExpiryDate)} · ${days}d`, tone: "amber" as const, bad: true };
  return { label: `${fmtDate(motExpiryDate)} · ${days}d`, tone: "green" as const, bad: false };
}
const taxTone = (t: any) => !t ? "slate" : /^taxed$/i.test(t) ? "green" : "red"; // Untaxed / SORN → red
// AutoTrader price indicator vs market: High = above guide (slow to sell) → flag amber.
const priceTone = (p: any) => { const s = String(p || "").toLowerCase(); if (s === "good") return "green"; if (s === "high") return "amber"; if (s === "low") return "sky"; return "slate"; };

const TONE: Record<string, string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  slate: "border-slate-200 bg-slate-50 text-slate-500",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
};

export default function SalesStock() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState("");
  const utils = trpc.useUtils();
  // compliance data — always fetch fresh on open so MOT/tax can never show a stale value
  const { data, isLoading } = trpc.salesStock.list.useQuery(undefined, { staleTime: 0, refetchOnMount: "always" });
  const refresh = trpc.salesStock.refresh.useMutation({
    onSuccess: (r) => { toast.success(`Refreshed MOT/tax on ${r.updated} cars`); utils.salesStock.list.invalidate(); },
    onError: (e) => toast.error(e.message || "Refresh failed"),
  });

  const cars = (data as any[]) || [];
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return cars;
    return cars.filter((c) => `${c.registration} ${c.make} ${c.model} ${c.colour} ${c.fuelType}`.toLowerCase().includes(f));
  }, [cars, filter]);

  const stats = useMemo(() => {
    let value = 0, motExpired = 0, motSoon = 0, untaxed = 0, alerts = 0;
    for (const c of cars) {
      value += Number(c.price) || 0;
      const m = motStatus(c.motExpiryDate);
      if (m.tone === "red") motExpired++; else if (m.tone === "amber") motSoon++;
      if (c.taxStatus && !/^taxed$/i.test(c.taxStatus)) untaxed++;
      if (c.checkIssues) alerts++;
    }
    return { count: cars.length, value, motExpired, motSoon, untaxed, alerts };
  }, [cars]);

  return (
    <DashboardLayout>
      <div className="max-w-[1500px] mx-auto p-4 space-y-4 text-slate-800">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2"><Car className="w-5 h-5 text-violet-600" /> Sales Cars Stock</h1>
            <p className="text-sm text-slate-500">Forecourt stock with live DVLA MOT &amp; tax status.</p>
          </div>
          <button onClick={() => refresh.mutate()} disabled={refresh.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            {refresh.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh MOT/Tax
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Cars in stock" value={String(stats.count)} />
          <Stat label="Total value" value={`£${money(stats.value)}`} />
          <Stat label="Check alerts" value={String(stats.alerts)} tone={stats.alerts ? "red" : "green"} />
          <Stat label="MOT expired" value={String(stats.motExpired)} tone={stats.motExpired ? "red" : "green"} />
          <Stat label="MOT due ≤30d" value={String(stats.motSoon)} tone={stats.motSoon ? "amber" : "green"} />
          <Stat label="Untaxed / SORN" value={String(stats.untaxed)} tone={stats.untaxed ? "red" : "green"} />
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by reg, make, model, colour…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-[14px] outline-none focus:border-violet-500" />
        </div>

        {isLoading ? <div className="text-center text-slate-400 py-12"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
          : cars.length === 0 ? <div className="text-center text-slate-500 py-12">No stock cars yet. Import the stocklist with <code>scripts/import-sales-stock.ts</code>.</div>
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {shown.map((c) => {
                const mot = motStatus(c.motExpiryDate);
                return (
                  <div key={c.id} className={`rounded-xl border bg-white overflow-hidden flex flex-col ${c.checkIssues ? "border-red-400 ring-1 ring-red-300" : "border-slate-200"}`}>
                    {c.checkIssues && <div className="bg-red-600 text-white text-[11px] font-bold uppercase tracking-wide px-2 py-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {c.checkIssues}</div>}
                    <div className="aspect-[16/10] bg-slate-100 relative">
                      {c.imageUrl
                        ? <img src={c.imageUrl} alt={`${c.make} ${c.model}`} loading="lazy" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                        : <div className="w-full h-full flex items-center justify-center text-slate-300"><Car className="w-10 h-10" /></div>}
                      <div className="absolute top-2 left-2 bg-black/75 text-white text-[13px] font-bold tracking-wider rounded px-2 py-0.5">{c.registration}</div>
                      <div className="absolute bottom-2 right-2 bg-white/95 text-slate-900 text-[15px] font-bold rounded px-2 py-0.5 shadow">£{money(c.price)}</div>
                    </div>
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <div>
                        <div className="font-semibold text-[14px] leading-tight">{c.make} {c.model}</div>
                        <div className="text-[12px] text-slate-500 truncate" title={c.variant || ""}>{c.year} · {c.colour} · {c.fuelType}</div>
                      </div>
                      {c.priceIndicator && c.priceIndicator !== "No analysis" && (
                        <div className="flex items-center gap-2 text-[11px] flex-wrap">
                          <span className={`rounded px-1.5 py-0.5 font-semibold border ${TONE[priceTone(c.priceIndicator)]}`}>{c.priceIndicator} price{c.pricePosition ? ` · ${c.pricePosition}` : ""}</span>
                          {c.retailValuation ? <span className="text-slate-400">guide £{money(c.retailValuation)}</span> : null}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-slate-500">
                        <span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" />{money(c.mileage)} mi</span>
                        <span>{c.transmission}</span>
                        {c.owners != null && <span>{c.owners} owner{c.owners === 1 ? "" : "s"}</span>}
                        {c.daysInStock != null && <span>{c.daysInStock}d in stock</span>}
                        {c.views7d != null && <span className="inline-flex items-center gap-1"><Eye className="w-3 h-3" />{c.views7d}/wk</span>}
                      </div>
                      <div className="flex flex-col gap-1.5 mt-auto pt-1">
                        <Badge icon={<CalendarClock className="w-3.5 h-3.5" />} label="MOT" main={mot.label} tone={mot.tone} />
                        <Badge icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Tax" main={c.taxStatus || "Unknown"} sub={c.taxDueDate ? `due ${fmtDate(c.taxDueDate)}` : undefined} tone={taxTone(c.taxStatus)} />
                      </div>
                      <div className="flex items-center gap-3 pt-1 text-[12px]">
                        <button onClick={() => setLocation(`/view-vehicle/${encodeURIComponent(c.registration)}`)} className="text-violet-700 hover:underline">In workshop ↗</button>
                        {c.websiteUrl && <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">Listing <ExternalLink className="w-3 h-3" /></a>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`rounded-lg border p-3 ${tone ? TONE[tone] : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] uppercase font-semibold opacity-70">{label}</div>
      <div className="text-[20px] font-bold leading-tight mt-0.5">{value}</div>
    </div>
  );
}

function Badge({ icon, label, main, sub, tone }: { icon: ReactNode; label: string; main: string; sub?: string; tone: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] ${TONE[tone]}`}>
      {icon}
      <span className="text-[10px] uppercase font-semibold opacity-70">{label}</span>
      <span className="font-medium truncate">{main}{sub ? ` · ${sub}` : ""}</span>
    </div>
  );
}
