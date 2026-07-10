import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Search, Loader2, Package, Plus, Pencil, Trash2, X, Check } from "lucide-react";

const money = (n: any) => Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = {
  id: number;
  partNumber: string | null;
  description: string;
  unitPrice: string;
  vatRate: string | null;
  quantity: string | null;
  nominalCode: string | null;
};

type Draft = { partNumber: string; description: string; unitPrice: string; vatRate: string; quantity: string; nominalCode: string };
const emptyDraft: Draft = { partNumber: "", description: "", unitPrice: "", vatRate: "20", quantity: "", nominalCode: "" };

export default function PartsPriceList() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.partsPriceList.list.useQuery({ search: search || undefined });
  const rows = (data as Row[] | undefined) ?? [];

  const upsert = trpc.partsPriceList.upsert.useMutation({
    onSuccess: () => { utils.partsPriceList.list.invalidate(); },
    onError: (e) => toast.error("Save failed: " + e.message),
  });
  const del = trpc.partsPriceList.delete.useMutation({
    onSuccess: () => { utils.partsPriceList.list.invalidate(); toast.success("Deleted"); },
    onError: (e) => toast.error("Delete failed: " + e.message),
  });

  function draftToInput(d: Draft) {
    const unitPrice = Number(d.unitPrice);
    if (!d.description.trim() || !Number.isFinite(unitPrice)) return null;
    return {
      description: d.description.trim(),
      unitPrice,
      partNumber: d.partNumber.trim() || undefined,
      vatRate: d.vatRate.trim() ? Number(d.vatRate) : undefined,
      quantity: d.quantity.trim() ? Number(d.quantity) : undefined,
      nominalCode: d.nominalCode.trim() || undefined,
    };
  }

  async function saveAdd() {
    const input = draftToInput(addDraft);
    if (!input) { toast.error("Description and unit price are required"); return; }
    await upsert.mutateAsync(input);
    setAddDraft(emptyDraft);
    setAdding(false);
    toast.success("Part added");
  }

  function startEdit(r: Row) {
    setEditingId(r.id);
    setEditDraft({
      partNumber: r.partNumber ?? "", description: r.description, unitPrice: r.unitPrice,
      vatRate: r.vatRate ?? "20", quantity: r.quantity ?? "", nominalCode: r.nominalCode ?? "",
    });
  }

  async function saveEdit(id: number) {
    const input = draftToInput(editDraft);
    if (!input) { toast.error("Description and unit price are required"); return; }
    await upsert.mutateAsync({ id, ...input });
    setEditingId(null);
  }

  const inp = "bg-white border border-slate-300 rounded px-2 py-1 text-[13px] outline-none focus:border-violet-500 w-full";
  // Icon buttons with no padding have a hit area as small as the icon itself (~14-16px) — easy to
  // miss on a real click, and it can look like "Save didn't do anything." Give every action icon a
  // proper ≥28px tap target with a hover background so misses are much less likely.
  const iconBtn = "p-1.5 rounded hover:bg-slate-100";
  const onDraftKeyDown = (e: React.KeyboardEvent, save: () => void, cancel: () => void) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };

  return (
    <DashboardLayout>
      <div className="max-w-[1100px] mx-auto p-4 space-y-4 text-slate-800">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Package className="w-5 h-5 text-violet-600" /> Parts Price List</h1>
          <p className="text-sm text-slate-500">Keep prices current here so picking a part on a job sheet auto-fills its quantity and price. A part not yet listed still gets a price suggested from its average historical cost.</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search part no or description…"
              className="w-full bg-white border border-slate-300 rounded pl-8 pr-2 h-9 text-[14px] outline-none focus:border-violet-500" />
          </div>
          <button onClick={() => { setAdding((a) => !a); setAddDraft(emptyDraft); }}
            className="inline-flex items-center gap-1.5 bg-violet-700 text-white rounded px-3 h-9 text-sm font-medium hover:bg-violet-800">
            <Plus className="w-4 h-4" /> Add Part
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase font-semibold text-slate-500">
                <th className="px-3 py-2 w-32">Part No</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 w-24 text-right">Qty</th>
                <th className="px-3 py-2 w-28 text-right">Price</th>
                <th className="px-3 py-2 w-20 text-right">VAT %</th>
                <th className="px-3 py-2 w-28">Nominal</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {adding && (
                <tr className="bg-violet-50/40" onKeyDown={(e) => onDraftKeyDown(e, saveAdd, () => setAdding(false))}>
                  <td className="px-3 py-1.5"><input className={inp} placeholder="Part No" value={addDraft.partNumber} onChange={(e) => setAddDraft((d) => ({ ...d, partNumber: e.target.value }))} /></td>
                  <td className="px-3 py-1.5"><input className={inp} placeholder="Description" autoFocus value={addDraft.description} onChange={(e) => setAddDraft((d) => ({ ...d, description: e.target.value }))} /></td>
                  <td className="px-3 py-1.5"><input className={inp + " text-right"} placeholder="1" value={addDraft.quantity} onChange={(e) => setAddDraft((d) => ({ ...d, quantity: e.target.value }))} /></td>
                  <td className="px-3 py-1.5"><input className={inp + " text-right"} placeholder="0.00" value={addDraft.unitPrice} onChange={(e) => setAddDraft((d) => ({ ...d, unitPrice: e.target.value }))} /></td>
                  <td className="px-3 py-1.5"><input className={inp + " text-right"} placeholder="20" value={addDraft.vatRate} onChange={(e) => setAddDraft((d) => ({ ...d, vatRate: e.target.value }))} /></td>
                  <td className="px-3 py-1.5"><input className={inp} placeholder="Nominal" value={addDraft.nominalCode} onChange={(e) => setAddDraft((d) => ({ ...d, nominalCode: e.target.value }))} /></td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={saveAdd} disabled={upsert.isPending} className={iconBtn + " text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800"} title="Save">
                        {upsert.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </button>
                      <button type="button" onClick={() => setAdding(false)} className={iconBtn + " text-slate-400 hover:text-slate-600"} title="Cancel"><X className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && !adding && (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No parts in the price list yet{search ? " matching your search" : ""}.</td></tr>
              )}
              {rows.map((r) => {
                const isEditing = editingId === r.id;
                if (isEditing) {
                  return (
                    <tr key={r.id} className="bg-violet-50/40" onKeyDown={(e) => onDraftKeyDown(e, () => saveEdit(r.id), () => setEditingId(null))}>
                      <td className="px-3 py-1.5"><input className={inp} value={editDraft.partNumber} onChange={(e) => setEditDraft((d) => ({ ...d, partNumber: e.target.value }))} /></td>
                      <td className="px-3 py-1.5"><input className={inp} value={editDraft.description} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} /></td>
                      <td className="px-3 py-1.5"><input className={inp + " text-right"} value={editDraft.quantity} onChange={(e) => setEditDraft((d) => ({ ...d, quantity: e.target.value }))} /></td>
                      <td className="px-3 py-1.5"><input className={inp + " text-right"} value={editDraft.unitPrice} onChange={(e) => setEditDraft((d) => ({ ...d, unitPrice: e.target.value }))} /></td>
                      <td className="px-3 py-1.5"><input className={inp + " text-right"} value={editDraft.vatRate} onChange={(e) => setEditDraft((d) => ({ ...d, vatRate: e.target.value }))} /></td>
                      <td className="px-3 py-1.5"><input className={inp} value={editDraft.nominalCode} onChange={(e) => setEditDraft((d) => ({ ...d, nominalCode: e.target.value }))} /></td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => saveEdit(r.id)} disabled={upsert.isPending} className={iconBtn + " text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800"} title="Save">
                            {upsert.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button type="button" onClick={() => setEditingId(null)} className={iconBtn + " text-slate-400 hover:text-slate-600"} title="Cancel"><X className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-mono text-[12px] text-violet-700">{r.partNumber || "—"}</td>
                    <td className="px-3 py-1.5">{r.description}</td>
                    <td className="px-3 py-1.5 text-right">{r.quantity ? Number(r.quantity) : 1}</td>
                    <td className="px-3 py-1.5 text-right font-medium">£{money(r.unitPrice)}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{r.vatRate != null ? Number(r.vatRate) : 20}%</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.nominalCode || "—"}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-0.5">
                        <button type="button" onClick={() => startEdit(r)} className={iconBtn + " text-slate-400 hover:bg-violet-50 hover:text-violet-700"} title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => { if (window.confirm(`Delete "${r.description}" from the price list?`)) del.mutate({ id: r.id }); }}
                          className={iconBtn + " text-slate-400 hover:bg-red-50 hover:text-red-600"} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
