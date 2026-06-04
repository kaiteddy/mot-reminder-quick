import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MOTMileageChart } from "@/components/MOTMileageChart";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, Pencil, Save, X, Search, Plus, Trash2, Loader2, ChevronDown, Mail, Droplet, Snowflake, Gauge, CalendarClock, ShieldCheck, MessageSquare, Phone, StickyNote, ArrowDownLeft, CheckCircle2, FileText, ExternalLink } from "lucide-react";
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
// A/C refrigerant charge: SWS gives a unit-bearing string ("430 ± 20 (g)"); heuristic gives grams as a number.
const fmtGasQty = (q: any): string | undefined => {
  if (q == null || q === "") return undefined;
  const s = String(q).trim();
  return `Charge ${/[a-z(]/i.test(s) ? s : `${s} g`}`;
};
const TITLES = ["MR", "MRS", "MS", "MISS", "DR", "PROF", "REV", "SIR"];
function splitName(full?: string) {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  let title = "";
  if (parts.length > 1 && TITLES.includes(parts[0].toUpperCase().replace(/\./g, ""))) title = parts.shift()!;
  const surname = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || "");
  const forename = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
  return { title, forename, surname };
}

function daysUntil(d: any): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}
function daysLabel(d: any): string | undefined {
  const n = daysUntil(d);
  if (n == null) return undefined;
  if (n < 0) return `Expired ${-n}d ago`;
  if (n === 0) return "Expires today";
  return `${n} days left`;
}
function motTone(d: any): InfoTone {
  const n = daysUntil(d);
  if (n == null) return "slate";
  if (n < 0) return "red";
  if (n <= 30) return "amber";
  return "green";
}
type InfoTone = "amber" | "sky" | "slate" | "green" | "red";
const TONES: Record<InfoTone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  green: "border-green-200 bg-green-50 text-green-700",
  red: "border-red-200 bg-red-50 text-red-700",
};
function InfoCard({ icon, label, main, sub, tone }: { icon: ReactNode; label: string; main: string; sub?: string; tone: InfoTone }) {
  return (
    <div className={`rounded-md border px-2.5 py-1.5 ${TONES[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">{icon}{label}</div>
      <div className="text-[13px] font-semibold text-slate-800 leading-tight mt-0.5 truncate" title={main}>{main}</div>
      {sub && <div className="text-[10.5px] text-slate-500 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

const EMAIL_TEMPLATES: { name: string; types?: string[]; subject: string; body: string }[] = [
  { name: "Invoice", types: ["SI"], subject: "Invoice {docNo} — ELI Motors Limited", body: "Dear {customer},\n\nThank you for choosing ELI Motors. Please find attached your invoice {docNo} for {reg}, total £{total}.\n\nIf you have any questions please reply to this email or call us on 020 8203 6449.\n\nKind regards,\nELI Motors Limited" },
  { name: "Estimate", types: ["ES"], subject: "Estimate {docNo} — ELI Motors Limited", body: "Dear {customer},\n\nPlease find attached our estimate {docNo} for {reg}, total £{total}.\n\nTo go ahead, or if you have any questions, just reply or call us on 020 8203 6449.\n\nKind regards,\nELI Motors Limited" },
  { name: "Job Sheet", types: ["JS"], subject: "Job Sheet {docNo} — ELI Motors Limited", body: "Dear {customer},\n\nPlease find attached the job sheet {docNo} for {reg}.\n\nKind regards,\nELI Motors Limited" },
  { name: "General", subject: "{type} {docNo} — ELI Motors Limited", body: "Dear {customer},\n\nPlease find your {type} attached.\n\nKind regards,\nELI Motors Limited" },
];
function applyTemplate(t: { subject: string; body: string }, ctx: any) {
  const sub = (s: string) => s
    .replace(/\{customer\}/g, ctx.customer || "Customer")
    .replace(/\{docNo\}/g, ctx.docNo || "")
    .replace(/\{type\}/g, ctx.type || "Document")
    .replace(/\{total\}/g, ctx.total || "0.00")
    .replace(/\{reg\}/g, ctx.reg || "your vehicle");
  return { subject: sub(t.subject), message: sub(t.body) };
}

type Item = { id?: number; itemType: string; description?: string; partNumber?: string; nominalCode?: string; quantity?: any; unitPrice?: any; vatRate?: any; subNet?: any; taxAmount?: any };

function recalc(i: Item): Item {
  const q = num(i.quantity) ?? 0, u = num(i.unitPrice) ?? 0, r = num(i.vatRate) ?? 0;
  const net = +(q * u).toFixed(2);
  return { ...i, subNet: net, taxAmount: +(net * r / 100).toFixed(2) };
}

// Workshop staff (GA4 "Employee" list) — used for the Sales Advisor / Technician /
// Road Tester / MOT Tester dropdowns. (Could later be moved to editable app settings.)
const TECHNICIANS = ["Dec Buckley", "Doug Brittain", "Eli Rutstein", "Kevin Peach"];

// "Extras" categories surfaced as single £ amounts (not itemised line tables).
const EXTRA_KINDS = ["MOT", "Sundries", "Lubricant", "Paint"];
const EXTRA_VAT: Record<string, number> = { MOT: 0, Sundries: 20, Lubricant: 20, Paint: 20 };
const sumNetOf = (lis: any[], kind: string) => (lis || []).filter((i) => i.itemType === kind).reduce((a, i) => a + (Number(i.subNet) || 0), 0);
const extraSum = (lis: any[], kind: string) => { const v = sumNetOf(lis, kind); return v ? String(v.toFixed(2)) : ""; };
/** Build synthetic line items for the Extras amounts entered on the form. */
function extrasToLineItems(form: Record<string, any>): Item[] {
  const map: [string, string][] = [["MOT", "motAmount"], ["Sundries", "sundriesAmount"], ["Lubricant", "lubricantsAmount"], ["Paint", "paintAmount"]];
  const out: Item[] = [];
  for (const [kind, field] of map) {
    const amt = num(form[field]);
    if (amt && amt !== 0) out.push(recalc({ itemType: kind, description: kind === "MOT" ? "MOT Test" : kind === "Paint" ? "Paint & Materials" : kind, quantity: 1, unitPrice: amt, vatRate: EXTRA_VAT[kind] ?? 20 }));
  }
  return out;
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
  const [lookupTech, setLookupTech] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({ docType: "JS" });
  const [items, setItems] = useState<Item[]>([]);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const [printing, setPrinting] = useState(false);
  // Print the SAME server-rendered PDF that gets emailed, so print & email always match.
  async function handlePrint() {
    if (isNew || !id) return;
    setPrinting(true);
    try {
      const res: any = await utils.serviceHistory.getRichPDF.fetch({ documentId: id });
      if (!res?.content) { toast.error("Could not generate the PDF"); return; }
      const bytes = atob(res.content);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      const w = window.open(url, "_blank");
      if (!w) { // popup blocked — fall back to a download
        const a = document.createElement("a"); a.href = url; a.download = res.filename || "document.pdf"; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) { toast.error("Print failed: " + (e.message || "")); }
    finally { setPrinting(false); }
  }
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
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailForm, setEmailForm] = useState({ to: "", subject: "", message: "" });
  const issueMut = trpc.documents.issue.useMutation();
  const createExcessMut = trpc.documents.createExcess.useMutation();
  const [issueOpen, setIssueOpen] = useState(false);
  const [excessOpen, setExcessOpen] = useState(false);
  async function doIssue(after: "none" | "print" | "email" | "both") {
    try {
      await issueMut.mutateAsync({ id });
      await utils.documents.getById.invalidate({ id });
      setIssueOpen(false);
      toast.success("Invoice issued");
      if (after === "print" || after === "both") setTimeout(() => handlePrint(), 200);
      if (after === "email" || after === "both") openEmail();
    } catch (e: any) { toast.error("Issue failed: " + (e.message || "")); }
  }
  async function doCreateExcess(args: { excessNet: number; discount: number; vatRegistered: boolean }) {
    try {
      const res: any = await createExcessMut.mutateAsync({ mainDocId: id, ...args });
      setExcessOpen(false);
      toast.success(`Policy excess invoice ${res.docNo} created`);
      setLocation(`/documents/${res.id}`);
    } catch (e: any) { toast.error("Create excess failed: " + (e.message || "")); }
  }
  function emailCtx() {
    const d = (data as any)?.doc; const cust = (data as any)?.customer; const veh = (data as any)?.vehicle;
    return { customer: d?.customerName || cust?.name || "Customer", docNo: d?.docNo || "", type: TYPE_LABEL[d?.docType] || "Document", total: money(d?.totalGross), reg: d?.registration || veh?.registration || "your vehicle" };
  }
  function openEmail() {
    const d = (data as any)?.doc; const cust = (data as any)?.customer;
    const t = EMAIL_TEMPLATES.find((x) => x.types?.includes(d?.docType)) || EMAIL_TEMPLATES[EMAIL_TEMPLATES.length - 1];
    setEmailForm({ to: d?.custEmail || cust?.email || "", ...applyTemplate(t, emailCtx()) });
    setEmailOpen(true);
  }
  async function sendEmail() {
    if (!emailForm.to.includes("@")) { toast.error("Enter a valid recipient email address"); return; }
    try { await emailMut.mutateAsync({ docId: id, to: emailForm.to, subject: emailForm.subject, message: emailForm.message }); toast.success(`Emailed to ${emailForm.to}`); setEmailOpen(false); }
    catch (e: any) { toast.error("Email failed: " + (e.message || "")); }
  }

  // initialise the form once data arrives
  useEffect(() => {
    if (isNew || !data?.doc) return;
    setNewCust(false);
    const { doc, vehicle, customer } = data as any;
    const nm = splitName(doc.customerName || customer?.name);
    setForm({
      docType: doc.docType || "JS",
      customerId: doc.customerId ?? undefined,
      registration: vehicle?.registration || doc.registration || "",
      make: vehicle?.make || "", model: vehicle?.model || "", derivative: vehicle?.derivative || "", colour: vehicle?.colour || "",
      fuelType: vehicle?.fuelType || "", engineCC: vehicle?.engineCC || "", engineNo: vehicle?.engineNo || "",
      engineCode: vehicle?.engineCode || "", vin: vehicle?.vin || "", paintCode: vehicle?.paintCode || "",
      keyCode: vehicle?.keyCode || "", radioCode: vehicle?.radioCode || "", dateOfRegistration: dateInput(vehicle?.dateOfRegistration),
      mileage: doc.mileage ?? "",
      customerName: doc.customerName || customer?.name || "",
      custTitle: doc.custTitle || nm.title, custForename: doc.custForename || nm.forename, custSurname: doc.custSurname || nm.surname,
      company: doc.company || "", accountNumber: doc.accountNumber || "",
      custHouseNo: doc.custHouseNo || "", custRoad: doc.custRoad || "", custLocality: doc.custLocality || "",
      custTown: doc.custTown || "", custCounty: doc.custCounty || "", custPostcode: doc.custPostcode || customer?.postcode || "",
      custTelephone: doc.custTelephone || customer?.phone || "", custMobile: doc.custMobile || "", custEmail: doc.custEmail || customer?.email || "",
      docStatus: doc.docStatus || "", orderRef: doc.orderRef || "", department: doc.department || "", terms: doc.terms || "",
      dateCreated: dateInput(doc.dateCreated), dateIssued: dateInput(doc.dateIssued), description: doc.description || "",
      staffSalesPerson: doc.staffSalesPerson || "", staffTechnician: doc.staffTechnician || "", staffRoadTester: doc.staffRoadTester || "",
      staffMotTester: doc.staffMotTester || "", motClass: doc.motClass || "", motStatus: doc.motStatus || "",
      motAmount: extraSum((data as any).lineItems, "MOT"), sundriesAmount: extraSum((data as any).lineItems, "Sundries"),
      lubricantsAmount: extraSum((data as any).lineItems, "Lubricant"), paintAmount: extraSum((data as any).lineItems, "Paint"),
    });
    // Labour/Parts/Advisories stay in the line-item tabs; MOT/Sundries/Lubricant/Paint
    // are surfaced as single Extras amounts (XS excess docs keep all their lines).
    const all = (data as any).lineItems as any[];
    setItems((doc.docType === "XS" ? all : all.filter((li) => !EXTRA_KINDS.includes(li.itemType))).map((li) => ({ ...li })));
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
      setLookupTech({ ...(v.technical || {}), motExpiry: v.motExpiryDate, taxStatus: v.taxStatus, taxDueDate: v.taxDueDate });
      const src = String(res.source || "");
      if (res.found) toast.success("Loaded from your records");
      else if (src.includes("sws")) toast.success("Loaded from SWS vehicle data" + (src.includes("dvla") ? " + DVLA" : ""));
      else if (src.includes("dvla")) toast.success("Loaded from DVLA");
      else toast.message("No external data found — registration set");
    } catch { toast.error("Lookup failed"); }
    finally { setLooking(false); }
  }

  const liveTotals = useMemo(() => {
    const itemNet = (t: string) => items.filter((i) => i.itemType === t).reduce((a, i) => a + (num(i.subNet) ?? 0), 0);
    const itemTax = (t: string) => items.filter((i) => i.itemType === t).reduce((a, i) => a + (num(i.taxAmount) ?? 0), 0);
    const labourNet = itemNet("Labour"), partsNet = itemNet("Part"), otherNet = itemNet("Other"), excessLineNet = itemNet("Excess");
    // Extras entered as single amounts on the form
    const mot = num(form.motAmount) || 0, sundries = num(form.sundriesAmount) || 0, lubricants = num(form.lubricantsAmount) || 0, paint = num(form.paintAmount) || 0;
    const subTotal = +(labourNet + partsNet + otherNet + excessLineNet + sundries + lubricants + paint).toFixed(2);
    const vat = +(itemTax("Labour") + itemTax("Part") + itemTax("Other") + itemTax("Excess") + (sundries + lubricants + paint) * 0.2).toFixed(2);
    const motGross = +mot.toFixed(2); // MOT fee is outside the scope of VAT
    const gross = +(subTotal + vat + motGross).toFixed(2);
    return {
      subTotal, vat, motGross, gross, net: subTotal, tax: vat,
      labourNet, partsNet, sundriesNet: sundries, paintNet: paint, lubricantNet: lubricants,
    };
  }, [items, form.motAmount, form.sundriesAmount, form.lubricantsAmount, form.paintAmount]);

  const vehInfo = useMemo(() => {
    const v = (data as any)?.vehicle;
    const td = (v?.comprehensiveTechnicalData as any) || {};
    const oil = (td.lubricants || []).find((l: any) => /engine oil/i.test(l?.description || ""));
    return {
      oilSpec: lookupTech?.oilSpec ?? oil?.specification,
      oilCapacity: lookupTech?.oilCapacity ?? oil?.capacity,
      airconType: lookupTech?.airconType ?? td.aircon?.type,
      airconCapacity: lookupTech?.airconCapacity ?? td.aircon?.quantity ?? td.aircon?.capacity,
      motExpiry: lookupTech?.motExpiry ?? v?.motExpiryDate,
      taxStatus: lookupTech?.taxStatus ?? v?.taxStatus,
      taxDueDate: lookupTech?.taxDueDate ?? v?.taxDueDate,
    };
  }, [data, lookupTech]);

  async function onSave() {
    try {
      const payload: any = {
        id: isNew ? undefined : id, docType: form.docType || "JS", registration: form.registration,
        customerId: form.customerId || undefined,
        createCustomer: !form.customerId && !!form.customerName && (isNew || newCust),
        vehicle: { make: form.make, model: form.model, derivative: form.derivative, colour: form.colour, fuelType: form.fuelType, engineCC: form.engineCC, engineNo: form.engineNo, engineCode: form.engineCode, vin: form.vin, paintCode: form.paintCode, keyCode: form.keyCode, radioCode: form.radioCode },
        customerName: [form.custTitle, form.custForename, form.custSurname].filter(Boolean).join(" ") || form.customerName,
        custTitle: form.custTitle, custForename: form.custForename, custSurname: form.custSurname,
        company: form.company, accountNumber: form.accountNumber,
        custHouseNo: form.custHouseNo, custRoad: form.custRoad, custLocality: form.custLocality, custTown: form.custTown,
        custCounty: form.custCounty, custPostcode: form.custPostcode, custTelephone: form.custTelephone, custMobile: form.custMobile, custEmail: form.custEmail,
        mileage: form.mileage ? Number(String(form.mileage).replace(/\D/g, "")) || null : null,
        dateCreated: form.dateCreated || undefined, dateIssued: form.dateIssued || undefined,
        docStatus: form.docStatus, orderRef: form.orderRef, department: form.department, terms: form.terms, description: form.description,
        staffSalesPerson: form.staffSalesPerson, staffTechnician: form.staffTechnician, staffRoadTester: form.staffRoadTester,
        staffMotTester: form.staffMotTester, motClass: form.motClass, motStatus: form.motStatus,
        lineItems: [...items, ...extrasToLineItems(form)].map((i) => ({ itemType: i.itemType, description: i.description, partNumber: i.partNumber, nominalCode: i.nominalCode, quantity: num(i.quantity), unitPrice: num(i.unitPrice), vatRate: num(i.vatRate), subNet: num(i.subNet), taxAmount: num(i.taxAmount) })),
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
  const isInvoice = form.docType === "SI" || form.docType === "XS";
  const isExcess = form.docType === "XS";
  const relatedDoc = (data as any)?.relatedDoc;
  const docReceipts = Number((data as any)?.doc?.totalReceipts) || 0;
  const excessDeduction = isExcess ? 0 : (Number((data as any)?.doc?.excessGross) || 0);
  const docBalance = +(liveTotals.gross - excessDeduction - docReceipts).toFixed(2);
  const docStatusLabel = (data as any)?.doc?.dateIssued ? ((data as any)?.doc?.docStatus || "Issued") : "Not Issued";

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
                  <button onClick={openEmail} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent"><Mail className="w-4 h-4" /> Email</button>
                )}
                <button onClick={handlePrint} disabled={printing} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">{printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Print</button>
                {!isNew && (
                  <div className="relative">
                    <button onClick={() => setConvertOpen((o) => !o)} disabled={convert.isPending} className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
                      {convert.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Convert <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    {convertOpen && (
                      <div className="absolute right-0 mt-1 bg-white border rounded shadow-lg z-30 min-w-[190px] py-1">
                        {([["ES", "Copy to Estimate"], ["JS", "Convert to Job Sheet"], ["SI", "Convert to Invoice"], ["CR", "Copy to Credit Note"]] as [string, string][])
                          .filter(([code]) => code !== (data as any)?.doc?.docType)
                          .map(([code, label]) => (
                            <button key={code} onClick={() => doConvert(code)} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-violet-50">{label}</button>
                          ))}
                        {(data as any)?.doc?.docType === "SI" && (
                          <>
                            <div className="border-t my-1" />
                            <button onClick={() => { setConvertOpen(false); setExcessOpen(true); }} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-violet-50 text-fuchsia-700 font-medium">Raise Policy Excess Invoice…</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {!isNew && isInvoice && (
                  <button onClick={() => setIssueOpen(true)} className="inline-flex items-center gap-1.5 bg-fuchsia-700 text-white rounded px-3 py-1.5 text-sm hover:bg-fuchsia-800"><CheckCircle2 className="w-4 h-4" /> Issue</button>
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
            <div className="flex items-center gap-3">
              {!isNew && isInvoice && (
                <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${docStatusLabel === "Not Issued" ? "bg-amber-400 text-amber-950" : docStatusLabel === "Paid" ? "bg-green-400 text-green-950" : "bg-white/90 text-violet-900"}`}>{docStatusLabel}</span>
              )}
              <span className="text-[11px] text-white/70">{editing ? "Editing" : "Read-only"}</span>
            </div>
          </div>

          {/* policy-excess banner */}
          {isExcess && (
            <div className="bg-fuchsia-50 border-b border-fuchsia-200 text-center py-2 text-[14px] font-semibold text-fuchsia-900">
              This invoice is a Policy Excess Invoice related to: Invoice {(data as any)?.doc?.relatedDocNo || relatedDoc?.docNo || "—"}
            </div>
          )}

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
                <EF label="Make / Model" field="make" upper {...{ form, set, editing }} />
                <input value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} readOnly={!editing} className={boxCls(editing) + " flex-1 self-end uppercase"} />
              </div>
              <EF label="Derivative" field="derivative" upper {...{ form, set, editing }} grow />
              <div className="flex gap-2 items-center">
                <EF label="Chassis" field="vin" upper {...{ form, set, editing }} grow />
                {form.vin && (
                  <button type="button" title="Search this VIN on PartSouq"
                    onClick={() => { navigator.clipboard?.writeText(form.vin).catch(() => {}); window.open(`https://partsouq.com/en/search/all?q=${encodeURIComponent(form.vin)}`, "_blank", "noopener"); }}
                    className="shrink-0 h-[26px] inline-flex items-center gap-1 border border-blue-200 bg-blue-50 rounded-sm px-2 text-[11px] font-medium text-blue-600 hover:bg-blue-100">
                    <ExternalLink className="w-3.5 h-3.5" /> PartSouq
                  </button>
                )}
              </div>
              <div className="flex gap-2"><EF label="Engine CC" field="engineCC" {...{ form, set, editing }} /><EF label="Fuel Type" field="fuelType" w="w-20" upper {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Engine Code" field="engineCode" upper {...{ form, set, editing }} /><EF label="Engine No" field="engineNo" w="w-20" upper {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Colour" field="colour" upper {...{ form, set, editing }} /><EF label="Paint Code" field="paintCode" w="w-20" upper {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Key Code" field="keyCode" upper {...{ form, set, editing }} /><EF label="Radio Code" field="radioCode" w="w-20" upper {...{ form, set, editing }} /></div>
              <div className="flex gap-2"><EF label="Mileage" field="mileage" {...{ form, set, editing }} /><EF label="Date Reg" field="dateOfRegistration" w="w-20" type="date" {...{ form, set, editing }} /></div>
            </div>
            {/* customer */}
            <div className="xl:col-span-4 space-y-1.5">
              {editing && (
                <>
                  <CustomerSearch onSelect={(c) => { setNewCust(false); const sn = splitName(c.name); setForm((f) => ({
                    ...f, customerId: c.id, customerName: c.name || f.customerName,
                    custTitle: sn.title, custForename: sn.forename, custSurname: sn.surname,
                    custEmail: c.email || f.custEmail, custPostcode: c.postcode || f.custPostcode,
                    custTelephone: c.phone || f.custTelephone, custRoad: c.address || f.custRoad,
                  })); }} />
                  <div className="flex items-center justify-end gap-2 -mt-0.5 pr-1">
                    {form.customerId ? (
                      <span className="text-[11px] text-muted-foreground">Linked customer #{form.customerId}</span>
                    ) : (isNew || newCust) && form.customerName ? (
                      <span className="text-[11px] text-green-700">New customer will be created</span>
                    ) : null}
                    <button type="button" onClick={() => { setNewCust(true); setForm((f) => ({ ...f, customerId: undefined, customerName: "", custTitle: "", custForename: "", custSurname: "", company: "", accountNumber: "", custHouseNo: "", custRoad: "", custLocality: "", custTown: "", custCounty: "", custPostcode: "", custTelephone: "", custMobile: "", custEmail: "" })); }}
                      className="text-[11px] text-violet-700 hover:underline inline-flex items-center gap-1"><Plus className="w-3 h-3" /> New customer</button>
                  </div>
                </>
              )}
              <EF label="Acc Number" field="accountNumber" {...{ form, set, editing }} />
              <EF label="Company" field="company" {...{ form, set, editing }} />
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[11px] text-slate-600 text-right">Name</span>
                <input value={form.custTitle ?? ""} onChange={(e) => set("custTitle", e.target.value)} readOnly={!editing} placeholder="Title" className={boxCls(editing) + " w-14"} />
                <input value={form.custForename ?? ""} onChange={(e) => set("custForename", e.target.value)} readOnly={!editing} placeholder="Forename" className={boxCls(editing) + " flex-1"} />
                <input value={form.custSurname ?? ""} onChange={(e) => set("custSurname", e.target.value)} readOnly={!editing} placeholder="Surname" className={boxCls(editing) + " flex-1"} />
              </div>
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
                <SelectField label="Sales Advisor" field="staffSalesPerson" w="w-20" options={TECHNICIANS} {...{ form, set, editing }} />
                <SelectField label="Technician" field="staffTechnician" w="w-20" options={TECHNICIANS} {...{ form, set, editing }} />
                <SelectField label="Road Tester" field="staffRoadTester" w="w-20" options={TECHNICIANS} {...{ form, set, editing }} />
              </Panel>
              {!isExcess && (
                <Panel title="Extras">
                  {/* MOT: tick to include an MOT on this job (defaults the statutory fee, editable) */}
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-[12px] text-slate-600 select-none">
                      <input type="checkbox" disabled={!editing} checked={(num(form.motAmount) || 0) > 0}
                        onChange={(e) => set("motAmount", e.target.checked ? (num(form.motAmount) ? form.motAmount : "54.85") : "")}
                        className="accent-violet-600 w-3.5 h-3.5" />
                      MOT
                    </label>
                    <input value={form.motAmount ?? ""} onChange={(e) => set("motAmount", e.target.value)} readOnly={!editing} inputMode="decimal" placeholder="0.00"
                      className="w-24 text-right border border-slate-300 rounded-sm px-2 py-[2px] text-[13px] bg-white read-only:bg-slate-50 outline-none focus:border-violet-500" />
                  </div>
                  <SelectField label="MOT Class" field="motClass" w="w-20" options={["4", "5", "7"]} {...{ form, set, editing }} />
                  <SelectField label="MOT Status" field="motStatus" w="w-20" options={["Pass", "Fail", "Retest", "Advisory"]} {...{ form, set, editing }} />
                  <SelectField label="MOT Tester" field="staffMotTester" w="w-20" options={TECHNICIANS} {...{ form, set, editing }} />
                  <div className="border-t my-1.5" />
                  <AmountField label="Sundries" field="sundriesAmount" {...{ form, set, editing }} />
                  <AmountField label="Lubricants" field="lubricantsAmount" {...{ form, set, editing }} />
                  <AmountField label="Paint & Mat." field="paintAmount" {...{ form, set, editing }} />
                </Panel>
              )}
              {isExcess && <ExcessPanel doc={(data as any)?.doc} onSaved={() => utils.documents.getById.invalidate({ id })} />}
              {isExcess && relatedDoc && (
                <Panel title="Insurance Invoice">
                  <button onClick={() => setLocation(`/documents/${relatedDoc.id}`)} className="w-full text-left flex justify-between text-[13px] text-violet-700 hover:underline">
                    <span>Doc No</span><span className="font-semibold">{relatedDoc.docNo}</span>
                  </button>
                  <div className="flex justify-between text-[12px] mt-1"><span className="text-slate-600">Total</span><span>£{money(relatedDoc.totalGross)}</span></div>
                  <div className="flex justify-between text-[12px]"><span className="text-slate-600">Receipts</span><span>£{money(relatedDoc.totalReceipts)}</span></div>
                  <div className="flex justify-between text-[12px]"><span className="text-slate-600">Balance</span><span>£{money(relatedDoc.balance)}</span></div>
                </Panel>
              )}
              {!isExcess && relatedDoc && (
                <Panel title="Policy Excess Invoice">
                  <button onClick={() => setLocation(`/documents/${relatedDoc.id}`)} className="w-full text-left flex justify-between text-[13px] text-fuchsia-700 hover:underline">
                    <span>Doc No</span><span className="font-semibold">{relatedDoc.docNo}</span>
                  </button>
                  <div className="flex justify-between text-[12px] mt-1"><span className="text-slate-600">Excess (gross)</span><span>£{money((data as any)?.doc?.excessGross)}</span></div>
                  <p className="text-[10.5px] text-slate-500 mt-1">Deducted from the amount payable by the insurer.</p>
                </Panel>
              )}
              {!isNew && (
                <Panel title="Account">
                  <div className="flex justify-between text-[12px]"><span className="text-slate-600">Veh Last Invoiced</span><span>{fmtDate((data as any)?.vehLastInvoiced) || "—"}</span></div>
                  <div className="flex justify-between text-[12px]"><span className="text-slate-600">Cust Last Invoiced</span><span>{fmtDate((data as any)?.custLastInvoiced) || "—"}</span></div>
                  <div className="flex justify-between text-[13px] font-semibold border-t pt-1 mt-1"><span className="text-slate-600">Acc Balance</span><span className={((data as any)?.accBalance || 0) > 0 ? "text-red-600" : ""}>£{money((data as any)?.accBalance)}</span></div>
                </Panel>
              )}
            </div>
          </div>

          {/* vehicle info cards (pulled from MOT/SWS lookup) */}
          {(vehInfo.oilSpec || vehInfo.airconType || form.mileage || vehInfo.motExpiry || vehInfo.taxStatus) && (
            <div className="px-3 pt-1 pb-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
              <InfoCard icon={<Droplet className="w-4 h-4" />} tone="amber" label="Engine Oil"
                main={vehInfo.oilSpec || "—"} sub={vehInfo.oilCapacity ? `Capacity ${vehInfo.oilCapacity}` : undefined} />
              <InfoCard icon={<Snowflake className="w-4 h-4" />} tone="sky" label="Air Con"
                main={vehInfo.airconType || "—"} sub={fmtGasQty(vehInfo.airconCapacity)} />
              <InfoCard icon={<Gauge className="w-4 h-4" />} tone="slate" label="Mileage"
                main={form.mileage ? Number(form.mileage).toLocaleString("en-GB") : "—"} sub={form.mileage ? "miles (last)" : undefined} />
              <InfoCard icon={<CalendarClock className="w-4 h-4" />} tone={motTone(vehInfo.motExpiry)} label="MOT Expiry"
                main={vehInfo.motExpiry ? fmtDate(vehInfo.motExpiry) : "—"} sub={daysLabel(vehInfo.motExpiry)} />
              <InfoCard icon={<ShieldCheck className="w-4 h-4" />} tone={vehInfo.taxStatus && /tax/i.test(vehInfo.taxStatus) && !/not/i.test(vehInfo.taxStatus) ? "green" : vehInfo.taxStatus ? "red" : "slate"} label="Tax"
                main={vehInfo.taxStatus || "—"} sub={vehInfo.taxDueDate ? `Due ${fmtDate(vehInfo.taxDueDate)}` : undefined} />
            </div>
          )}

          {/* body: tabs + totals */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 px-3 pb-3">
            <div className="xl:col-span-9">
              <Tabs defaultValue="description">
                <TabsList className="w-full justify-start rounded-none bg-slate-700 p-0 h-auto">
                  {[["description", "Description"], ["labour", "Labour"], ["parts", "Parts"], ["advisories", "Advisories"], ["partsHistory", "Prev Parts"], ["mileage", "Mileage"], ["log", "Log"], ["history", `History (${history.length})`]].map(([v, label]) => (
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
                  <TabsContent value="mileage" className="mt-0"><MileageTab registration={form.registration} /></TabsContent>
                  <TabsContent value="log" className="mt-0"><CustomerLog customerId={(data as any)?.doc?.customerId ?? (data as any)?.customer?.id} vehicleId={(data as any)?.doc?.vehicleId} documentId={(data as any)?.doc?.id} /></TabsContent>
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
                <TRow label="SubTotal" value={liveTotals.subTotal} />
                <TRow label="VAT" value={liveTotals.vat} />
                <TRow label="MOT" value={liveTotals.motGross} />
                <TRow label="Total" value={liveTotals.gross} bold />
                {(isInvoice || excessDeduction > 0 || docReceipts > 0) && (
                  <div className="border-t mt-1 pt-1 space-y-1.5">
                    {!isExcess && <TRow label="Excess" value={excessDeduction} />}
                    <TRow label="Receipts" value={docReceipts} bold />
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-[12px] font-semibold text-slate-700">Balance</span>
                      <div className={`w-24 text-right border border-slate-300 rounded-sm px-2 py-[2px] text-[13px] font-bold ${docBalance > 0 ? "bg-yellow-100" : "bg-white"}`}>{money(docBalance)}</div>
                    </div>
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </div>

        {/* email dialog */}
        {emailOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEmailOpen(false)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2"><Mail className="w-5 h-5" /> Email document</h3>
                <button onClick={() => setEmailOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
              </div>
              <p className="text-xs text-muted-foreground">The {TYPE_LABEL[(data as any)?.doc?.docType] || "document"} PDF will be attached automatically.</p>
              <div>
                <label className="text-xs text-muted-foreground">Template</label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-0.5" defaultValue=""
                  onChange={(e) => { const t = EMAIL_TEMPLATES.find((x) => x.name === e.target.value); if (t) setEmailForm((f) => ({ ...f, ...applyTemplate(t, emailCtx()) })); }}>
                  <option value="" disabled>Choose a template…</option>
                  {EMAIL_TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">To</label>
                <input className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 outline-none focus:border-violet-500" value={emailForm.to} onChange={(e) => setEmailForm((f) => ({ ...f, to: e.target.value }))} placeholder="customer@email.com" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Subject</label>
                <input className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 outline-none focus:border-violet-500" value={emailForm.subject} onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Message</label>
                <textarea rows={8} className="w-full border rounded px-2 py-1.5 text-sm mt-0.5 resize-y outline-none focus:border-violet-500" value={emailForm.message} onChange={(e) => setEmailForm((f) => ({ ...f, message: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEmailOpen(false)} className="border rounded px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
                <button onClick={sendEmail} disabled={emailMut.isPending} className="bg-violet-700 text-white rounded px-4 py-1.5 text-sm hover:bg-violet-800 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {emailMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* issue invoice / add payments dialog */}
        {issueOpen && (
          <IssueDialog id={id} docNo={docNo} statusLabel={docStatusLabel} gross={liveTotals.gross} customerId={(data as any)?.doc?.customerId}
            payments={(data as any)?.payments || []} onClose={() => setIssueOpen(false)} onIssue={doIssue} issuing={issueMut.isPending}
            onChanged={() => utils.documents.getById.invalidate({ id })} />
        )}

        {/* raise policy excess dialog */}
        {excessOpen && (
          <ExcessCreateDialog mainDocNo={docNo} pending={createExcessMut.isPending} onClose={() => setExcessOpen(false)} onCreate={doCreateExcess} />
        )}

      </div>
    </DashboardLayout>
  );
}

const boxCls = (editing: boolean) =>
  `min-w-0 bg-white border border-slate-300 rounded-sm px-2 py-[3px] text-[13px] h-[26px] truncate outline-none ${editing ? "focus:border-violet-500" : "read-only:bg-slate-50"}`;

function AmountField({ label, field, form, set, editing }: { label: string; field: string; form: Record<string, any>; set: (k: string, v: any) => void; editing: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-slate-600">{label}</span>
      <input value={form[field] ?? ""} onChange={(e) => set(field, e.target.value)} readOnly={!editing} inputMode="decimal" placeholder="0.00"
        className="w-24 text-right border border-slate-300 rounded-sm px-2 py-[2px] text-[13px] bg-white read-only:bg-slate-50 outline-none focus:border-violet-500" />
    </div>
  );
}

const PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Cheque", "Account", "Online"];

function IssueDialog({ id, docNo, statusLabel, gross, customerId, payments, onClose, onIssue, issuing, onChanged }: {
  id: number; docNo?: string; statusLabel: string; gross: number; customerId?: number; payments: any[];
  onClose: () => void; onIssue: (after: "none" | "print" | "email" | "both") => void; issuing: boolean; onChanged: () => void;
}) {
  const addP = trpc.documents.addPayment.useMutation();
  const delP = trpc.documents.deletePayment.useMutation();
  const [method, setMethod] = useState("Cash");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const paid = (payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const outstanding = +(gross - paid).toFixed(2);
  async function add() {
    const amt = num(amount); if (!amt) { toast.error("Enter a payment amount"); return; }
    try { await addP.mutateAsync({ documentId: id, customerId: customerId ?? null, method, amount: amt, note: note || undefined }); setAmount(""); setNote(""); onChanged(); toast.success("Payment recorded"); }
    catch (e: any) { toast.error("Add payment failed: " + (e.message || "")); }
  }
  async function remove(pid: number) { try { await delP.mutateAsync({ id: pid }); onChanged(); } catch (e: any) { toast.error(e.message); } }
  const issueBtns: [string, "print" | "email" | "both" | "none"][] = [["Issue & Print", "print"], ["Issue & Email", "email"], ["Issue Print & Email", "both"], ["Issue Only", "none"]];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <h3 className="font-semibold">Issue Invoice / Add Payments {docNo ? `· ${docNo}` : ""} <span className={`ml-1 text-[12px] ${statusLabel === "Not Issued" ? "text-amber-300" : "text-green-300"}`}>{statusLabel}</span></h3>
          <button onClick={onClose} className="bg-fuchsia-700 hover:bg-fuchsia-800 rounded p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex border-b bg-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm hover:bg-slate-200 border-r">Close</button>
          {issueBtns.map(([label, after]) => (
            <button key={after} onClick={() => onIssue(after)} disabled={issuing} className="px-4 py-2 text-sm hover:bg-violet-100 border-r disabled:opacity-50 inline-flex items-center gap-1.5">
              {issuing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{label}
            </button>
          ))}
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm text-slate-600 pt-2">
              {outstanding <= 0 ? <p>The invoice balance is zero.<br />No further payments are required.</p>
                : <p>Record any payments taken below,<br />then issue the invoice.</p>}
            </div>
            <div className="border rounded-md px-5 py-3 text-center min-w-[180px]">
              <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Outstanding Balance</div>
              <div className={`text-2xl font-bold ${outstanding > 0 ? "text-red-600" : "text-green-600"}`}>£{money(outstanding)}</div>
            </div>
          </div>
          {/* add a payment */}
          <div className="mt-4 flex items-end gap-2 flex-wrap">
            <label className="text-xs text-slate-600">Method
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="block border rounded px-2 py-1.5 text-sm mt-0.5 w-36">{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="text-xs text-slate-600">Amount £
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={outstanding > 0 ? money(outstanding) : "0.00"} className="block border rounded px-2 py-1.5 text-sm mt-0.5 w-28 text-right outline-none focus:border-violet-500" />
            </label>
            <label className="text-xs text-slate-600 flex-1 min-w-[140px]">Note
              <input value={note} onChange={(e) => setNote(e.target.value)} className="block border rounded px-2 py-1.5 text-sm mt-0.5 w-full outline-none focus:border-violet-500" />
            </label>
            <button onClick={add} disabled={addP.isPending} className="bg-violet-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50 inline-flex items-center gap-1.5">{addP.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add</button>
          </div>
        </div>
        {/* payments list */}
        <div className="border-t">
          <div className="bg-slate-700 text-white px-4 py-1.5 text-sm font-semibold">Payments</div>
          <div className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] text-[12px] font-semibold text-slate-500 px-4 py-1 border-b">
            <span>Method</span><span>Date</span><span className="text-right">Amount</span><span>Note</span><span />
          </div>
          {(payments || []).length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No payments recorded.</p>
            : (payments || []).map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] text-[13px] px-4 py-1.5 border-b last:border-0 items-center">
                <span>{p.method}</span><span>{fmtDate(p.paymentDate)}</span><span className="text-right">£{money(p.amount)}</span>
                <span className="truncate text-slate-500">{p.note || ""}</span>
                <button onClick={() => remove(p.id)} className="text-red-500 hover:text-red-700 justify-self-end"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function ExcessCreateDialog({ mainDocNo, pending, onClose, onCreate }: { mainDocNo?: string; pending: boolean; onClose: () => void; onCreate: (a: { excessNet: number; discount: number; vatRegistered: boolean }) => void }) {
  const [vatReg, setVatReg] = useState(false);
  const [excess, setExcess] = useState("");
  const [discount, setDiscount] = useState("");
  const net = Math.max(0, (num(excess) || 0) - (num(discount) || 0));
  const vat = vatReg ? +(net * 0.2).toFixed(2) : 0;
  const gross = +(net + vat).toFixed(2);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Raise Policy Excess Invoice</h3>
          <button onClick={onClose} className="bg-fuchsia-700 hover:bg-fuchsia-800 rounded p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-center text-[14px] font-semibold text-fuchsia-900">This excess invoice will relate to: Invoice {mainDocNo || "—"}</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">Is the customer VAT registered?</span>
            <div className="flex rounded overflow-hidden border">
              <button onClick={() => setVatReg(true)} className={`px-4 py-1 text-sm ${vatReg ? "bg-fuchsia-700 text-white" : "bg-slate-100"}`}>Y</button>
              <button onClick={() => setVatReg(false)} className={`px-4 py-1 text-sm ${!vatReg ? "bg-fuchsia-700 text-white" : "bg-slate-100"}`}>N</button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">Insurance Policy Excess</span>
            <input value={excess} onChange={(e) => setExcess(e.target.value)} placeholder="0.00" className="w-32 text-right border rounded px-2 py-1.5 text-sm outline-none focus:border-violet-500" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">Discount Amount</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" className="w-32 text-right border rounded px-2 py-1.5 text-sm outline-none focus:border-violet-500" />
          </div>
          <p className="text-[12px] italic text-slate-500">This discount only applies to the policy excess NET figure. It will discount the excess invoice, without it showing a discount on the insurance invoice.</p>
          <div className="bg-slate-50 border rounded p-3 text-[13px] space-y-1">
            <div className="flex justify-between"><span className="text-slate-600">Excess NET</span><span>£{money(net)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">VAT {vatReg ? "(20%)" : "(0%)"}</span><span>£{money(vat)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-1"><span>Excess invoice total</span><span>£{money(gross)}</span></div>
          </div>
          <p className="text-[12px] text-slate-500 border-t pt-2">The excess amount will automatically be deducted from the main invoice to the insurance company.</p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="border rounded px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
            <button onClick={() => onCreate({ excessNet: num(excess) || 0, discount: num(discount) || 0, vatRegistered: vatReg })} disabled={pending || net <= 0} className="bg-fuchsia-700 text-white rounded px-4 py-1.5 text-sm hover:bg-fuchsia-800 disabled:opacity-50 inline-flex items-center gap-1.5">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Create Excess Invoice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExcessPanel({ doc, onSaved }: { doc: any; onSaved: () => void }) {
  const upd = trpc.documents.updateExcess.useMutation();
  const [vatReg, setVatReg] = useState(!!doc?.custVatRegistered);
  const [excess, setExcess] = useState(String((((Number(doc?.excessNet) || 0) + (Number(doc?.excessDiscount) || 0))).toFixed(2)));
  const [discount, setDiscount] = useState(String((Number(doc?.excessDiscount) || 0).toFixed(2)));
  const net = Math.max(0, (num(excess) || 0) - (num(discount) || 0));
  const vat = vatReg ? +(net * 0.2).toFixed(2) : 0;
  const gross = +(net + vat).toFixed(2);
  async function apply() {
    try { await upd.mutateAsync({ docId: doc.id, excessNet: num(excess) || 0, discount: num(discount) || 0, vatRegistered: vatReg }); onSaved(); toast.success("Excess updated"); }
    catch (e: any) { toast.error("Update failed: " + (e.message || "")); }
  }
  return (
    <Panel title="Policy Excess">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-600">Customer VAT registered?</span>
        <div className="flex rounded overflow-hidden border text-[12px]">
          <button onClick={() => setVatReg(true)} className={`px-3 py-0.5 ${vatReg ? "bg-fuchsia-700 text-white" : "bg-white"}`}>Y</button>
          <button onClick={() => setVatReg(false)} className={`px-3 py-0.5 ${!vatReg ? "bg-fuchsia-700 text-white" : "bg-white"}`}>N</button>
        </div>
      </div>
      <div className="flex items-center justify-between"><span className="text-[12px] text-slate-600">Policy Excess</span>
        <input value={excess} onChange={(e) => setExcess(e.target.value)} className="w-24 text-right border border-slate-300 rounded-sm px-2 py-[2px] text-[13px]" /></div>
      <div className="flex items-center justify-between"><span className="text-[12px] text-slate-600">Discount</span>
        <input value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-24 text-right border border-slate-300 rounded-sm px-2 py-[2px] text-[13px]" /></div>
      <div className="border-t pt-1 mt-1 space-y-0.5">
        <div className="flex justify-between text-[12px]"><span className="text-slate-600">NET</span><span>£{money(net)}</span></div>
        <div className="flex justify-between text-[12px]"><span className="text-slate-600">VAT</span><span>£{money(vat)}</span></div>
        <div className="flex justify-between text-[13px] font-semibold"><span>Total</span><span>£{money(gross)}</span></div>
      </div>
      <button onClick={apply} disabled={upd.isPending} className="w-full mt-1 bg-fuchsia-700 text-white rounded px-3 py-1 text-[13px] disabled:opacity-50 inline-flex items-center justify-center gap-1.5">{upd.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Apply</button>
    </Panel>
  );
}

function EF({ label, field, form, set, editing, w = "w-24", grow, type = "text", upper }: { label: string; field: string; form: Record<string, any>; set: (k: string, v: any) => void; editing: boolean; w?: string; grow?: boolean; type?: string; upper?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${grow ? "flex-1" : ""}`}>
      <span className={`${w} shrink-0 text-[11px] text-slate-600 text-right`}>{label}</span>
      <input type={type} value={form[field] ?? ""} onChange={(e) => set(field, e.target.value)} readOnly={!editing} className={boxCls(editing) + " flex-1" + (upper ? " uppercase" : "")} />
    </div>
  );
}

function SelectField({ label, field, form, set, editing, options, w = "w-24" }: { label: string; field: string; form: Record<string, any>; set: (k: string, v: any) => void; editing: boolean; options: string[]; w?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`${w} shrink-0 text-[11px] text-slate-600 text-right`}>{label}</span>
      <select value={form[field] ?? ""} onChange={(e) => set(field, e.target.value)} disabled={!editing} className={boxCls(editing) + " flex-1 disabled:bg-slate-50 disabled:text-slate-700"}>
        <option value=""></option>
        {(form[field] && !options.includes(form[field]) ? [form[field], ...options] : options).map((o) => <option key={o} value={o}>{o}</option>)}
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

function MileageTab({ registration }: { registration?: string }) {
  const reg = (registration || "").trim();
  const { data, isLoading } = trpc.documents.motTests.useQuery({ registration: reg }, { enabled: !!reg });
  if (!reg) return <p className="text-sm text-muted-foreground py-6 text-center">No registration on this document.</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground py-6 text-center">Loading MOT mileage history…</p>;
  const tests = ((data as any[]) || []);
  const withOdo = tests
    .filter((t) => t.odometerValue != null && !isNaN(Number(t.odometerValue)))
    .sort((a, b) => new Date(b.completedDate).getTime() - new Date(a.completedDate).getTime());
  if (withOdo.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">No MOT mileage history found for {reg}.</p>;
  return (
    <div>
      <MOTMileageChart tests={tests} />
      <Table>
        <TableHeader><TableRow>
          <TableHead className="h-8">Test Date</TableHead><TableHead className="h-8">Result</TableHead>
          <TableHead className="h-8 text-right">Odometer</TableHead><TableHead className="h-8 text-right">Change</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {withOdo.map((t, i) => {
            const next = withOdo[i + 1]; // the previous (older) test
            const cur = Number(t.odometerValue), prev = next ? Number(next.odometerValue) : null;
            const delta = prev != null ? cur - prev : null;
            const pass = /pass/i.test(t.testResult || "");
            return (
              <TableRow key={i}>
                <TableCell>{fmtDate(t.completedDate)}</TableCell>
                <TableCell><span className={pass ? "text-green-700" : "text-red-600"}>{(t.testResult || "").replace(/_/g, " ")}</span></TableCell>
                <TableCell className="text-right">{cur.toLocaleString("en-GB")} {t.odometerUnit === "km" ? "km" : "mi"}</TableCell>
                <TableCell className="text-right">{delta != null && delta > 0 ? `+${delta.toLocaleString("en-GB")}` : delta != null && delta < 0 ? delta.toLocaleString("en-GB") : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function logIcon(type: string, direction: string) {
  if (type === "email") return <Mail className="w-3.5 h-3.5" />;
  if (type === "call") return <Phone className="w-3.5 h-3.5" />;
  if (type === "note") return <StickyNote className="w-3.5 h-3.5" />;
  if (direction === "in") return <ArrowDownLeft className="w-3.5 h-3.5" />;
  return <MessageSquare className="w-3.5 h-3.5" />;
}
const LOG_TONE: Record<string, string> = {
  in: "bg-green-100 text-green-700",
  out: "bg-violet-100 text-violet-700",
  internal: "bg-slate-100 text-slate-600",
};
function fmtDateTime(d: any) { return d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; }

function CustomerLog({ customerId, vehicleId, documentId }: { customerId?: number; vehicleId?: number; documentId?: number }) {
  const utils = trpc.useUtils();
  const enabled = !!customerId || !!vehicleId;
  const { data: log, isLoading } = trpc.documents.customerLog.useQuery({ customerId, vehicleId }, { enabled });
  const addLog = trpc.documents.addLog.useMutation();
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"note" | "call" | "letter">("note");

  if (!enabled) return <p className="text-sm text-muted-foreground py-6 text-center">No customer linked to this document.</p>;

  async function add() {
    const body = note.trim();
    if (!body) return;
    await addLog.mutateAsync({ customerId, vehicleId, documentId, type: kind, direction: kind === "note" ? "internal" : "out", body });
    setNote("");
    await utils.documents.customerLog.invalidate();
    toast.success("Logged");
  }

  const entries = (log as any[]) || [];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="border border-slate-300 rounded-sm px-2 py-1.5 text-[13px] bg-white">
          <option value="note">Note</option>
          <option value="call">Phone call</option>
          <option value="letter">Letter</option>
        </select>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note or log a call / letter…"
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add(); }}
          className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-[13px] outline-none focus:border-violet-500 resize-y" />
        <button onClick={add} disabled={addLog.isPending || !note.trim()} className="bg-violet-700 text-white rounded px-3 py-1.5 text-[13px] disabled:opacity-50 inline-flex items-center gap-1.5 self-stretch">
          {addLog.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
        </button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        : entries.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No communication logged for this customer yet.</p>
        : (
          <ol className="relative border-l border-slate-200 ml-3 space-y-3">
            {entries.map((e) => (
              <li key={e.key} className="ml-4">
                <span className={`absolute -left-[11px] flex items-center justify-center w-[22px] h-[22px] rounded-full ring-4 ring-white ${LOG_TONE[e.direction] || LOG_TONE.internal}`}>{logIcon(e.type, e.direction)}</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-slate-800">{e.title}</span>
                  {e.status && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{e.status}</span>}
                  <span className="text-[11px] text-muted-foreground">{fmtDateTime(e.date)}</span>
                  {e.createdBy && <span className="text-[11px] text-muted-foreground">· {e.createdBy}</span>}
                </div>
                {e.body && <p className="text-[12.5px] text-slate-600 whitespace-pre-wrap mt-0.5">{e.body}</p>}
              </li>
            ))}
          </ol>
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
  const KIND_NOUN: Record<string, string> = { Part: "parts", Labour: "labour", Sundries: "sundries", Paint: "paint & materials", Lubricant: "lubricants", Other: "advisories" };
  const noun = KIND_NOUN[kind] || "lines";
  const showPartNo = kind === "Part" || kind === "Lubricant";

  if (!editing && rows.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">No {noun}.</p>;
  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            {showPartNo && <TableHead className="h-8">{kind === "Lubricant" ? "Code" : "Part No"}</TableHead>}
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
                {showPartNo && <TableCell>{editing ? <input className={inp} value={it.partNumber ?? ""} onChange={(e) => update(idx, { partNumber: e.target.value })} /> : <span className="font-mono text-xs">{it.partNumber || "—"}</span>}</TableCell>}
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
      {editing && <button onClick={add} className="mt-2 inline-flex items-center gap-1.5 text-sm text-violet-700 hover:underline"><Plus className="w-4 h-4" /> Add {kind === "Labour" ? "labour" : kind === "Part" ? "part" : "line"}</button>}
    </div>
  );
}
