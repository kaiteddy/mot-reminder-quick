import { useParams } from "wouter";
import { useClassicBase } from "@/lib/classicNav";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Phone, MapPin, User, ArrowLeft, Car, History, FileText, Pencil, Send, Plus, DollarSign, Trash2, ChevronDown, ArrowLeftRight, UserX } from "lucide-react";
import { AssignCustomerDialog } from "@/components/CustomerInfoCard";
import DashboardLayout from "@/components/DashboardLayout";
import { Link } from "wouter";
import { RegPlate } from "@/components/RegPlate";
import { format } from "date-fns";
import { useState, useEffect, useRef, Fragment } from "react";
import { DOC_TYPE_TAILWIND } from "@/lib/docType";
import { workSummary } from "@/lib/workSummary";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ServiceHistory } from "@/components/ServiceHistory";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const parseContacts = (emailStr?: string | null, phoneStr?: string | null) => {
    const results: { type: 'phone' | 'email', value: string, tag: string, original: string }[] = [];

    const processString = (input: string, defaultType: 'phone' | 'email') => {
        // Split by common separators: comma, slash, semicolon, newline, or multiple spaces that might act as separators
        const items = input.split(/[,/;\n]|\s{2,}/).map(s => s.trim()).filter(Boolean);

        for (const item of items) {
            // Check for email first
            const emailMatch = item.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) {
                let tag = item.replace(emailMatch[0], '').trim();
                tag = tag.replace(/^[-()|:]+|[-()|:]+$/g, '').trim();
                results.push({ type: 'email', value: emailMatch[0], tag, original: item });
                continue;
            }

            // Check for phone (at least 8 contiguous-ish digits/spaces/plus/hyphens ending and starting with digit or plus)
            const phoneMatch = item.match(/(\+?\d[\d\s\-\(\)]{6,}\d)/);
            if (phoneMatch) {
                let tag = item.replace(phoneMatch[0], '').trim();
                tag = tag.replace(/^[-()|:]+|[-()|:]+$/g, '').trim();
                results.push({ type: 'phone', value: phoneMatch[0].trim(), tag, original: item });
                continue;
            }

            // Fallback
            results.push({ type: defaultType, value: item, tag: "", original: item });
        }
    };

    if (emailStr) processString(emailStr, 'email');
    if (phoneStr) processString(phoneStr, 'phone');

    return results;
};

// One row in the customer's service-history list. Collapsed it shows the summary;
// expanded it lazily loads the document's line items and lays them out like a job
// card — Labour and Parts & Consumables broken out — so it's easy to see exactly
// what was done and which parts were fitted on each visit.
const HISTORY_TYPE_LABEL: Record<string, string> = { SI: "Invoice", ES: "Estimate", JS: "Job Sheet", XS: "Excess", CR: "Credit Note" };

// Clickable column header for the service-history table — click to sort, click again to flip.
function HistSortHead({ label, k, sort, onSort, align }: { label: string; k: string; sort: { key: string; dir: "asc" | "desc" }; onSort: (k: string) => void; align?: "right" }) {
    const active = sort.key === k;
    return (
        <TableHead className={`h-8 ${align === "right" ? "text-right" : ""}`}>
            <button type="button" onClick={() => onSort(k)}
                className={`inline-flex items-center gap-0.5 select-none hover:text-foreground ${active ? "text-foreground font-semibold" : ""}`}>
                {label}
                <ChevronDown className={`w-3 h-3 transition-transform ${active ? (sort.dir === "asc" ? "rotate-180" : "") : "opacity-30"}`} />
            </button>
        </TableHead>
    );
}

