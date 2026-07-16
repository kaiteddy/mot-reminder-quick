import { useParams } from "wouter";
import { useClassicBase } from "@/lib/classicNav";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Phone, MapPin, User, ArrowLeft, Car, History, FileText, Pencil, Send, Plus, DollarSign, Trash2, ChevronDown } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Link } from "wouter";
import { format } from "date-fns";
import { useState, useEffect, useRef } from "react";
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

    return (
        <div className="rounded-lg border bg-card overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${h.docType === 'SI' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-600'}`}>
                        {h.docType === 'SI' ? <FileText className="w-5 h-5" /> : <History className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-bold flex items-center gap-2 flex-wrap">
                            {h.docType === 'SI' ? 'Invoice' : 'Estimate'} #{h.docNo || h.id}
                            {h.registration && <span className="bg-yellow-100 text-[10px] px-1.5 py-0.5 rounded border border-yellow-200 font-mono">{h.registration}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                            {h.mainDescription || "No job description"}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 pl-2">
                    <div className="text-right">
                        <div className="text-sm font-bold">£{Number(h.totalGross || 0).toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground">{format(new Date(h.dateCreated), "dd MMM yyyy")}</div>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
            </button>

            {open && (
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
            )}
        </div>
    );
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

                {/* Stats Grid */}
                <div className="grid gap-4 md:grid-cols-4">
                    <Card className="bg-blue-50/50 border-blue-100">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-medium text-blue-600 uppercase tracking-wider flex items-center justify-between">
                                Total Jobs
                                <FileText className="w-4 h-4" />
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{data.stats?.totalJobs || 0}</div>
                            <p className="text-[10px] text-muted-foreground mt-1 text-blue-400">Recorded sessions</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-green-50/50 border-green-100">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-medium text-green-600 uppercase tracking-wider flex items-center justify-between">
                                Total Spent
                                <DollarSign className="w-4 h-4" />
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">£{(data.stats?.totalSpent || 0).toFixed(2)}</div>
                            <p className="text-[10px] text-muted-foreground mt-1 text-green-400">Total revenue</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-orange-50/50 border-orange-100">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-medium text-orange-600 uppercase tracking-wider flex items-center justify-between">
                                Vehicles
                                <Car className="w-4 h-4" />
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{vehicles.length}</div>
                            <p className="text-[10px] text-muted-foreground mt-1 text-orange-400">Currently active</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-purple-50/50 border-purple-100">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-medium text-purple-600 uppercase tracking-wider flex items-center justify-between">
                                Reminders
                                <Send className="w-4 h-4" />
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{reminders.length}</div>
                            <p className="text-[10px] text-muted-foreground mt-1 text-purple-400">Messages sent</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Info Cards Grid */}
                <div className="grid gap-6 md:grid-cols-3">
                    <Card className="md:col-span-1 h-fit">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <User className="w-5 h-5 text-blue-500" />
                                Contact Details
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {parsedContacts.length > 0 ? (
                                <div className="space-y-4">
                                    {parsedContacts.map((contact, idx) => (
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
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground italic">No contact information available</div>
                            )}
                            <AdditionalNumbers customerId={customer.id as number} />
                            {(customer.address || customer.postcode) && (
                                <div className="flex items-start gap-2 text-sm">
                                    <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                                    <div>
                                        {customer.address && <div>{customer.address}</div>}
                                        {customer.postcode && <div className="font-medium text-blue-700 uppercase">{customer.postcode}</div>}
                                    </div>
                                </div>
                            )}
                            {customer.notes && (
                                <div className="border-t pt-4 mt-4">
                                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">Internal Notes</p>
                                    <p className="text-sm bg-yellow-50/50 p-3 rounded-md border border-yellow-100 whitespace-pre-wrap">{customer.notes}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="md:col-span-2 space-y-6">
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
                                                                <div className="bg-yellow-400 text-black px-2 py-0.5 rounded font-mono font-bold text-sm border border-black inline-block shadow-sm cursor-pointer hover:scale-105 transition-transform">
                                                                    {v.registration}
                                                                </div>
                                                            </Link>
                                                        </TableCell>
                                                        <TableCell className="py-2">
                                                            <div className="text-sm font-bold">{v.make || "Unknown"}</div>
                                                            <div className="text-[10px] text-muted-foreground uppercase opacity-70">{v.model || ""}</div>
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
                                                            <div className="flex justify-end gap-1 opacity-10 md:opacity-0 group-hover:opacity-100 transition-opacity">
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
                                            <div className="space-y-3">
                                                {data.history.map((h: any) => (
                                                    <HistoryActivityRow
                                                        key={h.id}
                                                        h={h}
                                                        onOpenFull={() => {
                                                            setSelectedVehicleForHistory({ id: h.vehicleId, registration: h.registration || "Vehicle" });
                                                            setHistoryOpen(true);
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 text-muted-foreground text-sm italic">
                                                No service history recorded for this customer.
                                            </div>
                                        )}
                                    </TabsContent>
                                    <TabsContent value="reminders">
                                        {reminders && reminders.length > 0 ? (
                                            <div className="space-y-2">
                                                {reminders.map((r: any) => (
                                                    <div key={r.id} className="flex items-center justify-between p-2 rounded border text-xs">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-green-500" />
                                                            <span className="font-medium">{format(new Date(r.sentAt), "dd/MM/yy HH:mm")}</span>
                                                            <span className="text-muted-foreground truncate max-w-[100px]">{r.registration}</span>
                                                        </div>
                                                        <Badge variant="outline" className="text-[10px] scale-90 capitalize">{r.status}</Badge>
                                                    </div>
                                                ))}
                                            </div>
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
