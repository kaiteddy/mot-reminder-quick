import { trpc } from "@/lib/trpc";

// INTERNAL ONLY. Shows the margin on a job's parts — ECP cost (what ELI paid, ex VAT) vs the sell
// price on the document. This must NEVER appear on a customer's job sheet / invoice / estimate: it
// lives only in the on-screen editor, is `print:hidden`, and the PDF/email templates never receive
// cost data. Cost comes from the Euro Car Parts order(s) matched to this job (same jobSheet id).
function money(v: number) {
  return `£${(Number(v) || 0).toFixed(2)}`;
}

export function JobMarginCard({ documentId, partsSellNet }: { documentId: number; partsSellNet: number }) {
  const { data, isLoading, error } = trpc.omnipart.getOrderTracking.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!documentId) return null;

  const orders = (data?.orders || []).filter((o: any) => o.jobSheet && o.jobSheet.id === documentId);
  const hasCost = orders.length > 0;
  const ecpCost = orders.reduce((a: number, o: any) => a + (Number(o.totalExcTax) || 0), 0);
  const margin = partsSellNet - ecpCost;
  const marginPct = partsSellNet > 0 ? (margin / partsSellNet) * 100 : null;

  return (
    <div className="mt-3 rounded-md border border-dashed border-amber-400 bg-amber-50/50 p-2 print:hidden">
      <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
        Margin · internal only — never printed
      </div>
      {isLoading && <div className="text-xs text-muted-foreground mt-1">Loading ECP cost…</div>}
      {error && <div className="text-xs text-amber-700 mt-1">ECP session offline — open Omnipart to refresh.</div>}
      {!isLoading && !error && !hasCost && (
        <div className="text-xs text-muted-foreground mt-1">No linked Euro Car Parts order for this job — cost not available.</div>
      )}
      {!isLoading && !error && hasCost && (
        <div className="mt-1 space-y-0.5 text-[13px]">
          <div className="flex justify-between"><span className="text-slate-600">Parts sell (ex VAT)</span><span>{money(partsSellNet)}</span></div>
          <div className="flex justify-between"><span className="text-slate-600">ECP parts cost (ex VAT)</span><span>{money(ecpCost)}</span></div>
          <div className="flex justify-between font-semibold border-t pt-0.5">
            <span>Margin</span>
            <span className={margin >= 0 ? "text-green-700" : "text-red-600"}>
              {money(margin)}{marginPct != null ? ` · ${marginPct.toFixed(0)}%` : ""}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground pt-0.5">from {orders.map((o: any) => o.orderRef).join(", ")}</div>
        </div>
      )}
    </div>
  );
}

export default JobMarginCard;
