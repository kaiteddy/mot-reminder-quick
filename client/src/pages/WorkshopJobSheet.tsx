import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Home, Plus, Trash2, ChevronDown, Loader2, Save, Car, User, Wrench, Package, FileText, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Line = { id: number; kind: "Labour" | "Part"; description: string; price: string; qty: string };
let _lid = 1;
const money = (n: number) => `£${(n || 0).toFixed(2)}`;
const inputCls = "w-full bg-white border border-slate-300 rounded-lg px-3 h-12 text-[16px] outline-none focus:border-violet-500";

// Single collapsible section — module-level so children inputs don't remount (keep focus) on re-render.
function Section({ id, open, setOpen, icon: Icon, title, summary, children }: {
  id: string; open: string; setOpen: (s: string) => void; icon: any; title: string; summary?: string; children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen(isOpen ? "" : id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50">
        <Icon className="w-5 h-5 text-slate-500 shrink-0" />
        <span className="font-semibold text-slate-800 flex-1">{title}</span>
        {summary && <span className="text-sm text-slate-500 truncate max-w-[45%] text-right">{summary}</span>}
        <ChevronDown className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">{children}</div>}
    </div>
  );
}

function LineRows({ rows, kind, upd, rm, add }: {
  rows: Line[]; kind: "Labour" | "Part"; upd: (id: number, p: Partial<Line>) => void; rm: (id: number) => void; add: (k: "Labour" | "Part") => void;
}) {
  const noun = kind === "Labour" ? "labour" : "part";
  return (
    <>
      {rows.length === 0 && <p className="text-sm text-slate-400 py-1">No {noun} added yet.</p>}
      {rows.map((l) => (
        <div key={l.id} className="space-y-2 pb-3 border-b border-slate-100 last:border-0 last:pb-0">
          <Input value={l.description} onChange={(e) => upd(l.id, { description: e.target.value })} placeholder={kind === "Labour" ? "What was done" : "Part description"} className={inputCls} />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-sm text-slate-500 shrink-0">Qty</span>
              <Input value={l.qty} onChange={(e) => upd(l.id, { qty: e.target.value })} inputMode="decimal" className={inputCls} />
            </div>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-base text-slate-500 shrink-0">£</span>
              <Input value={l.price} onChange={(e) => upd(l.id, { price: e.target.value })} inputMode="decimal" placeholder="0.00" className={inputCls} />
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-12 w-10 text-red-500 shrink-0" onClick={() => rm(l.id)}><Trash2 className="w-5 h-5" /></Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="w-full h-12 border-dashed text-violet-700" onClick={() => add(kind)}>
        <Plus className="w-4 h-4 mr-2" /> Add {noun}
      </Button>
    </>
  );
}

export default function WorkshopJobSheet() {
  const params = new URLSearchParams(window.location.search);
  const reg = (params.get("reg") || "").replace(/\s+/g, "").toUpperCase();
  const motMileage = (params.get("mileage") || "").replace(/\D/g, ""); // last odometer from MOT, passed by the workshop screen
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState("labour");
  const [customer, setCustomer] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [mileage, setMileage] = useState(motMileage);
  const [motFee, setMotFee] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reg) { setLoading(false); return; }
    fetch(`/api/customer-lookup/${reg}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.customer) { setCustomer(d.customer); setCustName(d.customer.name || ""); setCustPhone(d.customer.phone || ""); }
        if (d?.vehicle) setVehicle(d.vehicle);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [reg]);

  const labour = lines.filter((l) => l.kind === "Labour");
  const parts = lines.filter((l) => l.kind === "Part");
  const lineTotal = (l: Line) => (parseFloat(l.price) || 0) * (parseFloat(l.qty) || 1);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const motNet = parseFloat(motFee) || 0;
  const total = subtotal * 1.2 + motNet; // labour/parts inc 20% VAT; MOT is VAT-exempt

  const add = (kind: "Labour" | "Part") => { setLines((p) => [...p, { id: _lid++, kind, description: "", price: kind === "Labour" ? "70" : "", qty: "1" }]); setOpen(kind === "Labour" ? "labour" : "parts"); };
  const upd = (id: number, patch: Partial<Line>) => setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const rm = (id: number) => setLines((p) => p.filter((l) => l.id !== id));

  const save = trpc.documents.save.useMutation({
    onSuccess: () => { toast.success("Job sheet created ✓"); setLocation(`/workshop?reg=${encodeURIComponent(reg)}`); },
    onError: (e: any) => toast.error(e.message || "Couldn't save the job sheet"),
  });

  const onSave = () => {
    const nameParts = custName.trim().split(/\s+/).filter(Boolean);
    save.mutate({
      docType: "JS",
      registration: reg,
      customerId: customer?.id || undefined,
      customerName: custName.trim() || undefined,
      custForename: nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : (nameParts[0] || ""),
      custSurname: nameParts.length > 1 ? nameParts[nameParts.length - 1] : "",
      custTelephone: custPhone || undefined,
      mileage: mileage ? Number(String(mileage).replace(/\D/g, "")) || null : null,
      description: notes || undefined,
      lineItems: [
        ...lines
          .filter((l) => l.description.trim() || parseFloat(l.price))
          .map((l) => { const net = lineTotal(l); return { itemType: l.kind, description: l.description, quantity: Number(l.qty) || 1, unitPrice: parseFloat(l.price) || 0, vatRate: 20, subNet: net, taxAmount: net * 0.2 }; }),
        ...(motNet > 0 ? [{ itemType: "MOT", description: "MOT Test", quantity: 1, unitPrice: motNet, vatRate: 0, subNet: motNet, taxAmount: 0 }] : []),
      ],
    } as any);
  };

  const sum = (rows: Line[]) => rows.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col pb-24">
      <div className="bg-slate-900 text-white p-4 shadow-md sticky top-0 z-50 flex items-center gap-3">
        <Link href={`/workshop?reg=${encodeURIComponent(reg)}`}>
          <div className="p-2 bg-slate-800 rounded-full cursor-pointer hover:bg-slate-700 active:scale-95 transition-all"><Home className="w-5 h-5" /></div>
        </Link>
        <div>
          <h1 className="text-xl font-bold leading-none">New Job Sheet</h1>
          <p className="text-slate-400 text-xs mt-1 font-mono tracking-widest">{reg || "NO REG"}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="p-3 space-y-2.5 flex-1">
          <Section id="vehicle" open={open} setOpen={setOpen} icon={Car} title="Vehicle" summary={[vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || undefined}>
            {(vehicle?.make || vehicle?.model) && <div className="text-sm font-medium text-slate-700">{vehicle?.make} {vehicle?.model}</div>}
            <label className="text-sm text-slate-500 block">Mileage</label>
            <Input value={mileage} onChange={(e) => setMileage(e.target.value)} inputMode="numeric" placeholder="Current mileage" className={inputCls} />
            {motMileage && <p className="text-xs text-slate-400">Pulled from last MOT ({Number(motMileage).toLocaleString()} mi) — adjust if needed.</p>}
          </Section>

          <Section id="customer" open={open} setOpen={setOpen} icon={User} title="Customer" summary={custName || (customer ? undefined : "Not linked")}>
            <label className="text-sm text-slate-500 block">Name</label>
            <Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Customer name" className={inputCls} />
            <label className="text-sm text-slate-500 block">Phone</label>
            <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} inputMode="tel" placeholder="Phone" className={inputCls} />
          </Section>

          <Section id="labour" open={open} setOpen={setOpen} icon={Wrench} title="Labour" summary={labour.length ? `${labour.length} · ${money(sum(labour))}` : undefined}>
            <LineRows rows={labour} kind="Labour" upd={upd} rm={rm} add={add} />
          </Section>

          <Section id="parts" open={open} setOpen={setOpen} icon={Package} title="Parts" summary={parts.length ? `${parts.length} · ${money(sum(parts))}` : undefined}>
            <LineRows rows={parts} kind="Part" upd={upd} rm={rm} add={add} />
          </Section>

          <Section id="mot" open={open} setOpen={setOpen} icon={ShieldCheck} title="MOT" summary={motNet > 0 ? money(motNet) : undefined}>
            {motFee === "" ? (
              <Button type="button" variant="outline" className="w-full h-12 border-dashed text-violet-700" onClick={() => setMotFee("54.85")}>
                <Plus className="w-4 h-4 mr-2" /> Add MOT
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-base text-slate-500 shrink-0">£</span>
                <Input value={motFee} onChange={(e) => setMotFee(e.target.value)} inputMode="decimal" placeholder="MOT fee" className={inputCls} />
                <Button type="button" variant="ghost" size="icon" className="h-12 w-10 text-red-500 shrink-0" onClick={() => setMotFee("")}><Trash2 className="w-5 h-5" /></Button>
              </div>
            )}
            <p className="text-xs text-slate-400">MOT is VAT-exempt.</p>
          </Section>

          <Section id="notes" open={open} setOpen={setOpen} icon={FileText} title="Job Description" summary={notes ? notes.slice(0, 22) : undefined}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe the work to be carried out…" rows={4} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-[16px] outline-none focus:border-violet-500" />
          </Section>
        </div>
      )}

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-3 z-50" style={{ boxShadow: "0 -2px 10px rgba(0,0,0,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-slate-500">Total (inc VAT)</div>
            <div className="text-xl font-bold text-slate-900">{money(total)}</div>
          </div>
          <Button onClick={onSave} disabled={save.isPending || !reg} className="h-14 px-6 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 rounded-xl">
            {save.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
            Save Job Sheet
          </Button>
        </div>
      </div>
    </div>
  );
}
