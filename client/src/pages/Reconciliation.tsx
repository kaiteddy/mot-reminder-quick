import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, AlertTriangle, Plus, Trash2, Search, Check } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const money = (n: number) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n || 0)).toLocaleString("en-GB");
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};
const sumArr = (a: number[]) => a.reduce((x, y) => x + (y || 0), 0);

export default function Reconciliation() {
  const [from, setFrom] = useState("2025-07-01");
  const [to, setTo] = useState("2026-06-30");

  const stats = trpc.expenditure.stats.useQuery();

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Profit &amp; Cashbook</h1>
            <p className="text-sm text-slate-500">
              Workshop sales (from GA4) reconciled against labelled bank &amp; card expenditure.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs text-slate-500">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <div>
              <label className="block text-xs text-slate-500">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
            </div>
          </div>
        </div>

        {stats.data && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-slate-100 px-2 py-1">Bank: {stats.data.bank}</span>
            <span className="rounded bg-slate-100 px-2 py-1">Card: {stats.data.card}</span>
            <span className={`rounded px-2 py-1 ${stats.data.unlabelled ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}`}>
              {stats.data.unlabelled} to label
            </span>
            {stats.data.first && <span className="rounded bg-slate-100 px-2 py-1">{stats.data.first} → {stats.data.last}</span>}
          </div>
        )}

        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Summary (P&amp;L)</TabsTrigger>
            <TabsTrigger value="export">Export for AI</TabsTrigger>
            <TabsTrigger value="overheads">Overheads</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="cars">Car Trading</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="labels">Labels</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>

          <TabsContent value="summary"><SummaryTab from={from} to={to} /></TabsContent>
          <TabsContent value="export"><ExportTab from={from} to={to} /></TabsContent>
          <TabsContent value="overheads"><OverheadsTab from={from} to={to} /></TabsContent>
          <TabsContent value="suppliers"><SuppliersTab from={from} to={to} /></TabsContent>
          <TabsContent value="cars"><CarTradingTab /></TabsContent>
          <TabsContent value="transactions"><TransactionsTab /></TabsContent>
          <TabsContent value="labels"><LabelsTab /></TabsContent>
          <TabsContent value="import"><ImportTab /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function SummaryTab({ from, to }: { from: string; to: string }) {
  const q = trpc.expenditure.reconciliation.useQuery({ from, to });
  const [showPct, setShowPct] = useState(true);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <p className="p-4 text-slate-500">No data.</p>;
  const { months, sales, sections, carTrading, vat, categories } = q.data as any;
  const catAmts = (name: string): number[] => (categories || []).find((c: any) => c.name === name)?.amounts || months.map(() => 0);
  const adamLoan = catAmts("Director — Adam Rutstein");
  const adamWages = catAmts("Wages — Adam Rutstein");
  const adamTotal = months.map((_: string, i: number) => adamLoan[i] + adamWages[i]);
  const hillelLoan = catAmts("Director — Hillel Rutstein");
  const hillelBupa = catAmts("Director — Hillel Rutstein (BUPA)");
  const hillelTotal = months.map((_: string, i: number) => hillelLoan[i] + hillelBupa[i]);

  const vatDue = vat?.due || months.map(() => 0);
  const vatDueWorkshop = vat?.dueWorkshop || months.map(() => 0);
  const vatDueCars = vat?.dueCars || months.map(() => 0);
  const vatReclaimedNeg = (vat?.reclaimed || months.map(() => 0)).map((x: number) => -x);
  const vatNet = vat?.net || months.map(() => 0);
  const sec = (k: string): number[] => sections[k] || months.map(() => 0);
  const cogs = sec("cogs"), overheads = sec("overheads"), cartrade = sec("cartrade"),
        taxes = sec("taxes"), receipts = sec("receipts"), financing = sec("financing");
  const gross = months.map((_: string, i: number) => sales[i] + cogs[i]);       // workshop gross profit
  const carRev = carTrading?.revenue || months.map(() => 0);
  const carCostNeg = (carTrading?.cost || months.map(() => 0)).map((x: number) => -x);
  const carMargin = carTrading?.margin || months.map(() => 0);
  const combinedGross = months.map((_: string, i: number) => gross[i] + carMargin[i]);       // workshop + car gross
  const netProfit = months.map((_: string, i: number) => combinedGross[i] + overheads[i]);   // shared overheads taken once
  // months where stock was bought but no car sales digitised yet → the car-sale rows are incomplete, not zero
  const carIncomplete = months.map((_: string, i: number) => cartrade[i] < -50 && Math.round(carRev[i]) === 0);
  // break-even: monthly overhead "nut" the business must cover with gross profit
  const nMonths = Math.max(months.length, 1);
  const ohMonthly = Math.abs(sumArr(overheads)) / nMonths;
  const wsGrossMonthly = sumArr(gross) / nMonths;
  const beDaily = ohMonthly / 26;
  const wsMargin = sumArr(sales) > 0 ? sumArr(gross) / sumArr(sales) : 0.57; // actual workshop gross margin
  const wsEquiv = wsMargin > 0 ? ohMonthly / wsMargin : 0;
  const wsCoverage = ohMonthly > 0 ? Math.round((wsGrossMonthly / ohMonthly) * 100) : 0;

  // Colour the MoM %: green when the change HELPS profit, red when it HURTS. Costs are stored as
  // negatives, so a more-positive change (more income OR less cost) is always "good". Drawings/VAT
  // rows are neutral (grey). `cost` rows flip the arrow so it reflects the line's own magnitude.
  const pctClass = (p: number, neutral: boolean, dark: boolean) =>
    neutral ? "text-slate-400" : dark ? (p > 0 ? "text-emerald-400" : "text-rose-400") : (p > 0 ? "text-emerald-600" : "text-rose-600");
  const Row = ({ label, vals, bold, hl, indent, cost, neutral }: any) => (
    <TableRow className={hl ? "bg-slate-900 text-white hover:bg-slate-900" : bold ? "bg-slate-100 font-semibold hover:bg-slate-100" : ""}>
      <TableCell className={`sticky left-0 z-10 whitespace-nowrap ${hl ? "bg-slate-900" : bold ? "bg-slate-100" : "bg-white"} ${indent ? "pl-6 text-slate-500" : ""}`}>{label}</TableCell>
      {vals.map((v: number, i: number) => {
        const prev = i > 0 ? vals[i - 1] : null;
        const p = showPct && prev != null && prev !== 0 ? ((v - prev) / Math.abs(prev)) * 100 : null;
        const showP = p != null && isFinite(p) && Math.abs(p) >= 0.5;
        return (
          <TableCell key={i} className={`text-right tabular-nums ${hl ? "bg-slate-900" : bold ? "bg-slate-100" : ""} ${v < 0 && !hl ? "text-red-600" : ""}`}>
            {money(v)}
            {showP && <span className={`ml-1 text-[9px] font-normal ${pctClass(p!, !!neutral, !!hl)}`}>{(cost ? p! < 0 : p! > 0) ? "↑" : "↓"}{Math.abs(Math.round(p!)) > 999 ? "999+" : Math.abs(Math.round(p!))}%</span>}
          </TableCell>
        );
      })}
      <TableCell className={`sticky right-0 z-10 text-right font-bold tabular-nums ${hl ? "bg-slate-900" : bold ? "bg-slate-100" : "bg-white"}`}>{money(sumArr(vals))}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Monthly P&amp;L — whole business</CardTitle>
        <Button variant={showPct ? "default" : "outline"} size="sm" className="h-7 shrink-0 text-xs" onClick={() => setShowPct((v) => !v)}>
          {showPct ? "Hide" : "Show"} month-on-month %
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Break-even / month</div><div className="text-lg font-bold text-slate-800">{money(ohMonthly)}</div><div className="text-[11px] text-slate-500">gross profit to cover overheads</div></div>
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Break-even / day</div><div className="text-lg font-bold text-slate-800">{money(beDaily)}</div><div className="text-[11px] text-slate-500">gross, over 26 working days</div></div>
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Workshop sales equiv.</div><div className="text-lg font-bold text-slate-800">{money(wsEquiv)}</div><div className="text-[11px] text-slate-500">/mo at {Math.round(wsMargin * 100)}% margin, if no car sales</div></div>
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Workshop covers</div><div className="text-lg font-bold text-slate-800">{wsCoverage}%</div><div className="text-[11px] text-slate-500">of the nut; cars fund the rest</div></div>
        </div>
        <div className="overflow-auto max-h-[72vh] rounded-md border">
        <table className="w-full caption-bottom text-sm border-separate border-spacing-0 [&_td]:border-b [&_th]:border-b [&_td]:border-slate-100 [&_th]:border-slate-200">
          <TableHeader className="sticky top-0 z-20 [&_th]:bg-slate-50">
            <TableRow>
              <TableHead className="sticky left-0 top-0 z-30 bg-slate-50">£</TableHead>
              {months.map((m: string) => <TableHead key={m} className="sticky top-0 z-20 bg-slate-50 text-right">{monthLabel(m)}</TableHead>)}
              <TableHead className="sticky right-0 top-0 z-30 bg-slate-50 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Row label="Workshop sales" vals={sales} />
            <Row label="Cost of sales (parts &amp; sublet)" vals={cogs} indent cost />
            <Row label="Workshop gross profit" vals={gross} bold />
            <TableRow><TableCell colSpan={months.length + 2} className="h-3 p-0" /></TableRow>
            <TableRow>
              <TableCell className="sticky left-0 z-10 bg-white whitespace-nowrap">Car sales</TableCell>
              {carRev.map((v: number, i: number) => {
                const prev = i > 0 ? carRev[i - 1] : null;
                const p = showPct && !carIncomplete[i] && (i === 0 || !carIncomplete[i - 1]) && prev != null && prev !== 0 ? ((v - prev) / Math.abs(prev)) * 100 : null;
                const showP = p != null && isFinite(p) && Math.abs(p) >= 0.5;
                return (
                  <TableCell key={i} className="text-right tabular-nums">
                    {carIncomplete[i]
                      ? <span className="text-amber-600 font-semibold" title="Stock bought this month but no car sales digitised yet — figure is incomplete, not zero">⚠</span>
                      : <>{money(v)}{showP && <span className={`ml-1 text-[9px] font-normal ${pctClass(p!, false, false)}`}>{p! > 0 ? "↑" : "↓"}{Math.abs(Math.round(p!)) > 999 ? "999+" : Math.abs(Math.round(p!))}%</span>}</>}
                  </TableCell>
                );
              })}
              <TableCell className="sticky right-0 z-10 bg-white text-right font-bold tabular-nums">{money(sumArr(carRev))}</TableCell>
            </TableRow>
            <Row label="Cost of cars sold" vals={carCostNeg} indent cost />
            <Row label="Car trading margin" vals={carMargin} bold />
            <TableRow><TableCell colSpan={months.length + 2} className="h-3 p-0" /></TableRow>
            <Row label="Combined gross profit (workshop + cars)" vals={combinedGross} bold />
            <Row label="Overheads — whole business (shared)" vals={overheads} indent cost />
            <Row label="NET BUSINESS PROFIT" vals={netProfit} hl />
            <TableRow><TableCell colSpan={months.length + 2} className="h-4 p-0" /></TableRow>
            <Row label="Car purchases — cash out on stock" vals={cartrade} indent cost />
            <Row label="Taxes (VAT / Corp Tax)" vals={taxes} indent cost />
            <Row label="Bank takings (cash in)" vals={receipts} indent />
            <Row label="Financing / drawings / contra" vals={financing} indent neutral />
            <Row label="→ Adam Rutstein (drawings / loan)" vals={adamLoan} indent neutral />
            <Row label="→ Adam Rutstein (wages)" vals={adamWages} indent neutral />
            <Row label="→ Adam Rutstein — total drawn" vals={adamTotal} bold neutral />
            <Row label="→ Hillel Rutstein (drawings / loan)" vals={hillelLoan} indent neutral />
            <Row label="→ Hillel Rutstein (BUPA)" vals={hillelBupa} indent neutral />
            <Row label="→ Hillel Rutstein — total drawn" vals={hillelTotal} bold neutral />
            <Row label="→ Douglas Brittain (rent)" vals={catAmts("Rent — Douglas Brittain")} indent neutral />
            <TableRow><TableCell colSpan={months.length + 2} className="h-4 p-0" /></TableRow>
            <TableRow className="bg-violet-50"><TableCell colSpan={months.length + 2} className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">VAT — Barclays expenditure is VAT-inclusive</TableCell></TableRow>
            <Row label="VAT due — workshop (output)" vals={vatDueWorkshop} indent neutral />
            <Row label="VAT due — car margins (÷6)" vals={vatDueCars} indent neutral />
            <Row label="VAT due (output — total)" vals={vatDue} neutral />
            <Row label="VAT reclaimed (input — on expenditure)" vals={vatReclaimedNeg} indent neutral />
            <Row label="VAT net payable to HMRC" vals={vatNet} bold neutral />
          </TableBody>
        </table>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span><b>Overheads are a shared, whole-business cost</b> (wages, rent, advertising, insurance) — taken off <i>combined</i> gross, not charged to the workshop alone. A <span className="text-amber-600 font-semibold">⚠</span> in Car sales means stock was bought that month but the disposals aren&apos;t digitised yet, so that month&apos;s car margin &amp; profit are <b>understated, not zero</b>. Car margin comes from the <b>Car Trading</b> tab; "Bank takings" are cash received (cross-check only, not added to revenue). Expenditure is net of reclaimable VAT. The small ↑/↓ % next to each figure is the change from the previous month, coloured by effect on profit — <span className="font-semibold text-emerald-600">green helps</span> (more income or lower cost), <span className="font-semibold text-rose-600">red hurts</span>; drawings &amp; VAT stay grey. (True year-on-year needs a full prior year, which the data doesn&apos;t reach back to yet.)</span>
        </p>
      </CardContent>
    </Card>
    <CategoryVatEditor />
    </div>
  );
}

