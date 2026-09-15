import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Printer, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { useClassicBase } from "@/lib/classicNav";

const money = (v: number) => `£${(Number(v) || 0).toFixed(2)}`;
const monthKey = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 7) : "unknown");
const monthLabel = (k: string) => k === "unknown" ? "Unknown" :
  new Date(k + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// Net cost basis: ECP is already ex-VAT; eBay/Amazon prices are gross, estimate net at ÷1.2.
function costNet(o: any): number {
  if (o.source === "ebay" || o.source === "amazon") return (Number(o.totalIncTax) || 0) / 1.2;
  return Number(o.totalExcTax) || 0;
}

/** Internal cost & margin report across parts orders (ECP live + eBay/Amazon captured). */
export default function PartsReport() {
  const base = useClassicBase();
  const { data, isLoading } = trpc.omnipart.getOrderTracking.useQuery(undefined, { staleTime: 5 * 60 * 1000, retry: false });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const orders = useMemo(() => {
    let os = (data?.orders || []) as any[];
    if (from) os = os.filter((o) => (o.orderDate || "") >= from);
    if (to) os = os.filter((o) => (o.orderDate || "") <= to + "T23:59:59");
    return os;
  }, [data, from, to]);

  // Job ids with linked orders → fetch parts-sell to compute margin.
  const jobIds = useMemo(
    () => Array.from(new Set(orders.filter((o) => o.jobSheet?.id).map((o) => o.jobSheet.id))) as number[],
    [orders],
  );
  const sellByJob = trpc.omnipart.jobPartsSell.useQuery({ ids: jobIds }, { enabled: jobIds.length > 0, staleTime: 5 * 60 * 1000 });

  const report = useMemo(() => {
    const bySupplier: Record<string, number> = { ecp: 0, ebay: 0, amazon: 0 };
    const byCategory: Record<string, number> = { car: 0, general: 0 };
    const byMonth: Record<string, { ecp: number; ebay: number; amazon: number; total: number }> = {};
    const byJob: Record<number, { id: number; job: string; reg: string | null; cost: number; suppliers: Set<string> }> = {};
    let total = 0;
    for (const o of orders) {
      const c = costNet(o);
      total += c;
      const src = o.source || "ecp";
      bySupplier[src] = (bySupplier[src] || 0) + c;
      byCategory[o.category === "general" ? "general" : "car"] += c;
      const mk = monthKey(o.orderDate);
      (byMonth[mk] ||= { ecp: 0, ebay: 0, amazon: 0, total: 0 });
      byMonth[mk][src as "ecp" | "ebay" | "amazon"] = (byMonth[mk][src as "ecp"] || 0) + c;
      byMonth[mk].total += c;
      if (o.jobSheet?.id) {
        const j = (byJob[o.jobSheet.id] ||= { id: o.jobSheet.id, job: o.jobSheet.ga4Number || o.jobSheet.docNo || String(o.jobSheet.id), reg: o.reg || o.vehicleText || null, cost: 0, suppliers: new Set() });
        j.cost += c;
        j.suppliers.add(src);
      }
    }
    const months = Object.keys(byMonth).sort().reverse();
    const jobs = Object.values(byJob).sort((a, b) => b.cost - a.cost);
    return { bySupplier, byCategory, byMonth, months, jobs, total };
  }, [orders]);

  const sell = sellByJob.data || {};

  return (
    <DashboardLayout>
      <div className="space-y-4 print:space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6" /> Parts Cost & Margin
          </h1>
          <div className="flex items-center gap-2">
            <Link href={`${base}/parts-orders`}><Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4" /> Board</Button></Link>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</Button>
          </div>
        </div>

        <div className="rounded-md border border-dashed border-amber-400 bg-amber-50/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          Internal only — cost & margin. Never share with a customer.
        </div>

        <div className="flex items-center gap-2 text-sm print:hidden">
          <span className="text-muted-foreground">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
        ) : (
          <>
            {/* Summary tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="Total parts cost" value={money(report.total)} sub={`${orders.length} orders`} big />
              <Tile label="ECP" value={money(report.bySupplier.ecp)} />
              <Tile label="eBay" value={money(report.bySupplier.ebay)} />
              <Tile label="Amazon" value={money(report.bySupplier.amazon)} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
              <Tile label="Car jobs" value={money(report.byCategory.car)} />
              <Tile label="General / workshop" value={money(report.byCategory.general)} />
            </div>

            {/* Spend by month */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Spend by month</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">ECP</TableHead>
                      <TableHead className="text-right">eBay</TableHead>
                      <TableHead className="text-right">Amazon</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {report.months.map((mk) => {
                        const m = report.byMonth[mk];
                        return (
                          <TableRow key={mk}>
                            <TableCell className="font-medium">{monthLabel(mk)}</TableCell>
                            <TableCell className="text-right tabular-nums">{m.ecp ? money(m.ecp) : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{m.ebay ? money(m.ebay) : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{m.amazon ? money(m.amazon) : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{money(m.total)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {report.months.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No orders in range.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Cost per job with margin */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cost per job {sellByJob.isFetching && <span className="text-xs text-muted-foreground">· loading sell prices…</span>}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead className="text-right">Parts cost</TableHead>
                      <TableHead className="text-right">Parts sell</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {report.jobs.map((j) => {
                        const s = sell[j.id];
                        const hasSell = typeof s === "number" && s > 0;
                        const margin = hasSell ? s - j.cost : null;
                        const pct = hasSell && s > 0 ? ((s - j.cost) / s) * 100 : null;
                        return (
                          <TableRow key={j.id}>
                            <TableCell className="font-medium">
                              <Link href={`${base}/documents/${j.id}`} className="text-brand-primary hover:underline">{j.job}</Link>
                            </TableCell>
                            <TableCell>{j.reg || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(j.cost)}</TableCell>
                            <TableCell className="text-right tabular-nums">{hasSell ? money(s) : "—"}</TableCell>
                            <TableCell className={"text-right tabular-nums font-semibold " + (margin == null ? "text-muted-foreground" : margin >= 0 ? "text-green-700" : "text-red-600")}>
                              {margin == null ? "—" : `${money(margin)}${pct != null ? ` · ${pct.toFixed(0)}%` : ""}`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {report.jobs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No orders linked to a job in range.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-[11px] text-muted-foreground pt-2">
                  Cost basis: ECP ex-VAT; eBay/Amazon gross ÷1.2. ECP shows recent live orders; eBay/Amazon show the full captured history.
                  Margin = parts sell (ex VAT, from the job) − parts cost. Only jobs with linked orders appear.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Tile({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={(big ? "text-2xl" : "text-xl") + " font-bold tabular-nums"}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