function HistoryActivityRow({ h, onOpenFull }: { h: any; onOpenFull: () => void }) {
    const [open, setOpen] = useState(false);
    const { data: items, isLoading } = trpc.serviceHistory.getLineItems.useQuery(
        { documentId: h.id },
        { enabled: open, staleTime: 60_000 }
    );

    const sub = (i: any) => Number(i.subNet ?? (Number(i.quantity || 0) * Number(i.unitPrice || 0)));
    const labour = (items || []).filter((i: any) => i.itemType === "Labour");
    const parts = (items || []).filter((i: any) => i.itemType === "Part");
    const others = (items || []).filter((i: any) => i.itemType !== "Labour" && i.itemType !== "Part");
    const fullDescription = h.description || h.mainDescription;
    const w = workSummary(h.mainDescription || h.description);

    return (
        <>
            <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen((o) => !o)}>
                <TableCell className="py-1.5 whitespace-nowrap text-[13px]">
                    <span className="font-semibold text-slate-800">{format(new Date(h.dateCreated), "dd/MM/yy")}</span>
                </TableCell>
                <TableCell className="py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${DOC_TYPE_TAILWIND[h.docType] || "bg-slate-100 text-slate-700"}`}>{HISTORY_TYPE_LABEL[h.docType] || h.docType}</span>
                </TableCell>
                <TableCell className="py-1.5 text-[13px] font-semibold text-slate-800 whitespace-nowrap">
                    {h.docNo || h.id}
                    {!h.viaAccountSame && <span className="ml-1.5 bg-amber-50 text-amber-700 text-[10px] px-1.5 py-0.5 rounded border border-amber-200" title="Same person, different GA4 account — shown here because it shares this customer's phone number">via {h.viaAccountNumber || `#${h.viaAccountId}`}</span>}
                </TableCell>
                <TableCell className="py-1.5">
                    {h.registration ? <RegPlate reg={h.registration} size="xs" /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="py-1.5 max-w-[320px]">
                    <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
                        {(w?.badges || []).map((b: any) => (
                            <span key={b.label} className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span>
                        ))}
                        <span className="truncate text-xs text-muted-foreground" title={fullDescription || undefined}>{w?.summary || h.mainDescription || "—"}</span>
                    </div>
                </TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap">
                    {Number(h.balance || 0) > 0
                        ? <span className="bg-red-50 text-red-700 text-[11px] px-1.5 py-0.5 rounded border border-red-200 font-semibold tabular-nums">£{Number(h.balance).toFixed(2)}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                </TableCell>
                <TableCell className="py-1.5 text-right text-[13px] font-bold tabular-nums whitespace-nowrap">£{Number(h.totalGross || 0).toFixed(2)}</TableCell>
                <TableCell className="py-1.5 w-6">
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                </TableCell>
            </TableRow>
            {open && (
                <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="p-0">{renderDetails()}</TableCell>
                </TableRow>
            )}
        </>
    );

    function renderDetails() {
        return (

                <div className="border-t bg-muted/20 px-4 py-3">
                    {isLoading ? (
                        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : (
                        <div className="space-y-4">
                            {fullDescription && (
                                <div className="text-xs text-slate-600 whitespace-pre-wrap bg-white rounded-md border p-2.5">{fullDescription}</div>
                            )}

                            {labour.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-black uppercase text-blue-600 mb-1.5 tracking-wider flex items-center gap-2">Labour<div className="h-px flex-1 bg-blue-100" /></h4>
                                    <div className="space-y-0.5">
                                        {labour.map((item: any) => (
                                            <div key={item.id} className="flex justify-between gap-3 text-[12px] py-1 border-b border-slate-100 last:border-0">
                                                <span className="text-slate-600 flex-1">{item.description}</span>
                                                <span className="font-semibold text-slate-900 shrink-0">£{sub(item).toFixed(2)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {parts.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-black uppercase text-orange-600 mb-1.5 tracking-wider flex items-center gap-2">Parts &amp; Consumables<div className="h-px flex-1 bg-orange-100" /></h4>
                                    <div className="space-y-0.5">
                                        {parts.map((item: any) => (
                                            <div key={item.id} className="flex justify-between gap-3 text-[12px] py-1 border-b border-slate-100 last:border-0">
                                                <span className="text-slate-600 flex-1">{item.description}</span>
                                                <div className="text-right shrink-0">
                                                    <span className="text-[10px] text-slate-400 mr-2">{Number(item.quantity || 0)} x £{Number(item.unitPrice || 0).toFixed(2)}</span>
                                                    <span className="font-semibold text-slate-900">£{sub(item).toFixed(2)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {others.length > 0 && (
                                <div>
                                    <h4 className="text-[10px] font-black uppercase text-slate-500 mb-1.5 tracking-wider flex items-center gap-2">Other<div className="h-px flex-1 bg-slate-100" /></h4>
                                    <div className="space-y-0.5">
                                        {others.map((item: any) => (
                                            <div key={item.id} className="flex justify-between gap-3 text-[12px] py-1 border-b border-slate-100 last:border-0">
                                                <span className="text-slate-600 flex-1">{item.description}{item.itemType ? <span className="text-slate-400"> · {item.itemType}</span> : null}</span>
                                                <span className="font-semibold text-slate-900 shrink-0">£{sub(item).toFixed(2)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {!isLoading && (items?.length ?? 0) === 0 && !fullDescription && (
                                <div className="text-center text-xs text-muted-foreground py-2 italic">No itemised parts or labour recorded on this document.</div>
                            )}

                            <div className="flex items-center justify-between pt-1">
                                <button type="button" onClick={onOpenFull} className="text-xs text-blue-600 hover:underline font-medium">Open full record →</button>
                                <div className="text-sm font-bold">Total £{Number(h.totalGross || 0).toFixed(2)}</div>
                            </div>
                        </div>
                    )}
                </div>
        );
    }
}

// Extra phone numbers kept on the customer record (altContacts: [{ name, phone }]).
// Names are optional — nameless numbers are preserved. Auto-saves (debounced) so a
// number can't be lost by navigating away. Reuses the same tRPC endpoints the job
// sheet's "Other numbers" editor uses.
function AdditionalNumbers({ customerId }: { customerId: number }) {
    const utils = trpc.useUtils();
    const { data: serverContacts } = trpc.customers.contacts.useQuery(
        { customerId },
        { enabled: !!customerId, staleTime: 30_000 }
    );
    const [rows, setRows] = useState<{ name: string; phone: string }[]>([]);
    const [dirty, setDirty] = useState(false);
    const loadedFor = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (customerId && serverContacts !== undefined && loadedFor.current !== customerId) {
            setRows(Array.isArray(serverContacts) ? (serverContacts as any[]).map((c) => ({ name: c.name || "", phone: c.phone || "" })) : []);
            setDirty(false);
            loadedFor.current = customerId;
        }
    }, [serverContacts, customerId]);

    const save = trpc.customers.saveContacts.useMutation({
        onSuccess: () => { setDirty(false); utils.customers.contacts.invalidate(); },
        onError: (e: any) => toast.error(e.message || "Couldn't save numbers"),
    });

    // Auto-save (debounced) whenever the list changes — matches the job sheet, so a
    // number added here can't be lost by navigating away.
    useEffect(() => {
        if (!dirty || !customerId) return;
        const t = setTimeout(() => save.mutate({ customerId, contacts: rows }), 700);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, dirty, customerId]);

    const upd = (i: number, k: "name" | "phone", v: string) => {
        setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
        setDirty(true);
    };
    const add = () => { setRows((p) => [...p, { name: "", phone: "" }]); setDirty(true); };
    const remove = (i: number) => { setRows((p) => p.filter((_, j) => j !== i)); setDirty(true); };

    return (
        <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Additional numbers</span>
                {(dirty || save.isPending)
                    ? <span className="text-[11px] text-violet-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
                    : save.isSuccess ? <span className="text-[11px] text-green-600">Saved ✓</span> : null}
            </div>
            <div className="space-y-2">
                {rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <Input value={r.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="Name (optional)" className="w-28 shrink-0 h-8 text-sm" />
                        <Input value={r.phone} onChange={(e) => upd(i, "phone", e.target.value)} placeholder="Phone number" className="flex-1 h-8 text-sm" />
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-red-500 hover:text-red-700" onClick={() => remove(i)}>
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                ))}
                {rows.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No additional numbers yet.</p>
                )}
            </div>
            <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 px-2 text-violet-700 hover:text-violet-800" onClick={add}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add number
            </Button>
        </div>
    );
}

export default function CustomerDetails() {
    const params = useParams<{ id: string }>();
    const base = useClassicBase();
    const id = params?.id ? parseInt(params.id) : 0;

    const { data, isLoading, error, refetch } = trpc.customers.getById.useQuery(
        { id },
        { enabled: !!id }
    );

    // Merging linked accounts (same phone, different GA4 account number — the Duplicates page
    // won't auto-merge these, so this is a deliberate, explicitly-confirmed override).
    const [mergeOpen, setMergeOpen] = useState(false);
    const mergeMutation = trpc.customers.merge.useMutation({
        onSuccess: (r: any) => {
            toast.success(`Merged into "${r.name}"`);
            setMergeOpen(false);
            refetch();
        },
        onError: (e: any) => toast.error(e.message || "Merge failed"),
    });

    // "No Longer Owned" — clears the vehicle's current-owner link (same mutation as Vehicle
    // Details' "Remove Owner") so MOT reminders for that car stop going to this customer.
    // History is untouched: every past invoice keeps its own customer link. Confirmation is an
    // in-app dialog, NOT window.confirm — Chrome silently suppresses native dialogs once a user
    // ever ticks "prevent this page from creating additional dialogs", which makes the button
    // look completely dead.
    // Service-history table sort (client-side — the full history is already loaded)
    const [histSort, setHistSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
    const histSortBy = (key: string) => setHistSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" || key === "total" || key === "unpaid" ? "desc" : "asc" }));

    const [unlinkTarget, setUnlinkTarget] = useState<{ id: number; registration: string } | null>(null);
    const unlinkVehicle = trpc.reminders.unlinkVehicle.useMutation({
        onSuccess: () => { toast.success("Owner link removed — no more reminders for this vehicle"); setUnlinkTarget(null); refetch(); },
        onError: (e: any) => toast.error(e.message || "Failed to remove owner link"),
    });

    // Edit State
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editForm, setEditForm] = useState({
        name: "",
        email: "",
        phone: "",
        address: "",
        postcode: "",
        notes: ""
    });

    // History State
    const [historyOpen, setHistoryOpen] = useState(false);
    const [selectedVehicleForHistory, setSelectedVehicleForHistory] = useState<{ id: number, registration: string } | null>(null);

    const updateCustomerMutation = trpc.customers.update.useMutation({
        onSuccess: () => {
            toast.success("Customer details updated successfully");
            setIsEditOpen(false);
            refetch();
        },
        onError: (err) => {
            toast.error(`Failed to update: ${err.message}`);
        }
    });

    // Populate form when data loads
    useEffect(() => {
        if (data?.customer) {
            setEditForm({
                name: data.customer.name || "",
                email: data.customer.email || "",
                phone: data.customer.phone || "",
                address: data.customer.address || "",
                postcode: data.customer.postcode || "",
                notes: data.customer.notes || ""
            });
        }
    }, [data]);

    const handleSave = () => {
        updateCustomerMutation.mutate({
            id,
            ...editForm
        });
    };

    if (!id) {
        return (
            <DashboardLayout>
                <div className="text-center py-12">
                    <h2 className="text-xl font-semibold text-red-500">Invalid Customer ID</h2>
                    <Link href={`${base}/customers`}>
                        <Button variant="link" className="mt-4">Back to Customers</Button>
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    if (isLoading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </DashboardLayout>
        );
    }

    if (error || !data || !data.customer) {
        return (
            <DashboardLayout>
                <div className="text-center py-12">
                    <h2 className="text-xl font-semibold text-red-500">
                        {error ? error.message : "Customer not found"}
                    </h2>
                    <Link href={`${base}/customers`}>
                        <Button variant="link" className="mt-4">Back to Customers</Button>
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    const { customer, vehicles, reminders } = data;
    const linkedAccounts: any[] = (data as any).linkedAccounts || [];
    const parsedContacts = parseContacts(customer.email as string | null, customer.phone as string | null);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href={`${base}/customers`}>
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
                            <p className="text-muted-foreground text-sm">Customer Profile • ID #{customer.id}</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={() => setIsEditOpen(true)} variant="outline" size="sm">
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit Profile
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            onClick={() => window.location.href = `${base}/documents/new?customerId=${customer.id}`}
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            New Job
                        </Button>
                    </div>
                </div>

                {linkedAccounts.length > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                        <p className="text-sm text-amber-900">
                            <span className="font-medium">{linkedAccounts.length} other account{linkedAccounts.length > 1 ? "s" : ""} share this phone number</span>
                            {" — "}
                            {linkedAccounts.map((a) => `${a.name || "Unnamed"} (${a.accountNumber || `#${a.id}`})`).join(", ")}.
                            {" "}Their vehicles and invoices are already shown below — merge if this is really the same person.
                        </p>
                        <Button size="sm" variant="outline" className="shrink-0 text-amber-800 border-amber-300 bg-white hover:bg-amber-100" onClick={() => setMergeOpen(true)}>
                            Merge into this profile
                        </Button>
                    </div>
                )}

                <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
                    <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>Merge linked accounts into {customer.name}</DialogTitle>
                            <DialogDescription>
                                This is normally blocked because different GA4 account numbers can mean different people sharing a phone. Confirm these are all the same person.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 py-2">
                            {linkedAccounts.map((a) => (
                                <div key={a.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                    <span>{a.name || "Unnamed"}</span>
                                    <span className="text-muted-foreground font-mono text-xs">{a.accountNumber || `#${a.id}`}</span>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Their vehicles, invoices, reminders and messages move onto <b>{customer.name}</b> (account {customer.accountNumber || `#${customer.id}`}); the accounts listed above are then deleted. Their vehicles/invoices keep their own history — nothing is lost, only which account holds it changes.
                        </p>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setMergeOpen(false)}>Cancel</Button>
                            <Button
                                disabled={mergeMutation.isPending}
                                onClick={() => mergeMutation.mutate({ primaryId: customer.id as number, secondaryIds: linkedAccounts.map((a) => a.id), force: true })}
                                className="bg-amber-700 hover:bg-amber-800"
                            >
                                {mergeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                Yes, merge into {customer.name}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Compact stats strip — one glanceable line instead of four tall cards */}
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border bg-white px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                        <FileText className="w-4 h-4 text-blue-500" />
                        <span className="font-bold text-slate-900">{data.stats?.totalJobs || 0}</span>
                        <span className="text-muted-foreground">jobs</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        <span className="font-bold text-slate-900">£{(data.stats?.totalSpent || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className="text-muted-foreground">spent</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <Car className="w-4 h-4 text-orange-500" />
                        <span className="font-bold text-slate-900">{vehicles.length}</span>
                        <span className="text-muted-foreground">vehicle{vehicles.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <Send className="w-4 h-4 text-purple-500" />
                        <span className="font-bold text-slate-900">{reminders.length}</span>
                        <span className="text-muted-foreground">reminders sent</span>
                    </div>
                </div>

                {/* Contact strip — full width, directly under the customer's name so it reads as
                    part of who they are (it used to sit in a side column, visually orphaned).
                    Three zones: how to reach them, where they are, and a live map of the address
                    with one-click Google Maps directions for collections/deliveries. */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <User className="w-5 h-5 text-blue-500" />
                            Contact Details
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-6 md:grid-cols-3">
                            <div className="space-y-2.5">
                                {parsedContacts.length > 0 ? (
                                    parsedContacts.map((contact, idx) => (
                                        <div key={idx} className="flex items-center gap-3 text-sm flex-wrap bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                                            {contact.type === 'email' ? (
                                                <div className="bg-blue-100 p-1.5 rounded-md text-blue-600 shrink-0">
                                                    <Mail className="w-4 h-4" />
                                                </div>
                                            ) : (
                                                <div className="bg-green-100 p-1.5 rounded-md text-green-600 shrink-0">
                                                    <Phone className="w-4 h-4" />
                                                </div>
                                            )}
                                            <a
                                                href={contact.type === 'email'
                                                    ? `mailto:${contact.value}`
                                                    : `tel:${contact.value.replace(/[^0-9+]/g, '')}`
                                                }
                                                className="hover:underline font-medium text-slate-800"
                                            >
                                                {contact.value}
                                            </a>
                                            {contact.tag && (
                                                <Badge variant="secondary" className="text-[10px] uppercase font-bold text-slate-600 bg-slate-200/50 ml-auto">
                                                    {contact.tag}
                                                </Badge>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-sm text-muted-foreground italic">No contact information available</div>
                                )}
                                <AdditionalNumbers customerId={customer.id as number} />
                            </div>
                            <div className="space-y-3">
                                {(customer.address || customer.postcode) ? (
                                    <div className="flex items-start gap-2.5">
                                        <MapPin className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                                        <div>
                                            {customer.address && <div className="text-[15px] leading-snug text-slate-800">{customer.address}</div>}
                                            {customer.postcode && <div className="text-lg font-bold text-blue-700 uppercase tracking-wide">{customer.postcode}</div>}
                                            <a
                                                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([customer.address, customer.postcode].filter(Boolean).join(", "))}`}
                                                target="_blank" rel="noreferrer"
                                                className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[13px] font-medium text-blue-700 hover:bg-blue-100"
                                            >
                                                <MapPin className="w-3.5 h-3.5" /> Directions in Google Maps
                                            </a>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground italic">No address on file</div>
                                )}
                                {customer.notes && (
                                    <div className="border-t pt-3">
                                        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">Internal Notes</p>
                                        <p className="text-sm bg-yellow-50/50 p-2.5 rounded-md border border-yellow-100 whitespace-pre-wrap">{customer.notes}</p>
                                    </div>
                                )}
                            </div>
                            {(customer.address || customer.postcode) && (
                                <iframe
                                    title="Customer address map"
                                    className="w-full h-44 md:h-full min-h-[140px] rounded-lg border"
                                    loading="lazy"
                                    referrerPolicy="no-referrer-when-downgrade"
                                    src={`https://maps.google.com/maps?q=${encodeURIComponent([customer.address, customer.postcode].filter(Boolean).join(", "))}&z=15&output=embed`}
                                />
                            )}
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Car className="w-5 h-5 text-blue-500" />
                                    Linked Vehicles ({vehicles.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {vehicles.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Registration</TableHead>
                                                <TableHead>Vehicle Info</TableHead>
                                                <TableHead>MOT Status</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {vehicles.map((v) => {
                                                const expiry = v.motExpiryDate ? new Date(v.motExpiryDate) : null;
                                                const today = new Date();
                                                const isExpired = expiry && expiry < today;
                                                const daysUntil = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

                                                return (
                                                    <TableRow key={v.id} className="group">
                                                        <TableCell className="py-2">
                                                            <Link href={`${base}/view-vehicle/${encodeURIComponent(v.registration || "")}`}>
                                                                {base ? (
                                                                    <span className="cursor-pointer hover:underline font-medium">{v.registration}</span>
                                                                ) : (
                                                                    <div className="bg-yellow-400 text-black px-2 py-0.5 rounded font-mono font-bold text-sm border border-black inline-block shadow-sm cursor-pointer hover:scale-105 transition-transform">
                                                                        {v.registration}
                                                                    </div>
                                                                )}
                                                            </Link>
                                                        </TableCell>
                                                        <TableCell className="py-2">
                                                            <div className="text-sm font-bold">{v.make || "Unknown"}</div>
                                                            <div className="text-[10px] text-muted-foreground uppercase opacity-70">{v.model || ""}</div>
                                                            {!v.viaAccountSame && (
                                                                <div className="text-[10px] text-amber-700 mt-0.5" title="Same person, different GA4 account — shown here because it shares this customer's phone number">
                                                                    Via linked account {v.viaAccountNumber || `#${v.viaAccountId}`}
                                                                </div>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="py-2">
                                                            {expiry ? (
                                                                <div className="flex items-center gap-2">
                                                                    <Badge
                                                                        variant={isExpired ? "destructive" : "outline"}
                                                                        className={!isExpired && daysUntil !== null && daysUntil <= 30 ? "bg-orange-50 text-orange-700 border-orange-200 text-[10px]" : "text-[10px]"}
                                                                    >
                                                                        {isExpired ? "Expired" : daysUntil !== null && daysUntil <= 30 ? `${daysUntil}d left` : "Valid"}
                                                                    </Badge>
                                                                    <span className="text-[10px] text-muted-foreground font-medium">{format(expiry, "dd/MM/yy")}</span>
                                                                </div>
                                                            ) : (
                                                                <Badge variant="secondary" className="text-[10px]">No Data</Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right py-2">
                                                            {/* Always visible (softly, full-strength on hover) — the old reveal-on-hover
                                                                pattern made the actions effectively undiscoverable. */}
                                                            <div className="flex justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-blue-600"
                                                                    title="View History"
                                                                    onClick={() => {
                                                                        setSelectedVehicleForHistory({ id: v.id, registration: v.registration });
                                                                        setHistoryOpen(true);
                                                                    }}
                                                                >
                                                                    <History className="w-3.5 h-3.5" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-primary"
                                                                    title="New Job"
                                                                    onClick={() => window.location.href = `${base}/documents/new?reg=${encodeURIComponent(v.registration)}`}
                                                                >
                                                                    <Plus className="w-3.5 h-3.5" />
                                                                </Button>
                                                                <AssignCustomerDialog
                                                                    vehicleId={v.id}
                                                                    onAssigned={() => refetch()}
                                                                    triggerButton={
                                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" title="Transfer to a different owner">
                                                                            <ArrowLeftRight className="w-3.5 h-3.5" />
                                                                        </Button>
                                                                    }
                                                                />
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-red-600"
                                                                    title="No longer owned — stop MOT reminders to this customer for this vehicle"
                                                                    disabled={unlinkVehicle.isPending}
                                                                    onClick={() => setUnlinkTarget({ id: v.id, registration: v.registration })}
                                                                >
                                                                    <UserX className="w-3.5 h-3.5" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <div className="text-center py-8">
                                        <Car className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                        <p className="text-muted-foreground text-sm">No vehicles linked to profile.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* "No Longer Owned" confirmation — in-app dialog (see unlinkVehicle above for why not window.confirm) */}
                        <Dialog open={unlinkTarget != null} onOpenChange={(open) => { if (!open) setUnlinkTarget(null); }}>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle>No longer owns {unlinkTarget?.registration}?</DialogTitle>
                                    <DialogDescription>
                                        This removes the owner link so {customer.name} stops getting MOT reminders for this vehicle.
                                        Past invoices and service history are not affected.
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setUnlinkTarget(null)}>Cancel</Button>
                                    <Button variant="destructive" disabled={unlinkVehicle.isPending}
                                        onClick={() => unlinkTarget && unlinkVehicle.mutate({ vehicleId: unlinkTarget.id })}>
                                        {unlinkVehicle.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <UserX className="w-4 h-4 mr-1.5" />}
                                        Yes, no longer owned
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <History className="w-5 h-5 text-blue-500" />
                                    Customer Activity
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Tabs defaultValue="history">
                                    <TabsList className="mb-4">
                                        <TabsTrigger value="history">Service History ({data.history?.length || 0})</TabsTrigger>
                                        <TabsTrigger value="reminders">Reminders ({reminders.length})</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="history">
                                        {data.history && data.history.length > 0 ? (
                                            <Table className="[&_th]:h-8">
                                                <TableHeader>
                                                    <TableRow>
                                                        <HistSortHead label="Date" k="date" sort={histSort} onSort={histSortBy} />
                                                        <HistSortHead label="Type" k="type" sort={histSort} onSort={histSortBy} />
                                                        <HistSortHead label="Doc No" k="docNo" sort={histSort} onSort={histSortBy} />
                                                        <HistSortHead label="Reg" k="reg" sort={histSort} onSort={histSortBy} />
                                                        <TableHead className="h-8">Job</TableHead>
                                                        <HistSortHead label="Unpaid" k="unpaid" sort={histSort} onSort={histSortBy} align="right" />
                                                        <HistSortHead label="Total" k="total" sort={histSort} onSort={histSortBy} align="right" />
                                                        <TableHead className="h-8 w-6" />
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {[...data.history].sort((a: any, b: any) => {
                                                        const dir = histSort.dir === "asc" ? 1 : -1;
                                                        const val = (h: any) => {
                                                            switch (histSort.key) {
                                                                case "type": return h.docType || "";
                                                                case "docNo": return Number(String(h.docNo || 0).replace(/\D/g, "")) || 0;
                                                                case "reg": return (h.registration || "").toUpperCase();
                                                                case "unpaid": return Number(h.balance) || 0;
                                                                case "total": return Number(h.totalGross) || 0;
                                                                default: return new Date(h.dateCreated || 0).getTime();
                                                            }
                                                        };
                                                        const av = val(a), bv = val(b);
                                                        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
                                                    }).map((h: any) => (
                                                        <HistoryActivityRow
                                                            key={h.id}
                                                            h={h}
                                                            onOpenFull={() => {
                                                                setSelectedVehicleForHistory({ id: h.vehicleId, registration: h.registration || "Vehicle" });
                                                                setHistoryOpen(true);
                                                            }}
                                                        />
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        ) : (
                                            <div className="text-center py-8 text-muted-foreground text-sm italic">
                                                No service history recorded for this customer.
                                            </div>
                                        )}
                                    </TabsContent>
                                    <TabsContent value="reminders">
                                        {reminders && reminders.length > 0 ? (
                                            <Table className="[&_th]:h-8 [&_td]:py-1.5">
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Date</TableHead>
                                                        <TableHead>Type</TableHead>
                                                        <TableHead>Reg</TableHead>
                                                        <TableHead>Via</TableHead>
                                                        <TableHead>Status</TableHead>
                                                        <TableHead>Message</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {reminders.map((r: any) => (
                                                        <TableRow key={r.id}>
                                                            <TableCell className="whitespace-nowrap text-[13px] font-semibold text-slate-800">
                                                                {r.date ? format(new Date(r.date), r.kind === "message" ? "dd/MM/yy HH:mm" : "dd/MM/yy") : "—"}
                                                                {r.kind === "legacy" && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(due)</span>}
                                                            </TableCell>
                                                            <TableCell><Badge variant="outline" className="text-[10px]">{r.type}</Badge></TableCell>
                                                            <TableCell>{r.registration ? <RegPlate reg={r.registration} size="xs" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                                                            <TableCell className="text-xs text-muted-foreground capitalize whitespace-nowrap">{r.method || "—"}</TableCell>
                                                            <TableCell>
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize whitespace-nowrap ${
                                                                    r.status === "read" ? "bg-green-50 text-green-700 border-green-200"
                                                                    : r.status === "delivered" ? "bg-sky-50 text-sky-700 border-sky-200"
                                                                    : r.status === "failed" || r.status === "undelivered" ? "bg-red-50 text-red-700 border-red-200"
                                                                    : r.status === "pending" ? "bg-amber-50 text-amber-700 border-amber-200"
                                                                    : "bg-slate-50 text-slate-600 border-slate-200"
                                                                }`} title={r.errorMessage || undefined}>{r.status}</span>
                                                            </TableCell>
                                                            <TableCell className="max-w-[300px]">
                                                                <span className="block truncate text-xs text-muted-foreground" title={r.preview || undefined}>
                                                                    {r.preview || (r.kind === "legacy" ? "GA4-era reminder (no message stored)" : "—")}
                                                                </span>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        ) : (
                                            <div className="text-center py-8 text-muted-foreground text-sm italic">
                                                No reminders sent to this customer.
                                            </div>
                                        )}
                                    </TabsContent>
                                </Tabs>
                            </CardContent>
                        </Card>
                </div>
            </div>

            {/* Service History Dialog */}
            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Service History: {selectedVehicleForHistory?.registration}</DialogTitle>
                        <DialogDescription className="sr-only">Historical service records and document history for this vehicle.</DialogDescription>
                    </DialogHeader>
                    {selectedVehicleForHistory && (
                        <ServiceHistory vehicleId={selectedVehicleForHistory.id} />
                    )}
                </DialogContent>
            </Dialog>

            {/* Edit Customer Dialog */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Customer Details</DialogTitle>
                        <DialogDescription>Update info for {customer.name}.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Name</label>
                            <Input
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Phone</label>
                            <Input
                                value={editForm.phone}
                                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Email</label>
                            <Input
                                value={editForm.email}
                                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Address</label>
                            <Input
                                value={editForm.address}
                                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Postcode</label>
                            <Input
                                value={editForm.postcode}
                                onChange={(e) => setEditForm({ ...editForm, postcode: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Notes</label>
                            <Input
                                value={editForm.notes}
                                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={updateCustomerMutation.isPending}>
                            {updateCustomerMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
}