/** Per-category default VAT rate — drives how much input VAT is stripped from each Barclays txn. */
function CategoryVatEditor() {
  const cats = trpc.expenditure.categories.useQuery();
  const utils = trpc.useUtils();
  const setVat = trpc.expenditure.setCategoryVat.useMutation({
    onSuccess: () => { utils.expenditure.categories.invalidate(); utils.expenditure.reconciliation.invalidate(); },
  });
  if (!cats.data) return null;
  const rows = (cats.data as any[]).filter((c) => c.name !== "OTHER / to label" && !/^INCOME/.test(c.name));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">VAT rate by category</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-slate-500">Barclays &amp; Barclaycard amounts are VAT-inclusive. Set each category's input-VAT rate — 20% strips reclaimable VAT, 0% for exempt / outside-scope (wages, insurance, HMRC, financing, MOT/DVLA, bank charges, used-car margin stock).</p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-2 border-b border-slate-50 py-1 text-[13px]">
              <span className="truncate text-slate-600" title={c.name}>{c.name}</span>
              <Select value={String(c.vatRate)} onValueChange={(v) => setVat.mutate({ name: c.name, vatRate: Number(v) })}>
                <SelectTrigger className="h-7 w-[76px] shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20%</SelectItem>
                  <SelectItem value="5">5%</SelectItem>
                  <SelectItem value="0">0%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Export the whole Profit & Cashbook as a self-contained Markdown brief to paste into an AI reviewer. */
function ExportTab({ from, to }: { from: string; to: string }) {
  const recon = trpc.expenditure.reconciliation.useQuery({ from, to });
  const supp = trpc.expenditure.supplierSpend.useQuery({ from, to });
  const cars = trpc.expenditure.carDeals.useQuery();
  const [copied, setCopied] = useState(false);

  if (recon.isLoading || supp.isLoading || cars.isLoading) return <Loading />;
  if (!recon.data) return <p className="p-4 text-slate-500">No data.</p>;

  const md = buildExportMarkdown(recon.data as any, supp.data as any, (cars.data as any) || [], from, to);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true); toast.success("Copied — paste straight into ChatGPT or Claude");
      setTimeout(() => setCopied(false), 2500);
    } catch { toast.error("Copy blocked — click the text, ⌘A, ⌘C to copy manually"); }
  };
  const download = () => {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `eli-motors-profit-cashbook_${from}_to_${to}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Card>
      <CardHeader><CardTitle>Export for AI review</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-500">
          A self-contained Markdown brief of the whole Profit &amp; Cashbook for the selected period — business context,
          the full monthly P&amp;L, VAT, per-car trading detail, supplier spend, data caveats and suggested review questions.
          <b> Copy it and paste into ChatGPT / Claude</b>, or download the <code>.md</code> file to attach.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={copy}>{copied ? "Copied ✓" : "Copy to clipboard"}</Button>
          <Button variant="outline" onClick={download}>Download .md</Button>
          <span className="text-xs text-slate-400">{md.length.toLocaleString("en-GB")} chars · {md.split("\n").length} lines · period {from} → {to}</span>
        </div>
        <Textarea
          readOnly value={md}
          onFocus={(e) => e.currentTarget.select()}
          className="h-[62vh] w-full font-mono text-[11px] leading-relaxed"
        />
      </CardContent>
    </Card>
  );
}

/** Build the Markdown brief from the reconciliation, supplier-spend and car-deal data. Pure function. */
function buildExportMarkdown(recon: any, supp: any, cars: any[], from: string, to: string): string {
  const { months = [], sales = [], sections = {}, carTrading = {}, vat = {}, categories = [] } = recon || {};
  const fmt = (n: number) => (n < 0 ? "-" : "") + "£" + Math.abs(Math.round(n || 0)).toLocaleString("en-GB");
  const zeros = () => months.map(() => 0);
  const cat = (name: string): number[] => (categories || []).find((c: any) => c.name === name)?.amounts || zeros();
  const sec = (k: string): number[] => sections?.[k] || zeros();
  const cogs = sec("cogs"), overheads = sec("overheads"), cartrade = sec("cartrade"),
        taxes = sec("taxes"), receipts = sec("receipts"), financing = sec("financing");
  const gross = months.map((_: any, i: number) => (sales[i] || 0) + (cogs[i] || 0));
  const carRev = carTrading?.revenue || zeros();
  const carCostNeg = (carTrading?.cost || zeros()).map((x: number) => -x);
  const carMargin = carTrading?.margin || zeros();
  const combined = months.map((_: any, i: number) => gross[i] + (carMargin[i] || 0));
  const net = months.map((_: any, i: number) => combined[i] + (overheads[i] || 0));
  const adamLoan = cat("Director — Adam Rutstein"), adamWage = cat("Wages — Adam Rutstein");
  const adamTot = months.map((_: any, i: number) => (adamLoan[i] || 0) + (adamWage[i] || 0));
  const hillel = cat("Director — Hillel Rutstein"), hillelBupa = cat("Director — Hillel Rutstein (BUPA)"), brittain = cat("Rent — Douglas Brittain");
  const hillelTot = months.map((_: any, i: number) => (hillel[i] || 0) + (hillelBupa[i] || 0));
  const vDue = vat?.due || zeros(), vWs = vat?.dueWorkshop || zeros(), vCar = vat?.dueCars || zeros();
  const vRec = (vat?.reclaimed || zeros()).map((x: number) => -x), vNet = vat?.net || zeros();
  const carInc = months.map((_: any, i: number) => (cartrade[i] || 0) < -50 && Math.round(carRev[i] || 0) === 0);

  const nMonths = Math.max(months.length, 1);
  const ohMonthly = Math.abs(sumArr(overheads)) / nMonths;
  const wsGrossMonthly = sumArr(gross) / nMonths;
  const wsCoverage = ohMonthly > 0 ? Math.round((wsGrossMonthly / ohMonthly) * 100) : 0;
  const wsMargin = sumArr(sales) > 0 ? sumArr(gross) / sumArr(sales) : 0.57;
  const beDaily = ohMonthly / 26, wsEquiv = wsMargin > 0 ? ohMonthly / wsMargin : 0;

  const hdr = ["Line item", ...months.map(monthLabel), "Total"];
  const headRow = "| " + hdr.join(" | ") + " |";
  const sepRow = "| " + hdr.map(() => "---").join(" | ") + " |";
  const rowFor = (label: string, vals: number[], inc?: boolean[]) =>
    "| " + [label, ...vals.map((v: number, i: number) => (inc?.[i] ? "⚠ n/a" : fmt(v))), fmt(sumArr(vals))].join(" | ") + " |";
  const tbl = (rows: string[]) => [headRow, sepRow, ...rows].join("\n");

  const o: string[] = [];
  o.push("# Eli Motors — Profit & Cashbook (management P&L)");
  o.push(`_Period: ${from} to ${to}. Generated from the live reconciliation; figures rounded to £._`);
  o.push("");
  o.push("## What this is");
  o.push("Eli Motors Ltd is a UK automatic-transmission specialist **garage (workshop)** that also **buys and sells used cars**. This internal management P&L reconciles:");
  o.push("- **Workshop sales** — every job invoice from the garage system (GA4); VAT-registered, standard-rated work.");
  o.push("- **Expenditure** — every Barclays bank + Barclaycard transaction, each categorised. Amounts are VAT-inclusive; the P&L shows them **net of reclaimable VAT**.");
  o.push("- **Car trading** — used-car disposals under the **VAT margin scheme** (output VAT = (sale − purchase) ÷ 6), plus occasional standard-rated (STD) cars (VAT on full price ÷ 6). From the accountant's quarterly VAT margin schedules.");
  o.push("");
  o.push("**How to read it:** workshop and car trading are two profit centres. Overheads (wages, rent, advertising, insurance) are a **shared whole-business cost** taken off *combined* gross profit — not charged to the workshop alone. 'Cash movements & drawings' are owner/balance-sheet items shown for cash visibility, **not** part of profit.");
  o.push("");
  o.push("## Headline");
  o.push(`- **Break-even overhead nut:** ${fmt(ohMonthly)}/month · ${fmt(beDaily)}/day (26 working days).`);
  o.push(`- **Workshop gross covers ${wsCoverage}%** of the nut; car trading funds the rest.`);
  o.push(`- **Workshop-only break-even:** ${fmt(wsEquiv)}/month of sales at ~${Math.round(wsMargin * 100)}% gross margin, if there were no car sales.`);
  o.push(`- **Period totals:** workshop sales ${fmt(sumArr(sales))} · workshop gross ${fmt(sumArr(gross))} · car margin ${fmt(sumArr(carMargin))} · combined gross ${fmt(sumArr(combined))} · overheads ${fmt(sumArr(overheads))} · **net business profit ${fmt(sumArr(net))}**.`);
  o.push(`- **VAT (period):** output due ${fmt(sumArr(vDue))} (workshop ${fmt(sumArr(vWs))} + car margins ${fmt(sumArr(vCar))}) · input reclaimed ${fmt(-sumArr(vRec))} · **net payable ${fmt(sumArr(vNet))}**.`);
  o.push("");
  o.push("## Monthly P&L — trading");
  o.push(tbl([
    rowFor("Workshop sales", sales),
    rowFor("— Cost of sales (parts & sublet)", cogs),
    rowFor("Workshop gross profit", gross),
    rowFor("Car sales", carRev, carInc),
    rowFor("— Cost of cars sold", carCostNeg),
    rowFor("Car trading margin", carMargin),
    rowFor("Combined gross profit (workshop + cars)", combined),
    rowFor("— Overheads (whole business, shared)", overheads),
    rowFor("NET BUSINESS PROFIT", net),
  ]));
  o.push("");
  o.push("> ⚠ n/a in **Car sales** = stock bought that month but disposals not yet digitised, so that month's car margin & profit are **understated, not zero** (see data gaps).");
  o.push("");
  o.push("## Cash movements & drawings (memo — not in profit)");
  o.push(tbl([
    rowFor("Car purchases — cash out on stock", cartrade),
    rowFor("Taxes paid (VAT / Corp Tax)", taxes),
    rowFor("Bank takings (cash in, cross-check only)", receipts),
    rowFor("Financing / drawings / contra", financing),
    rowFor("→ Adam Rutstein (drawings / loan)", adamLoan),
    rowFor("→ Adam Rutstein (wages)", adamWage),
    rowFor("→ Adam Rutstein — total drawn", adamTot),
    rowFor("→ Hillel Rutstein (drawings / loan)", hillel),
    rowFor("→ Hillel Rutstein (BUPA)", hillelBupa),
    rowFor("→ Hillel Rutstein — total drawn", hillelTot),
    rowFor("→ Douglas Brittain (rent, landlord)", brittain),
  ]));
  o.push("");
  o.push("## VAT (Barclays expenditure is VAT-inclusive)");
  o.push(tbl([
    rowFor("VAT due — workshop (output)", vWs),
    rowFor("VAT due — car margins (÷6)", vCar),
    rowFor("VAT due (output, total)", vDue),
    rowFor("VAT reclaimed (input, on expenditure)", vRec),
    rowFor("VAT net payable to HMRC", vNet),
  ]));
  o.push("");

  const sold = (cars || []).filter((c: any) => c.status === "sold" && c.saleDate)
    .sort((a: any, b: any) => (a.saleDate < b.saleDate ? -1 : 1));
  if (sold.length) {
    o.push(`## Car trading detail — ${sold.length} sold`);
    o.push("| Sold | Reg | Vehicle | Cost | Sale | Margin | VAT | Basis |");
    o.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const c of sold) {
      const std = /STD|standard-rated/i.test(c.notes || "");
      const vatCar = std ? (c.salePrice || 0) / 6 : Math.max((c.salePrice || 0) - (c.effectiveCost || 0), 0) / 6;
      const desc = String(c.description || "").replace(/\|/g, "/");
      o.push(`| ${c.saleDate || ""} | ${c.registration || "—"} | ${desc} | ${fmt(c.effectiveCost || 0)} | ${fmt(c.salePrice || 0)} | ${fmt(c.margin || 0)} | ${fmt(vatCar)} | ${std ? "STD full-price" : "margin"} |`);
    }
    o.push("");
  }

  const allSup = supp?.suppliers || [];
  const sup = allSup.slice(0, 30);
  if (sup.length) {
    o.push(`## Top suppliers by spend (${allSup.length} total, showing ${sup.length})`);
    o.push("| # | Supplier | Category | Total | Trend (last 3mo vs prior 3mo) |");
    o.push("| --- | --- | --- | --- | --- |");
    sup.forEach((s: any, i: number) => {
      const t = s.trendPct > 8 ? `up ${s.trendPct}%` : s.trendPct < -8 ? `down ${Math.abs(s.trendPct)}%` : "flat";
      o.push(`| ${i + 1} | ${String(s.payee || "").replace(/\|/g, "/")} | ${String(s.category || "").replace(/\|/g, "/")} | ${fmt(s.total)} | ${t} |`);
    });
    o.push("");
  }

  o.push("## Known data gaps & treatments (factor into any review)");
  o.push("- **Car disposals Nov 2025 – Apr 2026 are not yet digitised** (accountant hasn't finalised those quarterly VAT margin schedules). ⚠ months have stock purchases but no matching sales, so their car margin/profit and net are understated. Full-year car margin is materially higher than shown.");
  o.push("- **Overheads are deliberately shared**, not allocated to workshop vs cars.");
  o.push("- **BUPA / director medical** is a **director benefit (drawings)**, not an operating overhead — per the accountant's Directors Loan Account.");
  o.push("- **Foreign SaaS** (Neon/Vercel/Anthropic/OpenAI/Google/Apple etc.) is **reverse-charge, 0% input VAT**. Rent and insurance are outside/exempt (0%).");
  o.push("- **Bank takings** (cash in) are for cross-checking only and are **not** added to revenue (revenue = GA4 workshop invoices).");
  o.push("- Director drawings split by memo: 'LOAN FT' = loan, 'BBP' = wages, to avoid double-counting.");
  o.push("");
  o.push("## Suggested questions for the reviewer");
  o.push(`1. Are the workshop gross margin (~${Math.round(wsMargin * 100)}%) and monthly break-even reasonable for a specialist garage this size?`);
  o.push("2. Any categorisation that looks wrong, or an overhead that should be a direct cost (or vice-versa)?");
  o.push("3. Is the VAT treatment sound (margin scheme ÷6, reverse-charge SaaS, 0% rent/insurance)? Any exposure?");
  o.push("4. Cash flow / drawings: are the director extractions sustainable given net profit?");
  o.push("5. Where are costs rising fastest (supplier trends) and what would you challenge?");
  o.push("");
  o.push(`_${(cars || []).length} car deals on file · ${months.length} months in range._`);
  return o.join("\n");
}

