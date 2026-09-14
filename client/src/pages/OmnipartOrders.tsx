import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Search, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { RegPlate } from "@/components/RegPlate";
import { useClassicBase } from "@/lib/classicNav";
import { OrderStatusBadge, normReg } from "@/components/OmnipartOrdersCard";

function money(v: number | null | undefined) {
  return typeof v === "number" ? `£${v.toFixed(2)}` : "—";
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
    return needle ? all.filter((o) => normReg(o.reg).includes(needle)) : all;
  }, [data, q]);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="w-6 h-6" /> Parts Orders
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
            <CardTitle className="text-base">
              Live Omnipart order tracking{typeof data?.count === "number" ? ` · ${orders.length}/${data.count}` : ""}
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
                    {orders.map((o) => {
                      const vehicle = [o.make, o.model, o.year].filter(Boolean).join(" ");
                      return (
                        <TableRow key={o.orderRef}>
                          <TableCell className="font-medium">{o.orderRef}</TableCell>
                          <TableCell>
                            {o.reg ? (
                              <Link href={`/view-vehicle/${normReg(o.reg)}`} className="hover:underline">
                                <RegPlate reg={o.reg} />
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>{vehicle || "—"}</TableCell>
                          <TableCell>
                            {o.jobSheet ? (
                              <Link href={`${base}/documents/${o.jobSheet.id}`} className="text-brand-primary hover:underline">
                                {o.jobSheet.ga4Number || o.jobSheet.docNo || o.jobSheet.id}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{o.numberOfItems ?? "—"}</TableCell>
                          <TableCell className="text-right">{money(o.totalIncTax)}</TableCell>
                          <TableCell>
                            {o.orderDate ? new Date(o.orderDate).toLocaleDateString("en-GB") : "—"}
                          </TableCell>
                          <TableCell>
                            <OrderStatusBadge status={o.status} />
                          </TableCell>
                        </TableRow>
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
