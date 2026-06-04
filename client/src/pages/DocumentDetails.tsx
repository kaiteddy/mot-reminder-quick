import { useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import PrintableDocument from "@/components/PrintableDocument";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, Pencil, Save, X, Search, Plus, Trash2, Loader2, ChevronDown, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

const TYPE_LABEL: Record<string, string> = {
  SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note",
  XS: "Excess", PA: "Payment", VS: "Vehicle Sale", VP: "Vehicle Purchase",
};
const money = (v: any) => (v == null || v === "" ? "0.00" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(n) ? undefined : n; };
const dateInput = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

type Item = { id?: number; itemType: string; description?: string; partNumber?: string; nominalCode?: string; quantity?: any; unitPrice?: any; vatRate?: any; subNet?: any; taxAmount?: any };

function recalc(i: Item): Item {
  const q = num(i.quantity) ?? 0, u = num(i.unitPrice) ?? 0, r = num(i.vatRate) ?? 0;
  const net = +(q * u).toFixed(2);
  return { ...i, subNet: net, taxAmount: +(net * r / 100).toFixed(2) };
}

export default function DocumentDetails() {
  const params = useParams();
  const isNew = params.id === "new";
  const id = isNew ? 0 : Number(params.id);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.documents.getById.useQuery({ id }, { enabled: !isNew && !!id });
  const save = trpc.documents.save.useMutation();

  const [editing, setEditing] = useState(isNew);
  const [newCust, setNewCust] = useState(false);
  const [looking, setLooking] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({ docType: "JS" });
  const [items, setItems] = useState<Item[]>([]);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: `${(data as any)?.doc?.docType || "Doc"}_${(data as any)?.doc?.docNo || "draft"}` });
  const convert = trpc.documents.convert.useMutation();
  const [convertOpen, setConvertOpen] = useState(false);
  async function doConvert(toType: string) {
    setConvertOpen(false);
    try {
      const res: any = await convert.mutateAsync({ id, toType });
      toast.success(`Converted to ${TYPE_LABEL[toType] || toType}`);
      setLocation(`/documents/${res.id}`);
    } catch (e: any) { toast.error("Convert failed: " + e.message); }
  }
  const emailMut = trpc.email.sendDocument.useMutation();
  async function doEmail() {
    const def = (data as any)?.doc?.custEmail || (data as any)?.customer?.email || "";
    const to = window.prompt("Email this document (PDF attached) to:", def);
    if (!to) return;
    try { await emailMut.mutateAsync({ docId: id, to }); toast.success(`Emailed to ${to}`); }
    catch (e: any) { toast.error("Email failed: " + (e.message || "")); }
  }

  // initialise the form once data arrives
  useEffect(() => {
    if (isNew || !data?.doc) return;
    setNewCust(false);
    const { doc, vehicle, customer } = data as any;
    setForm({
      docType: doc.docType || "JS",
      customerId: doc.customerId ?? undefined,
      registration: vehicle?.registration || doc.registration || "",
      make: vehicle?.make || "", model: vehicle?.model || "", derivative: vehicle?.derivative || "", colour: vehicle?.colour || "",
      fuelType: vehicle?.fuelType || "", engineCC: vehicle?.engineCC || "", engineNo: vehicle?.engineNo || "",
      engineCode: vehicle?.engineCode || "", vin: vehicle?.vin || "", paintCode: vehicle?.paintCode || "",
      keyCode: vehicle?.keyCode || "", radioCode: vehicle?.radioCode || "", dateOfRegistration: dateInput(vehicle?.dateOfRegistration),
      mileage: doc.mileage ?? "",
      customerName: doc.customerName || customer?.name || "", company: doc.company || "", accountNumber: doc.accountNumber || "",
      custHouseNo: doc.custHouseNo || "", custRoad: doc.custRoad || "", custLocality: doc.custLocality || "",
      custTown: doc.custTown || "", custCounty: doc.custCounty || "", custPostcode: doc.custPostcode || customer?.postcode || "",
      custTelephone: doc.custTelephone || customer?.phone || "", custMobile: doc.custMobile || "", custEmail: doc.custEmail || customer?.email || "",
      docStatus: doc.docStatus || "", orderRef: doc.orderRef || "", department: doc.department || "", terms: doc.terms || "",
      dateCreated: dateInput(doc.dateCreated), dateIssued: dateInput(doc.dateIssued), description: doc.description || "",
      staffSalesPerson: doc.staffSalesPerson || "", staffTechnician: doc.staffTechnician || "", staffRoadTester: doc.staffRoadTester || "",
      staffMotTester: doc.staffMotTester || "", motClass: doc.motClass || "", motStatus: doc.motStatus || "",
    });
    setItems((data as any).lineItems.map((li: any) => ({ ...li })));
  }, [data, isNew]);

  async function lookup() {
    if (!form.registration) return;
    setLooking(true);
    try {
      const res: any = await utils.documents.lookupVehicle.fetch({ registration: form.registration });
      const v = res?.vehicle, c = res?.customer;
      if (!v) { toast.error("No vehicle data found for that registration"); return; }
      setForm((f) => ({
        ...f, registration: v.registration || f.registration,
        make: v.make ?? f.make, model: v.model ?? f.model, derivative: v.derivative ?? f.derivative, colour: v.colour ?? f.colour, fuelType: v.fuelType ?? f.fuelType,
        engineCC: v.engineCC ?? f.engineCC, engineNo: v.engineNo ?? f.engineNo, engineCode: v.engineCode ?? f.engineCode,
        vin: v.vin ?? f.vin, paintCode: v.paintCode ?? f.paintCode, keyCode: v.keyCode ?? f.keyCode, radioCode: v.radioCode ?? f.radioCode,
        dateOfRegistration: v.dateOfRegistration ? dateInput(v.dateOfRegistration) : f.dateOfRegistration,
        ...(c ? { customerName: c.name || f.customerName, custPostcode: c.postcode || f.custPostcode, custTelephone: c.phone || f.custTelephone, custEmail: c.email || f.custEmail, custRoad: c.address || f.custRoad } : {}),
      }));
      const src = String(res.source || "");
      if (res.found) toast.success("Loaded from your records");
      else if (src.includes("sws")) toast.success("Loaded from SWS vehicle data" + (src.includes("dvla") ? " + DVLA" : ""));
      else if (src.includes("dvla")) toast.success("Loaded from DVLA");
      else toast.message("No external data found — registration set");
    } catch { toast.error("Lookup failed"); }
    finally { setLooking(false); }
  }

  const liveTotals = useMemo(() => {
    const net = items.reduce((a, i) => a + (num(i.subNet) ?? 0), 0);
    const tax = items.reduce((a, i) => a + (num(i.taxAmount) ?? 0), 0);
    const partsNet = items.filter((i) => i.itemType === "Part").reduce((a, i) => a + (num(i.subNet) ?? 0), 0);
    const labourNet = items.filter((i) => i.itemType === "Labour").reduce((a, i) => a + (num(i.subNet) ?? 0), 0);
    return { net, tax, gross: +(net + tax).toFixed(2), partsNet, labourNet };
  }, [items]);

  async function onSave() {
    try {
      const payload: any = {
        id: isNew ? undefined : id, docType: form.docType || "JS", registration: form.registration,
        customerId: form.customerId || undefined,
        createCustomer: !form.customerId && !!form.customerName && (isNew || newCust),
        vehicle: { make: form.make, model: form.model, derivative: form.derivative, colour: form.colour, fuelType: form.fuelType, engineCC: form.engineCC, engineNo: form.engineNo, engineCode: form.engineCode, vin: form.vin, paintCode: form.paintCode, keyCode: form.keyCode, radioCode: form.radioCode },
        customerName: form.customerName, company: form.company, accountNumber: form.accountNumber,
        custHouseNo: form.custHouseNo, custRoad: form.custRoad, custLocality: form.custLocality, custTown: form.custTown,
        custCounty: form.custCounty, custPostcode: form.custPostcode, custTelephone: form.custTelephone, custMobile: form.custMobile, custEmail: form.custEmail,
        mileage: form.mileage ? Number(String(form.mileage).replace(/\D/g, "")) || null : null,
        dateCreated: form.dateCreated || undefined, dateIssued: form.dateIssued || undefined,
        docStatus: form.docStatus, orderRef: form.orderRef, department: form.department, terms: form.terms, description: form.description,
        staffSalesPerson: form.staffSalesPerson, staffTechnician: form.staffTechnician, staffRoadTester: form.staffRoadTester,
        staffMotTester: form.staffMotTester, motClass: form.motClass, motStatus: form.motStatus,
        lineItems: items.map((i) => ({ itemType: i.itemType, description: i.description, partNumber: i.partNumber, nominalCode: i.nominalCode, quantity: num(i.quantity), unitPrice: num(i.unitPrice), vatRate: num(i.vatRate), subNet: num(i.subNet), taxAmount: num(i.taxAmount) })),
      };
      // If the customer details were edited and a customer is linked, offer to update their record
      const cust = (data as any)?.customer;
      if (form.customerId && cust) {
        const changed =
          (form.customerName || "") !== (cust.name || "") ||
          (form.custMobile || form.custTelephone || "") !== (cust.phone || "") ||
          (form.custEmail || "") !== (cust.email || "") ||
          (form.custPostcode || "") !== (cust.postcode || "");
        if (changed) payload.updateCustomerRecord = window.confirm(`Customer details have changed.\n\nUpdate ${cust.name || "the customer"}'s record with the new details?`);
      }
      const res = await save.mutateAsync(payload);
      toast.success("Job sheet saved");
      if (isNew) { setLocation(`/documents/${res.id}`); }
      else { await utils.documents.getById.invalidate({ id }); setEditing(false); }
    } catch (e: any) { toast.error(`Save failed: ${e.message}`); }
  }

  if (!isNew && isLoading) return <DashboardLayout><div className="p-8 text-muted-foreground">Loading…</div></DashboardLayout>;
  if (!isNew && !data?.doc) return <DashboardLayout><div className="p-8">Document not found.</div></DashboardLayout>;

  const typeLabel = TYPE_LABEL[form.docType] || form.docType || "Job Sheet";
  const docNo = (data as any)?.doc?.docNo;
  const history = (data as any)?.history ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-3 text-slate-800">
        {/* toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button onClick={() => setLocation("/documents")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to documents
          </button>
          <div className="flex items-center gap-2">
            {!editing ? (
              <>
                {!isNew && (
                  <button onClick={doEmail} disabled={emailMut.isPending} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">{emailMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Email</button>
                )}
                <button onClick={handlePrint} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent"><Printer className="w-4 h-4" /> Print</button>
                {!isNew && (
                  <div className="relative">
                    <button onClick={() => setConvertOpen((o) => !o)} disabled={convert.isPending} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
                      {convert.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Convert <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    {convertOpen && (
                      <div className="absolute right-0 mt-1 bg-white border rounded shadow-lg z-30 min-w-[160px] py-1">
                        {([["ES", "Copy to Estimate"], ["JS", "Convert to Job Sheet"], ["SI", "Convert to Invoice"], ["CR", "Copy to Credit Note"]] as [string, string][])
                          .filter(([code]) => code !== (data as any)?.doc?.docType)
                          .map(([code, label]) => (
                            <button key={code} onClick={() => doConvert(code)} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-violet-50">{label}</button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 bg-violet-700 text-white rounded px-3 py-1.5 text-sm hover:bg-violet-800"><Pencil className="w-4 h-4" /> Edit</button>
              </>
            ) : (
              <>
                <button onClick={() => (isNew ? setLocation("/documents") : setEditing(false))} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent"><X className="w-4 h-4" /> Cancel</button>
                <button disabled={save.isPending} onClick={onSave} className="inline-flex items-center gap-1.5 bg-green-600 text-white rounded px-3 py-1.5 text-sm hover:bg-green-700 disabled:opacity-50">
                  {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                </button>
              </>
            )}
          </div>
        </div>

        <div className="border border-slate-300 rounded-md overflow-hidden shadow-sm bg-slate-100">
          {/* purple title bar */}
          <div className="bg-gradient-to-r from-violet-800 to-fuchsia-700 text-white px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-amber-300">★</span>
              {typeLabel}{docNo ? `: ${docNo}` : isNew ? " (new)" : ""}
            </div>
            <span className="text-[11px] text-white/70">{editing ? "Editing" : "Read-only"}</span>
          </div>

          {/* top form */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 p-3">
            {/* vehicle */}
            <div className="xl:col-span-5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[11px] text-slate-600 text-right">Registration</span>
                <input value={form.registration ?? ""} onChange={(e) => set("registration", e.target.value.toUpperCase())} readOnly={!editing}
                  className="flex-1 bg-yellow-50 border border-slate-300 rounded-sm px-2 py-[3px] text-[15px] font-mono font-semibold h-[28px] read-only:bg-yellow-50/60 outline-none focus:border-violet-500" />
                {editing && (
                  <button onClick={lookup} disabled={looking} className="inline-flex items-center gap-1 bg-violet-700 text-white rounded px-2 py-1 text-xs disabled:opacity-50">
                    {looking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Lookup
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <EF label="Make / Model" field="make" {...{ form, set, editing }} />
                <input value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} readOnly={!editing} className={boxCls(editing) + " flex-1 self-end"} />
              </div>
              <EF label="Derivative" field="derivative" {...{ form, set, editing }} grow />
              <div className="flex gap-2"><EF label="Chassis" field="vin" {...{ form, set, editing }} grow /></div>
              <div className="flex gap-2"><EF label="Engine CC" field="engineCC" {...{ form, set, editing }} /><EF label="Fuel Type" field="fuelType" w="w-20" {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Engine Code" field="engineCode" {...{ form, set, editing }} /><EF label="Engine No" field="engineNo" w="w-20" {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Colour" field="colour" {...{ form, set, editing }} /><EF label="Paint Code" field="paintCode" w="w-20" {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Key Code" field="keyCode" {...{ form, set, editing }} /><EF label="Radio Code" field="radioCode" w="w-20" {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Mileage" field="mileage" {...{ form, set, editing }} /><EF label="Date Reg" field="dateOfRegistration" w="w-20" type="date" {...{ form, set, editing }} /></div>
            </div>
            {/* customer */}
            <div className="xl:col-span-4 space-y-1.5">
              {editing && (
                <>
                  <CustomerSearch onSelect={(c) => { setNewCust(false); setForm((f) => ({
                    ...f, customerId: c.id, customerName: c.name || f.customerName,
                    custEmail: c.email || f.custEmail, custPostcode: c.postcode || f.custPostcode,
                    custTelephone: c.phone || f.custTelephone, custRoad: c.address || f.custRoad,
                  })); }} />
                  <div className="flex items-center justify-end gap-2 -mt-0.5 pr-1">
                    {form.customerId ? (
                      <span className="text-[11px] text-muted-foreground">Linked customer #{form.customerId}</span>
                    ) : (isNew || newCust) && form.customerName ? (
                      <span className="text-[11px] text-green-700">New customer will be created</span>
                    ) : null}
                    <button type="button" onClick={() => { setNewCust(true); setForm((f) => ({ ...f, customerId: undefined, customerName: "", company: "", accountNumber: "", custHouseNo: "", custRoad: "", custLocality: "", custTown: "", custCounty: "", custPostcode: "", custTelephone: "", custMobile: "", custEmail: "" })); }}
                      className="text-[11px] text-violet-700 hover:underline inline-flex items-center gap-1"><Plus className="w-3 h-3" /> New customer</button>
                  </div>
                </>
              )}
              <EF label="Acc Number" field="accountNumber" {...{ form, set, editing }} />
              <EF label="Company" field="company" {...{ form, set, editing }} />
              <EF label="Name" field="customerName" {...{ form, set, editing }} />
              <div className="flex gap-2"><EF label="House No" field="custHouseNo" {...{ form, set, editing }} /><EF label="Post Code" field="custPostcode" w="w-20" {...{ form, set, editing }} /></div>
              <EF label="Road" field="custRoad" {...{ form, set, editing }} />
              <EF label="Locality" field="custLocality" {...{ form, set, editing }} />
              <div className="flex gap-2"><EF label="Town" field="custTown" {...{ form, set, editing }} /><EF label="County" field="custCounty" w="w-20" {...{ form, set, editing }} /></div>
              <EF label="Telephone" field="custTelephone" {...{ form, set, editing }} />
              <EF label="Mobile" field="custMobile" {...{ form, set, editing }} />
              <EF label="Email" field="custEmail" {...{ form, set, editing }} />
            </div>
            {/* additional info */}
            <div className="xl:col-span-3 space-y-3">
              <Panel title="Additional Info">
                <EF label="Status" field="docStatus" w="w-20" {...{ form, set, editing }} />
                <EF label="Order Ref" field="orderRef" w="w-20" {...{ form, set, editing }} />
                <EF label="Department" field="department" w="w-20" {...{ form, set, editing }} />
                <EF label="Terms" field="terms" w="w-20" {...{ form, set, editing }} />
                <EF label="Sales Advisor" field="staffSalesPerson" w="w-20" {...{ form, set, editing }} />
                <EF label="Technician" field="staffTechnician" w="w-20" {...{ form, set, editing }} />
                <EF label="Road Tester" field="staffRoadTester" w="w-20" {...{ form, set, editing }} />
              </Panel>
              <Panel title="MOT">
                <SelectField label="MOT Class" field="motClass" w="w-20" options={["4", "5", "7"]} {...{ form, set, editing }} />
                <SelectField label="MOT Status" field="motStatus" w="w-20" options={["Pass", "Fail", "Retest", "Advisory"]} {...{ form, set, editing }} />
                <EF label="MOT Tester" field="staffMotTester" w="w-20" {...{ form, set, editing }} />
              </Panel>
              {!isNew && (
                <Panel title="Account">
                  <div className="flex justify-between text-[12px]"><span className="text-slate-600">Veh Last Invoiced</span><span>{fmtDate((data as any)?.vehLastInvoiced) || "—"}</span></div>
                  <div className="flex justify-between text-[12px]"><span className="text-slate-600">Cust Last Invoiced</span><span>{fmtDate((data as any)?.custLastInvoiced) || "—"}</span></div>
                  <div className="flex justify-between text-[13px] font-semibold border-t pt-1 mt-1"><span className="text-slate-600">Acc Balance</span><span className={((data as any)?.accBalance || 0) > 0 ? "text-red-600" : ""}>£{money((data as any)?.accBalance)}</span></div>
                </Panel>
              )}
            </div>
          </div>

          {/* body: tabs + totals */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 px-3 pb-3">
            <div className="xl:col-span-9">
              <Tabs defaultValue="description">
                <TabsList className="w-full justify-start rounded-none bg-slate-700 p-0 h-auto">
                  {[["description", "Description"], ["labour", "Labour"], ["parts", "Parts"], ["advisories", "Advisories"], ["partsHistory", "Prev Parts"], ["history", `History (${history.length})`]].map(([v, label]) => (
                    <TabsTrigger key={v} value={v} className="rounded-none text-slate-200 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 px-4 py-2 text-[13px]">{label}</TabsTrigger>
                  ))}
                </TabsList>
                <div className="border border-slate-300 border-t-0 bg-white p-3 min-h-[260px]">
                  <TabsContent value="description" className="mt-0">
                    {editing && <PresetPicker currentBody={form.description} onPick={(body) => set("description", (form.description ? form.description.trimEnd() + "\n\n" : "") + body)} />}
                    <textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} readOnly={!editing} rows={10}
                      placeholder={editing ? "Describe the work to be carried out…" : ""}
                      className="w-full text-[13px] leading-relaxed border border-slate-200 rounded p-2 outline-none read-only:border-transparent read-only:p-0 focus:border-violet-400 resize-y" />
                  </TabsContent>
                  <TabsContent value="labour" className="mt-0"><ItemsEditor items={items} setItems={setItems} kind="Labour" editing={editing} /></TabsContent>
                  <TabsContent value="parts" className="mt-0"><ItemsEditor items={items} setItems={setItems} kind="Part" editing={editing} /></TabsContent>
                  <TabsContent value="advisories" className="mt-0"><ItemsEditor items={items} setItems={setItems} kind="Other" editing={editing} /></TabsContent>
                  <TabsContent value="partsHistory" className="mt-0"><PrevParts vehicleId={(data as any)?.doc?.vehicleId} onOpen={(docId) => setLocation(`/documents/${docId}`)} /></TabsContent>
                  <TabsContent value="history" className="mt-0">
                    {history.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No other documents for this vehicle.</p> : (
                      <Table>
                        <TableHeader><TableRow><TableHead className="h-8">Date</TableHead><TableHead className="h-8">Type</TableHead><TableHead className="h-8">Doc No</TableHead><TableHead className="h-8 text-right">Mileage</TableHead><TableHead className="h-8">Description</TableHead><TableHead className="h-8 text-right">Total</TableHead></TableRow></TableHeader>
                        <TableBody>{history.map((h: any) => (
                          <TableRow key={h.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/documents/${h.id}`)}>
                            <TableCell>{fmtDate(h.dateIssued || h.dateCreated)}</TableCell>
                            <TableCell><Badge variant="secondary">{TYPE_LABEL[h.docType] || h.docType}</Badge></TableCell>
                            <TableCell>{h.docNo}</TableCell>
                            <TableCell className="text-right">{h.mileage ? Number(h.mileage).toLocaleString("en-GB") : ""}</TableCell>
                            <TableCell className="max-w-[280px] truncate">{h.mainDescription || h.description || ""}</TableCell>
                            <TableCell className="text-right">£{money(h.totalGross)}</TableCell>
                          </TableRow>))}
                        </TableBody>
                      </Table>
                    )}
                  </TabsContent>
                </div>
              </Tabs>
            </div>
            <div className="xl:col-span-3 space-y-3">
              <Panel title="Totals">
                <TRow label="Parts" value={liveTotals.partsNet} />
                <TRow label="Labour" value={liveTotals.labourNet} />
                <TRow label="Subtotal" value={liveTotals.net} />
                <TRow label="VAT" value={liveTotals.tax} />
                <TRow label="Total" value={liveTotals.gross} bold />
              </Panel>
            </div>
          </div>
        </div>

        {/* off-screen printable replica (react-to-print) */}
        <div style={{ position: "absolute", left: "-99999px", top: 0 }} aria-hidden="true">
          <div ref={printRef}>
            <PrintableDocument doc={(data as any)?.doc} vehicle={(data as any)?.vehicle} customer={(data as any)?.customer} lineItems={(data as any)?.lineItems} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

const boxCls = (editing: boolean) =>
  `min-w-0 bg-white border border-slate-300 rounded-sm px-2 py-[3px] text-[13px] h-[26px] truncate outline-none ${editing ? "focus:border-violet-500" : "read-only:bg-slate-50"}`;

function EF({ label, field, form, set, editing, w = "w-24", grow, type = "text" }: { label: string; field: string; form: Record<string, any>; set: (k: string, v: any) => void; editing: boolean; w?: string; grow?: boolean; type?: string }) {
  return (
    <div className={`flex items-center gap-2 ${grow ? "flex-1" : ""}`}>
      <span className={`${w} shrink-0 text-[11px] text-slate-600 text-right`}>{label}</span>
      <input type={type} value={form[field] ?? ""} onChange={(e) => set(field, e.target.value)} readOnly={!editing} className={boxCls(editing) + " flex-1"} />
    </div>
  );
}

function SelectField({ label, field, form, set, editing, options, w = "w-24" }: { label: string; field: string; form: Record<string, any>; set: (k: string, v: any) => void; editing: boolean; options: string[]; w?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`${w} shrink-0 text-[11px] text-slate-600 text-right`}>{label}</span>
      <select value={form[field] ?? ""} onChange={(e) => set(field, e.target.value)} disabled={!editing} className={boxCls(editing) + " flex-1 disabled:bg-slate-50 disabled:text-slate-700"}>
        <option value=""></option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-300 rounded-sm bg-slate-50 overflow-hidden">
      <div className="bg-slate-200/70 px-3 py-1.5 text-[13px] font-semibold text-slate-700">{title}</div>
      <div className="p-2 space-y-1.5">{children}</div>
    </div>
  );
}

function TRow({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-[12px] text-slate-600">{label}</span>
      <div className={`w-24 text-right border border-slate-300 rounded-sm px-2 py-[2px] text-[13px] bg-white ${bold ? "font-semibold" : ""}`}>{money(value)}</div>
    </div>
  );
}

function CustomerSearch({ onSelect }: { onSelect: (c: any) => void }) {
  const [q, setQ] = useState("");
  const { data: results } = trpc.customers.search.useQuery({ query: q }, { enabled: q.trim().length >= 2 });
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[11px] text-slate-600 text-right">Find customer</span>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / postcode…"
            className="w-full bg-white border border-violet-300 rounded-sm pl-7 pr-2 py-[3px] text-[13px] h-[26px] outline-none focus:border-violet-500" />
        </div>
      </div>
      {q.trim().length >= 2 && results && results.length > 0 && (
        <div className="absolute z-30 left-[104px] right-0 mt-1 bg-white border border-slate-300 rounded-sm shadow-lg max-h-56 overflow-auto">
          {results.map((c: any) => (
            <button key={c.id} type="button" onClick={() => { onSelect(c); setQ(""); }}
              className="block w-full text-left px-3 py-1.5 text-[13px] hover:bg-violet-50 border-b last:border-0">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground ml-2">{[c.phone, c.postcode].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PresetPicker({ onPick, currentBody }: { onPick: (body: string) => void; currentBody?: string }) {
  const { data: presets } = trpc.descriptionPresets.list.useQuery();
  const create = trpc.descriptionPresets.create.useMutation();
  const utils = trpc.useUtils();
  return (
    <div className="flex items-center gap-3 mb-2">
      <select className="border border-slate-300 rounded-sm px-2 py-1 text-[13px] bg-white" value=""
        onChange={(e) => { const p = (presets as any[])?.find((x) => String(x.id) === e.target.value); if (p) onPick(p.body); }}>
        <option value="">Pre-set descriptions…</option>
        {(presets as any[])?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      {currentBody?.trim() && (
        <button type="button" className="text-[12px] text-violet-700 hover:underline"
          onClick={async () => { const title = prompt("Save current description as a preset — enter a title:"); if (title?.trim()) { await create.mutateAsync({ title: title.trim(), body: currentBody! }); await utils.descriptionPresets.list.invalidate(); toast.success("Preset saved"); } }}>
          + Save as preset
        </button>
      )}
    </div>
  );
}

function PrevParts({ vehicleId, onOpen }: { vehicleId?: number; onOpen: (docId: number) => void }) {
  const [q, setQ] = useState("");
  const { data: parts, isLoading } = trpc.documents.partsHistory.useQuery({ vehicleId: vehicleId! }, { enabled: !!vehicleId });
  if (!vehicleId) return <p className="text-sm text-muted-foreground py-6 text-center">No vehicle linked to this document.</p>;
  const s = q.trim().toLowerCase();
  const filtered = ((parts as any[]) || []).filter((p) => !s || (p.description || "").toLowerCase().includes(s) || (p.partNumber || "").toLowerCase().includes(s));
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts fitted to this vehicle…" className="w-full border border-slate-300 rounded-sm pl-7 pr-2 py-1 text-[13px] outline-none focus:border-violet-500" />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} part{filtered.length === 1 ? "" : "s"}</span>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        : filtered.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No parts found for this vehicle.</p>
        : (
          <Table>
            <TableHeader><TableRow>
              <TableHead className="h-8">Date</TableHead><TableHead className="h-8">Doc No</TableHead>
              <TableHead className="h-8">Part No</TableHead><TableHead className="h-8">Description</TableHead>
              <TableHead className="h-8 text-right">Qty</TableHead><TableHead className="h-8 text-right">Unit £</TableHead><TableHead className="h-8 text-right">Net £</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onOpen(p.docId)}>
                  <TableCell>{fmtDate(p.dateIssued || p.dateCreated)}</TableCell>
                  <TableCell>{p.docNo}</TableCell>
                  <TableCell className="font-mono text-xs">{p.partNumber || "—"}</TableCell>
                  <TableCell className="max-w-[300px] truncate">{p.description || "—"}</TableCell>
                  <TableCell className="text-right">{p.quantity ?? ""}</TableCell>
                  <TableCell className="text-right">{money(p.unitPrice)}</TableCell>
                  <TableCell className="text-right">{money(p.subNet)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
    </div>
  );
}

function ItemsEditor({ items, setItems, kind, editing }: { items: Item[]; setItems: (f: (p: Item[]) => Item[]) => void; kind: string; editing: boolean }) {
  const rows = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.itemType === kind);
  const update = (idx: number, patch: Partial<Item>) => setItems((p) => p.map((it, i) => (i === idx ? recalc({ ...it, ...patch }) : it)));
  const add = () => setItems((p) => [...p, recalc({ itemType: kind, description: "", quantity: kind === "Labour" ? 1 : 1, unitPrice: 0, vatRate: 20 })]);
  const remove = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx));
  const inp = "w-full bg-white border border-slate-300 rounded-sm px-1.5 py-1 text-[13px] outline-none focus:border-violet-500";

  if (!editing && rows.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">No {kind === "Part" ? "parts" : kind === "Labour" ? "labour" : "advisories"}.</p>;
  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            {kind === "Part" && <TableHead className="h-8">Part No</TableHead>}
            <TableHead className="h-8">Description</TableHead>
            <TableHead className="h-8 text-right w-16">{kind === "Labour" ? "Hrs" : "Qty"}</TableHead>
            <TableHead className="h-8 text-right w-20">{kind === "Labour" ? "Rate" : "Unit"}</TableHead>
            <TableHead className="h-8 text-right w-14">VAT%</TableHead>
            <TableHead className="h-8 text-right w-20">Net</TableHead>
            <TableHead className="h-8 text-right w-20">Gross</TableHead>
            {editing && <TableHead className="h-8 w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ it, idx }) => {
            const gross = (num(it.subNet) ?? 0) + (num(it.taxAmount) ?? 0);
            return (
              <TableRow key={idx}>
                {kind === "Part" && <TableCell>{editing ? <input className={inp} value={it.partNumber ?? ""} onChange={(e) => update(idx, { partNumber: e.target.value })} /> : <span className="font-mono text-xs">{it.partNumber || "—"}</span>}</TableCell>}
                <TableCell>{editing ? <input className={inp} value={it.description ?? ""} onChange={(e) => update(idx, { description: e.target.value })} /> : <span className="whitespace-pre-wrap">{it.description || "—"}</span>}</TableCell>
                <TableCell className="text-right">{editing ? <input className={inp + " text-right"} value={it.quantity ?? ""} onChange={(e) => update(idx, { quantity: e.target.value })} /> : (it.quantity ?? "-")}</TableCell>
                <TableCell className="text-right">{editing ? <input className={inp + " text-right"} value={it.unitPrice ?? ""} onChange={(e) => update(idx, { unitPrice: e.target.value })} /> : `£${money(it.unitPrice)}`}</TableCell>
                <TableCell className="text-right">{editing ? <input className={inp + " text-right"} value={it.vatRate ?? ""} onChange={(e) => update(idx, { vatRate: e.target.value })} /> : it.vatRate ?? "-"}</TableCell>
                <TableCell className="text-right">£{money(it.subNet)}</TableCell>
                <TableCell className="text-right">£{money(gross)}</TableCell>
                {editing && <TableCell><button onClick={() => remove(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button></TableCell>}
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-4">None yet</TableCell></TableRow>}
        </TableBody>
      </Table>
      {editing && <button onClick={add} className="mt-2 inline-flex items-center gap-1.5 text-sm text-violet-700 hover:underline"><Plus className="w-4 h-4" /> Add {kind === "Part" ? "part" : kind === "Labour" ? "labour" : "line"}</button>}
    </div>
  );
}
