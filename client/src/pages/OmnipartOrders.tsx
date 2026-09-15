import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Search, RefreshCw, ChevronDown, ChevronRight, Package } from "lucide-react";
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

/** One board row that expands on click to show the parts on the order. */
function BoardRow({ o, base }: { o: any; base: string }) {
  const [open, setOpen] = useState(false);
  const detail = trpc.omnipart.getOrderDetail.useQuery(
    { ref: o.orderRef, branchId: o.branchId ?? undefined },
    { enabled: open, retry: false, staleTime: 60 * 1000 },
  );
  const parts = detail.data?.parts || [];
  const vehicle = [o.make, o.model, o.year].filter(Boolean).join(" ");
  return (
    <>
      <TableRow className={(o.needsAttention ? "bg-amber-50 " : "") + "cursor-pointer"} onClick={() => setOpen((v) => !v)}>
        <TableCell className="font-medium">
          <span className="inline-flex items-center gap-1">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {o.orderRef}
          </span>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {o.reg ? (
            <Link href={`/view-vehicle/${normReg(o.reg)}`} className="hover:underline">
              <RegPlate reg={o.reg} />
            </Link>
          ) : "—"}
        </TableCell>
        <TableCell>{vehicle || "—"}</TableCell>
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
              <OrderProgress status={o.status} />
              <div className="pt-1">
                {detail.isLoading && <div className="text-xs text-muted-foreground">Loading parts…</div>}
                {!detail.isLoading && parts.length === 0 && (
                  <div className="text-xs text-muted-foreground/70">Part detail not available for this order.</div>
                )}
                {parts.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-0.5">
                    <Package className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium">{p.name || p.code || "part"}</span>
                    {p.code && p.name && p.name !== p.code && <span className="text-xs text-muted-foreground/70">({p.code})</span>}
                    {p.quantity != null && <span className="text-xs text-muted-foreground">×{p.quantity}</span>}
                    {p.status && <span className="ml-auto text-xs text-muted-foreground/70">{p.status}</span>}
                  </div>
                ))}
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

  const orders = useMemo(() => {
    const all = data?.orders || [];
    const needle = normReg(q);
    const filtered = needle ? all.filter((o) => normReg(o.reg).includes(needle)) : all;
    // orders that need chasing float to the top so a stuck one is never missed
    return [...filtered].sort((a: any, b: any) =>
      (b.needsAttention ? 1 : 0) - (a.needsAttention ? 1 : 0) ||
      String(b.orderDate || "").localeCompare(String(a.orderDate || "")));
  }, [data, q]);
  const chasing = (data?.orders || []).filter((o: any) => o.needsAttention).length;

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
