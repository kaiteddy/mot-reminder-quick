import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Undo2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// One returnable line, defensively typed — the ECP payload shape isn't fully pinned yet, so we
// read a few likely field names and fall back gracefully.
type Line = {
  sku: string;
  name: string;
  available: number;
  selected: boolean;
  quantity: number;
  reason: string;
  additionalInfo: string;
};

function coerceLines(raw: any): Line[] {
  const arr = Array.isArray(raw) ? raw : raw?.items || raw?.["hydra:member"] || [];
  return (arr as any[]).map((it) => {
    const sku = it.sku || it.SKU || it.productSku || it.code || "";
    const name = it.name || it.description || it.productName || sku;
    const available = Number(it.quantity ?? it.availableQuantity ?? it.qty ?? 1) || 1;
    return { sku, name, available, selected: false, quantity: available, reason: "", additionalInfo: "" };
  }).filter((l) => l.sku);
}

/**
 * Start a digital return for one order. Creates a credit request at Euro Car Parts on confirm —
 * this fires ONLY when the user presses "Submit return", never automatically.
 */
export function ReturnDialog({ orderRef, orderId }: { orderRef: string; orderId?: string | number | null }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const idStr = orderId != null ? String(orderId) : "";

  const reasonsQ = trpc.omnipart.getDigitalReturnReasons.useQuery(undefined, {
    enabled: open, staleTime: 60 * 60 * 1000, retry: false,
  });
  const itemsQ = trpc.omnipart.getReturnableItems.useQuery(
    { orderId: idStr },
    { enabled: open && !!idStr, retry: false },
  );
  const submit = trpc.omnipart.submitDigitalReturn.useMutation();

  // Populate the editable line list once the items load.
  useEffect(() => {
    if (itemsQ.data) setLines(coerceLines(itemsQ.data));
  }, [itemsQ.data]);

  const reasons: { code: string; additionalInformationRequired?: boolean }[] =
    (reasonsQ.data as any[]) || [];

  const chosen = lines.filter((l) => l.selected && l.reason);
  const canSubmit = chosen.length > 0 && !submit.isPending;

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function onSubmit() {
    const items = chosen.map((l) => ({
      sku: l.sku,
      quantity: l.quantity,
      returnLineId: `${l.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      returnReason: l.reason,
      additionalInfo: l.additionalInfo || undefined,
    }));
    try {
      await submit.mutateAsync({ orderId: idStr, items });
      toast.success(`Return submitted for ${orderRef}`);
      setOpen(false);
      setLines([]);
    } catch (e: any) {
      toast.error(e?.message || "Return failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Undo2 className="w-4 h-4" /> Return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Digital return · {orderRef}</DialogTitle>
          <DialogDescription>
            Select the parts to return and a reason for each. Submitting creates a credit request with
            Euro Car Parts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {itemsQ.isLoading && <div className="text-sm text-muted-foreground">Loading returnable items…</div>}
          {itemsQ.error && (
            <div className="flex items-start gap-2 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              No returnable items came back for this order (it may be outside the returns window, or the
              lookup id needs confirming).
            </div>
          )}
          {!itemsQ.isLoading && !itemsQ.error && lines.length === 0 && (
            <div className="text-sm text-muted-foreground">Nothing available to return on this order.</div>
          )}
          {lines.map((l, i) => (
            <div key={`${l.sku}-${i}`} className="rounded-md border p-2 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={l.selected} onCheckedChange={(v) => update(i, { selected: !!v })} />
                {l.name} <span className="text-xs text-muted-foreground">({l.sku})</span>
              </label>
              {l.selected && (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <Select value={l.reason} onValueChange={(v) => update(i, { reason: v })}>
                    <SelectTrigger className="w-56 h-8"><SelectValue placeholder="Reason for return" /></SelectTrigger>
                    <SelectContent>
                      {reasons.map((r) => (
                        <SelectItem key={r.code} value={r.code}>{r.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">qty {l.quantity}/{l.available}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submit.isPending ? "Submitting…" : `Submit return${chosen.length ? ` (${chosen.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReturnDialog;
