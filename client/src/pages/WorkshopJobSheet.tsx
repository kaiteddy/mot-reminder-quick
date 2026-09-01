import { useState, useEffect } from "react";
import { RequireLogin } from "@/components/RequireLogin";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Home, Plus, Trash2, ChevronDown, Loader2, Save, Car, User, Wrench, Package, FileText, ShieldCheck, Printer, Receipt, CheckCircle2, CheckSquare, Square } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { round2 } from "@/lib/utils";
import { buildServiceSets, parseVehOil } from "@/lib/serviceParts";
import { toast } from "sonner";
import { printDocumentOnHandheld } from "@/lib/printDocument";

type Line = { id: number; kind: "Labour" | "Part"; description: string; price: string; qty: string };

// The customer record stores one address blob ("12 Church Road, Hendon, London"); the document
// prints split fields. Comma-split, peeling the leading house number off the first part.
function splitAddress(addr: string) {
  const parts = addr.split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return {};
  const m = parts[0].match(/^(\d+[a-zA-Z]?)\s+(.+)$/);
  return { custHouseNo: m?.[1], custRoad: m ? m[2] : parts[0], custLocality: parts[1], custTown: parts[2], custCounty: parts[3] };
}
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

/** One-tap job type: big checkbox chip that generates the description + priced lines. */
function JobChip({ on, label, sub, onClick }: { on: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`h-16 rounded-lg border-2 px-1 flex flex-col items-center justify-center gap-0.5 text-center transition-colors ${on ? "border-violet-600 bg-violet-50 text-violet-800" : "border-slate-200 bg-white text-slate-600 active:bg-slate-50"}`}>
      <span className="flex items-center gap-1 text-[13px] font-semibold leading-tight">
        {on ? <CheckSquare className="w-4 h-4 shrink-0" /> : <Square className="w-4 h-4 shrink-0 text-slate-300" />}
        {label}
      </span>
      {sub && <span className="text-[11px] opacity-70">{sub}</span>}
    </button>
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
              <Input value={l.price} onChange={(e) => upd(l.id, { price: e.target.value })} inputMode="decimal" placeholder="0.00"
                className={inputCls + (l.description.trim() && !(parseFloat(l.price) > 0) ? " border-red-400 bg-red-50" : "")} />
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

function WorkshopJobSheetInner() {
  const params = new URLSearchParams(window.location.search);
  const reg = (params.get("reg") || "").replace(/\s+/g, "").toUpperCase();
  const motMileage = (params.get("mileage") || "").replace(/\D/g, ""); // last odometer from MOT, passed by the workshop screen
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState("labour");
  const [customer, setCustomer] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custPostcode, setCustPostcode] = useState("");
  const [mileage, setMileage] = useState(motMileage);
  const [motFee, setMotFee] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedType, setSavedType] = useState<"Job Sheet" | "Invoice">("Job Sheet");
  const [printing, setPrinting] = useState(false);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!reg) { setLoading(false); return; }
    fetch(`/api/customer-lookup/${reg}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.customer) {
          setCustomer(d.customer); setCustName(d.customer.name || ""); setCustPhone(d.customer.phone || "");
          setCustEmail(d.customer.email || ""); setCustAddress(d.customer.address || ""); setCustPostcode(d.customer.postcode || "");
        }
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

  // --- One-tap job types (MOT / Small Service / Major Service) --------------------------
  // Ticking generates the description line AND the priced lines from the garage's own
  // pricing data, never a hardcoded figure: MOT from pricing_knowledge.motCost, and the
  // service sets (oil by capacity/grade, filters, sump seal, sundries, banded labour) from
  // lib/serviceParts — the SAME definitions the desktop "Add service parts" dropdown uses.
  // Unticking removes exactly what the tick added (tracked by line id).
  const pricingQ = trpc.ai.getPricingKnowledge.useQuery(undefined, { staleTime: 5 * 60_000 });
  const bandsQ = trpc.priceGuide.labourBands.useQuery(undefined, { staleTime: 5 * 60_000 });
  const priceListQ = trpc.partsPriceList.list.useQuery({}, { staleTime: 5 * 60_000 });
  // Major Service labour comes from the Price Guide: the median of what we actually charged
  // for full-service labour on this size band (there is no banded table for it).
  const guideQ = trpc.priceGuide.forRegistration.useQuery({ registration: reg }, { enabled: !!reg, staleTime: 5 * 60_000 });
  const motPrice = Number((pricingQ.data as any)?.motCost) || 50;
  const serviceSets = buildServiceSets({
    vehInfo: parseVehOil(vehicle),
    engineCC: vehicle?.engineCC,
    priceList: (priceListQ.data as any[]) || [],
    labourBands: (bandsQ.data as any[]) || [],
    majorLabourNet: (guideQ.data as any)?.fullServiceLabour?.net,
  });
  const majorLabourPrice = serviceSets.major.labour?.unitPrice;
  const smallLabourPrice = serviceSets.small.labour?.unitPrice;

  const [ticks, setTicks] = useState<{ mot: boolean; small: number[] | null; major: number[] | null }>({ mot: false, small: null, major: null });
  const SERVICE_TEXT = { small: "Carry out Small Service", major: "Carry out Major Service" } as const;
  const addDescLine = (t: string) => setNotes((n) => (n ? n.trimEnd() + "\n" : "") + t);
  const rmDescLine = (t: string) => setNotes((n) => n.split("\n").filter((l) => l.trim() !== t).join("\n"));

  const toggleMot = () => {
    if (ticks.mot) { setMotFee(""); rmDescLine("Carry out MOT"); setTicks({ ...ticks, mot: false }); }
    else { setMotFee(String(motPrice)); addDescLine("Carry out MOT"); setTicks({ ...ticks, mot: true }); }
  };

  const toggleService = (kind: "small" | "major") => {
    // Ticking before the price list has answered built the set with everything at £0 — the
    // race behind "sometimes the oil is 0.00". Untick always works.
    if (!ticks[kind] && !priceListQ.data) { toast.message("Prices still loading — try again in a second"); return; }
    const next = { ...ticks };
    const removeKind = (k: "small" | "major") => {
      const ids = next[k]; if (!ids) return;
      setLines((p) => p.filter((l) => !ids.includes(l.id)));
      rmDescLine(SERVICE_TEXT[k]);
      next[k] = null;
    };
    if (ticks[kind]) { removeKind(kind); setTicks(next); return; }
    removeKind(kind === "small" ? "major" : "small"); // a car gets one or the other
    const set = serviceSets[kind];
    const newLines: Line[] = [
      // Major Service labour is priced by staff — only Small has a banded figure.
      { id: _lid++, kind: "Labour", description: SERVICE_TEXT[kind], price: set.labour ? String(set.labour.unitPrice) : "", qty: "1" },
      ...set.parts.map((pt) => ({ id: _lid++, kind: "Part" as const, description: pt.description, price: pt.unitPrice != null ? String(pt.unitPrice) : "", qty: String(pt.quantity || 1) })),
      ...(set.sundries ? [{ id: _lid++, kind: "Part" as const, description: "Sundries & PPE", price: set.sundries.toFixed(2), qty: "1" }] : []),
    ];
    setLines((p) => [...p, ...newLines]);
    addDescLine(SERVICE_TEXT[kind]);
    next[kind] = newLines.map((l) => l.id);
    setTicks(next);
    const unpriced = newLines.filter((l) => !l.price).length;
    if (unpriced) toast.message(`${set.label} added — ${set.parts.length} parts + sundries. ${unpriced} line${unpriced === 1 ? "" : "s"} need a price (Labour/Parts).`);
    else toast.success(`${set.label} added — labour, ${set.parts.length} parts + sundries, all priced`);
  };

  const updateCustomer = trpc.customers.update.useMutation();

  // After the job sheet saves, push typed customer details back to the master record.
  // Gap-fills (the record is blank, or the typed name extends a stub like "Miss") go through
  // silently; a value that CONFLICTS with what's stored gets a toast with an "Update record"
  // action instead, so a one-off change on a job can't clobber the master by accident.
  const syncCustomerRecord = () => {
    if (!customer?.id) return;
    const digits = (v: any) => String(v || "").replace(/\D/g, "").slice(-10);
    const nospace = (v: any) => String(v || "").replace(/\s/g, "").toUpperCase();
    const stored = {
      name: String(customer.name || "").trim(), phone: String(customer.phone || "").trim(),
      email: String(customer.email || "").trim(), address: String(customer.address || "").trim(),
      postcode: String(customer.postcode || "").trim(),
    };
    const typed = { name: custName.trim(), phone: custPhone.trim(), email: custEmail.trim(), address: custAddress.trim(), postcode: custPostcode.trim() };
    const same: Record<string, boolean> = {
      name: typed.name === stored.name,
      phone: digits(typed.phone) === digits(stored.phone),
      email: typed.email.toLowerCase() === stored.email.toLowerCase(),
      address: typed.address === stored.address,
      postcode: nospace(typed.postcode) === nospace(stored.postcode),
    };
    const fills: Record<string, string> = {}, changes: Record<string, string> = {};
    (Object.keys(typed) as (keyof typeof typed)[]).forEach((k) => {
      if (!typed[k] || same[k]) return;
      if (!stored[k] || (k === "name" && typed.name.toLowerCase().startsWith(stored.name.toLowerCase()))) fills[k] = typed[k];
      else changes[k] = typed[k];
    });
    if (Object.keys(fills).length) {
      updateCustomer.mutate({ id: customer.id, ...fills }, {
        onSuccess: () => toast.success(`Customer record updated — ${Object.keys(fills).join(", ")} added`),
      });
    }
    if (Object.keys(changes).length) {
      toast(`Customer record has a different ${Object.keys(changes).join(", ")} on file`, {
        duration: 10000,
        action: { label: "Update record", onClick: () => updateCustomer.mutate({ id: customer.id, ...changes }, { onSuccess: () => toast.success("Customer record updated") }) },
      });
    }
  };

  const save = trpc.documents.save.useMutation({
    onSuccess: (res: any) => { toast.success("Job sheet created ✓"); setSavedId(res?.id ?? null); syncCustomerRecord(); },
    onError: (e: any) => toast.error(e.message || "Couldn't save the job sheet"),
  });

  // Convert + print reuse the SAME backend the desktop uses, so output/behaviour match exactly.
  const convert = trpc.documents.convert.useMutation({
    onSuccess: (res: any) => { setSavedType("Invoice"); if (res?.id) setSavedId(res.id); toast.success("Converted to invoice ✓"); },
    onError: (e: any) => toast.error("Convert failed: " + (e.message || "")),
  });

  /**
   * A phone cannot print from the hidden iframe below. Neither iOS Safari nor Android Chrome
   * renders a PDF inside an iframe, so print() has nothing to print; it throws nothing, so the
   * catch-and-window.open fallback never runs; and even if it did, that open happens inside a
   * timeout, long after the tap, so the popup blocker would eat it. The button simply does
   * nothing — which is exactly what it did on the phone.
   *
   * So on a handheld, hand the OS the PDF as an ordinary URL and let its viewer print it.
   */
  async function handlePrint() {
    if (!savedId) return;

    // Phones can't print from the hidden iframe below; the shared helper knows what each one
    // needs instead.
    if (printDocumentOnHandheld(savedId, (m) => toast.success(m))) return;

    setPrinting(true);
    try {
      const res: any = await utils.serviceHistory.getRichPDF.fetch({ documentId: savedId });
      if (!res?.content) { toast.error("Could not generate the PDF"); return; }
      const bytes = atob(res.content); const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      await new Promise<void>((resolve) => {
        let fired = false;
        const fire = () => { if (fired) return; fired = true; try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { window.open(url, "_blank"); } resolve(); };
        iframe.onload = () => setTimeout(fire, 800);
        iframe.src = url; document.body.appendChild(iframe);
        setTimeout(fire, 5000);
      });
      setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 120000);
    } catch (e: any) { toast.error("Print failed: " + (e.message || "")); }
    finally { setPrinting(false); }
  }

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
      custEmail: custEmail || undefined,
      ...splitAddress(custAddress),
      custPostcode: custPostcode || undefined,
      mileage: mileage ? Number(String(mileage).replace(/\D/g, "")) || null : null,
      description: notes || undefined,
      lineItems: [
        ...lines
          .filter((l) => l.description.trim() || parseFloat(l.price))
          .map((l) => { const net = round2(lineTotal(l)); return { itemType: l.kind, description: l.description, quantity: Number(l.qty) || 1, unitPrice: parseFloat(l.price) || 0, vatRate: 20, subNet: net, taxAmount: round2(net * 0.2) }; }),
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

      {savedId ? (
        <div className="p-4 space-y-4 flex-1">
          <div className="bg-white rounded-xl p-6 text-center shadow-sm">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-slate-900">{savedType} saved</h2>
            <p className="text-slate-500 mt-1 font-mono tracking-widest">{reg}</p>
          </div>
          <Button onClick={handlePrint} disabled={printing} className="w-full h-14 text-lg font-bold bg-slate-900 hover:bg-slate-800 rounded-xl">
            {printing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Printer className="w-5 h-5 mr-2" />}
            Print {savedType}
          </Button>
          {savedType === "Job Sheet" && (
            <Button onClick={() => convert.mutate({ id: savedId!, toType: "SI" })} disabled={convert.isPending} variant="outline" className="w-full h-14 text-lg font-bold rounded-xl border-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50">
              {convert.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Receipt className="w-5 h-5 mr-2" />}
              Convert to Invoice
            </Button>
          )}
          <Button onClick={() => setLocation(`/workshop?reg=${encodeURIComponent(reg)}`)} variant="ghost" className="w-full h-12 text-slate-600">Done</Button>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="p-3 space-y-2.5 flex-1">
          <Section id="vehicle" open={open} setOpen={setOpen} icon={Car} title="Vehicle" summary={[vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || undefined}>
            {(vehicle?.make || vehicle?.model) && <div className="text-sm font-medium text-slate-700">{[vehicle?.make, vehicle?.model, vehicle?.derivative].filter(Boolean).join(" ")}</div>}
            {vehicle && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                {([["VIN", vehicle.vin], ["Colour", vehicle.colour], ["Fuel", vehicle.fuelType],
                  ["Engine", vehicle.engineCC ? `${vehicle.engineCC}cc` : null], ["Engine code", vehicle.engineCode],
                  ["First reg", vehicle.dateOfRegistration ? new Date(vehicle.dateOfRegistration).toLocaleDateString("en-GB") : null],
                ] as [string, any][]).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className={k === "VIN" ? "col-span-2" : ""}>
                    <span className="text-slate-400">{k}: </span>
                    <span className="text-slate-700 font-medium break-all">{v}</span>
                  </div>
                ))}
              </div>
            )}
            <label className="text-sm text-slate-500 block">Mileage</label>
            <Input value={mileage} onChange={(e) => setMileage(e.target.value)} inputMode="numeric" placeholder="Current mileage" className={inputCls} />
            {motMileage && <p className="text-xs text-slate-400">Pulled from last MOT ({Number(motMileage).toLocaleString()} mi) — adjust if needed.</p>}
          </Section>

          <Section id="customer" open={open} setOpen={setOpen} icon={User} title="Customer" summary={custName || (customer ? undefined : "Not linked")}>
            <label className="text-sm text-slate-500 block">Name</label>
            <Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Customer name" className={inputCls} />
            <label className="text-sm text-slate-500 block">Phone</label>
            <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} inputMode="tel" placeholder="Phone" className={inputCls} />
            <label className="text-sm text-slate-500 block">Email</label>
            <Input value={custEmail} onChange={(e) => setCustEmail(e.target.value)} inputMode="email" placeholder="Email" className={inputCls} />
            <label className="text-sm text-slate-500 block">Address</label>
            <Input value={custAddress} onChange={(e) => setCustAddress(e.target.value)} placeholder="House no & road, area, town" className={inputCls} />
            <label className="text-sm text-slate-500 block">Postcode</label>
            <Input value={custPostcode} onChange={(e) => setCustPostcode(e.target.value)} placeholder="Postcode" className={inputCls} />
            {customer?.accountNumber && <p className="text-xs text-slate-400">Account: {customer.accountNumber}</p>}
          </Section>

          {/* Job Description — always visible (Adam: straight under the customer, no tap to
              find it), with one-tap job types that generate the description AND the priced
              lines from the garage's own pricing data. */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="w-full flex items-center gap-3 px-4 py-3.5">
              <FileText className="w-5 h-5 text-slate-500 shrink-0" />
              <span className="font-semibold text-slate-800 flex-1">Job Description</span>
            </div>
            <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <JobChip on={ticks.mot} label="MOT" sub={`£${motPrice}`} onClick={toggleMot} />
                <JobChip on={!!ticks.small} label="Small Service" sub={smallLabourPrice ? `£${smallLabourPrice} + parts` : "labour + parts"} onClick={() => toggleService("small")} />
                <JobChip on={!!ticks.major} label="Major Service" sub={majorLabourPrice ? `£${majorLabourPrice} + parts` : "oil + filters"} onClick={() => toggleService("major")} />
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe the work to be carried out…" rows={4} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-[16px] outline-none focus:border-violet-500" />
            </div>
          </div>

          <Section id="labour" open={open} setOpen={setOpen} icon={Wrench} title="Labour" summary={labour.length ? `${labour.length} · ${money(sum(labour))}` : undefined}>
            <LineRows rows={labour} kind="Labour" upd={upd} rm={rm} add={add} />
          </Section>

          <Section id="parts" open={open} setOpen={setOpen} icon={Package} title="Parts" summary={parts.length ? `${parts.length} · ${money(sum(parts))}` : undefined}>
            <LineRows rows={parts} kind="Part" upd={upd} rm={rm} add={add} />
          </Section>

          <Section id="mot" open={open} setOpen={setOpen} icon={ShieldCheck} title="MOT" summary={motNet > 0 ? money(motNet) : undefined}>
            {motFee === "" ? (
              <Button type="button" variant="outline" className="w-full h-12 border-dashed text-violet-700" onClick={() => setMotFee(String(motPrice))}>
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
        </div>
      )}

      {!savedId && (
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
      )}
    </div>
  );
}

export default function WorkshopJobSheet(props: any) {
  return (
    <RequireLogin>
      <WorkshopJobSheetInner {...props} />
    </RequireLogin>
  );
}
