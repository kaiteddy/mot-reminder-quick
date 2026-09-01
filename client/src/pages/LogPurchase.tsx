/**
 * Log a bought car from its purchase invoice.
 *
 * Drop the auction PDF, check what was read, save. The figures feed the margin-scheme books,
 * so nothing is written until it has been looked at — and DVLA's view of the same registration
 * sits alongside, because the invoice is typed by a human at the auction house.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileText, Car } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Parsed = Record<string, any>;

function Field({ label, value, onChange, placeholder, wide }: {
  label: string; value: any; onChange: (v: string) => void; placeholder?: string; wide?: boolean;
}) {
  return (
    <div className={cn("grid grid-cols-3 items-center gap-3", wide && "sm:col-span-2")}>
      <label className="text-sm text-muted-foreground">{label}</label>
      <input
        className="col-span-2 border rounded px-2 py-1.5 text-sm outline-none focus:border-violet-500"
        value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      />
    </div>
  );
}

export default function LogPurchase() {
  const [, setLocation] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [form, setForm] = useState<Parsed>({});
  const [fees, setFees] = useState<Record<string, number>>({});

  const parse = trpc.purchaseInvoice.parse.useMutation();
  const commit = trpc.purchaseInvoice.commit.useMutation();

  useEffect(() => {
    if (!result?.parsed) return;
    const p = result.parsed;
    setForm({
      registration: p.registration ?? "", make: p.make ?? "", model: p.model ?? "",
      variant: p.variant ?? "", colour: p.colour ?? "", vin: p.vin ?? "",
      mileage: p.mileage ?? "", firstRegistered: p.firstRegistered ?? "",
      motExpiry: p.motExpiry ?? "", purchaseCost: p.purchaseCost ?? "",
      purchaseDate: p.documentDate ?? "", invoiceNumber: p.invoiceNumber ?? "",
      source: p.supplier ?? "BCA", marginScheme: p.marginScheme ?? true,
    });
    setFees(p.fees ?? {});
  }, [result]);

  const handleFile = useCallback(async (file: File) => {
    if (!/\.pdf$/i.test(file.name)) { toast.error("That needs to be a PDF"); return; }
    setFileName(file.name);
    setResult(null);
    const b64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] ?? "");
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    try {
      const out = await parse.mutateAsync({ fileBase64: b64, fileName: file.name });
      setResult(out);
      if (!out.parsed?.registration) toast.error("Couldn't read a registration from that invoice");
      else if (out.existingDealId) toast.warning("This car looks like it's already been logged");
      else toast.success(`Read ${out.parsed.registration} — check the details and save`);
    } catch (e: any) { toast.error(e.message || "Couldn't read that PDF"); }
  }, [parse]);

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const feesTotal = Object.values(fees).reduce((a, b) => a + Number(b || 0), 0);
  const cost = Number(form.purchaseCost || 0);

  async function save() {
    try {
      const out = await commit.mutateAsync({
        registration: String(form.registration || "").trim(),
        make: form.make || undefined, model: form.model || undefined,
        variant: form.variant || undefined, colour: form.colour || undefined,
        vin: form.vin || undefined,
        mileage: form.mileage ? Number(form.mileage) : undefined,
        firstRegistered: form.firstRegistered || undefined,
        motExpiry: form.motExpiry || undefined,
        purchaseCost: Number(form.purchaseCost || 0),
        purchaseDate: form.purchaseDate || undefined,
        fees, marginScheme: !!form.marginScheme,
        source: form.source || "BCA",
        invoiceNumber: form.invoiceNumber || undefined,
      });
      toast.success(out.createdStock ? "Logged, and added to Sales Stock as IN PREP" : "Logged against the existing stock car");
      setLocation("/sales-stock");
    } catch (e: any) { toast.error(e.message || "Couldn't save"); }
  }

  const p = result?.parsed;
  const mismatches: string[] = result?.mismatches ?? [];

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto p-4 space-y-4 text-slate-800">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Car className="w-5 h-5 text-violet-600" /> Log a car purchase
          </h1>
          <p className="text-sm text-slate-500">
            Drop the auction invoice and everything on it is read out — no typing.
          </p>
        </div>

        {/* drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
            dragging ? "border-violet-500 bg-violet-50" : "border-slate-300 hover:border-violet-400 hover:bg-slate-50",
          )}
        >
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {parse.isPending ? (
            <div className="flex items-center justify-center gap-2 text-slate-600"><Loader2 className="w-5 h-5 animate-spin" /> Reading…</div>
          ) : fileName ? (
            <div className="flex items-center justify-center gap-2 text-slate-700"><FileText className="w-5 h-5" /> {fileName}</div>
          ) : (
            <div className="text-slate-500">
              <Upload className="w-6 h-6 mx-auto mb-2" />
              <div className="font-medium text-slate-700">Drop the purchase invoice here</div>
              <div className="text-xs mt-1">or click to choose a PDF · BCA invoices are read automatically</div>
            </div>
          )}
        </div>

        {p?.warnings?.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
            {p.warnings.map((w: string, i: number) => (
              <div key={i} className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{w}</div>
            ))}
          </div>
        )}

        {p?.registration && (
          <>
            {/* what the invoice says vs what DVLA says */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {mismatches.length === 0
                    ? <><CheckCircle2 className="w-4 h-4 text-green-600" /> DVLA agrees with the invoice</>
                    : <><AlertTriangle className="w-4 h-4 text-amber-600" /> Worth a look before saving</>}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {mismatches.length === 0 ? (
                  <p className="text-slate-600">
                    {result.dvla?.make} · {result.dvla?.colour} · {result.dvla?.engineCapacity}cc ·
                    first registered {result.dvla?.monthOfFirstRegistration} · MOT {result.dvla?.motStatus} · {result.dvla?.taxStatus}
                  </p>
                ) : mismatches.map((m, i) => <div key={i} className="text-amber-800">{m}</div>)}
                {result.existingDealId && (
                  <div className="text-amber-800 pt-1">
                    A purchase for this car at this price is already logged (deal #{result.existingDealId}) — saving again would double it up.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">The car</CardTitle></CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3">
                <Field label="Registration" value={form.registration} onChange={(v) => set("registration", v.toUpperCase())} />
                <Field label="Mileage" value={form.mileage} onChange={(v) => set("mileage", v)} />
                <Field label="Make" value={form.make} onChange={(v) => set("make", v)} />
                <Field label="Model" value={form.model} onChange={(v) => set("model", v)} />
                <Field label="Variant" value={form.variant} onChange={(v) => set("variant", v)} />
                <Field label="Colour" value={form.colour} onChange={(v) => set("colour", v)} />
                <Field label="VIN" value={form.vin} onChange={(v) => set("vin", v)} />
                <Field label="First registered" value={form.firstRegistered} onChange={(v) => set("firstRegistered", v)} placeholder="dd/mm/yy" />
                <Field label="MOT expiry" value={form.motExpiry} onChange={(v) => set("motExpiry", v)} placeholder="dd/mm/yy" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">What it cost</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Field label="Purchase price" value={form.purchaseCost} onChange={(v) => set("purchaseCost", v)} />
                {Object.entries(fees).map(([label, amt]) => (
                  <Field key={label} label={label} value={amt}
                    onChange={(v) => setFees((f) => ({ ...f, [label]: Number(v) || 0 }))} />
                ))}
                <div className="flex justify-between border-t pt-2 text-sm">
                  <span className="text-slate-600">Total paid</span>
                  <span className="font-semibold">£{(cost + feesTotal).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                </div>
                {p.totalDue != null && Math.abs(cost + feesTotal - p.totalDue) > 0.005 && (
                  <div className="text-xs text-amber-700">
                    The invoice total is £{p.totalDue.toLocaleString("en-GB", { minimumFractionDigits: 2 })} — these figures don't add up to it.
                  </div>
                )}
                <div className="text-xs text-slate-500">
                  {form.marginScheme
                    ? "Margin scheme (second-hand goods) — no VAT reclaimable on the car itself."
                    : "Standard-rated — VAT applies on the full sale price."}
                </div>
                <Field label="Invoice no." value={form.invoiceNumber} onChange={(v) => set("invoiceNumber", v)} />
                <Field label="Bought from" value={form.source} onChange={(v) => set("source", v)} />
                <Field label="Purchase date" value={form.purchaseDate} onChange={(v) => set("purchaseDate", v)} placeholder="dd/mm/yy" />
              </CardContent>
            </Card>

            <div className="flex gap-2 pb-8">
              <Button onClick={save} disabled={commit.isPending || !form.registration}>
                {commit.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                Log this purchase
              </Button>
              <Button variant="outline" onClick={() => { setResult(null); setFileName(null); }}>Start again</Button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
