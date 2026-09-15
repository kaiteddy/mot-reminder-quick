import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Search, RefreshCw, ChevronDown, ChevronRight, Package, Car, Building2, Link2, X, BarChart3, Eye, EyeOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { RegPlate } from "@/components/RegPlate";
import { useClassicBase } from "@/lib/classicNav";
import { OrderStatusBadge, OrderProgress, normReg } from "@/components/OmnipartOrdersCard";

function money(v: number | null | undefined) {
  return typeof v === "number" ? `£${v.toFixed(2)}` : "—";
}

const agoShort = (h: number | null | undefined) =>
  h == null ? "" : h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;

// Build a live courier tracking URL from the courier + number; unknown courier → a web search.
const TRACK_URL: Record<string, (n: string) => string> = {
  evri: (n) => `https://www.evri.com/track/parcel/${n}/details`,
  hermes: (n) => `https://www.evri.com/track/parcel/${n}/details`,
  dpd: (n) => `https://track.dpd.co.uk/parcels/${n}`,
  "royal mail": (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`,
  parcelforce: (n) => `https://www.parcelforce.com/track-trace?trackNumber=${n}`,
  yodel: (n) => `https://www.yodel.co.uk/tracking/${n}`,
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
  dhl: (n) => `https://www.dhl.com/gb-en/home/tracking.html?tracking-id=${n}`,
  inpost: (n) => `https://inpost.co.uk/tracking/${n}`,
};
function trackUrl(courier?: string | null, num?: string | null): string | null {
  if (!num) return null;
  const f = TRACK_URL[(courier || "").toLowerCase()];
  return f ? f(num) : `https://www.google.com/search?q=${encodeURIComponent(`${courier || ""} tracking ${num}`)}`;
}

// Bucket an order by when it was placed, relative to today.
const BUCKET_ORDER = ["Today", "Yesterday", "Earlier this week", "Last week", "Older"] as const;
function bucketOf(dateStr?: string | null): (typeof BUCKET_ORDER)[number] {
  if (!dateStr) return "Older";
  const d = new Date(dateStr);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startToday - dDay) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 6) return "Earlier this week";
  if (diff <= 13) return "Last week";
  return "Older";
}

/** A part's ECP photo — small thumbnail that enlarges on hover. Falls back to a box icon when the
 *  product has no image (some SKUs 404 on the ECP image CDN). */
