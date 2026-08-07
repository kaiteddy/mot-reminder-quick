/**
 * Used Car Sales Invoice — raised from Sales Stock, filled in directly on the replica of the
 * pre-printed form. Autosaves as you type; Print sends the same DOM to the printer, so what is
 * on screen is what comes out (white original + pale-yellow seller's copy).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Printer, Loader2, Save, CheckCircle2, Trash2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import VehicleSaleForm, { VEHICLE_SALE_FIELD_KEYS, type VehicleSaleValues } from "@/components/VehicleSaleForm";
import { trpc } from "@/lib/trpc";

export default function VehicleSaleInvoice() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.vehicleSale.get.useQuery({ id }, { enabled: Number.isFinite(id) });
  const save = trpc.vehicleSale.save.useMutation();
  const del = trpc.vehicleSale.delete.useMutation();
  const attach = trpc.vehicleSale.attachCustomer.useMutation();

  const [values, setValues] = useState<VehicleSaleValues>({});
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const loadedFor = useRef<number | null>(null);

  // Seed the form once per record; later refetches must not stomp on what is being typed.
  useEffect(() => {
    if (!data || loadedFor.current === id) return;
    const seed: VehicleSaleValues = {};
    for (const k of [...VEHICLE_SALE_FIELD_KEYS, "sellerSignature", "buyerSignature"]) {
      seed[k] = (data as any)[k] ?? "";
    }
    setValues(seed);
    loadedFor.current = id;
  }, [data, id]);

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setDirty(true);
  }

  // Typing the purchaser's name searches the customer database; picking a match fills the name,
  // address and telephone and links the invoice to that customer record. Typing a name that
  // isn't on file is still fine — walk-in buyers don't have to exist as customers first.
  const custQuery = values.purchaserName ?? "";
  const { data: custMatches, isFetching: custSearching } = trpc.customers.search.useQuery(
    { query: custQuery },
    { enabled: custQuery.trim().length >= 2, staleTime: 30_000 },
  );

  async function fillPurchaser(customerId: number) {
    try {
      const patch = await attach.mutateAsync({ id, customerId });
      setValues((prev) => ({ ...prev, ...patch }));
      setDirty(false);
      setSaveStatus("saved");
      utils.vehicleSale.get.invalidate({ id });
      toast.success("Purchaser filled in from the customer record");
    } catch (e: any) {
      toast.error(e.message || "Could not attach customer");
    }
  }

  async function flush() {
    if (!dirty) return;
    setSaveStatus("saving");
    try {
      await save.mutateAsync({ id, fields: values as any });
      setDirty(false);
      setSaveStatus("saved");
      utils.vehicleSale.list.invalidate();
    } catch (e: any) {
      setSaveStatus("error");
      toast.error(`Auto-save failed: ${e.message || ""}`);
    }
  }

  // Debounced autosave.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { flush(); }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, values]);

  // Warn if the tab is closed mid-edit.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function handlePrint() {
    await flush();
    // Leaving a blank focused would print it scrolled to the caret; blurring resets it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    // Tag again here as well as on render: if the shell hasn't been tagged for any reason, the
    // print rules hide every child of <body> and a blank sheet comes out of the printer.
    tagPrintAncestors();
    // The form is the print target — nothing is re-rendered or re-templated on the way out.
    window.print();
  }

  /**
   * Printing has to escape the dashboard shell. Hiding the chrome with `visibility` leaves its
   * boxes in the layout, so the sheet inherits the sidebar's offset and prints ~100mm to the
   * right. Instead, tag every ancestor between the sheet and <body>: print CSS collapses those
   * to `display: contents` and drops their other children, leaving the sheet as a plain flow
   * child of the page.
   *
   * The tag is inert on screen — it only means anything inside `@media print` — so it can sit on
   * the shell for as long as this page is open. It MUST come off on the way out, though: left
   * behind, it would blank the printout of every other page in the app.
   */
  const taggedRef = useRef<Element[]>([]);
  const tagPrintAncestors = useCallback(() => {
    const root = document.querySelector(".vs-print-root");
    if (!root) return;
    for (let el = root.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.classList.contains("vs-print-passthrough")) continue;
      el.classList.add("vs-print-passthrough");
      taggedRef.current.push(el);
    }
  }, []);

  // Runs again once the record arrives: on first mount this component is still rendering
  // "Loading…", so the sheet — and everything to tag above it — doesn't exist yet.
  useEffect(() => { tagPrintAncestors(); }, [tagPrintAncestors, isLoading, data]);

  useEffect(() => () => {
    taggedRef.current.forEach((el) => el.classList.remove("vs-print-passthrough"));
    taggedRef.current = [];
  }, []);

  async function handleDelete() {
    if (!confirm("Delete this sales invoice? This cannot be undone.")) return;
    try {
      await del.mutateAsync({ id });
      utils.vehicleSale.list.invalidate();
      toast.success("Sales invoice deleted");
      setLocation("/sales-stock");
    } catch (e: any) { toast.error(e.message || "Delete failed"); }
  }

  const heading = useMemo(() => {
    const bits = [values.vehicleMake, values.vehicleType].filter(Boolean).join(" ");
    return [values.registrationNumber, bits].filter(Boolean).join(" · ") || "Used Car Sales Invoice";
  }, [values.registrationNumber, values.vehicleMake, values.vehicleType]);

  if (isLoading) return <DashboardLayout><div className="p-8 text-muted-foreground">Loading…</div></DashboardLayout>;
  if (!data) return (
    <DashboardLayout>
      <div className="p-8 space-y-3">
        <p className="text-muted-foreground">This sales invoice no longer exists.</p>
        <button onClick={() => setLocation("/sales-stock")} className="inline-flex items-center gap-1.5 text-violet-700 hover:underline text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Sales Stock
        </button>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      {/* Only the sheet goes to the printer, and it starts at the page origin. */}
      <style>{`
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .vs-print-passthrough { display: contents !important; }
          body > *:not(.vs-print-passthrough):not(.vs-print-root),
          .vs-print-passthrough > *:not(.vs-print-passthrough):not(.vs-print-root) { display: none !important; }
          .vs-print-root { display: block !important; margin: 0 !important; padding: 0 !important; }
        }
      `}</style>

      <div className="space-y-3 text-slate-800 vs-no-print">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button onClick={async () => { await flush(); setLocation("/sales-stock"); }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to Sales Stock
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs inline-flex items-center gap-1 mr-1 min-w-[64px] justify-end">
              {saveStatus === "saving" ? <span className="text-slate-500 inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</span>
                : dirty ? <span className="text-amber-600 inline-flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Unsaved…</span>
                : saveStatus === "saved" ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>
                : saveStatus === "error" ? <span className="text-red-600">Save failed</span>
                : null}
            </span>
            <button onClick={handlePrint} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent">
              <Printer className="w-4 h-4" /> Print
            </button>
            <button onClick={handleDelete} disabled={del.isPending} className="inline-flex items-center gap-1.5 border border-red-200 text-red-600 rounded px-3 py-1.5 text-sm hover:bg-red-50 disabled:opacity-50">
              {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-r from-violet-800 to-fuchsia-700 text-white px-4 py-2 rounded-md flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <span className="text-amber-300">★</span>
            <span>Used Car Sales Invoice</span>
            <span className="text-white/60 text-sm font-normal">{heading}</span>
          </div>
          <span className="text-[11px] text-white/70">Type straight onto the form · auto-saves</span>
        </div>
      </div>

      <div className="vs-print-root mt-3">
        <VehicleSaleForm
          values={values}
          onChange={set}
          suggestFor="purchaserName"
          suggest={{
            items: (custMatches as any[] | undefined)?.map((c) => ({
              id: c.id,
              label: c.name,
              sub: [c.phone, c.postcode].filter(Boolean).join(" · ") || undefined,
            })) ?? [],
            loading: custSearching,
            emptyHint: custQuery.trim().length >= 2 ? "No matching customer — typing here is fine" : undefined,
            onPick: fillPurchaser,
          }}
        />
      </div>
    </DashboardLayout>
  );
}
