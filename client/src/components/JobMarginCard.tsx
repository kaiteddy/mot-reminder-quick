import { trpc } from "@/lib/trpc";
import { Plus } from "lucide-react";

// INTERNAL ONLY. Shows the parts actually ORDERED for this job (from the Euro Car Parts / eBay /
// Amazon orders matched to it) and the margin — ECP/eBay cost vs the sell price on the document.
// This must NEVER appear on a customer's job sheet / invoice / estimate: it lives only in the
// on-screen editor, is `print:hidden`, and the PDF/email templates never receive cost data.
function money(v: number) {
  return `£${(Number(v) || 0).toFixed(2)}`;
}

const SRC = (s?: string) => (s === "ebay" ? { t: "eBay", c: "bg-[#e53238]/10 text-[#e53238]" } :
  s === "amazon" ? { t: "Amzn", c: "bg-[#ff9900]/15 text-[#b06f00]" } :
  s === "gsf" ? { t: "GSF", c: "bg-blue-100 text-blue-700" } :
  { t: "ECP", c: "bg-orange-100 text-orange-700" });

export function JobMarginCard({ documentId, partsSellNet, onAddPart }: {
  documentId: number;
  partsSellNet: number;
  onAddPart?: (p: { description: string; partNumber?: string; quantity: number }) => void;
}) {
  const { data, isLoading, error } = trpc.omnipart.getOrderTracking.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!documentId) return null;

  const orders = (data?.orders || []).filter((o: any) => o.jobSheet && o.jobSheet.id === documentId);
  const hasCost = orders.length > 0;
  // ECP cost is already ex-VAT. eBay/Amazon prices are gross (inc VAT), so estimate net at ÷1.2.
  const ecpOrders = orders.filter((o: any) => o.source !== "ebay" && o.source !== "amazon");
  const emailOrders = orders.filter((o: any) => o.source === "ebay" || o.source === "amazon");
  const ecpCost = ecpOrders.reduce((a: number, o: any) => a + (Number(o.totalExcTax) || 0), 0);
  const emailGross = emailOrders.reduce((a: number, o: any) => a + (Number(o.totalIncTax) || 0), 0);
  const emailNet = emailGross / 1.2;
  const totalCost = ecpCost + emailNet;
  const margin = partsSellNet - totalCost;
  const marginPct = partsSellNet > 0 ? (margin / partsSellNet) * 100 : null;

  // Every part across the linked orders — this is the "where are my ordered parts" list.
  const orderParts = orders.flatMap((o: any) =>
    (o.parts || []).map((p: any) => ({ ...p, source: o.source, orderRef: o.orderRef })));

  return (
    <div className="mt-3 rounded-md border border-dashed border-amber-400 bg-amber-50/50 p-2 print:hidden">
      <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
        Ordered parts &amp; margin · internal only — never printed
      </div>
      {isLoading && <div className="text-xs text-muted-foreground mt-1">Loading ordered parts…</div>}
      {error && <div className="text-xs text-amber-700 mt-1">ECP session offline — open Omnipart to refresh.</div>}
      {!isLoading && !error && !hasCost && (
        <div className="text-xs text-muted-foreground mt-1">No parts order linked to this job. Link one on the Parts Orders board (or it auto-matches ECP orders by reg).</div>
      )}

      {!isLoading && !error && hasCost && (
        <>
          {/* The parts that were actually ordered for this job */}
          {orderParts.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {orderParts.map((p: any, i: number) => {
                const src = SRC(p.source);
                return (
                  <div key={i} className="flex items-center gap-1.5 text-[12px]">
                    <span className={"text-[9px] font-bold px-1 py-0.5 rounded shrink-0 " + src.c}>{src.t}</span>
                    <span className="font-medium truncate" title={p.name || p.code}>{p.name || p.code || "part"}</span>
                    {p.code && <span className="text-[10px] text-muted-foreground shrink-0">{p.code}</span>}
                    {p.quantity != null && <span className="text-[10px] text-muted-foreground shrink-0">×{p.quantity}</span>}
                    <span className="ml-auto text-[11px] text-slate-600 tabular-nums shrink-0">{p.lineCost != null ? money(p.lineCost) : ""}</span>
                    {onAddPart && (
                      <button
                        onClick={() => onAddPart({ description: p.name || p.code || "Part", partNumber: p.code || undefined, quantity: Number(p.quantity) || 1 })}
                        className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-brand-primary border border-brand-primary/40 rounded px-1 py-0.5 hover:bg-brand-primary/10"
                        title="Add this part to the job (you set the sell price)"
                      >
                        <Plus className="w-2.5 h-2.5" /> Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Margin summary */}
          <div className="mt-2 pt-1.5 border-t space-y-0.5 text-[13px]">
            <div className="flex justify-between"><span className="text-slate-600">Parts sell (ex VAT)</span><span>{money(partsSellNet)}</span></div>
            {ecpOrders.length > 0 && (
              <div className="flex justify-between"><span className="text-slate-600">ECP/GSF cost (ex VAT)</span><span>{money(ecpCost)}</span></div>
            )}
            {emailOrders.length > 0 && (
              <div className="flex justify-between"><span className="text-slate-600">eBay/Amazon cost (ex VAT est.)</span><span>{money(emailNet)}</span></div>
            )}
            <div className="flex justify-between font-semibold border-t pt-0.5">
              <span>Margin</span>
              <span className={margin >= 0 ? "text-green-700" : "text-red-600"}>
                {money(margin)}{marginPct != null ? ` · ${marginPct.toFixed(0)}%` : ""}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground pt-0.5">
              from {orders.map((o: any) => o.orderRef).join(", ")}
              {emailOrders.length > 0 && <span className="block">eBay/Amazon prices are gross; ex-VAT estimated at ÷1.2.</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Compact strip of the parts ORDERED for this job with their cost — shown right above the Parts
 *  editor so you can price each part against what it cost. Internal / print:hidden. */
export function OrderedPartsStrip({ documentId, onAddPart }: {
  documentId: number;
  onAddPart?: (p: { description: string; partNumber?: string; quantity: number }) => void;
}) {
  const { data } = trpc.omnipart.getOrderTracking.useQuery(undefined, { staleTime: 5 * 60 * 1000, retry: false });
  if (!documentId) return null;
  const orders = (data?.orders || []).filter((o: any) => o.jobSheet && o.jobSheet.id === documentId);
  const parts = orders.flatMap((o: any) => (o.parts || []).map((p: any) => ({ ...p, source: o.source })));
  if (parts.length === 0) return null;
  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-400 bg-amber-50/50 p-2 print:hidden">
      <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
        Parts you ordered for this job · cost is internal, never printed
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {parts.map((p: any, i: number) => {
          const src = SRC(p.source);
          return (
            <div key={i} className="inline-flex items-center gap-1.5 border rounded-md bg-white px-2 py-1 text-[12px]">
              <span className={"text-[9px] font-bold px-1 py-0.5 rounded " + src.c}>{src.t}</span>
              <span className="font-medium">{p.name || p.code || "part"}</span>
              {p.code && <span className="text-[10px] text-muted-foreground">{p.code}</span>}
              {p.quantity != null && <span className="text-[10px] text-muted-foreground">×{p.quantity}</span>}
              {p.lineCost != null && <span className="font-semibold text-slate-700 tabular-nums">cost {money(p.lineCost)}</span>}
              {onAddPart && (
                <button
                  onClick={() => onAddPart({ description: p.name || p.code || "Part", partNumber: p.code || undefined, quantity: Number(p.quantity) || 1 })}
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand-primary border border-brand-primary/40 rounded px-1 py-0.5 hover:bg-brand-primary/10"
                  title="Add this part to the job (you set the sell price)"
                >
                  <Plus className="w-2.5 h-2.5" /> Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default JobMarginCard;
