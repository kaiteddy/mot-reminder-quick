import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, Loader2, FileSpreadsheet, Plus, X, CheckCircle2, Info } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const lastDayISO = (m: number, y: number) => { const d = new Date(y, m, 0); return `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const concat = (arrs: Uint8Array[]): Uint8Array => {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out;
};
// Minimal STORE (uncompressed) zip — bundles the export files into ONE download
// (browsers block multiple sequential downloads; a single zip also matches GA4's dated folder).
function makeZip(files: { name: string; content: string }[]): Blob {
  const enc = new TextEncoder();
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tbl[n] = c >>> 0; }
  const crc32 = (b: Uint8Array) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = tbl[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const u16 = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
  const u32 = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.name), data = enc.encode(f.content), crc = crc32(data);
    const lh = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), nameB]);
    local.push(lh, data);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameB]));
    offset += lh.length + data.length;
  }
  const cd = concat(central);
  const eocd = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
  const all = concat([concat(local), cd, eocd]);
  return new Blob([all as BlobPart], { type: "application/zip" });
}

// Labels for the sales nominal category rows (key -> display)
const SALES_NOMINAL_ROWS: [string, string][] = [
  ["labour", "Labour"], ["labourSublet", "Labour (Sublet)"], ["parts", "Parts"],
  ["mot", "MOT"], ["motSublet", "MOT (Sublet)"], ["sundries", "Sundries"],
  ["lubricants", "Lubricants"], ["paint", "Paint & Mat."], ["excess", "Excess"],
  ["vehiclePartEx", "Vehicle Part Exchange"], ["vehiclePurchase", "Vehicle Purchase"],
  ["vehicleSale", "Vehicle Sale"], ["surcharge", "SURCHARGE"],
];

export default function AccountsExport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [markAfter, setMarkAfter] = useState(false);
  const [cfg, setCfg] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newMethod, setNewMethod] = useState("");

  const cfgQuery = trpc.accountsExport.getConfig.useQuery();
  const logsQuery = trpc.accountsExport.logs.useQuery();
  const saveCfg = trpc.accountsExport.saveConfig.useMutation();
  const runSales = trpc.accountsExport.runSales.useMutation();
  const runExpenses = trpc.accountsExport.runExpenses.useMutation();
  const markExported = trpc.accountsExport.markExported.useMutation();

  useEffect(() => { if (cfgQuery.data && !cfg) setCfg(cfgQuery.data); }, [cfgQuery.data]);

  const persist = async (next: any) => {
    setCfg(next);
    try { await saveCfg.mutateAsync(next); } catch (e: any) { toast.error("Save failed: " + e.message); }
  };

  const doExport = async (kind: "sales" | "expenses", toDate: string, label: string) => {
    setBusy(label);
    try {
      const res: any = kind === "sales"
        ? await runSales.mutateAsync({ toDate, markExported: markAfter })
        : await runExpenses.mutateAsync({ toDate });
      if (res.counts.invoices === 0 && res.counts.payments === 0 && res.counts.customers === 0) {
        toast.message("Nothing to export", { description: "No un-exported records were found in that range." });
      } else {
        downloadBlob(`${res.folder}.zip`, makeZip(res.files));
        toast.success(`Exported ${res.counts.invoices} invoices, ${res.counts.payments} payments`, {
          description: `${res.counts.customers} customers · ${res.counts.invoiceLines} invoice lines · ${res.folder}.zip (3 files)${markAfter ? " · marked as exported" : ""}`,
        });
        logsQuery.refetch();
      }
    } catch (e: any) { toast.error("Export failed: " + e.message); }
    finally { setBusy(null); }
  };

  const doMark = async () => {
    if (!confirm(`Mark ALL sales documents up to ${MONTHS[month - 1]} ${year} as already-exported? This excludes them from future exports.`)) return;
    setBusy("mark");
    try {
      const r = await markExported.mutateAsync({ toDate: lastDayISO(month, year) });
      toast.success(`Marked ${r.marked} documents as exported`);
      logsQuery.refetch();
    } catch (e: any) { toast.error("Failed: " + e.message); }
    finally { setBusy(null); }
  };

  if (!cfg) return <DashboardLayout><div className="p-8 text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div></DashboardLayout>;

  const years = Array.from({ length: 8 }, (_, i) => now.getFullYear() - 5 + i);
  const set = (path: string, value: any) => {
    const next = structuredClone(cfg); let o = next;
    const parts = path.split("."); for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value; persist(next);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <FileSpreadsheet className="w-6 h-6 text-violet-600" />
          <h1 className="text-2xl font-bold text-slate-800">Accounts Export</h1>
        </div>
        <p className="text-sm text-slate-500 mb-5">Export sales &amp; payments to Sage-importable CSV files (Audit Trail Transactions).</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ---- Export actions ---- */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Export</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-auto py-3 flex-col gap-0.5" disabled={!!busy}
                  onClick={() => doExport("sales", todayISO(), "sales-now")}>
                  {busy === "sales-now" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span className="font-semibold">Export Sales</span><span className="text-[11px] text-slate-500">to current date</span>
                </Button>
                <Button variant="outline" className="h-auto py-3 flex-col gap-0.5" disabled={!!busy}
                  onClick={() => doExport("expenses", todayISO(), "exp-now")}>
                  {busy === "exp-now" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span className="font-semibold">Export Expenses</span><span className="text-[11px] text-slate-500">to current date</span>
                </Button>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Month ending:</span>
                <select value={month} onChange={(e) => setMonth(+e.target.value)} className="border rounded-md px-2 py-1 text-sm">
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={year} onChange={(e) => setYear(+e.target.value)} className="border rounded-md px-2 py-1 text-sm">
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-auto py-3 flex-col gap-0.5" disabled={!!busy}
                  onClick={() => doExport("sales", lastDayISO(month, year), "sales-me")}>
                  {busy === "sales-me" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span className="font-semibold">Export Sales</span><span className="text-[11px] text-slate-500">to month end</span>
                </Button>
                <Button variant="outline" className="h-auto py-3 flex-col gap-0.5" disabled={!!busy}
                  onClick={() => doExport("expenses", lastDayISO(month, year), "exp-me")}>
                  {busy === "exp-me" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span className="font-semibold">Export Expenses</span><span className="text-[11px] text-slate-500">to month end</span>
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-md bg-slate-50 border px-3 py-2">
                <div className="text-sm"><span className="font-medium text-slate-700">Mark records as exported</span><div className="text-[11px] text-slate-500">Excludes them from future exports (like GA4). Off = safe repeatable downloads.</div></div>
                <Switch checked={markAfter} onCheckedChange={setMarkAfter} />
              </div>

              <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-[12px] text-slate-600 leading-relaxed">
                <div className="font-semibold text-slate-700 mb-1">First time use</div>
                On first export every un-exported record is included (can be large). Use <b>Mark as Exported</b> to set a baseline of data already in your accounts package, then export going forward.
                <div className="mt-2">
                  <Button size="sm" variant="secondary" disabled={!!busy} onClick={doMark}>
                    {busy === "mark" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                    Mark as Exported up to {MONTHS[month - 1]} {year}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ---- Right panel tabs ---- */}
          <Card>
            <CardContent className="p-0">
              <Tabs defaultValue="info">
                <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto">
                  {["info", "settings", "nominals", "payments", "logs"].map((t) => (
                    <TabsTrigger key={t} value={t} className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:shadow-none capitalize px-4 py-2.5">{t}</TabsTrigger>
                  ))}
                </TabsList>

                {/* Info */}
                <TabsContent value="info" className="p-4 text-[13px] text-slate-600 space-y-3 mt-0">
                  <p className="flex items-start gap-2"><Info className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" /> Each export produces 3 Sage-importable files. Import them in order into your accounts package.</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    <div className="font-semibold text-slate-700">Sales import order</div>
                    <div>1. <b>Customers Records.csv</b> → Customer Records</div>
                    <div>2. <b>Audit Trail Invoices.csv</b> → Audit Trail Transactions</div>
                    <div>3. <b>Audit Trail Payments.csv</b> → Audit Trail Transactions <span className="italic text-slate-400">(optional)</span></div>
                  </div>
                  <p className="text-amber-700 bg-amber-50 border border-amber-100 rounded p-2 text-[12px]">Do not import the same file twice if the import was successful — it may create duplicate ledger entries.</p>
                  <p className="text-[12px] text-slate-400">Invoices are grouped into nominal categories (Labour / Parts / MOT / Sundries / Lubricants / Paint / Excess). Each invoice's lines always total the document, so the ledger balances. Vehicle part-exchange &amp; purchases export within Sales.</p>
                </TabsContent>

                {/* Settings */}
                <TabsContent value="settings" className="p-4 mt-0">
                  <ToggleRow label="Combine Invoices & Payments to single Audit Trail file" checked={cfg.combineInvoicesPayments} onChange={(v) => set("combineInvoicesPayments", v)} />
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 items-center mt-3 text-[13px]">
                    <div className="font-semibold text-slate-600"></div><div className="font-semibold text-slate-500 text-center px-2">Sales</div><div className="font-semibold text-slate-500 text-center px-2">Exp.</div>
                    <SettingPair label="Simple export format" hint="One grand-total line per invoice instead of category breakdown." sales={cfg.sales.simpleFormat} onSales={(v) => set("sales.simpleFormat", v)} exp={null} />
                    <SettingPair label="Cash accounting" sales={cfg.sales.cashAccounting} onSales={(v) => set("sales.cashAccounting", v)} exp={cfg.expenses.cashAccounting} onExp={(v) => set("expenses.cashAccounting", v)} />
                    <SettingPair label="Export paid-in-full invoices only" sales={cfg.sales.paidInFullOnly} onSales={(v) => set("sales.paidInFullOnly", v)} exp={cfg.expenses.paidInFullOnly} onExp={(v) => set("expenses.paidInFullOnly", v)} />
                  </div>
                  <div className="mt-4 space-y-2">
                    <TextRow label="Department override (expenses)" value={cfg.expenses.departmentOverride} onChange={(v) => set("expenses.departmentOverride", v)} />
                    <TextRow label="Non-account sales → account no." value={cfg.sales.nonAccountPoolAcct} onChange={(v) => set("sales.nonAccountPoolAcct", v)} placeholder="e.g. CASH" />
                    <TextRow label="Bank nominal (payments)" value={cfg.bankNominal} onChange={(v) => set("bankNominal", v)} />
                  </div>
                  <div className="mt-4 font-semibold text-slate-600 text-[13px]">Used vehicle pooling</div>
                  <div className="space-y-2 mt-1">
                    <TextRow label="Part-exchange → account no." value={cfg.vehicle.partExAcct} onChange={(v) => set("vehicle.partExAcct", v)} />
                    <TextRow label="Purchase → account no." value={cfg.vehicle.purchaseAcct} onChange={(v) => set("vehicle.purchaseAcct", v)} />
                  </div>
                </TabsContent>

                {/* Nominals */}
                <TabsContent value="nominals" className="p-4 mt-0">
                  <div className="text-[12px] text-slate-500 mb-2">Sales nominal codes — <b>Standard</b> for non-account customers, <b>Account</b> for account customers.</div>
                  <div className="grid grid-cols-[1fr_5rem_5rem] gap-x-3 gap-y-1.5 items-center text-[13px]">
                    <div></div><div className="text-center text-[11px] uppercase tracking-wide text-slate-400">Standard</div><div className="text-center text-[11px] uppercase tracking-wide text-slate-400">Account</div>
                    {SALES_NOMINAL_ROWS.map(([key, label]) => (
                      <NominalRow key={key} label={label}
                        std={cfg.salesNominals[key]?.std ?? ""} acct={cfg.salesNominals[key]?.acct ?? ""}
                        onStd={(v) => set(`salesNominals.${key}.std`, v)} onAcct={(v) => set(`salesNominals.${key}.acct`, v)} />
                    ))}
                  </div>
                </TabsContent>

                {/* Payments */}
                <TabsContent value="payments" className="p-4 mt-0">
                  <div className="text-[12px] text-slate-500 mb-2">Payment methods used on invoices.</div>
                  <div className="flex gap-2 mb-3">
                    <Input value={newMethod} onChange={(e) => setNewMethod(e.target.value)} placeholder="New payment method" className="h-8" onKeyDown={(e) => { if (e.key === "Enter" && newMethod.trim()) { set("paymentMethods", [...cfg.paymentMethods, newMethod.trim()]); setNewMethod(""); } }} />
                    <Button size="sm" variant="secondary" disabled={!newMethod.trim()} onClick={() => { set("paymentMethods", [...cfg.paymentMethods, newMethod.trim()]); setNewMethod(""); }}><Plus className="w-4 h-4" /></Button>
                  </div>
                  <div className="divide-y border rounded-md">
                    {cfg.paymentMethods.map((m: string, i: number) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[13px]">
                        <span>{m}</span>
                        <button onClick={() => set("paymentMethods", cfg.paymentMethods.filter((_: any, j: number) => j !== i))} className="text-slate-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* Logs */}
                <TabsContent value="logs" className="p-4 mt-0">
                  {(logsQuery.data || []).length === 0 ? (
                    <div className="text-[13px] text-slate-400 py-6 text-center">No exports recorded yet.</div>
                  ) : (
                    <div className="divide-y border rounded-md text-[12px]">
                      {(logsQuery.data || []).map((l: any, i: number) => (
                        <div key={i} className="px-3 py-2 flex items-center justify-between">
                          <span className="capitalize font-medium text-slate-700">{l.type}{l.toDate ? ` → ${l.toDate}` : ""}</span>
                          <span className="text-slate-500">{l.type === "mark" ? `${l.marked} marked` : `${l.invoices} inv · ${l.payments} pay`} · {new Date(l.at).toLocaleString("en-GB")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-center justify-between py-1.5 text-[13px]"><span className="text-slate-700">{label}</span><Switch checked={checked} onCheckedChange={onChange} /></div>;
}
function SettingPair({ label, hint, sales, onSales, exp, onExp }: { label: string; hint?: string; sales: boolean; onSales: (v: boolean) => void; exp: boolean | null; onExp?: (v: boolean) => void }) {
  return (
    <>
      <div className="text-slate-700 py-1.5"><div>{label}</div>{hint && <div className="text-[11px] text-slate-400">{hint}</div>}</div>
      <div className="flex justify-center"><Switch checked={sales} onCheckedChange={onSales} /></div>
      <div className="flex justify-center">{exp === null ? <span className="text-[11px] text-slate-300">NA</span> : <Switch checked={exp} onCheckedChange={onExp} />}</div>
    </>
  );
}
function TextRow({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div className="flex items-center justify-between gap-3 text-[13px]"><span className="text-slate-600">{label}</span><Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-8 w-32 text-right" /></div>;
}
function NominalRow({ label, std, acct, onStd, onAcct }: { label: string; std: string; acct: string; onStd: (v: string) => void; onAcct: (v: string) => void }) {
  return (
    <>
      <span className="text-slate-600">{label}</span>
      <Input value={std} onChange={(e) => onStd(e.target.value)} className="h-7 text-center px-1" />
      <Input value={acct} onChange={(e) => onAcct(e.target.value)} className="h-7 text-center px-1" />
    </>
  );
}
