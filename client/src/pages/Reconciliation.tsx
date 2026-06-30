import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, AlertTriangle } from "lucide-react";

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
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="labels">Labels</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>

          <TabsContent value="summary"><SummaryTab from={from} to={to} /></TabsContent>
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
  const { months, sales, sections } = q.data as any;

  const sec = (k: string): number[] => sections[k] || months.map(() => 0);
  const cogs = sec("cogs"), overheads = sec("overheads"), cartrade = sec("cartrade"),
        taxes = sec("taxes"), receipts = sec("receipts"), financing = sec("financing");
  const gross = months.map((_: string, i: number) => sales[i] + cogs[i]);
  const opProfit = months.map((_: string, i: number) => gross[i] + overheads[i]);

  const Row = ({ label, vals, bold, hl, indent }: any) => (
    <TableRow className={hl ? "bg-slate-900 text-white" : bold ? "bg-slate-100 font-semibold" : ""}>
      <TableCell className={`whitespace-nowrap ${indent ? "pl-6 text-slate-500" : ""}`}>{label}</TableCell>
      {vals.map((v: number, i: number) => (
        <TableCell key={i} className={`text-right tabular-nums ${v < 0 && !hl ? "text-red-600" : ""}`}>{money(v)}</TableCell>
      ))}
      <TableCell className="text-right font-bold tabular-nums">{money(sumArr(vals))}</TableCell>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader><CardTitle>Monthly P&amp;L — workshop</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-white">£</TableHead>
              {months.map((m: string) => <TableHead key={m} className="text-right">{monthLabel(m)}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Row label="Workshop sales" vals={sales} />
            <Row label="Cost of sales (parts &amp; sublet)" vals={cogs} indent />
            <Row label="Gross profit" vals={gross} bold />
            <Row label="Overheads" vals={overheads} indent />
            <Row label="Workshop operating profit" vals={opProfit} hl />
            <TableRow><TableCell colSpan={months.length + 2} className="h-3 p-0" /></TableRow>
            <Row label="Car purchases (trading)" vals={cartrade} indent />
            <Row label="Taxes (VAT / Corp Tax)" vals={taxes} indent />
            <Row label="Bank takings (cash in)" vals={receipts} indent />
            <Row label="Financing / drawings / contra" vals={financing} indent />
          </TableBody>
        </Table>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          Car purchases sit outside the workshop P&amp;L because car-sale revenue isn't yet recorded (phase 2). "Bank takings" are cash received, shown for cross-check — not added to revenue.
        </p>
      </CardContent>
    </Card>
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

const Loading = () => (
  <div className="flex items-center justify-center gap-2 p-8 text-slate-400">
    <Loader2 className="h-5 w-5 animate-spin" /> Loading…
  </div>
);
