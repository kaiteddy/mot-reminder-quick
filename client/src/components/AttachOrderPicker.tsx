import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Link2, Undo2, Loader2, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { optionLabel, money, shortDate, type SuggestionReason } from "@shared/attachOrders";

/**
 * Put a parts order onto this job.
 *
 * Most orders place themselves: an order carrying this car's registration, where only one job
 * matches, is attached automatically when the email arrives. This is for the rest — stock orders,
 * counter and eBay buys that carry no registration at all, and cars that were in twice the same
 * week, where guessing would put a cost on the wrong customer's invoice.
 *
 * Needs a SAVED job: an order is attached to a document id, so nothing shows until the sheet has
 * been saved once.
 */

/** Rows are grouped under these, in this order, so the likely answer is at the top. */
const REASON_ORDER: SuggestionReason[] = ["same vehicle", "ordered around this job", "recent"];

const REASON_HELP: Record<SuggestionReason, string> = {
  "same vehicle": "Ordered for this car",
  "ordered around this job": "Bought while this job was open",
  "recent": "Everything else, newest first",
};

export function AttachOrderPicker({ documentId }: { documentId: number }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const utils = trpc.useUtils();
  const attachedQ = trpc.partsOrders.onJob.useQuery({ documentId });
  const optionsQ = trpc.partsOrders.forJob.useQuery(
    { documentId, search: search.trim() || undefined },
    { enabled: open },
  );

  const refresh = () => {
    utils.partsOrders.onJob.invalidate({ documentId });
    utils.partsOrders.forJob.invalidate({ documentId });
  };

  const attach = trpc.partsOrders.attach.useMutation({
    onSuccess: () => { toast.success("Order added to this job"); setOpen(false); setSearch(""); refresh(); },
    // The message is written for the counter: what happened, and what to do about it.
    onError: (e) => toast.error(e.message),
  });

  const detach = trpc.partsOrders.detach.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.costsCleared > 0
          ? `Order removed. ${r.costsCleared} part cost${r.costsCleared === 1 ? "" : "s"} cleared from this job.`
          : "Order removed from this job.",
      );
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const attached = attachedQ.data ?? [];
  const options = optionsQ.data ?? [];

  const groups = REASON_ORDER
    .map((reason) => ({ reason, items: options.filter((o) => o.reason === reason) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-2">
      {/* What is already on this job, each with a way back out. */}
      {attached.map((o) => (
        <div
          key={o.orderId}
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2"
        >
          <PackageSearch className="h-4 w-4 shrink-0 text-emerald-700" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-emerald-900">
              {money(o.netTotal)} · {o.supplier} · {shortDate(o.orderedAt)}
            </div>
            <div className="truncate text-xs text-emerald-800/80">
              {o.lineCount} {o.lineCount === 1 ? "part" : "parts"}
              {o.linesAttached > 0 ? ` · ${o.linesAttached} costed` : " · not costed yet"}
              {o.linkBasis === "manual" && o.linkedBy ? ` · added by ${o.linkedBy}` : ""}
              {o.linkBasis === "registration" ? " · matched by number plate" : ""}
              {" · "}{o.ref}
            </div>
          </div>
          <Button
            type="button" variant="ghost" size="sm"
            className="shrink-0 text-emerald-900 hover:bg-emerald-100"
            disabled={detach.isPending}
            onClick={() => detach.mutate({ orderId: o.orderId })}
          >
            <Undo2 className="h-4 w-4" />
            <span className="sr-only">Remove this order from the job</span>
          </Button>
        </div>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="h-11 w-full justify-start border-dashed">
            <Link2 className="h-4 w-4" />
            Add a parts order
          </Button>
        </PopoverTrigger>

        {/* Full width on a handheld: these labels do not fit in a narrow popover. */}
        <PopoverContent className="w-[min(30rem,calc(100vw-2rem))] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by part number, supplier or order…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {optionsQ.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Looking for orders…
                </div>
              ) : (
                <CommandEmpty>
                  {search
                    ? "No orders match that."
                    : "Every parts order from the last year is already on a job."}
                </CommandEmpty>
              )}

              {groups.map((group) => (
                <CommandGroup key={group.reason} heading={REASON_HELP[group.reason]}>
                  {group.items.map((o) => (
                    <CommandItem
                      key={o.orderId}
                      value={String(o.orderId)}
                      disabled={attach.isPending}
                      onSelect={() => attach.mutate({ orderId: o.orderId, documentId })}
                      className="flex items-start gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{optionLabel(o)}</div>
                        {o.typedRef ? (
                          <div className="truncate text-xs text-muted-foreground">
                            Ordered as “{o.typedRef}”
                            {o.reason === "recent" && o.daysApart != null
                              ? ` · ${Math.round(o.daysApart)} days from this job`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                      {o.reason === "same vehicle" ? (
                        <Badge variant="secondary" className="shrink-0 bg-emerald-100 text-emerald-900">
                          this car
                        </Badge>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
