import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Truck } from "lucide-react";
import { trpc } from "@/lib/trpc";

// Normalise a registration for comparison — vehicles.registration is stored solid (no space),
// and WISMO returns the reg as customer_order_ref; strip spaces and upper-case both sides.
export function normReg(reg?: string | null): string {
  return (reg || "").toUpperCase().replace(/\s+/g, "");
}

// Map an Omnipart order status to a coloured badge. Statuses seen: "Preparing your order",
// "Delivered"; treat anything not-yet-delivered as in-progress.
export function OrderStatusBadge({ status }: { status?: string | null }) {
  const s = (status || "").toLowerCase();
  let cls = "bg-slate-100 text-slate-700 border-slate-200";
  if (s.includes("deliver")) cls = "bg-green-100 text-green-800 border-green-200";
  else if (s.includes("prepar") || s.includes("picking") || s.includes("process") || s.includes("pending"))
    cls = "bg-amber-100 text-amber-800 border-amber-200";
  else if (s.includes("dispatch") || s.includes("transit") || s.includes("out for"))
    cls = "bg-blue-100 text-blue-800 border-blue-200";
  return <Badge variant="outline" className={cls}>{status || "Unknown"}</Badge>;
}

function money(v: number | null | undefined) {
  return typeof v === "number" ? `£${v.toFixed(2)}` : "—";
}

/** Inline card for a single vehicle's ECP orders, matched by registration. */
export function OmnipartOrdersCard({ registration }: { registration?: string | null }) {
  const { data, isLoading, error } = trpc.omnipart.getOrderTracking.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const target = normReg(registration);
  const orders = (data?.orders || []).filter((o) => target && normReg(o.reg) === target);

  // Nothing to show for this vehicle — stay quiet rather than render an empty card.
  if (!isLoading && !error && orders.length === 0) return null;

  return (
    <Card className="md:col-span-3">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="w-4 h-4" /> Euro Car Parts Orders
        </CardTitle>
        <CardDescription>Live Omnipart order status for this vehicle</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="text-sm text-muted-foreground">Loading order status…</div>}
        {error && (
          <div className="text-sm text-amber-700">
            Couldn't load order tracking (session may need refreshing).
          </div>
        )}
        {orders.map((o) => (
          <div
            key={o.orderRef}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
          >
            <div className="flex flex-col">
              <span className="font-medium">{o.orderRef}</span>
              <span className="text-xs text-muted-foreground">
                {o.orderDate ? new Date(o.orderDate).toLocaleDateString("en-GB") : "—"} ·{" "}
                {o.numberOfItems ?? "?"} item{o.numberOfItems === 1 ? "" : "s"} · {money(o.totalIncTax)}
              </span>
            </div>
            <OrderStatusBadge status={o.status} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default OmnipartOrdersCard;
