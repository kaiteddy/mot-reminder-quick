import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Truck, Search, RefreshCw, ChevronDown, ChevronRight, Package, Car, Building2, X, BarChart3, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { RegPlate } from "@/components/RegPlate";
import { useClassicBase } from "@/lib/classicNav";
import { OrderProgress, normReg } from "@/components/OmnipartOrdersCard";
import { BUCKETS, RECENT_DAYS, bucketOf, isDelivered, orderStage, orderedLabel, statusIsStale } from "@shared/partsBoard";

function money(v: number | null | undefined) {
  return typeof v === "number" ? `£${v.toFixed(2)}` : "—";
}

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

type RecentJob = {
  id: number; docNo: string | null; ga4Number: string | null; docType: string | null; registration: string | null;
  customerName: string | null; vehicle: string; description: string | null; date: string | null;
};

/** How a job card is named on the board: its GA4 number, marked when it is an invoice or estimate. */
function docLabel(j: { id: number; ga4Number?: string | null; docNo?: string | null; docType?: string | null }) {
  const prefix = j.docType === "SI" ? "Inv " : j.docType === "ES" ? "Est " : "";
  return `${prefix}${j.ga4Number || j.docNo || `#${j.id}`}`;
}

/** One car in the dropdown: its plate, what it is, and what picking it does. */
function CarLine({ reg, vehicle, right }: { reg?: string | null; vehicle?: string | null; right?: string }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      {reg ? <RegPlate reg={reg} size="xs" /> : null}
      <span className="truncate text-xs text-slate-600">{vehicle || ""}</span>
      {right && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{right}</span>}
    </span>
  );
}

/**
 * The Car cell: which car an order is for, as a dropdown (Adam, 15/09/2026: "shouldn't the reg be a
 * drop down"). It opens on the cars in recently, so linking an order is usually one click; typing
 * searches every car on file. Picking a car links the order to its job, and a car with several job
 * cards asks which one. An eBay item that names a car offers that car's jobs first.
 */