function PartThumb({ src, alt }: { src?: string | null; alt: string }) {
  const [ok, setOk] = useState(!!src);
  if (!src || !ok) {
    return (
      <span className="w-11 h-11 shrink-0 rounded border bg-muted/40 flex items-center justify-center">
        <Package className="w-4 h-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <span className="relative group/thumb shrink-0">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setOk(false)}
        className="w-11 h-11 rounded border object-contain bg-white"
      />
      <span className="pointer-events-none hidden group-hover/thumb:flex absolute left-0 top-12 z-50 p-1.5 rounded-lg border bg-white shadow-xl flex-col items-center gap-1">
        <img src={src} alt={alt} className="w-52 h-52 object-contain bg-white" />
        <span className="text-xs font-medium text-slate-700 max-w-52 text-center">{alt}</span>
      </span>
    </span>
  );
}

// ---- Optimistic cache patches: update the board in place so a click is instant and doesn't
// re-hit Euro Car Parts. ----
function patchPart(old: any, orderRef: string, code: string, usage: string | null) {
  if (!old?.orders) return old;
  return { ...old, orders: old.orders.map((o: any) =>
    o.orderRef !== orderRef ? o : { ...o, parts: (o.parts || []).map((p: any) => p.code === code ? { ...p, usage } : p) }) };
}
function patchCategory(old: any, orderRef: string, category: string | null) {
  if (!old?.orders) return old;
  return { ...old, orders: old.orders.map((o: any) =>
    o.orderRef !== orderRef ? o : { ...o, categoryOverride: category, category: category ?? o.autoCategory }) };
}
function patchJob(old: any, orderRef: string, jobSheet: any, extra?: { reg?: string; vehicle?: string }) {
  if (!old?.orders) return old;
  return { ...old, orders: old.orders.map((o: any) => {
    if (o.orderRef !== orderRef) return o;
    const linked = !!jobSheet;
    const isEmail = o.source === "ebay" || o.source === "amazon";
    return {
      ...o, jobSheet, jobSheetLinked: linked,
      // snap the row to the linked car straight away (eBay/Amazon inherit the job's reg + vehicle)
      reg: linked ? (extra?.reg ?? o.reg) : (isEmail ? null : o.reg),
      linkedVehicle: linked ? (extra?.vehicle ?? o.linkedVehicle) : (isEmail ? null : o.linkedVehicle),
    };
  }) };
}
function patchHidden(old: any, orderRef: string, hidden: boolean) {
  if (!old?.orders) return old;
  return { ...old, orders: old.orders.map((o: any) => o.orderRef !== orderRef ? o : { ...o, hidden }) };
}

/** Genuine recommendations: when an eBay/Amazon order has no reg, guess the car from the item and
 *  offer matching jobs to link in one click. */
function SuggestedJobs({ order }: { order: any }) {
  const utils = trpc.useUtils();
  const q = trpc.omnipart.suggestJobs.useQuery(
    { vehicle: order.suggestedVehicle || "" },
    { enabled: !!order.suggestedVehicle && !order.jobSheet, staleTime: 60_000 },
  );
  const link = trpc.omnipart.setOrderJobSheet.useMutation();
  if (order.jobSheet || !order.suggestedVehicle) return null;
  const apply = (j: any) => {
    utils.omnipart.getOrderTracking.setData(undefined, (old: any) =>
      patchJob(old, order.orderRef, { id: j.id, ga4Number: j.ga4Number, docNo: j.docNo }, { reg: j.registration, vehicle: j.vehicle }));
    link.mutate({ orderRef: order.orderRef, jobSheetId: j.id });
  };
  const jobs = q.data || [];
  return (
    <div className="text-xs flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground">Looks like a <span className="font-semibold text-slate-700">{order.suggestedVehicle}</span> part.</span>
      {jobs.length > 0 ? (
        <>
          <span className="text-muted-foreground">Link to:</span>
          {jobs.map((j: any) => (
            <button key={j.id} onClick={(e) => { e.stopPropagation(); apply(j); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-white text-slate-700 hover:bg-blue-50 hover:border-blue-300">
              {j.registration || j.ga4Number || `#${j.id}`}{j.vehicle ? ` · ${j.vehicle}` : ""}
            </button>
          ))}
        </>
      ) : q.isFetched ? (
        <span className="text-muted-foreground/70">no {order.suggestedVehicle} on file — search below</span>
      ) : null}
    </div>
  );
}

/** Hide / unhide an order (garage supplies, non-parts buys). */
function HideButton({ order }: { order: any }) {
  const utils = trpc.useUtils();
  const m = trpc.omnipart.setOrderHidden.useMutation({
    onMutate: async (vars) => {
      await utils.omnipart.getOrderTracking.cancel();
      const prev = utils.omnipart.getOrderTracking.getData();
      utils.omnipart.getOrderTracking.setData(undefined, (old: any) => patchHidden(old, vars.orderRef, vars.hidden));
      return { prev };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) utils.omnipart.getOrderTracking.setData(undefined, ctx.prev); },
  });
  return (
    <button
      onClick={(e) => { e.stopPropagation(); m.mutate({ orderRef: order.orderRef, hidden: !order.hidden }); }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-white text-slate-500 hover:bg-slate-50 text-xs"
      title={order.hidden ? "Show on the board again" : "Hide — not a customer part (garage supply)"}
    >
      {order.hidden ? <><Eye className="w-3 h-3" /> Unhide</> : <><EyeOff className="w-3 h-3" /> Hide</>}
    </button>
  );
}

/** Attach an order to a job sheet in two steps: pick the REGISTRATION, then the correct job card
 *  for that reg. Works for eBay/Amazon orders (no reg to auto-match) and can re-point an ECP order. */
function JobLink({ order, base }: { order: any; base: string }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [reg, setReg] = useState<{ registration: string; vehicle: string } | null>(null);
  // prefill the reg search with the guessed vehicle so the right car is one keystroke away
  const regs = trpc.omnipart.searchRegs.useQuery({ q }, { enabled: editing && !reg && q.trim().length >= 2, staleTime: 30_000 });
  const jobs = trpc.omnipart.jobsForReg.useQuery({ reg: reg?.registration || "" }, { enabled: editing && !!reg, staleTime: 30_000 });
  const link = trpc.omnipart.setOrderJobSheet.useMutation();
  const reset = () => { setEditing(false); setQ(""); setReg(null); };
  const applyJob = (job: any) => {
    utils.omnipart.getOrderTracking.setData(undefined, (old: any) =>
      patchJob(old, order.orderRef, job, { reg: reg?.registration, vehicle: reg?.vehicle }));
    link.mutate({ orderRef: order.orderRef, jobSheetId: job.id });
    reset();
  };
  const unlink = () => {
    utils.omnipart.getOrderTracking.setData(undefined, (old: any) => patchJob(old, order.orderRef, null));
    link.mutate({ orderRef: order.orderRef, jobSheetId: null });
    reset();
  };
  const js = order.jobSheet;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs relative" onClick={(e) => e.stopPropagation()}>
      <span className="text-[11px] text-muted-foreground">Job:</span>
      {js ? (
        <>
          <Link href={`${base}/documents/${js.id}`} className="text-brand-primary hover:underline font-medium">
            {js.ga4Number || js.docNo || js.id}
          </Link>
          <span className="text-[10px] text-muted-foreground">{order.jobSheetLinked ? "(linked)" : "(auto)"}</span>
          <button onClick={unlink} className="text-muted-foreground hover:text-red-600" title="Unlink from job"><X className="w-3 h-3" /></button>
        </>
      ) : editing ? (
        <span className="relative">
          {!reg ? (
            // Step 1 — pick the registration
            <>
              <span className="inline-flex items-center gap-1 border rounded-md px-1.5 py-0.5 bg-white">
                <Search className="w-3 h-3 text-muted-foreground" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="registration or make/model…" className="outline-none text-xs w-48" />
                <button onClick={reset} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
              </span>
              {q.trim().length >= 2 && (
                <div className="absolute left-0 top-7 z-50 w-72 max-h-60 overflow-auto rounded-md border bg-white shadow-lg">
                  {regs.isLoading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</div>}
                  {!regs.isLoading && (regs.data || []).length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching registrations.</div>}
                  {(regs.data || []).map((r: any) => (
                    <button key={r.registration} onClick={() => { setReg({ registration: r.registration, vehicle: r.vehicle }); }}
                      className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-blue-50 border-b last:border-b-0">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <RegPlate reg={r.registration} />
                        <span className="truncate text-muted-foreground">{r.vehicle}</span>
                      </span>
                      <span className="text-muted-foreground/70 shrink-0">{r.jobs} job{r.jobs === 1 ? "" : "s"}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            // Step 2 — pick the job card for the chosen reg
            <>
              <span className="inline-flex items-center gap-1.5 border rounded-md px-1.5 py-0.5 bg-white">
                <RegPlate reg={reg.registration} />
                {reg.vehicle && <span className="text-muted-foreground">{reg.vehicle}</span>}
                <button onClick={() => setReg(null)} className="text-[10px] text-brand-primary hover:underline ml-1">change</button>
                <button onClick={reset} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
              </span>
              <div className="absolute left-0 top-8 z-50 w-80 max-h-64 overflow-auto rounded-md border bg-white shadow-lg">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">Choose the job card</div>
                {jobs.isLoading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading job cards…</div>}
                {!jobs.isLoading && (jobs.data || []).length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No job cards for this reg.</div>}
                {(jobs.data || []).map((j: any) => (
                  <button key={j.id} onClick={() => applyJob(j)}
                    className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-slate-50 border-b last:border-b-0">
                    <span className="min-w-0">
                      <span className="font-medium">{j.ga4Number || j.docNo || `#${j.id}`}</span>
                      {j.docType && <span className="ml-1 text-muted-foreground/70">{j.docType}</span>}
                      {j.description && <span className="block truncate text-muted-foreground/70">{j.description}</span>}
                    </span>
                    <span className="text-muted-foreground/70 shrink-0">{j.date ? new Date(j.date).toLocaleDateString("en-GB") : ""}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
      ) : (
        <button onClick={() => { setEditing(true); setQ(order.suggestedVehicle || ""); }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-white text-slate-600 hover:bg-slate-50">
          <Link2 className="w-3 h-3" /> Link to job
        </button>
      )}
    </span>
  );
}

const USAGE_OPTS: Array<{ key: "fitted" | "returned" | "spare"; label: string; on: string }> = [
  { key: "fitted",   label: "Fitted",   on: "bg-green-600 text-white border-green-600" },
  { key: "returned", label: "Returned", on: "bg-amber-500 text-white border-amber-500" },
  { key: "spare",    label: "Spare",    on: "bg-slate-600 text-white border-slate-600" },
];

/** Fitted / Returned / Spare pills for one part. */
function UsagePicker({ orderRef, code, usage }: { orderRef: string; code: string | null; usage: string | null }) {
  const utils = trpc.useUtils();
  const m = trpc.omnipart.setPartUsage.useMutation({
    onMutate: async (vars) => {
      await utils.omnipart.getOrderTracking.cancel();
      const prev = utils.omnipart.getOrderTracking.getData();
      utils.omnipart.getOrderTracking.setData(undefined, (old: any) => patchPart(old, vars.orderRef, vars.code, vars.usage));
      return { prev };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) utils.omnipart.getOrderTracking.setData(undefined, ctx.prev); },
  });
  if (!code) return null;
  return (
    <span className="inline-flex rounded-md border overflow-hidden print:hidden">
      {USAGE_OPTS.map((opt) => {
        const active = usage === opt.key;
        return (
          <button
            key={opt.key}
            onClick={(e) => { e.stopPropagation(); m.mutate({ orderRef, code, usage: active ? null : opt.key }); }}
            className={"px-2 py-0.5 text-[11px] font-medium border-l first:border-l-0 transition-colors " +
              (active ? opt.on : "bg-white text-slate-500 hover:bg-slate-50")}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}

/** Car job vs General/workshop toggle for one order (pins a manual override; clears back to auto). */
function CategoryToggle({ order }: { order: any }) {
  const utils = trpc.useUtils();
  const m = trpc.omnipart.setOrderCategory.useMutation({
    onMutate: async (vars) => {
      await utils.omnipart.getOrderTracking.cancel();
      const prev = utils.omnipart.getOrderTracking.getData();
      utils.omnipart.getOrderTracking.setData(undefined, (old: any) => patchCategory(old, vars.orderRef, vars.category));
      return { prev };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) utils.omnipart.getOrderTracking.setData(undefined, ctx.prev); },
  });
  const set = (c: "car" | "general") => (e: any) => {
    e.stopPropagation();
    m.mutate({ orderRef: order.orderRef, category: order.categoryOverride === c ? null : c });
  };
  const pill = (active: boolean, on: string) =>
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs " + (active ? on : "bg-white text-slate-500 hover:bg-slate-50");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Type:</span>
      <button onClick={set("car")} className={pill(order.category === "car", "bg-blue-600 text-white border-blue-600")}>
        <Car className="w-3 h-3" /> Car job
      </button>
      <button onClick={set("general")} className={pill(order.category === "general", "bg-slate-700 text-white border-slate-700")}>
        <Building2 className="w-3 h-3" /> General
      </button>
      <span className="text-[10px] text-muted-foreground">{order.categoryOverride ? "(pinned)" : "(auto)"}</span>
    </span>
  );
}

// Per-order worklist flags, all derived from data already on the board.
function orderFlags(o: any) {
  const delivered = String(o.status || "").toLowerCase().includes("deliver");
  const parts = o.parts || [];
  return {
    toFit: delivered && parts.some((p: any) => !p.usage),          // arrived but not yet marked fitted/returned/spare
    awaitingCredit: parts.some((p: any) => p.usage === "returned"), // sent back, credit not reconciled
    unlinked: !o.jobSheet,                                          // not attached to a job (mostly eBay)
  };
}

/** Small supplier source tag (ECP / eBay / Amazon / …). */
const SOURCE_TAG: Record<string, { label: string; cls: string }> = {
  ebay: { label: "eBay", cls: "bg-[#e53238]/10 text-[#e53238] border-[#e53238]/30" },
  amazon: { label: "Amazon", cls: "bg-[#ff9900]/10 text-[#b06f00] border-[#ff9900]/40" },
  ecp: { label: "ECP", cls: "bg-orange-100 text-orange-700 border-orange-200" },
};
function SourceBadge({ source }: { source?: string }) {
  const m = SOURCE_TAG[source || "ecp"] || SOURCE_TAG.ecp;
  return <span className={"text-[9px] font-bold px-1 py-0.5 rounded shrink-0 border " + m.cls}>{m.label}</span>;
}

/** One board row that expands on click to show the parts on the order. */
function BoardRow({ o, base }: { o: any; base: string }) {
  const [open, setOpen] = useState(false);
  // Parts come with the board data itself (getOrderTracking reads them from the order list), so the
  // row expands instantly and there's no extra API call to fail or get rate-limited.
  const parts = o.parts || [];
  const isEmail = o.source === "ebay" || o.source === "amazon";
  const itemTitle = parts[0]?.name || o.vehicleText || null;
  // Vehicle column shows the associated CAR first. ECP has its own vehicle; eBay/Amazon show the
  // linked car once linked, otherwise the item itself.
  const vehicle = isEmail
    ? (o.linkedVehicle || itemTitle || "eBay item")
    : [o.make, o.model, o.year].filter(Boolean).join(" ");
  const secondaryItem = isEmail && o.linkedVehicle ? itemTitle : null;
  return (
    <>
      <TableRow className={(o.needsAttention ? "bg-amber-50 " : "") + "cursor-pointer"} onClick={() => setOpen((v) => !v)}>
        <TableCell className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <SourceBadge source={o.source} />
            {o.orderRef}
          </span>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {o.reg ? (
            <Link href={`/view-vehicle/${normReg(o.reg)}`} className="hover:underline">
              <RegPlate reg={o.reg} />
            </Link>
          ) : o.suggestedVehicle ? (
            <span className="inline-flex items-center gap-1 text-xs text-slate-600" title="Guessed from the item — link it to a job below">
              <Car className="w-3 h-3 text-muted-foreground" /> {o.suggestedVehicle}<span className="text-muted-foreground/60">?</span>
            </span>
          ) : <span className="text-muted-foreground/50">—</span>}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <span className="font-medium uppercase tracking-wide">{vehicle || "—"}</span>
              {secondaryItem && <span className="block text-xs text-muted-foreground truncate normal-case">{secondaryItem}</span>}
            </div>
            <span className={"text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 " +
              (o.category === "general" ? "bg-slate-100 text-slate-600 border-slate-200" : "bg-blue-50 text-blue-700 border-blue-200")}>
              {o.category === "general" ? "General" : "Car"}
            </span>
          </div>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {o.jobSheet ? (
            <Link href={`${base}/documents/${o.jobSheet.id}`} className="text-brand-primary hover:underline">
              {o.jobSheet.ga4Number || o.jobSheet.docNo || o.jobSheet.id}
            </Link>
          ) : <span className="text-muted-foreground/60">—</span>}
        </TableCell>
        <TableCell className="text-right">{o.numberOfItems ?? "—"}</TableCell>
        <TableCell className="text-right">{money(o.totalIncTax)}</TableCell>
        <TableCell>{o.orderDate ? new Date(o.orderDate).toLocaleDateString("en-GB") : "—"}</TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <OrderStatusBadge status={o.status} />
            {o.status && !String(o.status).toLowerCase().includes("deliver") && (
              <span className={"text-xs " + (o.needsAttention ? "text-amber-700 font-semibold" : "text-muted-foreground")}>
                {o.needsAttention ? "⚠ " : ""}ordered {agoShort(o.ageHours)}
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={8} className="py-3">
            <div className="px-6 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <CategoryToggle order={o} />
                  {o.seller && <span className="text-xs text-muted-foreground">Seller: <span className="text-slate-600">{o.seller}</span></span>}
                </div>
                <div className="flex items-center gap-2">
                  <JobLink order={o} base={base} />
                  <HideButton order={o} />
                </div>
              </div>
              <SuggestedJobs order={o} />
              <OrderProgress status={o.status} />
              {(o.tracking || o.courier) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                  <Truck className="w-3.5 h-3.5 shrink-0" />
                  {o.courier && <span className="font-medium text-slate-700">{o.courier}</span>}
                  {o.tracking ? (
                    <a href={trackUrl(o.courier, o.tracking)!} target="_blank" rel="noreferrer"
                       className="text-brand-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                      Track {o.tracking}
                    </a>
                  ) : null}
                  {o.eta && <span className="text-muted-foreground/70">· {o.eta}</span>}
                </div>
              )}
              <div className="pt-1">
                {parts.length === 0 && (
                  <div className="text-xs text-muted-foreground/70">No part detail on this order.</div>
                )}
                {parts.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm py-1">
                    <PartThumb src={p.image} alt={p.name || p.code || "part"} />
                    <div className="min-w-0">
                      <div className={"font-medium truncate " + (p.usage === "returned" ? "line-through text-muted-foreground" : "")}>
                        {p.name || p.code || "part"}
                        {p.quantity != null && <span className="text-muted-foreground font-normal"> ×{p.quantity}</span>}
                      </div>
                      {p.code && <div className="text-xs text-muted-foreground/70 tabular-nums">{p.code}</div>}
                    </div>
                    <span className="ml-auto flex items-center gap-3 shrink-0">
                      <UsagePicker orderRef={o.orderRef} code={p.code} usage={p.usage} />
                      {p.status && <span className="text-xs text-muted-foreground/70">{p.status}</span>}
                      {/* Internal cost (ex VAT) — Parts Orders is a staff page; print:hidden as a belt-and-braces guard. */}
                      {p.lineCost != null && (
                        <span className="text-xs tabular-nums text-slate-600 w-16 text-right print:hidden">{money(p.lineCost)}</span>
                      )}
                    </span>
                  </div>
                ))}
                {(() => {
                  const total = parts.reduce((a: number, p: any) => a + (Number(p.lineCost) || 0), 0);
                  return total > 0 ? (
                    <div className="flex items-center justify-end gap-3 pt-1.5 mt-1 border-t print:hidden">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Parts cost · ex VAT · internal</span>
                      <span className="text-sm tabular-nums font-semibold w-16 text-right">{money(total)}</span>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** Board of all recent Euro Car Parts (Omnipart) orders with live delivery status. */
export default function OmnipartOrders() {
  const base = useClassicBase();
  const { data, isLoading, error, refetch, isFetching } =
    trpc.omnipart.getOrderTracking.useQuery(undefined, { staleTime: 5 * 60 * 1000, retry: false });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | "car" | "general">("all");
  const [wl, setWl] = useState<"all" | "tofit" | "credit" | "unlinked" | "hidden">("all");

  const orders = useMemo(() => {
    const all = data?.orders || [];
    const needle = normReg(q);
    let filtered = needle ? all.filter((o) => normReg(o.reg).includes(needle)) : all;
    if (wl === "hidden") {
      filtered = filtered.filter((o: any) => o.hidden);            // the Hidden view shows only hidden
    } else {
      filtered = filtered.filter((o: any) => !o.hidden);           // hidden orders are off the board by default
      if (cat !== "all") filtered = filtered.filter((o: any) => (o.category || "car") === cat);
      if (wl !== "all") filtered = filtered.filter((o: any) => {
        const f = orderFlags(o);
        return wl === "tofit" ? f.toFit : wl === "credit" ? f.awaitingCredit : f.unlinked;
      });
    }
    // orders that need chasing float to the top so a stuck one is never missed
    return [...filtered].sort((a: any, b: any) =>
      (b.needsAttention ? 1 : 0) - (a.needsAttention ? 1 : 0) ||
      String(b.orderDate || "").localeCompare(String(a.orderDate || "")));
  }, [data, q, cat, wl]);
  const allOrders = (data?.orders || []) as any[];
  const visible = allOrders.filter((o: any) => !o.hidden);         // counts exclude hidden orders
  const chasing = visible.filter((o: any) => o.needsAttention).length;
  const carCount = visible.filter((o: any) => (o.category || "car") === "car").length;
  const generalCount = visible.filter((o: any) => o.category === "general").length;
  const hiddenCount = allOrders.filter((o: any) => o.hidden).length;
  const CAT_TABS: Array<{ k: "all" | "car" | "general"; label: string; n: number }> = [
    { k: "all", label: "All", n: visible.length },
    { k: "car", label: "Car jobs", n: carCount },
    { k: "general", label: "General", n: generalCount },
  ];
  const flagged = visible.map(orderFlags);
  const WL_TABS: Array<{ k: "tofit" | "credit" | "unlinked" | "hidden"; label: string; n: number; on: string }> = [
    { k: "tofit", label: "To fit", n: flagged.filter((f) => f.toFit).length, on: "bg-blue-600 text-white border-blue-600" },
    { k: "credit", label: "Awaiting credit", n: flagged.filter((f) => f.awaitingCredit).length, on: "bg-amber-500 text-white border-amber-500" },
    { k: "unlinked", label: "Unlinked", n: flagged.filter((f) => f.unlinked).length, on: "bg-slate-700 text-white border-slate-700" },
    { k: "hidden", label: "Hidden", n: hiddenCount, on: "bg-slate-500 text-white border-slate-500" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="w-6 h-6" /> Parts Orders
            {chasing > 0 && (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-3 py-0.5">
                ⚠ {chasing} need chasing
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 w-56"
                placeholder="Search by reg…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Link href={`${base}/parts-orders/report`}>
              <Button variant="outline" size="sm"><BarChart3 className="w-4 h-4" /> Report</Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                <span className={"w-2 h-2 rounded-full " + (error ? "bg-slate-400" : "bg-green-500 animate-pulse")} />
                {error ? "OFFLINE" : "LIVE"}
              </span>
              Omnipart order tracking{typeof data?.count === "number" ? ` · ${orders.length}/${data.count}` : ""}
            </CardTitle>
            {!error && (
              <div className="flex items-center gap-1.5 pt-2 flex-wrap">
                {CAT_TABS.map((t) => (
                  <button
                    key={t.k}
                    onClick={() => setCat(t.k)}
                    className={"px-3 py-1 rounded-full text-xs font-medium border transition-colors " +
                      (cat === t.k ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 hover:bg-slate-50")}
                  >
                    {t.label}{t.n ? ` · ${t.n}` : ""}
                  </button>
                ))}
                <span className="w-px h-5 bg-slate-200 mx-0.5" />
                {WL_TABS.map((t) => (
                  <button
                    key={t.k}
                    onClick={() => setWl(wl === t.k ? "all" : t.k)}
                    className={"px-3 py-1 rounded-full text-xs font-medium border transition-colors " +
                      (wl === t.k ? t.on : "bg-white text-slate-600 hover:bg-slate-50")}
                    title="Worklist filter — click again to clear"
                  >
                    {t.label}{t.n ? ` · ${t.n}` : ""}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoading && <div className="text-sm text-muted-foreground py-6 text-center">Loading orders…</div>}
            {error && (
              <div className="text-sm text-amber-700 py-6 text-center">
                Couldn't load order tracking — the Omnipart session may need refreshing (reload an Omnipart
                page in the logged-in browser, then Refresh here).
              </div>
            )}
            {!isLoading && !error && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ref</TableHead>
                      <TableHead>Reg</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Job sheet</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {BUCKET_ORDER.map((bucket) => {
                      const inBucket = orders.filter((o: any) => bucketOf(o.orderDate) === bucket);
                      if (inBucket.length === 0) return null;
                      return (
                        <Fragment key={bucket}>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={8} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {bucket} · {inBucket.length}
                            </TableCell>
                          </TableRow>
                          {inBucket.map((o: any) => (
                            <BoardRow key={o.orderRef} o={o} base={base} />
                          ))}
                        </Fragment>
                      );
                    })}
                    {orders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                          No orders {q ? "match that reg" : "found"}.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
