import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Truck, FileText, AlertTriangle, ChevronDown, ChevronRight, Package } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useClassicBase } from "@/lib/classicNav";
import { ReturnDialog } from "@/components/ReturnDialog";

// Normalise a registration for comparison — vehicles.registration is stored solid (no space),
// and WISMO returns the reg as customer_order_ref; strip spaces and upper-case both sides.
export function normReg(reg?: string | null): string {
  return (reg || "").toUpperCase().replace(/\s+/g, "");
}

export function OrderStatusBadge({ status }: { status?: string | null }) {
  const s = (status || "").toLowerCase();
  let cls = "bg-slate-100 text-slate-700 border-slate-200";
  if (s.includes("deliver")) cls = "bg-green-100 text-green-800 border-green-200";
  else if (s.includes("prepar") || s.includes("picking") || s.includes("process") || s.includes("pending"))
    cls = "bg-amber-100 text-amber-800 border-amber-200";
  else if (s.includes("dispatch") || s.includes("transit") || s.includes("ready") || s.includes("out for"))
    cls = "bg-blue-100 text-blue-800 border-blue-200";
  return <Badge variant="outline" className={cls}>{status || "Unknown"}</Badge>;
}

const STAGES = ["Preparing", "Picking & packing", "Ready for dispatch", "Delivered"];
export function stageIndex(status?: string | null): number {
  const s = (status || "").toLowerCase();
  if (s.includes("deliver")) return 3;
  if (s.includes("dispatch") || s.includes("ready") || s.includes("out for") || s.includes("transit")) return 2;
  if (s.includes("picking") || s.includes("packing")) return 1;
  return 0;
}

/** 4-stage delivery progress bar driven by the order status. */
export function OrderProgress({ status }: { status?: string | null }) {
  const idx = stageIndex(status);
  const delivered = idx >= 3;
  return (
    <div className="flex items-center gap-1 w-full">
      {STAGES.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1" title={label}>
          <div
            className={
              "h-1.5 w-full rounded-full " +
              (i <= idx ? (delivered ? "bg-green-500" : "bg-brand-primary") : "bg-slate-200")
            }
          />
          <span className={"text-[10px] leading-none text-center " + (i === idx ? "font-semibold text-foreground" : "text-muted-foreground/70")}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function money(v: number | null | undefined) {
  return typeof v === "number" ? `£${v.toFixed(2)}` : "—";
}
function ago(hours?: number | null) {
  if (hours == null) return "";
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** One order row: status + progress + age/attention + expandable parts. */
function OrderRow({ o, base }: { o: any; base: string }) {
  const [open, setOpen] = useState(false);
  const detail = trpc.omnipart.getOrderDetail.useQuery(
    { ref: o.orderRef, orderId: o.dbOrderId ?? undefined, branchId: o.branchId ?? undefined },
    { enabled: open, retry: false, staleTime: 60 * 1000 },
  );
  const parts = detail.data?.parts || [];
  return (
    <div className={"rounded-md border p-2 text-sm " + (o.needsAttention ? "border-amber-300 bg-amber-50/50" : "")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 font-medium hover:underline text-left">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {o.orderRef}
          </button>
          <span className="text-xs text-muted-foreground pl-4">
            {o.orderDate ? new Date(o.orderDate).toLocaleDateString("en-GB") : "—"} · {o.numberOfItems ?? "?"} item
            {o.numberOfItems === 1 ? "" : "s"} · {money(o.totalIncTax)}
          </span>
          {o.jobSheet ? (
            <Link href={`${base}/documents/${o.jobSheet.id}`} className="mt-0.5 ml-4 inline-flex items-center gap-1 text-xs text-brand-primary hover:underline">
              <FileText className="w-3 h-3" /> Job {o.jobSheet.ga4Number || o.jobSheet.docNo || o.jobSheet.id}
              {o.jobSheet.date ? ` · ${new Date(o.jobSheet.date).toLocaleDateString("en-GB")}` : ""}
            </Link>
          ) : (
            <span className="mt-0.5 ml-4 text-xs text-muted-foreground/70">No matching job sheet</span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <OrderStatusBadge status={o.status} />
            <ReturnDialog orderRef={o.orderRef} orderId={o.dbOrderId} />
          </div>
          {o.status && !String(o.status).toLowerCase().includes("deliver") && (
            <span className={"text-xs inline-flex items-center gap-1 " + (o.needsAttention ? "text-amber-700 font-semibold" : "text-muted-foreground")}>
              {o.needsAttention && <AlertTriangle className="w-3 h-3" />}
              ordered {ago(o.ageHours)}{o.needsAttention ? " · not arrived" : ""}
            </span>
          )}
        </div>
      </div>

      {/* progress bar */}
      <div className="mt-2 px-1">
        <OrderProgress status={o.status} />
      </div>

      {/* expandable parts */}
      {open && (
        <div className="mt-2 pl-4 border-t pt-2">
          {detail.isLoading && <div className="text-xs text-muted-foreground">Loading parts…</div>}
          {!detail.isLoading && parts.length === 0 && (
            <div className="text-xs text-muted-foreground/70">Part detail not available for this order.</div>
          )}
          {parts.map((p: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs py-0.5">
              <Package className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="font-medium">{p.name || p.code || "part"}</span>
              {p.code && p.name && <span className="text-muted-foreground/70">({p.code})</span>}
              {p.quantity != null && <span className="text-muted-foreground">×{p.quantity}</span>}
              {p.status && <span className="ml-auto text-muted-foreground/70">{p.status}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline card for a single vehicle's ECP orders, matched by registration. */
export function OmnipartOrdersCard({ registration }: { registration?: string | null }) {
  const base = useClassicBase();
  const { data, isLoading, error } = trpc.omnipart.getOrderTracking.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const target = normReg(registration);
  const orders = (data?.orders || []).filter((o) => target && normReg(o.reg) === target);
  if (!isLoading && !error && orders.length === 0) return null;

  const attention = orders.filter((o) => (o as any).needsAttention).length;

  return (
    <Card className="md:col-span-3">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="w-4 h-4" /> Euro Car Parts Orders
          {attention > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
              <AlertTriangle className="w-3 h-3" /> {attention} need chasing
            </span>
          )}
        </CardTitle>
        <CardDescription>Live Omnipart order status for this vehicle — click an order for its parts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-sm text-muted-foreground">Loading order status…</div>}
        {error && <div className="text-sm text-amber-700">Couldn't load order tracking (session may need refreshing).</div>}
        {orders.map((o) => (
          <OrderRow key={o.orderRef} o={o} base={base} />
        ))}
      </CardContent>
    </Card>
  );
}

export default OmnipartOrdersCard;