function CarPicker({ order, recent }: { order: any; recent: RecentJob[] }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [car, setCar] = useState<{ registration: string; vehicle: string } | null>(null);
  const term = q.trim();
  const regs = trpc.omnipart.searchRegs.useQuery({ q: term }, { enabled: open && !car && term.length >= 2, staleTime: 30_000 });
  const jobs = trpc.omnipart.jobsForReg.useQuery({ reg: car?.registration || "" }, { enabled: open && !!car, staleTime: 30_000 });
  const suggested = trpc.omnipart.suggestJobs.useQuery(
    { vehicle: order.suggestedVehicle || "" },
    { enabled: open && !car && !order.jobSheet && !!order.suggestedVehicle, staleTime: 60_000 },
  );
  const link = trpc.omnipart.setOrderJobSheet.useMutation({
    onError: () => utils.omnipart.getOrderTracking.invalidate(),   // put the board back as the server has it
  });
  const close = () => { setOpen(false); setQ(""); setCar(null); };
  const apply = (job: any, chosen: { registration?: string | null; vehicle?: string | null }) => {
    utils.omnipart.getOrderTracking.setData(undefined, (old: any) =>
      patchJob(old, order.orderRef, { id: job.id, ga4Number: job.ga4Number, docNo: job.docNo, docType: job.docType, date: job.date },
        { reg: chosen.registration || undefined, vehicle: chosen.vehicle || undefined }));
    link.mutate({ orderRef: order.orderRef, jobSheetId: job.id });
    close();
  };
  const unlink = () => {
    utils.omnipart.getOrderTracking.setData(undefined, (old: any) => patchJob(old, order.orderRef, null));
    link.mutate({ orderRef: order.orderRef, jobSheetId: null });
    close();
  };

  // One line per car in recently (its newest job card), narrowed by whatever has been typed.
  const needle = term.toLowerCase();
  const regNeedle = normReg(term);
  const inRecently = useMemo(() => {
    const seen = new Set<string>();
    return recent.filter((j) => {
      const key = normReg(j.registration);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return !needle || key.includes(regNeedle) || j.vehicle.toLowerCase().includes(needle)
        || String(j.customerName || "").toLowerCase().includes(needle);
    });
  }, [recent, needle, regNeedle]);
  const recentKeys = new Set(inRecently.map((j) => normReg(j.registration)));
  const otherCars = (regs.data || []).filter((r: any) => !recentKeys.has(normReg(r.registration)));

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={order.reg ? "Change the car this order is for" : "Choose the car this order is for"}
          className="group -mx-1 inline-flex items-center gap-1 rounded-md border border-dashed border-transparent px-1 py-0.5 hover:border-slate-300 hover:bg-white"
        >
          {order.reg ? (
            <RegPlate reg={order.reg} size="xs" />
          ) : order.suggestedVehicle ? (
            <span className="text-xs text-slate-600">{order.suggestedVehicle}?</span>
          ) : (
            <span className="text-xs text-slate-500">Choose car</span>
          )}
          <ChevronDown className="h-3 w-3 text-slate-400 group-hover:text-slate-700" />
        </button>
      </PopoverTrigger>
      {/* Stop clicks here reaching the row: React events bubble out of a portal, and would fold it. */}
      <PopoverContent align="start" className="w-96 p-0" onClick={(e) => e.stopPropagation()}>
        {!car ? (
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder="Search reg, make or model…" />
            <CommandList className="max-h-80">
              <CommandEmpty>{regs.isFetching ? "Searching…" : "No car found. Try the registration."}</CommandEmpty>
              {!needle && !order.jobSheet && (suggested.data || []).length > 0 && (
                <CommandGroup heading={`Looks like a ${order.suggestedVehicle} part`}>
                  {(suggested.data || []).map((j: any) => (
                    <CommandItem key={`s${j.id}`} value={`s${j.id}`} onSelect={() => apply(j, { registration: j.registration, vehicle: j.vehicle })}>
                      <CarLine reg={j.registration} vehicle={j.vehicle} right={docLabel(j)} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {inRecently.length > 0 && (
                <CommandGroup heading={`In recently · last ${RECENT_DAYS} days`}>
                  {inRecently.map((j) => (
                    <CommandItem key={`r${j.id}`} value={`r${j.id}`} onSelect={() => apply(j, { registration: j.registration, vehicle: j.vehicle })}>
                      <CarLine reg={j.registration} vehicle={j.vehicle || j.customerName} right={docLabel(j)} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {term.length >= 2 && otherCars.length > 0 && (
                <CommandGroup heading="Other cars on file">
                  {otherCars.map((r: any) => (
                    <CommandItem key={`o${r.registration}`} value={`o${r.registration}`} onSelect={() => setCar({ registration: r.registration, vehicle: r.vehicle })}>
                      <CarLine reg={r.registration} vehicle={r.vehicle} right={`${r.jobs} job${r.jobs === 1 ? "" : "s"} ›`} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {order.jobSheet && (
                <CommandGroup>
                  <CommandItem value="unlink" onSelect={unlink} className="text-red-600">
                    <X className="h-3.5 w-3.5" /> Unlink from job {docLabel(order.jobSheet)}
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        ) : (
          <div>
            <div className="flex items-center gap-2 border-b px-2 py-1.5">
              <button type="button" onClick={() => setCar(null)} className="text-slate-500 hover:text-slate-800" title="Back to the cars">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <RegPlate reg={car.registration} size="xs" />
              <span className="truncate text-xs text-muted-foreground">{car.vehicle}</span>
            </div>
            <div className="bg-muted/40 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Which job card?</div>
            <div className="max-h-72 overflow-auto">
              {jobs.isLoading && <div className="px-2 py-2 text-xs text-muted-foreground">Loading job cards…</div>}
              {!jobs.isLoading && (jobs.data || []).length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">No job cards for this car.</div>}
              {(jobs.data || []).map((j: any) => (
                <button key={j.id} type="button" onClick={() => apply(j, car)}
                  className="flex w-full items-center justify-between gap-2 border-b px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="font-medium">{docLabel(j)}</span>
                    {j.description && <span className="block truncate text-muted-foreground/80">{j.description}</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground/70">{j.date ? new Date(j.date).toLocaleDateString("en-GB") : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
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

const USAGE_OPTS: Array<{ key: "fitted" | "returned" | "spare"; label: string; on: string }> = [
  { key: "fitted",   label: "Fitted",   on: "bg-green-600 text-white border-green-600" },
  { key: "returned", label: "Returned", on: "bg-amber-500 text-white border-amber-500" },
  { key: "spare",    label: "Spare",    on: "bg-slate-600 text-white border-slate-600" },
];

/**
 * Fitted / Returned / Spare for one part.
 *
 * A line of one gets the three pills, unchanged. A line of MORE than one also gets a count against
 * each, because four bought and three fitted is the ordinary case — the pills alone would force it
 * to all-or-nothing, which either charges the customer for the fourth or loses the credit on it.
 */
function UsagePicker(
  { orderRef, code, usage, quantity, detail }:
  { orderRef: string; code: string | null; usage: string | null; quantity?: number | null; detail?: any },
) {
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
  const qty = Math.max(Number(quantity ?? 1) || 1, 1);
  const split = trpc.omnipart.setPartQuantities.useMutation({
    onSettled: () => utils.omnipart.getOrderTracking.invalidate(),
  });

  if (!code) return null;

  const counts = {
    fitted: Number(detail?.fitted ?? 0),
    returned: Number(detail?.returned ?? 0),
    spare: Number(detail?.spare ?? 0),
  };
  const undecided = Math.max(qty - counts.fitted - counts.returned - counts.spare, 0);

  const bump = (key: "fitted" | "returned" | "spare", by: number) => {
    const next = { ...counts, [key]: Math.max(counts[key] + by, 0) };
    split.mutate({ orderRef, code, quantityOrdered: qty, ...next });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1 print:hidden">
      <span className="inline-flex rounded-md border overflow-hidden">
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

      {/* Only where a split is possible. On a line of one the pills already say everything. */}
      {qty > 1 ? (
        <span className="inline-flex items-center gap-1 rounded-md border bg-white px-1 py-0.5 text-[11px]">
          {USAGE_OPTS.map((opt) => (
            <span key={opt.key} className="inline-flex items-center">
              <button
                onClick={(e) => { e.stopPropagation(); bump(opt.key, -1); }}
                disabled={counts[opt.key] === 0 || split.isPending}
                className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                aria-label={`One fewer ${opt.label.toLowerCase()}`}
              >−</button>
              <span className="min-w-[2.6rem] text-center tabular-nums text-slate-600">
                {counts[opt.key]} {opt.label.toLowerCase()}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); bump(opt.key, +1); }}
                disabled={undecided === 0 || split.isPending}
                className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                aria-label={`One more ${opt.label.toLowerCase()}`}
              >+</button>
            </span>
          ))}
          {undecided > 0 ? (
            <span className="rounded bg-amber-50 px-1 text-amber-700">{undecided} of {qty} not decided</span>
          ) : null}
        </span>
      ) : null}
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
  const parts = o.parts || [];
  return {
    chase: !!o.needsAttention,                                          // not arrived by 18:00 on the day, this week
    // arrived but not yet marked fitted/returned/spare. isDelivered, not includes("deliver"): the old
    // check counted every eBay "Out for delivery" as arrived.
    toFit: isDelivered(o.status) && parts.some((p: any) => !p.usage),
    awaitingCredit: parts.some((p: any) => p.usage === "returned"),       // sent back, credit not reconciled
    unlinked: !o.jobSheet,                                                // no car / job yet (mostly eBay)
  };
}

/** Small supplier source tag (ECP / eBay / Amazon / …). */
const SOURCE_TAG: Record<string, { label: string; cls: string }> = {
  ebay: { label: "eBay", cls: "bg-[#e53238]/10 text-[#e53238] border-[#e53238]/30" },
  amazon: { label: "Amazon", cls: "bg-[#ff9900]/10 text-[#b06f00] border-[#ff9900]/40" },
  gsf: { label: "GSF", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  ecp: { label: "ECP", cls: "bg-orange-100 text-orange-700 border-orange-200" },
};
function SourceBadge({ source }: { source?: string }) {
  const m = SOURCE_TAG[source || "ecp"] || SOURCE_TAG.ecp;
  return <span className={"text-[9px] font-bold px-1 py-0.5 rounded shrink-0 border " + m.cls}>{m.label}</span>;
}

/** What was bought: the first part and how many more. A description, so never in capitals. */
function itemSummary(o: any): { first: string; more: number } {
  const parts = o.parts || [];
  const first = parts[0]?.name || parts[0]?.code || o.vehicleText || (o.source === "ebay" ? "eBay item" : "Parts order");
  const count = Math.max(parts.length, Number(o.numberOfItems) || 0);
  return { first, more: Math.max(0, count - 1) };
}

const STAGE_PILL: Record<string, [string, string]> = {
  ordered: ["Ordered", "bg-amber-50 text-amber-800 border-amber-200"],
  on_the_way: ["On its way", "bg-blue-50 text-blue-800 border-blue-200"],
  delivered: ["Delivered", "bg-green-50 text-green-800 border-green-200"],
  cancelled: ["Cancelled", "bg-slate-100 text-slate-500 border-slate-200"],
};

/** Where the order has got to in plain words, with the supplier's own wording underneath when it adds something. */
function StatusCell({ o }: { o: any }) {
  const stale = statusIsStale(o);
  const [label, cls] = stale ? ["No update", "bg-slate-50 text-slate-500 border-slate-200"] : STAGE_PILL[orderStage(o.status)];
  const own = String(o.status || "").trim();
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium " + cls}>{label}</span>
      {o.needsAttention ? (
        <span className="text-[11px] font-semibold text-amber-700">⚠ Not arrived — chase</span>
      ) : stale ? (
        <span className="text-[11px] text-muted-foreground">last said "{own || "nothing"}"</span>
      ) : own && own.toLowerCase() !== label.toLowerCase() ? (
        <span className="text-[11px] text-muted-foreground">{own}</span>
      ) : null}
    </div>
  );
}

/** One board row that expands on click to show the parts on the order. */
function BoardRow({ o, base, recent }: { o: any; base: string; recent: RecentJob[] }) {
  const [open, setOpen] = useState(false);
  // Parts come with the board data itself (getOrderTracking reads them from the order list), so the
  // row expands instantly and there's no extra API call to fail or get rate-limited.
  const parts = o.parts || [];
  const { first, more } = itemSummary(o);
  // The car the order is for: the linked car, or the supplier's own vehicle details (ECP).
  const vehicle = o.linkedVehicle || [o.make, o.model, o.year].filter(Boolean).join(" ");
  const cancelled = orderStage(o.status) === "cancelled";
  return (
    <>
      <TableRow
        className={(o.needsAttention ? "bg-amber-50 hover:bg-amber-100/60 " : "") + (cancelled ? "opacity-60 " : "") + "cursor-pointer"}
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell className="whitespace-nowrap align-top">
          <span className="inline-flex items-center gap-1.5">
            {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            <span className="font-medium text-slate-800">{orderedLabel(o.orderDate)}</span>
          </span>
        </TableCell>
        <TableCell className="w-full max-w-0 align-top">
          <div className="truncate text-sm text-slate-800" title={first}>
            {first}{more > 0 && <span className="text-muted-foreground"> +{more} more</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <SourceBadge source={o.source} />
            <span className="tabular-nums">{o.orderRef}</span>
            {o.category === "general" && <span className="rounded border bg-slate-50 px-1 text-[10px] text-slate-500">General</span>}
          </div>
        </TableCell>
        <TableCell className="whitespace-nowrap align-top" onClick={(e) => e.stopPropagation()}>
          <CarPicker order={o} recent={recent} />
          {vehicle && (
            <div className="mt-0.5 max-w-[14rem] truncate text-[11px] uppercase tracking-wide text-muted-foreground" title={vehicle}>{vehicle}</div>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap align-top" onClick={(e) => e.stopPropagation()}>
          {o.jobSheet ? (
            <Link href={`${base}/documents/${o.jobSheet.id}`} className="text-sm text-brand-primary hover:underline">
              {docLabel(o.jobSheet)}
            </Link>
          ) : <span className="text-muted-foreground/50">—</span>}
        </TableCell>
        <TableCell className="whitespace-nowrap align-top"><StatusCell o={o} /></TableCell>
        <TableCell className="whitespace-nowrap text-right align-top tabular-nums">{money(o.totalIncTax)}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={6} className="py-3">
            <div className="px-6 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <CategoryToggle order={o} />
                  {o.seller && <span className="text-xs text-muted-foreground">Seller: <span className="text-slate-600">{o.seller}</span></span>}
                  {o.status && <span className="text-xs text-muted-foreground">Supplier says: <span className="text-slate-600">{o.status}</span></span>}
                </div>
                <HideButton order={o} />
              </div>
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
                      <UsagePicker orderRef={o.orderRef} code={p.code} usage={p.usage} quantity={p.quantity} detail={p.usageDetail} />
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

type Worklist = "all" | "chase" | "tofit" | "credit" | "unlinked" | "hidden";

/** Every parts order — Euro Car Parts, GSF and eBay — with where it has got to and the car it is for. */
export default function OmnipartOrders() {
  const base = useClassicBase();
  const { data, isLoading, error, refetch, isFetching } =
    trpc.omnipart.getOrderTracking.useQuery(undefined, { staleTime: 5 * 60 * 1000, retry: false });
  const recentJobs = trpc.omnipart.recentJobs.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const recent = (recentJobs.data || []) as RecentJob[];
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | "car" | "general">("all");
  const [wl, setWl] = useState<Worklist>("all");
  const [showOlder, setShowOlder] = useState(false);

  const all = (data?.orders || []) as any[];
  const searching = q.trim().length > 0;
  const olderCount = all.filter((o) => !o.hidden && bucketOf(o.orderDate) === "Older").length;
  const chasing = all.filter((o) => !o.hidden && o.needsAttention).length;

  // The orders in view. Hidden ones appear only on the Hidden list. The board opens on the last
  // RECENT_DAYS days — 221 eBay orders over two months old still said "Out for delivery", which buried
  // the week's orders — and a search looks at every date, so an old order can still be found.
  const inView = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const regNeedle = normReg(q);
    return all.filter((o) => {
      if (wl === "hidden" ? !o.hidden : o.hidden) return false;
      if (!needle) return showOlder || bucketOf(o.orderDate) !== "Older";
      const vehicle = String(o.linkedVehicle || [o.make, o.model].filter(Boolean).join(" ") || o.suggestedVehicle || "").toLowerCase();
      return (regNeedle.length >= 2 && normReg(o.reg).includes(regNeedle))
        || String(o.orderRef || "").toLowerCase().includes(needle)
        || vehicle.includes(needle)
        || (o.parts || []).some((p: any) => String(p.name || "").toLowerCase().includes(needle));
    });
  }, [all, q, showOlder, wl]);

  const orders = useMemo(() => {
    const rows = inView
      .filter((o) => cat === "all" || (o.category || "car") === cat)
      .filter((o) => {
        if (wl === "all" || wl === "hidden") return true;
        const f = orderFlags(o);
        return wl === "chase" ? f.chase : wl === "tofit" ? f.toFit : wl === "credit" ? f.awaitingCredit : f.unlinked;
      });
    // orders that need chasing float to the top so a stuck one is never missed
    return [...rows].sort((a, b) =>
      (b.needsAttention ? 1 : 0) - (a.needsAttention ? 1 : 0) ||
      String(b.orderDate || "").localeCompare(String(a.orderDate || "")));
  }, [inView, cat, wl]);

  const flags = inView.map(orderFlags);
  const CAT_TABS: Array<{ k: "all" | "car" | "general"; label: string; n: number }> = [
    { k: "all", label: "All", n: inView.length },
    { k: "car", label: "Car jobs", n: inView.filter((o) => (o.category || "car") === "car").length },
    { k: "general", label: "General", n: inView.filter((o) => o.category === "general").length },
  ];
  const WL_TABS: Array<{ k: Exclude<Worklist, "all">; label: string; n: number; on: string; title: string }> = [
    { k: "chase", label: "To chase", n: flags.filter((f) => f.chase).length, on: "bg-amber-600 text-white border-amber-600",
      title: "Not arrived by 6pm on the day it was ordered, in the last week" },
    { k: "tofit", label: "To fit", n: flags.filter((f) => f.toFit).length, on: "bg-blue-600 text-white border-blue-600",
      title: "Delivered, but no part marked fitted, returned or spare yet" },
    { k: "credit", label: "Awaiting credit", n: flags.filter((f) => f.awaitingCredit).length, on: "bg-amber-500 text-white border-amber-500",
      title: "A part went back: check the credit came through" },
    { k: "unlinked", label: "No car", n: flags.filter((f) => f.unlinked).length, on: "bg-slate-700 text-white border-slate-700",
      title: "Not linked to a car yet: pick one in the Car column" },
    { k: "hidden", label: "Hidden", n: all.filter((o) => o.hidden).length, on: "bg-slate-500 text-white border-slate-500",
      title: "Garage supplies and anything else taken off the board" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="w-6 h-6" /> Parts Orders
            {chasing > 0 && (
              <button
                type="button"
                onClick={() => setWl("chase")}
                title="Not arrived by 6pm on the day it was ordered: show them"
                className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-3 py-0.5 hover:bg-amber-200"
              >
                ⚠ {chasing} to chase
              </button>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 w-64"
                placeholder="Search reg, part or order no…"
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
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                <span className={"w-2 h-2 rounded-full " + (error ? "bg-slate-400" : "bg-green-500 animate-pulse")} />
                {error ? "OFFLINE" : "LIVE"}
              </span>
              Orders from Euro Car Parts, GSF and eBay
              {data && (
                <span className="text-sm font-normal text-muted-foreground">
                  · {orders.length} shown{searching ? ", searching every date" : showOlder ? ", every date" : `, last ${RECENT_DAYS} days`}
                </span>
              )}
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
                    title={`${t.title} — click again to clear`}
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
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Ordered</TableHead>
                        <TableHead>What was ordered</TableHead>
                        <TableHead className="whitespace-nowrap">Car</TableHead>
                        <TableHead className="whitespace-nowrap">Job</TableHead>
                        <TableHead className="whitespace-nowrap">Status</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {BUCKETS.map((bucket) => {
                        const inBucket = orders.filter((o) => bucketOf(o.orderDate) === bucket);
                        if (inBucket.length === 0) return null;
                        return (
                          <Fragment key={bucket}>
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                              <TableCell colSpan={6} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {bucket} · {inBucket.length}
                              </TableCell>
                            </TableRow>
                            {inBucket.map((o) => (
                              <BoardRow key={o.orderRef} o={o} base={base} recent={recent} />
                            ))}
                          </Fragment>
                        );
                      })}
                      {orders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                            {searching
                              ? "No orders match that search."
                              : `No orders ${cat !== "all" || wl !== "all" ? "like that " : ""}in the last ${RECENT_DAYS} days.`}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                {!searching && wl !== "hidden" && olderCount > 0 && (
                  <div className="pt-3 text-center">
                    <Button variant="outline" size="sm" onClick={() => setShowOlder((v) => !v)}>
                      {showOlder ? `Hide the ${olderCount} older orders` : `Show ${olderCount} older orders`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
