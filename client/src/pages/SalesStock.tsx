import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Car, RefreshCw, Loader2, ExternalLink, Gauge, CalendarClock, ShieldCheck, Search, AlertTriangle, Eye, LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown, ReceiptText, BadgePoundSterling, Undo2, Upload, Printer, Globe, CloudOff } from "lucide-react";

const money = (n: any) => Number(n || 0).toLocaleString("en-GB");
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("en-GB") : "";

/**
 * What the used-car sales invoice needs but this car can't supply yet.
 *
 * These are the fields createFromStock pre-fills, so anything listed here is a blank the invoice
 * can't fill on its own — the car is stuck until someone finds it. Chassis and first-registration
 * date can come from either the stocklist or the garage's own vehicle record, so a car is only
 * short of them when BOTH are empty.
 *
 * Engine number is deliberately NOT here. The printed form asks for it "(if any)", and it only
 * ever reaches us on the garage's own vehicle record — 17 of the 24 stock cars lack one, so
 * treating it as a blocker would bury the handful of cars that genuinely are stuck.
 */
function missingBits(c: any): { purchase: string[]; invoice: string[]; noDeal: boolean } {
  const purchase: string[] = [];
  if (!c.purchasedOn) purchase.push("date");
  if (c.purchasedFor == null || Number(c.purchasedFor) <= 0) purchase.push("price paid");
  if (!c.purchasedFrom) purchase.push("source");

  const invoice: string[] = [];
  if (!c.registration) invoice.push("reg");
  if (!c.make) invoice.push("make");
  if (!c.model && !c.variant && !c.vehDerivative) invoice.push("model");
  if (!c.vin && !c.vehVin) invoice.push("chassis");
  if (!c.registrationDate && !c.vehFirstRegistered) invoice.push("first reg");
  if (c.mileage == null) invoice.push("mileage");
  if (Number(c.price) <= 0) invoice.push("sale price");

  // Nothing at all on the buying side means no car deal exists — the car is in stock with no
  // record of what was paid for it, which is a bigger hole than any single blank field.
  const noDeal = !c.purchasedOn && c.purchasedFor == null && !c.purchasedFrom;
  return { purchase, invoice, noDeal };
}
const missingCount = (c: any) => { const m = missingBits(c); return m.purchase.length + m.invoice.length; };

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

/** The price verdict as plain coloured text — a pill here would just be another badge in a row
 *  that already has enough of them. Only "High" (slow to sell) is meant to catch the eye. */
const PRICE_RANK: Record<string, number> = { great: 0, low: 1, good: 2, fair: 3, high: 4 };

const PRICE_TEXT: Record<string, string> = {
  green: "text-green-600", amber: "text-amber-600 font-medium", sky: "text-sky-600", slate: "text-slate-400",
};

const TONE: Record<string, string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  slate: "border-slate-200 bg-slate-50 text-slate-500",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
};

function SortHead({ label, k, sortKey, sortDir, onSort, align = "left", pad = "px-2", extra = "" }: { label: string; k: string; sortKey: string; sortDir: "asc" | "desc"; onSort: (k: string) => void; align?: "left" | "right" | "center"; pad?: string; extra?: string }) {
  const active = sortKey === k;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th className={`font-semibold py-2 ${pad} text-${align} whitespace-nowrap ${extra}`}>
      <button onClick={() => onSort(k)} className={`inline-flex items-center gap-1 ${justify} hover:text-slate-700 ${active ? "text-violet-700" : ""}`}>
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}

