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
import { Loader2, Upload, AlertTriangle, Plus, Trash2 } from "lucide-react";
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
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="cars">Car Trading</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="labels">Labels</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>

          <TabsContent value="summary"><SummaryTab from={from} to={to} /></TabsContent>
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
  if (q.isLoading) return <Loading />;
  if (!q.data) return <p className="p-4 text-slate-500">No data.</p>;
  const { months, sales, sections, carTrading, vat, categories } = q.data as any;
  const catAmts = (name: string): number[] => (categories || []).find((c: any) => c.name === name)?.amounts || months.map(() => 0);
  const adamLoan = catAmts("Director — Adam Rutstein");
  const adamWages = catAmts("Wages — Adam Rutstein");
  const adamTotal = months.map((_: string, i: number) => adamLoan[i] + adamWages[i]);

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
  const wsEquiv = ohMonthly / 0.57;
  const wsCoverage = ohMonthly > 0 ? Math.round((wsGrossMonthly / ohMonthly) * 100) : 0;

  const Row = ({ label, vals, bold, hl, indent }: any) => (
    <TableRow className={hl ? "bg-slate-900 text-white" : bold ? "bg-slate-100 font-semibold" : ""}>
      <TableCell className={`sticky left-0 z-10 whitespace-nowrap ${hl ? "bg-slate-900" : bold ? "bg-slate-100" : "bg-white"} ${indent ? "pl-6 text-slate-500" : ""}`}>{label}</TableCell>
      {vals.map((v: number, i: number) => (
        <TableCell key={i} className={`text-right tabular-nums ${v < 0 && !hl ? "text-red-600" : ""}`}>{money(v)}</TableCell>
      ))}
      <TableCell className={`sticky right-0 z-10 text-right font-bold tabular-nums ${hl ? "bg-slate-900" : bold ? "bg-slate-100" : "bg-white"}`}>{money(sumArr(vals))}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader><CardTitle>Monthly P&amp;L — whole business</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Break-even / month</div><div className="text-lg font-bold text-slate-800">{money(ohMonthly)}</div><div className="text-[11px] text-slate-500">gross profit to cover overheads</div></div>
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Break-even / day</div><div className="text-lg font-bold text-slate-800">{money(beDaily)}</div><div className="text-[11px] text-slate-500">gross, over 26 working days</div></div>
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Workshop sales equiv.</div><div className="text-lg font-bold text-slate-800">{money(wsEquiv)}</div><div className="text-[11px] text-slate-500">/mo at 57% margin, if no car sales</div></div>
          <div className="rounded-lg border bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Workshop covers</div><div className="text-lg font-bold text-slate-800">{wsCoverage}%</div><div className="text-[11px] text-slate-500">of the nut; cars fund the rest</div></div>
        </div>
        <div className="overflow-auto max-h-[72vh] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 top-0 z-30 bg-slate-50">£</TableHead>
              {months.map((m: string) => <TableHead key={m} className="sticky top-0 z-20 bg-slate-50 text-right">{monthLabel(m)}</TableHead>)}
              <TableHead className="sticky right-0 top-0 z-30 bg-slate-50 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Row label="Workshop sales" vals={sales} />
            <Row label="Cost of sales (parts &amp; sublet)" vals={cogs} indent />
            <Row label="Workshop gross profit" vals={gross} bold />
            <TableRow><TableCell colSpan={months.length + 2} className="h-3 p-0" /></TableRow>
            <TableRow>
              <TableCell className="sticky left-0 z-10 bg-white whitespace-nowrap">Car sales</TableCell>
              {carRev.map((v: number, i: number) => (
                <TableCell key={i} className="text-right tabular-nums">
                  {carIncomplete[i]
                    ? <span className="text-amber-600 font-semibold" title="Stock bought this month but no car sales digitised yet — figure is incomplete, not zero">⚠</span>
                    : money(v)}
                </TableCell>
              ))}
              <TableCell className="sticky right-0 z-10 bg-white text-right font-bold tabular-nums">{money(sumArr(carRev))}</TableCell>
            </TableRow>
            <Row label="Cost of cars sold" vals={carCostNeg} indent />
            <Row label="Car trading margin" vals={carMargin} bold />
            <TableRow><TableCell colSpan={months.length + 2} className="h-3 p-0" /></TableRow>
            <Row label="Combined gross profit (workshop + cars)" vals={combinedGross} bold />
            <Row label="Overheads — whole business (shared)" vals={overheads} indent />
            <Row label="NET BUSINESS PROFIT" vals={netProfit} hl />
            <TableRow><TableCell colSpan={months.length + 2} className="h-4 p-0" /></TableRow>
            <Row label="Car purchases — cash out on stock" vals={cartrade} indent />
            <Row label="Taxes (VAT / Corp Tax)" vals={taxes} indent />
            <Row label="Bank takings (cash in)" vals={receipts} indent />
            <Row label="Financing / drawings / contra" vals={financing} indent />
            <Row label="→ Adam Rutstein (drawings / loan)" vals={adamLoan} indent />
            <Row label="→ Adam Rutstein (wages)" vals={adamWages} indent />
            <Row label="→ Adam Rutstein — total drawn" vals={adamTotal} bold />
            <Row label="→ Hillel Rutstein (drawings / loan)" vals={catAmts("Director — Hillel Rutstein")} indent />
            <Row label="→ Douglas Brittain (rent)" vals={catAmts("Rent — Douglas Brittain")} indent />
            <TableRow><TableCell colSpan={months.length + 2} className="h-4 p-0" /></TableRow>
            <TableRow className="bg-violet-50"><TableCell colSpan={months.length + 2} className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">VAT — Barclays expenditure is VAT-inclusive</TableCell></TableRow>
            <Row label="VAT due — workshop (output)" vals={vatDueWorkshop} indent />
            <Row label="VAT due — car margins (÷6)" vals={vatDueCars} indent />
            <Row label="VAT due (output — total)" vals={vatDue} />
            <Row label="VAT reclaimed (input — on expenditure)" vals={vatReclaimedNeg} indent />
            <Row label="VAT net payable to HMRC" vals={vatNet} bold />
          </TableBody>
        </Table>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span><b>Overheads are a shared, whole-business cost</b> (wages, rent, advertising, insurance) — taken off <i>combined</i> gross, not charged to the workshop alone. A <span className="text-amber-600 font-semibold">⚠</span> in Car sales means stock was bought that month but the disposals aren&apos;t digitised yet, so that month&apos;s car margin &amp; profit are <b>understated, not zero</b>. Car margin comes from the <b>Car Trading</b> tab; "Bank takings" are cash received (cross-check only, not added to revenue). Expenditure is net of reclaimable VAT.</span>
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

/** Supplier spend analytics — monthly trend chart + per-supplier month-by-month table with rolling trend. */
function SuppliersTab({ from, to }: { from: string; to: string }) {
  const q = trpc.expenditure.supplierSpend.useQuery({ from, to });
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
            <Table>
              <TableHeader>
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
                    <TableCell className="whitespace-nowrap text-[11px] text-slate-500">{s.category}</TableCell>
                    {s.monthly.map((v: number, i: number) => <TableCell key={i} className="text-right tabular-nums text-slate-600">{v ? money(v) : <span className="text-slate-300">·</span>}</TableCell>)}
                    <TableCell className="text-right font-semibold tabular-nums">{money(s.total)}</TableCell>
                    <TableCell className="sticky right-0 z-10 bg-white text-right text-xs">
                      {s.trendPct > 8 ? <span className="text-red-600">↑ {s.trendPct}%</span> : s.trendPct < -8 ? <span className="text-green-600">↓ {Math.abs(s.trendPct)}%</span> : <span className="text-slate-400">–</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Trend = last 3 months' average vs the prior 3 months (↑ rising = red, ↓ falling = green). Showing top {top.length} of {suppliers.length} suppliers.</p>
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
  useEffect(() => { setVal(v ?? ""); }, [v]);
  const commit = () => {
    if (type === "number") {
      const nv = val === "" ? null : Number(val);
      if (nv !== (v ?? null)) onSave(nv);
    } else if ((val || "") !== (v || "")) onSave(val || null);
  };
  return (
    <Input type={type === "number" ? "number" : type || "text"} value={val} placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`h-8 ${align === "right" ? "text-right" : ""}`} style={{ width: w || "120px" }} />
  );
}

function CarTradingTab() {
  const utils = trpc.useUtils();
  const inval = () => {
    utils.expenditure.carDeals.invalidate();
    utils.expenditure.vehiclePurchases.invalidate();
    utils.expenditure.reconciliation.invalidate();
  };
  const deals = trpc.expenditure.carDeals.useQuery();
  const purchases = trpc.expenditure.vehiclePurchases.useQuery();
  const upsert = trpc.expenditure.upsertCarDeal.useMutation({ onSuccess: inval });
  const del = trpc.expenditure.deleteCarDeal.useMutation({ onSuccess: inval });
  const link = trpc.expenditure.linkPurchase.useMutation({ onSuccess: inval });
  const save = (id: number, patch: any) => upsert.mutate({ id, ...patch });

  if (deals.isLoading) return <Loading />;
  const rows: any[] = deals.data || [];
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
          <CardTitle className="mr-auto">Cars</CardTitle>
          <Button size="sm" onClick={() => upsert.mutate({ status: "in_stock" })}><Plus className="mr-1 h-4 w-4" />Add car</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reg</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Purchase £</TableHead><TableHead className="text-right">Recond £</TableHead>
                <TableHead className="text-right">Sale £</TableHead><TableHead>Sale date</TableHead>
                <TableHead className="text-right">Margin</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={r.status === "sold" ? "bg-green-50/40" : ""}>
                  <TableCell><EditCell v={r.registration} onSave={(v: any) => save(r.id, { registration: v })} w="90px" /></TableCell>
                  <TableCell><EditCell v={r.description} onSave={(v: any) => save(r.id, { description: v })} w="190px" /></TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => save(r.id, { status: v })}>
                      <SelectTrigger className="h-8 w-[108px]"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="in_stock">In stock</SelectItem><SelectItem value="sold">Sold</SelectItem></SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right"><EditCell v={r.purchaseCost} type="number" align="right" w="100px" placeholder={r.linkedPurchaseTotal ? String(Math.round(r.linkedPurchaseTotal)) : ""} onSave={(v: any) => save(r.id, { purchaseCost: v })} /></TableCell>
                  <TableCell className="text-right"><EditCell v={r.reconditioningCost} type="number" align="right" w="90px" onSave={(v: any) => save(r.id, { reconditioningCost: v })} /></TableCell>
                  <TableCell className="text-right"><EditCell v={r.salePrice} type="number" align="right" w="100px" onSave={(v: any) => save(r.id, { salePrice: v })} /></TableCell>
                  <TableCell><EditCell v={r.saleDate} type="date" w="140px" onSave={(v: any) => save(r.id, { saleDate: v })} /></TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${r.margin > 0 ? "text-green-700" : r.margin < 0 ? "text-red-600" : "text-slate-400"}`}>{r.margin != null ? money(r.margin) : "—"}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this car?")) del.mutate({ id: r.id }); }}><Trash2 className="h-4 w-4 text-slate-400" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">Set a car to <b>Sold</b> and fill in the sale price + date to book the margin. A greyed "Purchase £" hint = the total of associated bank purchases (below).</p>
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