/** Review each month's overheads line-by-line and reclassify any transaction to the correct category. */
function OverheadsTab({ from, to }: { from: string; to: string }) {
  const [month, setMonth] = useState<string>("");
  const cats = trpc.expenditure.categories.useQuery();
  const utils = trpc.useUtils();
  // first load with no month → get the month list + per-month totals for the chips
  const probe = trpc.expenditure.expenditureBreakdown.useQuery({ from, to, section: "overheads" });
  const months: string[] = (probe.data as any)?.months || [];
  const monthlyTotals: number[] = (probe.data as any)?.monthlyTotals || [];
  // default to the latest month that actually has spend
  const lastWithSpend = [...months].reverse().find((_m, i) => monthlyTotals[months.length - 1 - i]);
  const sel = month || lastWithSpend || months[months.length - 1] || "";
  const detail = trpc.expenditure.expenditureBreakdown.useQuery({ from, to, section: "overheads", month: sel }, { enabled: !!sel });
  const setOverride = trpc.expenditure.setOverride.useMutation({
    onSuccess: () => {
      utils.expenditure.expenditureBreakdown.invalidate();
      utils.expenditure.reconciliation.invalidate();
      utils.expenditure.supplierSpend.invalidate();
    },
  });

  if (probe.isLoading) return <Loading />;
  const d: any = detail.data;
  const txns: any[] = d?.transactions || [];
  const catRows: any[] = d?.categories || [];
  const monthTotal = catRows.reduce((s, c) => s + (c.amount || 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Overheads by month — review &amp; reclassify</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2">
            {months.map((m, i) => (
              <button key={m} onClick={() => setMonth(m)}
                className={`rounded-md border px-3 py-1.5 text-left transition-colors ${m === sel ? "border-slate-900 bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}>
                <div className="text-sm font-medium leading-tight">{monthLabel(m)}</div>
                <div className={`text-[11px] tabular-nums ${m === sel ? "text-slate-300" : "text-slate-500"}`}>{money(monthlyTotals[i] || 0)}</div>
              </button>
            ))}
          </div>

          {detail.isLoading ? <Loading /> : !sel ? <p className="p-4 text-slate-500">No data.</p> : (
            <>
              <div className="mb-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">{monthLabel(sel)} — where it went</h3>
                  <span className="text-sm font-bold tabular-nums text-red-600">{money(monthTotal)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {catRows.map((c) => (
                    <span key={c.name} className="rounded-md bg-slate-100 px-2 py-1 text-xs">
                      {c.name} · <b className="tabular-nums">{money(c.amount)}</b> <span className="text-slate-400">×{c.count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Payee / memo</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead>Category — reclassify</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.map((r) => (
                      <TableRow key={r.id} className={r.category === "OTHER / to label" ? "bg-orange-50" : ""}>
                        <TableCell className="whitespace-nowrap text-slate-500">{r.date}</TableCell>
                        <TableCell className="max-w-[340px]">
                          <div className="truncate font-medium" title={r.counterparty}>{r.counterparty}</div>
                          {r.memo && <div className="truncate text-[11px] text-slate-400" title={r.memo}>{r.memo}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-600">{money(r.amount)}</TableCell>
                        <TableCell>
                          <Select value={r.category} onValueChange={(v) => setOverride.mutate({ id: r.id, category: v })}>
                            <SelectTrigger className="h-8 w-[250px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(cats.data || []).map((c: any) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!txns.length && <p className="p-4 text-sm text-slate-500">No overhead transactions in {monthLabel(sel)}.</p>}
              </div>
              <p className="mt-2 text-xs text-slate-500">Amounts are gross (VAT-inclusive) — actual cash out. Reclassifying moves a transaction to another category and instantly updates the P&amp;L; pick a non-overhead category to move it out of overheads entirely.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Supplier spend analytics — monthly trend chart + per-supplier month-by-month table with rolling trend. */
function SuppliersTab({ from, to }: { from: string; to: string }) {
  const q = trpc.expenditure.supplierSpend.useQuery({ from, to });
  const cats = trpc.expenditure.categories.useQuery();
  const utils = trpc.useUtils();
  const reclassify = trpc.expenditure.reclassifyPayee.useMutation({
    onSuccess: (res: any, vars: any) => {
      utils.expenditure.supplierSpend.invalidate();
      utils.expenditure.reconciliation.invalidate();
      utils.expenditure.expenditureBreakdown.invalidate();
      toast.success(`${vars.payee} → ${vars.category}${res?.count ? ` (${res.count} txns)` : ""}`);
    },
    onError: (e) => toast.error("Reclassify failed: " + e.message),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <p className="p-4 text-slate-500">No data.</p>;
  const { months, suppliers, monthlyTotal } = q.data as any;
  const chartData = months.map((m: string, i: number) => ({ month: monthLabel(m), spend: Math.round(monthlyTotal[i]) }));
  const top = suppliers.slice(0, 40);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Total supplier spend — monthly</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={chartData} margin={{ left: 4, right: 8, top: 8 }}>
              <defs><linearGradient id="spend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} /><stop offset="100%" stopColor="#7c3aed" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={46} tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: any) => money(Number(v))} labelStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="spend" stroke="#7c3aed" strokeWidth={2} fill="url(#spend)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Suppliers by spend</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[70vh] rounded-md border">
            <table className="w-full caption-bottom text-sm border-separate border-spacing-0 [&_td]:border-b [&_th]:border-b [&_td]:border-slate-100 [&_th]:border-slate-200">
              <TableHeader className="sticky top-0 z-20 [&_th]:bg-slate-50">
                <TableRow>
                  <TableHead className="sticky left-0 top-0 z-30 bg-slate-50">Supplier</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-slate-50">Category</TableHead>
                  {months.map((m: string) => <TableHead key={m} className="sticky top-0 z-20 bg-slate-50 text-right">{monthLabel(m)}</TableHead>)}
                  <TableHead className="sticky top-0 z-20 bg-slate-50 text-right">Total</TableHead>
                  <TableHead className="sticky right-0 top-0 z-30 bg-slate-50 text-right">Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((s: any) => (
                  <TableRow key={s.payee}>
                    <TableCell className="sticky left-0 z-10 bg-white whitespace-nowrap font-medium">{s.payee}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Select value={s.category} onValueChange={(v) => reclassify.mutate({ payee: s.payee, category: v })}>
                        <SelectTrigger className="h-7 w-[220px] text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(cats.data || []).map((c: any) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {s.monthly.map((v: number, i: number) => <TableCell key={i} className="text-right tabular-nums text-slate-600">{v ? money(v) : <span className="text-slate-300">·</span>}</TableCell>)}
                    <TableCell className="text-right font-semibold tabular-nums">{money(s.total)}</TableCell>
                    <TableCell className="sticky right-0 z-10 bg-white text-right text-xs">
                      {s.trendPct > 8 ? <span className="text-red-600">↑ {s.trendPct}%</span> : s.trendPct < -8 ? <span className="text-green-600">↓ {Math.abs(s.trendPct)}%</span> : <span className="text-slate-400">–</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Change a supplier's <b>Category</b> to reclassify <i>all</i> of its transactions at once (e.g. a private car purchase → "Cost of sales — vehicle stock"). Trend = last 3 months' average vs the prior 3 months (↑ rising = red, ↓ falling = green). Showing top {top.length} of {suppliers.length} suppliers.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function TransactionsTab() {
  const [source, setSource] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [unlabelledOnly, setUnlabelledOnly] = useState(false);
  const cats = trpc.expenditure.categories.useQuery();
  const utils = trpc.useUtils();
  const q = trpc.expenditure.transactions.useQuery({
    source: source === "all" ? undefined : (source as any),
    search: search || undefined, unlabelledOnly, limit: 300,
  });
  const setOverride = trpc.expenditure.setOverride.useMutation({
    onSuccess: () => { utils.expenditure.transactions.invalidate(); utils.expenditure.reconciliation.invalidate(); utils.expenditure.stats.invalidate(); },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="mr-auto">Transactions</CardTitle>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="bank">Bank</SelectItem>
            <SelectItem value="card">Card</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Search payee / memo" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-[220px]" />
        <Button variant={unlabelledOnly ? "default" : "outline"} size="sm" onClick={() => setUnlabelledOnly((v) => !v)}>To label only</Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Loading /> : (
          <>
            <p className="mb-2 text-xs text-slate-500">{q.data?.total ?? 0} rows (showing up to 300)</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead><TableHead>Src</TableHead><TableHead>Payee / Merchant</TableHead>
                    <TableHead className="text-right">Amount</TableHead><TableHead>Category (row override)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(q.data?.rows || []).map((r: any) => (
                    <TableRow key={r.id} className={r.category === "OTHER / to label" ? "bg-orange-50" : ""}>
                      <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                      <TableCell className="uppercase text-slate-400">{r.source}</TableCell>
                      <TableCell className="max-w-[280px] truncate" title={r.counterparty + (r.memo ? " — " + r.memo : "")}>{r.counterparty}</TableCell>
                      <TableCell className={`text-right tabular-nums ${r.amount < 0 ? "text-red-600" : "text-green-700"}`}>{money(r.amount)}</TableCell>
                      <TableCell>
                        <Select value={r.category} onValueChange={(v) => setOverride.mutate({ id: r.id, category: v })}>
                          <SelectTrigger className="h-8 w-[230px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(cats.data || []).map((c: any) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LabelsTab() {
  const [source, setSource] = useState<string>("all");
  const cats = trpc.expenditure.categories.useQuery();
  const utils = trpc.useUtils();
  const q = trpc.expenditure.labels.useQuery({ source: source === "all" ? undefined : (source as any) });
  const upsert = trpc.expenditure.upsertLabel.useMutation({
    onSuccess: () => {
      utils.expenditure.labels.invalidate(); utils.expenditure.reconciliation.invalidate();
      utils.expenditure.transactions.invalidate(); utils.expenditure.stats.invalidate();
      toast.success("Label updated — applied to all its transactions");
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="mr-auto">Labels — classify each payee/merchant once</CardTitle>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="bank">Bank</SelectItem>
            <SelectItem value="card">Card</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Loading /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payee / Merchant</TableHead><TableHead>Src</TableHead>
                  <TableHead className="text-right">Txns</TableHead><TableHead className="text-right">Total</TableHead>
                  <TableHead>Category</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data || []).map((r: any) => (
                  <TableRow key={r.source + r.counterpartyKey} className={r.category === "OTHER / to label" ? "bg-orange-50" : ""}>
                    <TableCell className="max-w-[280px] truncate" title={r.counterparty}>{r.counterparty}</TableCell>
                    <TableCell className="uppercase text-slate-400">{r.source}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.n}</TableCell>
                    <TableCell className={`text-right tabular-nums ${r.total < 0 ? "text-red-600" : "text-green-700"}`}>{money(r.total)}</TableCell>
                    <TableCell>
                      <Select value={r.category} onValueChange={(v) => upsert.mutate({ source: r.source, counterpartyKey: r.counterpartyKey, category: v })}>
                        <SelectTrigger className="h-8 w-[230px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(cats.data || []).map((c: any) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportTab() {
  const [source, setSource] = useState<"bank" | "card">("bank");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const imp = trpc.expenditure.import.useMutation({
    onSuccess: (r) => {
      setResult(r);
      utils.expenditure.invalidate();
      toast.success(`Imported ${r.inserted} new transactions (${r.skipped} already present)`);
    },
    onError: (e) => toast.error(e.message),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const csvText = await file.text();
    imp.mutate({ source, csvText });
    e.target.value = "";
  };

  return (
    <Card>
      <CardHeader><CardTitle>Import a bank or card statement (CSV)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Select value={source} onValueChange={(v) => setSource(v as any)}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bank">Barclays (bank account)</SelectItem>
              <SelectItem value="card">Barclaycard (card)</SelectItem>
            </SelectContent>
          </Select>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            {imp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Choose CSV…
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" disabled={imp.isPending} />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Duplicates are skipped automatically, so re-uploading a statement is safe. New payees/merchants get a suggested category you can adjust on the Labels tab.
        </p>
        {result && (
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <b>{result.inserted}</b> new transactions imported · <b>{result.skipped}</b> already present · <b>{result.newLabels}</b> new payees auto-suggested.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, accent }: any) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "bg-slate-900 text-white" : "bg-white"}`}>
      <div className={`text-xs ${accent ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className={`text-xs ${accent ? "text-slate-300" : "text-slate-400"}`}>{sub}</div>}
    </div>
  );
}

function EditCell({ v, onSave, type, w, placeholder, align }: any) {
  const [val, setVal] = useState(v ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => { setVal(v ?? ""); }, [v]);
  const isMoney = type === "money";
  const numeric = type === "number" || isMoney;
  const clean = (s: any) => String(s ?? "").replace(/[^0-9.-]/g, "");
  const commit = () => {
    if (numeric) {
      const raw = clean(val);
      const nv = raw === "" ? null : Number(raw);
      if (nv !== (v ?? null)) onSave(nv);
    } else if ((val || "") !== (v || "")) onSave(val || null);
  };
  // money: show accounting £ format when not editing; raw number while focused for easy editing
  const formatted = isMoney && !focused && clean(val) !== "" && isFinite(Number(clean(val)));
  const display = formatted ? "£" + Number(clean(val)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (val ?? "");
  return (
    <Input type={isMoney ? "text" : type === "number" ? "number" : type || "text"} inputMode={numeric ? "decimal" : undefined}
      value={display} placeholder={isMoney && placeholder ? "£" + placeholder : placeholder}
      onChange={(e) => setVal(isMoney ? clean(e.target.value) : e.target.value)}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`h-8 ${align === "right" ? "text-right" : ""}`} style={{ width: w || "120px" }} />
  );
}

function CarTradingTab() {
  const utils = trpc.useUtils();
  const [newCarId, setNewCarId] = useState<number | null>(null); // just-added row: highlight + pin to top until its reg is entered
  const [carSearch, setCarSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_stock" | "sold">("all");
  const inval = () => {
    utils.expenditure.carDeals.invalidate();
    utils.expenditure.vehiclePurchases.invalidate();
    utils.expenditure.reconciliation.invalidate();
  };
  const deals = trpc.expenditure.carDeals.useQuery();
  const purchases = trpc.expenditure.vehiclePurchases.useQuery();
  const upsert = trpc.expenditure.upsertCarDeal.useMutation({ onSuccess: inval });
  const addCar = trpc.expenditure.upsertCarDeal.useMutation({
    onSuccess: (res: any) => { inval(); setNewCarId(res?.id ?? null); toast.success("Car added — fill it in, then click the green ✓ to save it into the list"); },
    onError: (e) => toast.error("Could not add car: " + e.message),
  });
  const del = trpc.expenditure.deleteCarDeal.useMutation({ onSuccess: inval });
  const link = trpc.expenditure.linkPurchase.useMutation({ onSuccess: inval });
  const lookup = trpc.expenditure.lookupReg.useMutation();
  const save = (id: number, patch: any) => upsert.mutate({ id, ...patch });
  // DVLA/UKVD lookup: pull make+model+year from the reg and fill the description.
  const fillFromReg = async (id: number, reg: string) => {
    const r = reg?.trim();
    if (!r) return;
    const t = toast.loading(`Looking up ${r.toUpperCase()}…`);
    try {
      const res: any = await lookup.mutateAsync({ registration: r });
      if (res?.description) { save(id, { description: res.description }); toast.success(`${res.reg}: ${res.description}`, { id: t }); }
      else toast.error(`No DVLA match for ${r.toUpperCase()}`, { id: t });
    } catch (e: any) { toast.error("Lookup failed: " + (e?.message || "unknown"), { id: t }); }
  };

  if (deals.isLoading) return <Loading />;
  const rows: any[] = deals.data || [];
  // pin the just-added row to the top so it doesn't re-order while you're filling it in
  const ordered: any[] = newCarId && rows.some((r) => r.id === newCarId)
    ? [rows.find((r) => r.id === newCarId), ...rows.filter((r) => r.id !== newCarId)]
    : rows;
  const cq = carSearch.trim().toLowerCase();
  const filtered: any[] = ordered.filter((r) => {
    if (r.id === newCarId) return true; // always show the just-added row
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (cq && !(r.registration || "").toLowerCase().includes(cq) && !(r.description || "").toLowerCase().includes(cq)) return false;
    return true;
  });
  const inStock = rows.filter((r) => r.status === "in_stock");
  const sold = rows.filter((r) => r.status === "sold");
  const stockCost = inStock.reduce((s, r) => s + (r.effectiveCost || 0), 0);
  const soldRevenue = sold.reduce((s, r) => s + (r.salePrice || 0), 0);
  const soldMargin = sold.reduce((s, r) => s + (r.margin || 0), 0);
  const purch: any[] = purchases.data || [];
  const toLink = purch.filter((p) => !p.carDealId).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="In stock" value={`${inStock.length} cars`} sub={`${money(stockCost)} tied up`} />
        <Stat label="Sold" value={`${sold.length} cars`} sub={`${money(soldRevenue)} revenue`} />
        <Stat label="Trading margin" value={money(soldMargin)} sub="on sold cars" accent />
        <Stat label="Purchases to link" value={`${toLink}`} sub="vehicle-stock payments" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <CardTitle>Cars</CardTitle>
          <Input placeholder="Search reg or model…" value={carSearch} onChange={(e) => setCarSearch(e.target.value)} className="h-9 w-[190px]" />
          <div className="mr-auto flex gap-1">
            {([["all", "All", rows.length], ["in_stock", "In stock", inStock.length], ["sold", "Sold", sold.length]] as const).map(([k, lbl, n]) => (
              <Button key={k} type="button" variant={statusFilter === k ? "default" : "outline"} size="sm" className="h-9" onClick={() => setStatusFilter(k as any)}>{lbl} <span className="ml-1 opacity-60">{n}</span></Button>
            ))}
          </div>
          <Button size="sm" disabled={addCar.isPending} onClick={() => addCar.mutate({ status: "in_stock" })}><Plus className="mr-1 h-4 w-4" />{addCar.isPending ? "Adding…" : "Add car"}</Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[70vh] rounded-md border">
          <table className="w-full caption-bottom text-sm border-separate border-spacing-0 [&_td]:border-b [&_th]:border-b [&_td]:border-slate-100 [&_th]:border-slate-200">
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-slate-50">
              <TableRow>
                <TableHead>Reg</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right" title="Vehicle price only — the VAT margin is based on this">Vehicle £</TableHead>
                <TableHead className="text-right" title="Fees, delivery & prep — cost of sales, but NOT part of the margin">Fees &amp; delivery £</TableHead>
                <TableHead className="text-right" title="Reclaimable input VAT on the fees/delivery (the vehicle itself carries none under the margin scheme)">Fee VAT £</TableHead>
                <TableHead className="text-right">Sale £</TableHead><TableHead>Sale date</TableHead>
                <TableHead className="text-right">Margin</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className={r.id === newCarId ? "bg-amber-100 hover:bg-amber-100" : r.status === "sold" ? "bg-green-50/40" : ""}>
                  <TableCell><EditCell v={r.registration} onSave={(v: any) => { save(r.id, { registration: v }); if (v && !r.description) fillFromReg(r.id, v); }} w="90px" /></TableCell>
                  <TableCell><EditCell v={r.description} onSave={(v: any) => save(r.id, { description: v })} w="190px" /></TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => save(r.id, { status: v })}>
                      <SelectTrigger className="h-8 w-[108px]"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="in_stock">In stock</SelectItem><SelectItem value="sold">Sold</SelectItem></SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right"><EditCell v={r.purchaseCost} type="money" align="right" w="110px" placeholder={r.linkedPurchaseTotal ? String(Math.round(r.linkedPurchaseTotal)) : ""} onSave={(v: any) => save(r.id, { purchaseCost: v })} /></TableCell>
                  <TableCell className="text-right"><EditCell v={r.reconditioningCost} type="money" align="right" w="105px" onSave={(v: any) => save(r.id, { reconditioningCost: v })} /></TableCell>
                  <TableCell className="text-right"><EditCell v={r.onCostVat} type="money" align="right" w="95px" onSave={(v: any) => save(r.id, { onCostVat: v })} /></TableCell>
                  <TableCell className="text-right"><EditCell v={r.salePrice} type="money" align="right" w="110px" onSave={(v: any) => save(r.id, { salePrice: v })} /></TableCell>
                  <TableCell><EditCell v={r.saleDate} type="date" w="140px" onSave={(v: any) => save(r.id, { saleDate: v })} /></TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${r.margin > 0 ? "text-green-700" : r.margin < 0 ? "text-red-600" : "text-slate-400"}`}>{r.margin != null ? money(r.margin) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.id === newCarId && <Button size="icon" variant="ghost" title="Done — save this car & let it sort into the list" className="text-green-600 hover:bg-green-100 hover:text-green-700" onClick={() => { setNewCarId(null); toast.success("Saved into the list"); }}><Check className="h-4 w-4" /></Button>}
                    <Button size="icon" variant="ghost" title="Look up make & model from the reg (DVLA)" disabled={!r.registration || lookup.isPending} onClick={() => fillFromReg(r.id, r.registration)}><Search className="h-4 w-4 text-slate-400" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this car?")) del.mutate({ id: r.id }); }}><Trash2 className="h-4 w-4 text-slate-400" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">{(cq || statusFilter !== "all") && <span className="font-medium text-slate-600">Showing {filtered.length} of {rows.length} cars. </span>}Type a <b>reg</b> and the make &amp; model auto-fill from DVLA (or click the <Search className="inline h-3 w-3" /> to look up any row). On a purchase invoice, put the <b>vehicle price</b> in <b>Vehicle £</b> (this alone drives the margin) and the <b>fees + delivery</b> in <b>Fees &amp; delivery £</b> with any reclaimable VAT in <b>Fee VAT £</b> — e.g. £5,000 vehicle, £650 fees, £108 VAT. Margin = sale − vehicle price; fees are cost of sales but not part of the margin. The greyed <b>Vehicle £</b> hint = the total of linked bank purchases (split it into vehicle vs fees). Set a car to <b>Sold</b> with the sale price + date to book the margin. A newly-added car stays pinned &amp; highlighted at the top until you click the green ✓ to save it into the list.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Vehicle-stock purchases — associate each to a car</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {purchases.isLoading ? <Loading /> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Payee</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Associated car</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {purch.map((p) => (
                  <TableRow key={p.id} className={p.carDealId ? "" : "bg-orange-50"}>
                    <TableCell className="whitespace-nowrap">{p.date}</TableCell>
                    <TableCell>{p.counterparty}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">{money(p.amount)}</TableCell>
                    <TableCell>
                      <Select value={p.carDealId ? String(p.carDealId) : "none"} onValueChange={(v) => link.mutate({ txnId: p.id, carDealId: v === "none" ? null : Number(v) })}>
                        <SelectTrigger className="h-8 w-[260px]"><SelectValue placeholder="— unassigned —" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— unassigned —</SelectItem>
                          {rows.map((d) => <SelectItem key={d.id} value={String(d.id)}>{(d.registration || "(no reg)") + " · " + (d.description || "")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const Loading = () => (
  <div className="flex items-center justify-center gap-2 p-8 text-slate-400">
    <Loader2 className="h-5 w-5 animate-spin" /> Loading…
  </div>
);