/** A heading that carries two sorts — "MOT / Tax" — so fusing the columns costs no sorting. */
function TwoSort({ a, b, sortKey, sortDir, onSort }: { a: { label: string; k: string }; b: { label: string; k: string }; sortKey: string; sortDir: "asc" | "desc"; onSort: (k: string) => void }) {
  const One = ({ label, k }: { label: string; k: string }) => (
    <button onClick={() => onSort(k)} className={`inline-flex items-center gap-0.5 hover:text-slate-700 ${sortKey === k ? "text-violet-700" : ""}`}>
      {label}
      {sortKey === k ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
  return <span className="inline-flex items-center gap-0.5 whitespace-nowrap"><One {...a} /><span className="opacity-40">/</span><One {...b} /></span>;
}

export default function SalesStock() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState("");
  // "Which cars are we stuck on" — narrows the list to those the invoice can't be raised for yet.
  const [onlyStuck, setOnlyStuck] = useState(false);
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("salesStockView") as "grid" | "list") || "grid");
  const setViewPersist = (v: "grid" | "list") => { setView(v); localStorage.setItem("salesStockView", v); };
  const utils = trpc.useUtils();
  // compliance data — always fetch fresh on open so MOT/tax can never show a stale value
  const { data, isLoading } = trpc.salesStock.list.useQuery(undefined, { staleTime: 0, refetchOnMount: "always" });
  const refresh = trpc.salesStock.refresh.useMutation({
    onSuccess: (r: any) => {
      const gaps = Object.entries(r.gapsFilled || {}).map(([k, v]) => `${v} ${k}`).join(", ");
      toast.success(`Refreshed MOT/tax on ${r.updated} cars${r.filled ? ` · filled ${r.filled} blanks from DVLA/DVSA (${gaps})` : ""}`);
      utils.salesStock.list.invalidate();
    },
    onError: (e) => toast.error(e.message || "Refresh failed"),
  });

  // Pull in what the website is advertising. Adds and updates only — a car in stock that isn't
  // advertised is reported back and left alone, which is why this is safe to press at any time.
  const syncSite = trpc.salesStock.syncWebsite.useMutation({
    onSuccess: (r: any) => {
      const unlisted = (r.notAdvertised || []).filter((c: any) => !/^sold$/i.test(String(c.status || "")));
      const bits = [
        r.added.length ? `added ${r.added.length} (${r.added.map((a: any) => a.registration).join(", ")})` : "",
        r.updated.length ? `updated ${r.updated.length}` : "",
        unlisted.length ? `${unlisted.length} in stock but not advertised` : "",
        r.statusDisagrees?.length ? `${r.statusDisagrees.length} advertised but marked ${r.statusDisagrees[0].status}` : "",
      ].filter(Boolean);
      toast.success(`Website: ${r.online} advertised · ${bits.join(" · ") || "everything already matched"}`);
      if (r.errors?.length) toast.error(r.errors.join("; "));
      utils.salesStock.list.invalidate();
    },
    onError: (e) => toast.error(e.message || "Could not read the website"),
  });

  const [sortKey, setSortKey] = useState("price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sortBy = (k: string) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "vehicle" || k === "reg" ? "asc" : "desc"); }
  };

  // Invoices already raised, so an existing one is opened rather than silently duplicated.
  // Keyed by kind as well as car: the same car can be bought in on one form and sold on another.
  const { data: saleInvoices } = trpc.vehicleSale.list.useQuery();
  const invoiceByStockId = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of (saleInvoices as any[]) || []) {
      if (inv.salesStockId != null) m.set(`${inv.salesStockId}:${inv.docKind || "sale"}`, inv.id);
    }
    return m;
  }, [saleInvoices]);
  // Which car the sale-or-purchase chooser is open for.
  const [invoiceFor, setInvoiceFor] = useState<any>(null);
  // Buying a car in from a customer: there is no auction invoice and often no stock row yet.
  // Match the plate first (never a second forecourt row for a car we already hold), then raise
  // the purchase document against it and open the same form we use for sales.
  const stockForReg = trpc.vehicleSale.createPurchaseForRegistration.useMutation({
    onSuccess: (r: any) => raiseInvoice.mutate({ salesStockId: r.salesStockId, docKind: "purchase" }),
    onError: (e) => toast.error(e.message || "Could not start the purchase invoice"),
  });
  // An in-app dialog, not window.prompt: browsers suppress prompt() in enough situations
  // (Safari especially) that the button simply did nothing.
  const [purchaseReg, setPurchaseReg] = useState<string | null>(null);
  const startPurchase = () => setPurchaseReg("");

  const raiseInvoice = trpc.vehicleSale.createFromStock.useMutation({
    onSuccess: (r: any) => { utils.vehicleSale.list.invalidate(); setInvoiceFor(null); setLocation(`/vehicle-sale/${r.id}`); },
    onError: (e) => toast.error(e.message || "Could not raise the invoice"),
  });

  // Mark sold: capture price/date, then hand over to the invoice if asked.
  const [soldTarget, setSoldTarget] = useState<any>(null);
  // Which car's purchase details are being filled in from the Needs column.
  const [fixTarget, setFixTarget] = useState<{ car: any; kind: "purchase" | "invoice" } | null>(null);
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
  const stuckCount = useMemo(() => cars.filter((c) => missingCount(c) > 0).length, [cars]);
  /**
   * Which cars the website is currently advertising.
   *
   * The sync stamps `lastSeenOnline` on every car it found and leaves the rest untouched, so the
   * cars carrying the LATEST stamp are the ones on the site — an old stamp means "was advertised,
   * isn't now". With no stamps anywhere the sync has never run, and the page says nothing at all
   * rather than labelling the whole forecourt unadvertised.
   */
  const lastSync = useMemo(
    () => cars.reduce((m: number, c: any) => Math.max(m, c.lastSeenOnline ? +new Date(c.lastSeenOnline) : 0), 0), [cars]);
  const isAdvertised = useCallback(
    (c: any) => !!lastSync && !!c.lastSeenOnline && +new Date(c.lastSeenOnline) >= lastSync - 36e5, [lastSync]);
  // Worth someone's attention: still on the books, not sold, and the website isn't showing it.
  const unlisted = useMemo(
    () => (lastSync ? cars.filter((c: any) => !isAdvertised(c) && !isSold(c)) : []), [cars, lastSync, isAdvertised]);
  const [onlyUnlisted, setOnlyUnlisted] = useState(false);

  /**
   * MOT and tax share a column now, but they are separate questions and stay separately
   * filterable — an expired MOT, an MOT due within the month and an untaxed car are three
   * different jobs for three different days. The stat tiles already counted them, so they are the
   * filters: click one to see just those cars, click it again to clear.
   */
  const [statFilter, setStatFilter] = useState<null | "alerts" | "motExpired" | "motSoon" | "untaxed">(null);
  const toggleStat = (k: typeof statFilter) => setStatFilter((v) => (v === k ? null : k));
  const STAT_LABEL: Record<string, string> = {
    alerts: "vehicle-check alerts only", motExpired: "MOT expired only",
    motSoon: "MOT due within 30 days only", untaxed: "untaxed / SORN only",
  };
  /** One car against one tile. Shares motStatus/taxTone with the tiles so the count and the list
   *  can never disagree. */
  const matchesStat = useCallback((c: any, k: NonNullable<typeof statFilter>) => {
    const tone = motStatus(c.motExpiryDate).tone;
    if (k === "alerts") return !!c.checkIssues;
    if (k === "motExpired") return tone === "red";
    if (k === "motSoon") return tone === "amber";
    return !!c.taxStatus && !/^taxed$/i.test(String(c.taxStatus));
  }, []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let out = onlyStuck ? cars.filter((c) => missingCount(c) > 0) : cars;
    if (onlyUnlisted) out = out.filter((c: any) => !isAdvertised(c) && !isSold(c));
    if (statFilter) out = out.filter((c: any) => matchesStat(c, statFilter));
    if (f) out = out.filter((c) => `${c.registration} ${c.make} ${c.model} ${c.colour} ${c.fuelType}`.toLowerCase().includes(f));
    return out;
  }, [cars, filter, onlyStuck, onlyUnlisted, isAdvertised, statFilter, matchesStat]);

  const sorted = useMemo(() => {
    const VAL: Record<string, (c: any) => any> = {
      vehicle: (c) => `${c.make || ""} ${c.model || ""}`.toLowerCase(),
      reg: (c) => String(c.registration || ""),
      price: (c) => Number(c.price) || 0,
      mileage: (c) => Number(c.mileage) || 0,
      // Ranked, not alphabetical: the useful sort is dearest-against-the-market first, because
      // "High" is the car that isn't shifting. Unrated cars sort to the far end either way.
      indicator: (c) => PRICE_RANK[String(c.priceIndicator || "").toLowerCase()] ?? -1,
      days: (c) => Number(c.daysInStock) || 0,
      mot: (c) => (c.motExpiryDate ? new Date(c.motExpiryDate).getTime() : 0),
      tax: (c) => (/^taxed$/i.test(c.taxStatus || "") ? 1 : 0), // untaxed/SORN sort first when asc
      // Never-purchased and never-dated cars sort to the far end either way rather than clumping
      // with the oldest, which would read as "bought in 1970".
      purchased: (c) => (c.purchasedOn ? new Date(c.purchasedOn).getTime() : -Infinity),
      added: (c) => (c.createdAt ? new Date(c.createdAt).getTime() : -Infinity),
      missing: (c) => missingCount(c),
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

  /**
   * What the printed sheet says across the top. Deliberately counted from `sorted` — the rows that
   * actually reach the paper — and not from `stats`, which counts the whole fleet: filter the list
   * down to one make and a stats-based header would print "25 cars" above eight of them.
   */
  const printSummary = useMemo(() => {
    let motExpired = 0, motSoon = 0, untaxed = 0;
    for (const c of sorted) {
      const m = motStatus(c.motExpiryDate);
      if (m.tone === "red") motExpired++; else if (m.tone === "amber") motSoon++;
      if (c.taxStatus && !/^taxed$/i.test(c.taxStatus)) untaxed++;
    }
    return { count: sorted.length, motExpired, motSoon, untaxed };
  }, [sorted]);

  /**
   * Printing has to escape the dashboard shell. Hiding the chrome with `visibility` leaves its
   * boxes in the layout, so the sheet inherits the sidebar's offset and prints far to the right.
   * Tag every ancestor between the table and <body> instead: print CSS collapses those to
   * `display: contents` and drops their other children, which is also what removes the page
   * heading, the stat tiles and the filter bar from the printout without tagging each one.
   *
   * Same technique as the sales invoice, which documents it at length. The tag is inert on screen,
   * but it MUST come off on unmount — left behind it would blank every other page's printout.
   */
  const taggedRef = useRef<Element[]>([]);
  const untagPrintAncestors = useCallback(() => {
    taggedRef.current.forEach((el) => el.classList.remove("stock-print-passthrough"));
    taggedRef.current = [];
  }, []);
  const tagPrintAncestors = useCallback(() => {
    const root = document.querySelector(".stock-print-root");
    // Switching to grid view takes the table, and the root with it. The tags have to come off
    // with it rather than sit there describing a shell that no longer wraps anything.
    if (!root) { untagPrintAncestors(); return; }
    for (let el = root.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.classList.contains("stock-print-passthrough")) continue;
      el.classList.add("stock-print-passthrough");
      taggedRef.current.push(el);
    }
  }, [untagPrintAncestors]);
  // Tag on render as well as on click. Ctrl+P never goes through the button, and it has to find
  // the shell already tagged or it prints the table halfway off the right-hand edge.
  useEffect(() => { tagPrintAncestors(); }, [tagPrintAncestors, isLoading, view]);
  useEffect(() => untagPrintAncestors, [untagPrintAncestors]);

  /**
   * The printed list IS the list-view table, so a print asked for from grid view has to switch
   * view first and go to the printer on a later render — hence the flag rather than calling
   * window.print() straight from the click.
   */
  const [pendingPrint, setPendingPrint] = useState(false);
  useEffect(() => {
    if (!pendingPrint || view !== "list" || isLoading) return;
    setPendingPrint(false);
    tagPrintAncestors();
    window.print();
  }, [pendingPrint, view, isLoading, tagPrintAncestors]);
  const handlePrint = () => { if (view !== "list") setViewPersist("list"); setPendingPrint(true); };

  return (
    <DashboardLayout>
      {/* Only the table goes to the printer, and it starts at the page origin. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 9mm; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          /* Every shell rule is guarded on a print root being in the DOM. Grid view has no table
             and so no root, and the tags can outlive it — unguarded, the rules then collapse the
             shell around nothing and a blank sheet comes out of the printer. */
          body:has(.stock-print-root) .stock-print-passthrough { display: contents !important; }
          body:has(.stock-print-root) > *:not(.stock-print-passthrough):not(.stock-print-root),
          body:has(.stock-print-root) .stock-print-passthrough > *:not(.stock-print-passthrough):not(.stock-print-root) { display: none !important; }
          .stock-print-root { display: block !important; margin: 0 !important; padding: 0 !important; }
          /* The screen table scrolls sideways inside a fixed minimum; paper has neither. */
          .stock-print-root table { width: 100% !important; min-width: 0 !important; font-size: 9.5px !important; }
          .stock-print-root td, .stock-print-root th { padding: 2.5px 4px !important; }
          /* A stock list runs past one sheet, so repeat the header and never split a car in half. */
          .stock-print-root thead { display: table-header-group; }
          .stock-print-root tr { break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-[1500px] mx-auto p-4 space-y-4 text-slate-800">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2"><Car className="w-5 h-5 text-violet-600" /> Sales Cars Stock</h1>
            <p className="text-sm text-slate-500">Forecourt stock with live DVLA MOT &amp; tax status.</p>
          </div>
          {/* Wraps as a GROUP. Left to itself the row shrinks each button until every label
              breaks over two lines, which is what a narrow window used to look like. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden shrink-0">
              <button onClick={() => setViewPersist("grid")} title="Grid view" className={`px-2.5 py-2 ${view === "grid" ? "bg-violet-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setViewPersist("list")} title="List view" className={`px-2.5 py-2 border-l border-slate-300 ${view === "list" ? "bg-violet-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}><List className="w-4 h-4" /></button>
            </div>
            <button onClick={startPurchase} disabled={stockForReg.isPending || raiseInvoice.isPending}
              title="Raise a Used Car Purchase Invoice for a car bought from a customer"
              className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Upload className="w-4 h-4 rotate-180" /> Purchase invoice
            </button>
            <button onClick={() => setLocation("/log-purchase")}
              title="Log a car you've bought by uploading its purchase invoice"
              className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100">
              <Upload className="w-4 h-4" /> Log a purchase
            </button>
            <button onClick={() => syncSite.mutate({})} disabled={syncSite.isPending}
              title="Read elimotors.co.uk and bring the stock list into line — adds cars that went live, updates prices and photos. Never removes a car that isn't advertised."
              className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
              {syncSite.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Sync website
            </button>
            <button onClick={() => refresh.mutate()} disabled={refresh.isPending}
              className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
              {refresh.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh MOT/Tax
            </button>
            <button onClick={handlePrint}
              title="Print the stock list for the garage — no sale prices, no buttons"
              className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              <Printer className="w-4 h-4" /> Print list
            </button>
          </div>
        </div>

        {/* Six across only once there is genuinely room. The breakpoint is the VIEWPORT, and the
            sidebar takes ~230px out of it, so at lg the tiles were ~130px wide and every label
            broke in two. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label="Cars in stock" value={String(stats.count)} />
          <Stat label="Total value" value={`£${money(stats.value)}`} />
          <Stat label="Check alerts" value={String(stats.alerts)} tone={stats.alerts ? "red" : "green"}
            active={statFilter === "alerts"} onClick={() => toggleStat("alerts")} />
          <Stat label="MOT expired" value={String(stats.motExpired)} tone={stats.motExpired ? "red" : "green"}
            active={statFilter === "motExpired"} onClick={() => toggleStat("motExpired")} />
          <Stat label="MOT due ≤30d" value={String(stats.motSoon)} tone={stats.motSoon ? "amber" : "green"}
            active={statFilter === "motSoon"} onClick={() => toggleStat("motSoon")} />
          <Stat label="Untaxed / SORN" value={String(stats.untaxed)} tone={stats.untaxed ? "red" : "green"}
            active={statFilter === "untaxed"} onClick={() => toggleStat("untaxed")} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by reg, make, model, colour…"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-[14px] outline-none focus:border-violet-500" />
          </div>
          <button
            onClick={() => setOnlyStuck((v) => !v)}
            title="Cars the sales invoice can't be raised for yet — something it needs is missing"
            className={`h-9 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap ${onlyStuck ? "border-amber-400 bg-amber-100 text-amber-900" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
            Missing invoice info {stuckCount}
          </button>
          {unlisted.length > 0 && (
            <button
              onClick={() => setOnlyUnlisted((v) => !v)}
              title="In stock and not sold, but the website isn't advertising it — in prep, held back, or sold without being marked"
              className={`h-9 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap ${onlyUnlisted ? "border-sky-400 bg-sky-100 text-sky-900" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              <CloudOff className="mr-1.5 inline h-3.5 w-3.5" />
              Not advertised {unlisted.length}
            </button>
          )}
        </div>

        {isLoading ? <div className="text-center text-slate-400 py-12"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
          : cars.length === 0 ? <div className="text-center text-slate-500 py-12">No stock cars yet — press <strong>Sync website</strong> to pull in what elimotors.co.uk is advertising.</div>
          : view === "list" ? (
            <div className="stock-print-root rounded-xl border border-slate-200 bg-white overflow-x-auto print:overflow-visible print:rounded-none print:border-0">
              {/* Paper only. A printed sheet has to say what it is and when it was run — and
                  because the filter carries through to the printout, whether it is the whole
                  fleet or a slice of it. */}
              <div className="hidden print:block px-1 pb-1.5">
                <div className="flex items-baseline justify-between">
                  <div className="text-[13px] font-bold">ELI MOTORS LTD · Sales Cars Stock</div>
                  <div className="text-[9px]">Printed {new Date().toLocaleDateString("en-GB")}</div>
                </div>
                <div className="text-[9px]">
                  {printSummary.count} car{printSummary.count === 1 ? "" : "s"}
                  {" · "}{printSummary.motExpired} MOT expired
                  {" · "}{printSummary.motSoon} MOT due ≤30d
                  {" · "}{printSummary.untaxed} untaxed/SORN
                  {(filter.trim() || onlyStuck || onlyUnlisted || statFilter) && (
                    <span className="font-semibold">
                      {" · filtered"}{filter.trim() ? ` by “${filter.trim()}”` : ""}{onlyStuck ? ", missing invoice info only" : ""}{onlyUnlisted ? ", not advertised only" : ""}{statFilter ? `, ${STAT_LABEL[statFilter]}` : ""} — not the whole fleet
                    </span>
                  )}
                </div>
              </div>
              <table className="w-full text-[13px] min-w-[720px]">
                <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                  <tr>
                    <SortHead label="Vehicle" k="vehicle" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} pad="px-3"
                      extra="sticky left-0 z-20 bg-slate-50 border-r border-slate-200 print:static print:border-r-0" />
                    <SortHead label="Reg" k="reg" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    <SortHead label="Price" k="price" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} align="right" />
                    <SortHead label="Market" k="indicator" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    <SortHead label="Miles" k="mileage" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} align="right" />
                    <SortHead label="Days" k="days" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} align="center" />
                    <SortHead label="Bought" k="purchased" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    <SortHead label="Needs" k="missing" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    {/* One column, both sorts. MOT and tax are read together — "is this car legal
                        to sell?" — and as two columns they cost 200px the table hasn't got. */}
                    <th className="text-left font-semibold px-2 py-2">
                      <TwoSort a={{ label: "MOT", k: "mot" }} b={{ label: "Tax", k: "tax" }} sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
                    </th>
                    {/* The garage's copy stops at the MOT: the sold price and the row actions are
                        no use on paper, and the sold price is not the workshop's business. */}
                    <th className="text-right font-semibold px-2 py-2 print:hidden">Sale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((c) => {
                    const mot = motStatus(c.motExpiryDate);
                    return (
                      <tr key={c.id} onClick={() => setLocation(`/view-vehicle/${encodeURIComponent(c.registration)}`)}
                        className={`group cursor-pointer ${c.checkIssues ? "bg-red-50" : "bg-white"} hover:bg-slate-50`}>
                        {/* Twelve columns don't fit a narrow window, so the table scrolls sideways —
                            and the make, model and photo were the first thing to disappear, leaving
                            rows you couldn't identify. Pinned, with the row's own background repeated
                            on it (a sticky cell doesn't inherit the row's) so it doesn't read as a
                            floating tile as the rest slides underneath. */}
                        <td className={`sticky left-0 z-10 px-3 py-2 ${c.checkIssues ? "bg-red-50" : "bg-white"} group-hover:bg-slate-50 border-r border-slate-200 print:static print:border-r-0`}>
                          <div className="flex items-center gap-2.5">
                            {c.imageUrl
                              ? <img src={c.imageUrl} alt="" loading="lazy" className="w-12 h-9 object-cover rounded shrink-0 print:hidden" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                              : <div className="w-12 h-9 bg-slate-100 rounded flex items-center justify-center shrink-0 print:hidden"><Car className="w-4 h-4 text-slate-300" /></div>}
                            {/* No width cap: truncation is by `truncate` alone, so the column takes
                                the room the table has spare and only clips when it genuinely runs
                                out. A fixed cap clipped the name on a wide screen with space beside
                                it. Both lines carry a title either way. */}
                            <div className="min-w-0">
                              <div className="font-medium truncate" title={`${c.make || ""} ${c.model || ""}${c.variant ? ` ${c.variant}` : ""}`.trim()}>{c.make} {c.model}</div>
                              <div className="text-[11px] text-slate-500 truncate" title={[c.year, c.colour, c.fuelType, c.transmission].filter(Boolean).join(" · ")}>{[c.year, c.colour, c.fuelType].filter(Boolean).join(" · ")}</div>
                              {c.checkIssues && (
                                <div className="text-[11px] font-semibold text-red-700 inline-flex items-center gap-1 max-w-full" title={`Vehicle check: ${c.checkIssues}`}>
                                  <AlertTriangle className="w-3 h-3 shrink-0" /><span className="truncate">{c.checkIssues}</span>
                                </div>
                              )}
                              {!!lastSync && !isAdvertised(c) && !isSold(c) && (
                                <div className="text-[11px] text-sky-700 inline-flex items-center gap-1 print:hidden" title={c.lastSeenOnline ? `Last advertised ${fmtDate(c.lastSeenOnline)}` : "Never advertised on the website"}>
                                  <CloudOff className="w-3 h-3" />not advertised
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2"><span className="font-mono font-semibold text-[12px] bg-slate-100 rounded px-1.5 py-0.5 whitespace-nowrap">{c.registration}</span></td>
                        <td className="px-2 py-2 text-right font-semibold whitespace-nowrap">£{money(c.price)}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {c.priceIndicator && c.priceIndicator !== "No analysis"
                            ? <span className={`text-[11px] font-medium ${PRICE_TEXT[priceTone(c.priceIndicator)]}`}
                                title={`AutoTrader rates this ${String(c.priceIndicator).toLowerCase()} against the market${c.retailValuation ? ` — guide £${money(c.retailValuation)}` : ""}`}>
                                {c.priceIndicator}
                              </span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right text-slate-600 whitespace-nowrap">{money(c.mileage)}</td>
                        <td className="px-2 py-2 text-center text-slate-500">{c.daysInStock ?? "—"}</td>
                        {/* "Added" was a column of its own and was almost always the import date.
                            It is the tooltip here instead, and the table is 90px narrower. */}
                        <td className="px-2 py-2 whitespace-nowrap text-slate-600" title={c.createdAt ? `Added to the list ${fmtDate(c.createdAt)}` : undefined}>
                          {c.purchasedOn
                            ? <>{fmtDate(c.purchasedOn)}{c.purchasedFrom && <span className="block text-[11px] text-slate-400">{c.purchasedFrom}</span>}</>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-2 py-2 max-w-[150px]" onClick={(e) => e.stopPropagation()}><MissingCell car={c} onFix={(car, kind) => setFixTarget({ car, kind })} /></td>
                        {/* Colour marks the exception, not the rule. An MOT with months on it and
                            a taxed car are the normal state — as bordered pills they made every row
                            shout and the genuinely bad ones disappeared into the pattern. */}
                        <td className="px-2 py-2 leading-tight whitespace-nowrap">
                          <span className={mot.bad
                            ? `inline-block rounded px-1.5 py-0.5 text-[11px] border whitespace-nowrap ${TONE[mot.tone]}`
                            : "inline-block text-[11px] text-slate-600 whitespace-nowrap"}>{mot.label}</span>
                          {" "}
                          <span className={/^taxed$/i.test(String(c.taxStatus || ""))
                            ? "inline-block text-[11px] text-slate-400 whitespace-nowrap"
                            : `inline-block rounded px-1.5 py-0.5 text-[11px] border whitespace-nowrap ${TONE[taxTone(c.taxStatus)]}`}>{c.taxStatus || "Unknown"}</span>
                        </td>
                        {/* The SOLD badge used to have a column to itself two along from the button
                            that undoes it. Same cell now — a column saved, and the sale reads as
                            one thing. */}
                        <td className="px-2 py-2 text-right print:hidden" onClick={(e) => e.stopPropagation()}>
                          {/* One flex row, so the badge and the buttons are spaced by the gap
                              instead of sitting flush against each other — two inline-flex boxes
                              side by side had nothing between them at all. It wraps rather than
                              squeezing, so on a narrow column the badge drops above the buttons
                              and the same gap becomes the space between the lines. */}
                          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                          {isSold(c) && (
                            <div className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
                              SOLD{c.soldPrice ? ` £${money(c.soldPrice)}` : ""}
                            </div>
                          )}
                          <div className="inline-flex gap-1.5">
                            <MarkSoldButton
                              car={c} compact
                              pending={unsell.isPending && unsell.variables?.id === c.id}
                              onMark={() => setSoldTarget(c)}
                              onUndo={() => unsell.mutate({ id: c.id, sold: false })}
                            />
                            <SaleInvoiceButton
                              car={c} compact
                              raised={invoiceByStockId.has(`${c.id}:sale`) || invoiceByStockId.has(`${c.id}:purchase`)}
                              pending={raiseInvoice.isPending && raiseInvoice.variables?.salesStockId === c.id}
                              onChoose={() => setInvoiceFor(c)}
                            />
                          </div>
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
                      {isSold(c) ? (
                        <div className="absolute top-2 right-2 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-wide rounded px-2 py-0.5 shadow">
                          Sold{c.soldPrice ? ` £${money(c.soldPrice)}` : ""}
                        </div>
                      ) : !!lastSync && !isAdvertised(c) && (
                        <div className="absolute top-2 right-2 inline-flex items-center gap-1 bg-white/95 text-sky-800 text-[11px] font-semibold rounded px-2 py-0.5 shadow"
                          title={c.lastSeenOnline ? `Last advertised ${fmtDate(c.lastSeenOnline)}` : "Never advertised on the website"}>
                          <CloudOff className="w-3 h-3" /> Not advertised
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
                        {c.purchasedOn && <span title={`Bought in${c.purchasedFrom ? ` from ${c.purchasedFrom}` : ""}`}>bought {fmtDate(c.purchasedOn)}</span>}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}><MissingCell car={c} block onFix={(car, kind) => setFixTarget({ car, kind })} /></div>
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
                          car={c}
                          raised={invoiceByStockId.has(`${c.id}:sale`) || invoiceByStockId.has(`${c.id}:purchase`)}
                          pending={raiseInvoice.isPending && raiseInvoice.variables?.salesStockId === c.id}
                          onChoose={() => setInvoiceFor(c)}
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

      {purchaseReg !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setPurchaseReg(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-slate-800">Purchase invoice</div>
            <p className="mt-1 text-sm text-slate-600">
              Registration of the car you have bought. If it is already on the forecourt this uses that record rather than creating another.
            </p>
            <input
              autoFocus
              value={purchaseReg}
              onChange={(e) => setPurchaseReg(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && purchaseReg.trim()) { stockForReg.mutate({ registration: purchaseReg.trim() }); setPurchaseReg(null); }
                if (e.key === "Escape") setPurchaseReg(null);
              }}
              placeholder="e.g. LT07 ZKO"
              className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-sm uppercase"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPurchaseReg(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
              <button
                disabled={!purchaseReg.trim() || stockForReg.isPending || raiseInvoice.isPending}
                onClick={() => { stockForReg.mutate({ registration: purchaseReg.trim() }); setPurchaseReg(null); }}
                className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                Raise it
              </button>
            </div>
          </div>
        </div>
      )}

      {fixTarget?.kind === "purchase" && (
        <PurchaseFillDialog car={fixTarget.car} onClose={() => setFixTarget(null)} onSaved={() => setFixTarget(null)} />
      )}
      {fixTarget?.kind === "invoice" && (
        <InvoiceFillDialog car={fixTarget.car} onClose={() => setFixTarget(null)} onSaved={() => setFixTarget(null)} />
      )}

      {soldTarget && (
        <MarkSoldDialog
          car={soldTarget}
          onClose={() => setSoldTarget(null)}
          onDone={(opts) => onSoldDone(soldTarget, opts)}
        />
      )}
      {invoiceFor && (
        <InvoiceKindDialog
          car={invoiceFor}
          saleId={invoiceByStockId.get(`${invoiceFor.id}:sale`)}
          purchaseId={invoiceByStockId.get(`${invoiceFor.id}:purchase`)}
          pending={raiseInvoice.isPending}
          onClose={() => setInvoiceFor(null)}
          onPick={(kind, existingId) => {
            if (existingId != null) { setInvoiceFor(null); setLocation(`/vehicle-sale/${existingId}`); return; }
            raiseInvoice.mutate({ salesStockId: invoiceFor.id, docKind: kind });
          }}
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
  car, raised, pending, compact, onChoose,
}: {
  car: any; raised: boolean; pending: boolean; compact?: boolean;
  onChoose: () => void;
}) {
  const cls = compact
    ? `inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium whitespace-nowrap disabled:opacity-50 ${raised ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100" : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50"}`
    : `inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px] font-semibold w-full disabled:opacity-50 ${raised ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100" : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50"}`;
  return (
    <button
      className={cls}
      disabled={pending}
      title={`Invoice for ${car.registration} — selling it, or buying it in`}
      onClick={onChoose}
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ReceiptText className="w-3.5 h-3.5" />}
      {/* Icon only in the list. Two labelled buttons on every one of 27 rows was the single
          noisiest thing on the page; the tooltip and the green tint still say which it is. */}
      {compact ? <span className="sr-only">{raised ? "Open invoice" : "Invoice"}</span> : (raised ? "Open invoice" : "Invoice")}
    </button>
  );
}

/**
 * Sale or purchase, asked before the form is raised.
 *
 * The same pre-printed pad is used both ways round, and the two aren't interchangeable once
 * filled in — a purchase strikes out the last-owner block — so the kind is settled up front
 * rather than being something to notice afterwards.
 */
function InvoiceKindDialog({
  car, saleId, purchaseId, pending, onPick, onClose,
}: {
  car: any; saleId?: number; purchaseId?: number; pending: boolean;
  onPick: (kind: "sale" | "purchase", existingId?: number) => void; onClose: () => void;
}) {
  const Option = ({ kind, existingId, title, blurb, tone }: any) => (
    <button
      disabled={pending}
      onClick={() => onPick(kind, existingId)}
      className={`w-full rounded-lg border-2 p-3 text-left transition-colors disabled:opacity-50 ${tone}`}
    >
      <div className="flex items-center justify-between font-semibold">
        <span>{title}</span>
        {existingId != null && <span className="text-[11px] font-medium opacity-70">already raised — open it</span>}
      </div>
      <div className="mt-0.5 text-[12px] font-normal opacity-80">{blurb}</div>
    </button>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 font-semibold text-slate-800">
          {car.registration} · {[car.make, car.model].filter(Boolean).join(" ")}
        </div>
        <p className="mb-3 text-[12px] text-slate-500">Which way round is this?</p>
        <div className="space-y-2">
          <Option kind="sale" existingId={saleId} title="Sales invoice"
            blurb="Selling this car to a customer."
            tone="border-violet-300 bg-violet-50/60 text-violet-900 hover:bg-violet-100" />
          <Option kind="purchase" existingId={purchaseId} title="Purchase invoice"
            blurb="Buying this car in from a customer. The last-owner block is greyed out and marked PURCHASE."
            tone="border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100" />
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-md py-1.5 text-[12px] text-slate-500 hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}

/** Fill in the buying side without leaving the stock list.
 *
 * The amber chip already said exactly what was missing; it just wasn't clickable, so correcting
 * a blank meant finding the car again over in the trading ledger. Only the three fields the
 * chip complains about are here, plus the on-costs, because anything more turns a ten-second
 * correction back into a form.
 *
 * A car with NO deal at all gets one created and linked to this stock row — the link matters,
 * or the ledger sync would spawn a second stock entry for a car already sitting in the list.
 */
function PurchaseFillDialog({ car, onClose, onSaved }: { car: any; onClose: () => void; onSaved: () => void }) {
  const SOURCES = ["BCA", "Manheim", "Aston Barclay", "Eastbourne", "Customer", "Part-exchange", "Trade", "Other"];
  const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const [date, setDate] = useState(iso(car.purchasedOn));
  const [price, setPrice] = useState(car.purchasedFor != null ? String(car.purchasedFor) : "");
  const [source, setSource] = useState(car.purchasedFrom || "");
  const [onCosts, setOnCosts] = useState(car.purchaseOnCosts != null ? String(car.purchaseOnCosts) : "");
  const [saving, setSaving] = useState(false);
  const utils = trpc.useUtils();
  const upsert = trpc.expenditure.upsertCarDeal.useMutation();

  const custom = !!source && !SOURCES.includes(source);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const save = async () => {
    const p = num(price), oc = num(onCosts);
    if ((p != null && !isFinite(p)) || (oc != null && !isFinite(oc))) { toast.error("Enter a valid amount"); return; }
    setSaving(true);
    try {
      await upsert.mutateAsync({
        id: car.dealId ?? undefined,
        // Only sent when creating, so an existing deal's reg/link are never rewritten from here.
        ...(car.dealId ? {} : { registration: car.registration, salesStockId: car.id, status: "in_stock" as const }),
        purchaseDate: date || null,
        purchaseCost: p,
        source: source || null,
        ...(onCosts.trim() === "" ? {} : { reconditioningCost: oc }),
      });
      // This writes a CAR DEAL, which is what Profit & Cashbook is built from — so refresh that
      // too. Without it the money was in the database and the page you'd check still said it
      // wasn't, until a reload.
      await Promise.all([utils.salesStock.list.invalidate(), utils.expenditure.invalidate()]);
      toast.success(`Purchase saved for ${car.registration} — it's in Profit & Cashbook now`);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Couldn't save the purchase details");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="font-semibold text-slate-800">Purchase details</div>
          <div className="text-[12px] text-slate-500">{car.registration} · {[car.make, car.model].filter(Boolean).join(" ")}</div>
        </div>

        <div>
          <label className="text-[11px] text-slate-500">Date bought</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500">Price paid for the car</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Vehicle only, before fees"
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500">Bought from</label>
          <select value={custom ? "__other" : source} onChange={(e) => setSource(e.target.value === "__other" ? " " : e.target.value)}
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500">
            <option value="">Choose…</option>
            {SOURCES.map((x) => <option key={x} value={x}>{x}</option>)}
            <option value="__other">Something else…</option>
          </select>
          {custom && (
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Who from"
              className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500" autoFocus />
          )}
        </div>
        <div>
          <label className="text-[11px] text-slate-500">Fees &amp; delivery <span className="text-slate-400">(optional)</span></label>
          <input value={onCosts} onChange={(e) => setOnCosts(e.target.value)} inputMode="decimal" placeholder="Buyer fee, assured, delivery"
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500" />
          <div className="mt-0.5 text-[10px] text-slate-400">Kept apart from the car price — on-costs don't count towards the VAT margin.</div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-700 px-4 py-1.5 text-sm text-white hover:bg-violet-800 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Fill in what the sales invoice is short of, without leaving the stock list.
 *
 * Shows ONLY the fields the chip complained about — asking for a chassis number on a car that
 * already has one is how a ten-second correction turns back into a form. A chassis number or a
 * first-registration date typed here is also backfilled onto the garage's own vehicle record when
 * that one is blank, so the workshop and the forecourt stop holding different answers.
 */
function InvoiceFillDialog({ car, onClose, onSaved }: { car: any; onClose: () => void; onSaved: () => void }) {
  const gaps = new Set(missingBits(car).invoice);
  const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const [make, setMake] = useState(car.make || "");
  const [model, setModel] = useState(car.model || "");
  const [vin, setVin] = useState(car.vin || car.vehVin || "");
  const [firstReg, setFirstReg] = useState(iso(car.registrationDate || car.vehFirstRegistered));
  const [mileage, setMileage] = useState(car.mileage != null ? String(car.mileage) : "");
  const [price, setPrice] = useState(Number(car.price) > 0 ? String(car.price) : "");
  const [saving, setSaving] = useState(false);
  const utils = trpc.useUtils();
  const update = trpc.salesStock.updateDetails.useMutation();
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[^0-9.\-]/g, "")));

  const save = async () => {
    const m = num(mileage), p = num(price);
    if ((m != null && !isFinite(m)) || (p != null && !isFinite(p))) { toast.error("Enter a valid number"); return; }
    setSaving(true);
    try {
      await update.mutateAsync({
        id: car.id,
        ...(gaps.has("make") ? { make: make.trim().toUpperCase() || null } : {}),
        ...(gaps.has("model") ? { model: model.trim().toUpperCase() || null } : {}),
        ...(gaps.has("chassis") ? { vin: vin.trim() || null } : {}),
        ...(gaps.has("first reg") ? { registrationDate: firstReg || null } : {}),
        ...(gaps.has("mileage") ? { mileage: m } : {}),
        ...(gaps.has("sale price") ? { price: p } : {}),
      });
      await utils.salesStock.list.invalidate();
      toast.success(`Saved for ${car.registration} — the sales invoice can fill itself in now`);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Couldn't save these details");
    } finally { setSaving(false); }
  };

  const Field = ({ show, label, hint, children }: any) => (!show ? null : (
    <div>
      <label className="text-[11px] text-slate-500">{label}</label>
      {children}
      {hint && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>}
    </div>
  ));
  const input = "w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-violet-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="font-semibold text-slate-800">What the sales invoice needs</div>
          <div className="text-[12px] text-slate-500">{car.registration} · {[car.make, car.model].filter(Boolean).join(" ")}</div>
        </div>
        <Field show={gaps.has("make")} label="Make">
          <input value={make} onChange={(e) => setMake(e.target.value)} className={input} autoFocus />
        </Field>
        <Field show={gaps.has("model")} label="Model">
          <input value={model} onChange={(e) => setModel(e.target.value)} className={input} />
        </Field>
        <Field show={gaps.has("chassis")} label="Chassis / VIN" hint="17 characters. Also saved onto the workshop's vehicle record if that one is blank.">
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} className={`${input} font-mono`} maxLength={20} />
        </Field>
        <Field show={gaps.has("first reg")} label="First registered">
          <input type="date" value={firstReg} onChange={(e) => setFirstReg(e.target.value)} className={input} />
        </Field>
        <Field show={gaps.has("mileage")} label="Mileage">
          <input value={mileage} onChange={(e) => setMileage(e.target.value)} inputMode="numeric" className={input} />
        </Field>
        <Field show={gaps.has("sale price")} label="Price" hint="The advertised figure the invoice starts from — not what it eventually sells for.">
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={input} />
        </Field>
        {gaps.has("reg") && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            This car has no registration. Everything else keys off the plate, so that one has to be
            put right on the car's own record rather than here.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-700 px-4 py-1.5 text-sm text-white hover:bg-violet-800 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What this car is still short of — kept in two groups because they're different jobs: the buying
 * side is bookkeeping (what you paid, when, who from), the invoice side is what the sales form
 * can't fill in on its own.
 */
function MissingCell({ car, block, onFix }: { car: any; block?: boolean; onFix?: (car: any, kind: "purchase" | "invoice") => void }) {
  const { purchase, invoice, noDeal } = missingBits(car);
  if (!purchase.length && !invoice.length) {
    // Deliberately just a tick. This is the state 20-odd rows are in, and as a bordered green
    // pill it was louder than the handful of rows that actually need something doing.
    return <span className="inline-flex items-center text-green-600" title="Purchase logged and everything the sales invoice needs is on file"><ShieldCheck className="h-4 w-4" /><span className="sr-only">complete</span></span>;
  }
  // A symbol, not a sentence. Spelled out, this was the widest column in the table for the sake
  // of two or three rows; the tooltip says exactly what is missing and clicking it opens the form
  // that fills those very fields. `block` (the grid card) has room, so it still reads in words.
  const Tag = ({ kind, gaps, tone, hint, fixable, opens }: { kind: string; gaps: string[]; tone: string; hint: string; fixable?: "purchase" | "invoice"; opens?: string }) => {
    const title = `${hint}${fixable && onFix ? ` — click to fill it in${opens ? ` (${opens})` : ""}` : ""}`;
    const words = (<>
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span className="truncate"><b className="font-semibold">{kind}</b>{gaps.length ? ` ${gaps.join(", ")}` : ""}</span>
    </>);
    const cls = block
      ? `inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`
      : `inline-flex items-center rounded p-0.5 ${tone.replace(/bg-\S+/, "").replace(/border-\S+/, "")}`;
    const inner = block ? words : <AlertTriangle className="h-4 w-4" />;
    if (!fixable || !onFix) return <span title={title} className={cls}>{inner}</span>;
    return (
      <button type="button" title={title}
        onClick={(e) => { e.stopPropagation(); onFix(car, fixable); }}
        className={`${cls} cursor-pointer hover:brightness-95`}>{inner}</button>
    );
  };
  return (
    <span className={`${block ? "flex" : "inline-flex"} flex-wrap items-center gap-1`}>
      {noDeal
        ? <Tag kind="not bought in" gaps={[]} tone="border-red-300 bg-red-50 text-red-800" fixable="purchase"
            opens="also posts it to Profit & Cashbook"
            hint="No car deal exists for this car — there's no record of what was paid for it or who from." />
        : purchase.length > 0 && <Tag kind="purchase" gaps={purchase} tone="border-amber-300 bg-amber-50 text-amber-800" fixable="purchase"
            opens="also posts it to Profit & Cashbook"
            hint={`Missing from the purchase record: ${purchase.join(", ")}`} />}
      {invoice.length > 0 && <Tag kind="invoice" gaps={invoice} tone="border-sky-300 bg-sky-50 text-sky-800" fixable="invoice"
        hint={`The sales invoice can't fill these in: ${invoice.join(", ")}`} />}
    </span>
  );
}

function Stat({ label, value, tone, active, onClick }: { label: string; value: string; tone?: string; active?: boolean; onClick?: () => void }) {
  const cls = `rounded-lg border p-3 text-left ${tone ? TONE[tone] : "border-slate-200 bg-white"}${
    onClick ? " cursor-pointer hover:brightness-[0.97]" : ""}${active ? " ring-2 ring-violet-500" : ""}`;
  const body = (<>
    <div className="text-[11px] uppercase font-semibold opacity-70">{label}</div>
    <div className="text-[20px] font-bold leading-tight mt-0.5">{value}</div>
  </>);
  // A counting tile is only a filter when there is something to filter TO — "MOT expired 0" that
  // narrows the list to nothing is a dead end, not a feature.
  if (!onClick || value === "0") return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} title={active ? `Showing ${label.toLowerCase()} only — click to clear` : `Show only these cars`}
      className={`${cls} w-full`}>{body}</button>
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
