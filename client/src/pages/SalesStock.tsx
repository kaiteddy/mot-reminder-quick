import { useState, useMemo, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Car, RefreshCw, Loader2, ExternalLink, Gauge, CalendarClock, ShieldCheck, Search, AlertTriangle, Eye, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown, ReceiptText, BadgePoundSterling, Undo2 } from "lucide-react";

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

function SortHead({ label, k, sortKey, sortDir, onSort, align = "left", pad = "px-2" }: { label: string; k: string; sortKey: string; sortDir: "asc" | "desc"; onSort: (k: string) => void; align?: "left" | "right" | "center"; pad?: string }) {
  const active = sortKey === k;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th className={`font-semibold py-2 ${pad} text-${align}`}>
      <button onClick={() => onSort(k)} className={`inline-flex items-center gap-1 ${justify} hover:text-slate-700 ${active ? "text-violet-700" : ""}`}>
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}

export default function SalesStock() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("salesStockView") as "grid" | "list") || "grid");
  const setViewPersist = (v: "grid" | "list") => { setView(v); localStorage.setItem("salesStockView", v); };
  const utils = trpc.useUtils();
  // compliance data — always fetch fresh on open so MOT/tax can never show a stale value
  const { data, isLoading } = trpc.salesStock.list.useQuery(undefined, { staleTime: 0, refetchOnMount: "always" });
  const refresh = trpc.salesStock.refresh.useMutation({
    onSuccess: (r) => { toast.success(`Refreshed MOT/tax on ${r.updated} cars`); utils.salesStock.list.invalidate(); },
    onError: (e) => toast.error(e.message || "Refresh failed"),
  });

  const [sortKey, setSortKey] = useState("price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sortBy = (k: string) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "vehicle" || k === "reg" ? "asc" : "desc"); }
  };

  // Sales invoices already raised, so a car that has been sold offers "Open invoice" rather
  // than silently raising a second one.
  const { data: saleInvoices } = trpc.vehicleSale.list.useQuery();
  const invoiceByStockId = useMemo(() => {
    const m = new Map<number, number>();
    for (const inv of (saleInvoices as any[]) || []) if (inv.salesStockId != null) m.set(inv.salesStockId, inv.id);
    return m;
  }, [saleInvoices]);
  const raiseInvoice = trpc.vehicleSale.createFromStock.useMutation({
    onSuccess: (r: any) => { utils.vehicleSale.list.invalidate(); setLocation(`/vehicle-sale/${r.id}`); },
    onError: (e) => toast.error(e.message || "Could not raise the sales invoice"),
  });

  // Mark sold: capture price/date, then hand over to the invoice if asked.
  const [soldTarget, setSoldTarget] = useState<any>(null);
  const unsell = trpc.salesStock.setSold.useMutation({
    onSuccess: (_r, v) => { utils.salesStock.list.invalidate(); toast.success("Back on the forecourt"); },
    onError: (e) => toast.error(e.message || "Could not update this car"),
  });
  const onSoldDone = (car: any, opts: { raiseInvoice: boolean }) => {
    setSoldTarget(null);
    if (!opts.raiseInvoice) return;
    const existing = invoiceByStockId.get(car.id);
    if (existing != null) setLocation(`/vehicle-sale/${existing}`);
    else raiseInvoice.mutate({ salesStockId: car.id });
  };

  const cars = (data as any[]) || [];
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return cars;
    return cars.filter((c) => `${c.registration} ${c.make} ${c.model} ${c.colour} ${c.fuelType}`.toLowerCase().includes(f));
  }, [cars, filter]);

  const sorted = useMemo(() => {
    const VAL: Record<string, (c: any) => any> = {
      vehicle: (c) => `${c.make || ""} ${c.model || ""}`.toLowerCase(),
      reg: (c) => String(c.registration || ""),
      price: (c) => Number(c.price) || 0,
      mileage: (c) => Number(c.mileage) || 0,
      days: (c) => Number(c.daysInStock) || 0,
      mot: (c) => (c.motExpiryDate ? new Date(c.motExpiryDate).getTime() : 0),
      tax: (c) => (/^taxed$/i.test(c.taxStatus || "") ? 1 : 0), // untaxed/SORN sort first when asc
    };
    const get = VAL[sortKey] || VAL.price;
    const arr = [...shown];
    arr.sort((a, b) => { const x = get(a), y = get(b); const cmp = x < y ? -1 : x > y ? 1 : 0; return sortDir === "asc" ? cmp : -cmp; });
    return arr;
  }, [shown, sortKey, sortDir]);

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
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
              <button onClick={() => setViewPersist("grid")} title="Grid view" className={`px-2.5 py-2 ${view === "grid" ? "bg-violet-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setViewPersist("list")} title="List view" className={`px-2.5 py-2 border-l border-slate-300 ${view === "list" ? "bg-violet-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}><List className="w-4 h-4" /></button>
            </div>
            <button onClick={() => refresh.mutate()} disabled={refresh.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
              {refresh.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh MOT/Tax
            </button>
          </div>
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
          : view === "list" ? (
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-[13px] min-w-[760px]">
                <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                  <tr>
                    <SortHead label="Vehicle" k="vehicle" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} pad="px-3" />
                    <SortHead label="Reg" k="reg" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    <SortHead label="Price" k="price" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} align="right" />
                    <SortHead label="Mileage" k="mileage" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} align="right" />
                    <SortHead label="Days" k="days" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} align="center" />
                    <SortHead label="MOT" k="mot" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    <SortHead label="Tax" k="tax" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    <th className="text-left font-semibold px-2 py-2">Status</th>
                    <th className="text-right font-semibold px-3 py-2">Sale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((c) => {
                    const mot = motStatus(c.motExpiryDate);
                    return (
                      <tr key={c.id} onClick={() => setLocation(`/view-vehicle/${encodeURIComponent(c.registration)}`)}
                        className={`cursor-pointer hover:bg-slate-50 ${c.checkIssues ? "bg-red-50/50" : ""}`}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            {c.imageUrl
                              ? <img src={c.imageUrl} alt="" loading="lazy" className="w-12 h-9 object-cover rounded shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                              : <div className="w-12 h-9 bg-slate-100 rounded flex items-center justify-center shrink-0"><Car className="w-4 h-4 text-slate-300" /></div>}
                            <div className="min-w-0">
                              <div className="font-medium truncate">{c.make} {c.model}</div>
                              <div className="text-[11px] text-slate-500 truncate">{[c.year, c.colour, c.fuelType].filter(Boolean).join(" · ")}{c.priceIndicator && c.priceIndicator !== "No analysis" ? ` · ${c.priceIndicator} price` : ""}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2"><span className="font-mono font-semibold text-[12px] bg-slate-100 rounded px-1.5 py-0.5 whitespace-nowrap">{c.registration}</span></td>
                        <td className="px-2 py-2 text-right font-semibold whitespace-nowrap">£{money(c.price)}</td>
                        <td className="px-2 py-2 text-right text-slate-600 whitespace-nowrap">{money(c.mileage)}</td>
                        <td className="px-2 py-2 text-center text-slate-500">{c.daysInStock ?? "—"}</td>
                        <td className="px-2 py-2"><span className={`inline-block rounded px-1.5 py-0.5 text-[11px] border whitespace-nowrap ${TONE[mot.tone]}`}>{mot.label}</span></td>
                        <td className="px-2 py-2"><span className={`inline-block rounded px-1.5 py-0.5 text-[11px] border whitespace-nowrap ${TONE[taxTone(c.taxStatus)]}`}>{c.taxStatus || "Unknown"}</span></td>
                        <td className="px-2 py-2">
                          {isSold(c)
                            ? <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">SOLD{c.soldPrice ? ` £${money(c.soldPrice)}` : ""}</span>
                            : c.checkIssues ? <span className="inline-flex items-center gap-1 text-red-700 text-[11px] font-semibold whitespace-nowrap"><AlertTriangle className="w-3 h-3" />{c.checkIssues}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex gap-1.5">
                            <MarkSoldButton
                              car={c} compact
                              pending={unsell.isPending && unsell.variables?.id === c.id}
                              onMark={() => setSoldTarget(c)}
                              onUndo={() => unsell.mutate({ id: c.id, sold: false })}
                            />
                            <SaleInvoiceButton
                              car={c} invoiceId={invoiceByStockId.get(c.id)} compact
                              pending={raiseInvoice.isPending && raiseInvoice.variables?.salesStockId === c.id}
                              onRaise={() => raiseInvoice.mutate({ salesStockId: c.id })}
                              onOpen={(invId) => setLocation(`/vehicle-sale/${invId}`)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {sorted.map((c) => {
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
                      {isSold(c) && (
                        <div className="absolute top-2 right-2 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-wide rounded px-2 py-0.5 shadow">
                          Sold{c.soldPrice ? ` £${money(c.soldPrice)}` : ""}
                        </div>
                      )}
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
                      <div className="grid grid-cols-2 gap-1.5">
                        <MarkSoldButton
                          car={c}
                          pending={unsell.isPending && unsell.variables?.id === c.id}
                          onMark={() => setSoldTarget(c)}
                          onUndo={() => unsell.mutate({ id: c.id, sold: false })}
                        />
                        <SaleInvoiceButton
                          car={c} invoiceId={invoiceByStockId.get(c.id)}
                          pending={raiseInvoice.isPending && raiseInvoice.variables?.salesStockId === c.id}
                          onRaise={() => raiseInvoice.mutate({ salesStockId: c.id })}
                          onOpen={(invId) => setLocation(`/vehicle-sale/${invId}`)}
                        />
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

      {soldTarget && (
        <MarkSoldDialog
          car={soldTarget}
          onClose={() => setSoldTarget(null)}
          onDone={(opts) => onSoldDone(soldTarget, opts)}
        />
      )}
    </DashboardLayout>
  );
}

/**
 * Raise (or reopen) the used-car sales invoice for a stock car. The form is pre-filled from
 * the stocklist and the garage's own vehicle record, then filled in on the replica itself.
 */
const isSold = (c: any) => /^sold$/i.test(String(c?.status || ""));

/** Marking a car sold and raising its invoice are one action in practice — you agree a price and
 * the paperwork follows — so this captures the price and date, then hands straight over to the
 * sales invoice. The sale price is recorded separately from the advertised price so what we
 * asked for isn't lost behind what it went for. */
function MarkSoldDialog({ car, onClose, onDone }: { car: any; onClose: () => void; onDone: (opts: { raiseInvoice: boolean }) => void }) {
  const [price, setPrice] = useState(String(car?.price ?? ""));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [raise, setRaise] = useState(true);
  const setSold = trpc.salesStock.setSold.useMutation();
  const utils = trpc.useUtils();

  const submit = async () => {
    const p = price.trim() === "" ? null : Number(price);
    if (p != null && (!isFinite(p) || p < 0)) { toast.error("Enter a valid sale price"); return; }
    try {
      await setSold.mutateAsync({ id: car.id, sold: true, soldPrice: p, soldAt: date || null });
      await utils.salesStock.list.invalidate();
      toast.success(`${car.registration} marked sold`);
      onDone({ raiseInvoice: raise });
    } catch (e: any) {
      toast.error(e.message || "Could not mark this car sold");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold flex items-center gap-2"><BadgePoundSterling className="w-5 h-5" /> Mark as sold</h3>
        <p className="text-xs text-muted-foreground">{car.make} {car.model} · {car.registration}{car.price ? ` · advertised £${money(car.price)}` : ""}</p>
        <div>
          <label className="text-xs text-muted-foreground">Sale price</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="What it actually sold for"
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 outline-none focus:border-violet-500" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Date sold</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 outline-none focus:border-violet-500" />
        </div>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={raise} onChange={(e) => setRaise(e.target.checked)} className="mt-0.5" />
          <span>Raise the sales invoice now<span className="block text-xs text-muted-foreground">Opens the used car sales invoice for this car.</span></span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="border rounded px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
          <button onClick={submit} disabled={setSold.isPending}
            className="bg-violet-700 text-white rounded px-4 py-1.5 text-sm hover:bg-violet-800 disabled:opacity-50 inline-flex items-center gap-1.5">
            {setSold.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgePoundSterling className="w-4 h-4" />} Mark sold
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sold cars keep the button so a mistake can be undone — a car marked sold in error would
 * otherwise be stuck off the forecourt with no way back. */
function MarkSoldButton({ car, compact, onMark, onUndo, pending }: { car: any; compact?: boolean; onMark: () => void; onUndo: () => void; pending: boolean }) {
  const sold = isSold(car);
  const cls = compact
    ? `inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium whitespace-nowrap disabled:opacity-50 ${sold ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"}`
    : `inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px] font-semibold w-full disabled:opacity-50 ${sold ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"}`;
  return (
    <button className={cls} disabled={pending} onClick={() => (sold ? onUndo() : onMark())}
      title={sold ? "Put this car back on the forecourt" : `Mark ${car.registration} as sold`}>
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sold ? <Undo2 className="w-3.5 h-3.5" /> : <BadgePoundSterling className="w-3.5 h-3.5" />}
      {sold ? "Back on sale" : "Mark sold"}
    </button>
  );
}

function SaleInvoiceButton({
  car, invoiceId, pending, compact, onRaise, onOpen,
}: {
  car: any; invoiceId?: number; pending: boolean; compact?: boolean;
  onRaise: () => void; onOpen: (invoiceId: number) => void;
}) {
  const raised = invoiceId != null;
  const cls = compact
    ? `inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium whitespace-nowrap disabled:opacity-50 ${raised ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100" : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50"}`
    : `inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px] font-semibold w-full disabled:opacity-50 ${raised ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100" : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50"}`;
  return (
    <button
      className={cls}
      disabled={pending}
      title={raised ? "Open the used car sales invoice for this car" : `Raise a used car sales invoice for ${car.registration}`}
      onClick={() => (raised ? onOpen(invoiceId!) : onRaise())}
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ReceiptText className="w-3.5 h-3.5" />}
      {raised ? "Open invoice" : "Sales invoice"}
    </button>
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
