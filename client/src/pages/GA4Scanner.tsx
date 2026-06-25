import React, { useMemo, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from '@/lib/trpc';
import DashboardLayout from "@/components/DashboardLayout";
import { fileToBase64 } from '@/lib/utils';
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { MOTRefreshButton } from "@/components/MOTRefreshButton";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDistanceToNow } from "date-fns";
import {
    CheckCircle, Search, XCircle, Loader2, Send, CalendarCheck, CheckCircle2, Eye, Clock,
    ArrowDown, ArrowUp, Trash2, UploadCloud, ScanLine, ImageIcon, X, AlertTriangle, CalendarClock, ShieldCheck,
} from "lucide-react";

// Soft status pill with a coloured dot — quieter than solid badges, easier to scan in a long list.
function Pill({ tone, children }: { tone: "red" | "amber" | "green" | "slate" | "blue"; children: React.ReactNode }) {
    const tones: Record<string, { bg: string; dot: string }> = {
        red: { bg: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
        amber: { bg: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
        green: { bg: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
        slate: { bg: "bg-slate-50 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
        blue: { bg: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500" },
    };
    const t = tones[tone];
    return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${t.bg}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
            {children}
        </span>
    );
}

function StatChip({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
    return (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
                <div className="text-xl font-bold leading-tight">{value}</div>
                <div className="text-[11px] text-muted-foreground whitespace-nowrap">{label}</div>
            </div>
        </div>
    );
}

function CreateReminderButton({ item, onSuccess }: { item: any, onSuccess: () => void }) {
    const createMutation = trpc.reminders.createManualReminder.useMutation();
    const sendMutation = trpc.reminders.sendWhatsApp.useMutation();
    const [status, setStatus] = useState<"idle" | "creating" | "sending" | "done">("idle");

    const handleCreateAndSend = async () => {
        if (!confirm(`Create and Send MOT reminder for ${item.registration}?`)) return;
        try {
            setStatus("creating");
            const result = await createMutation.mutateAsync({
                registration: item.registration,
                dueDate: item.liveMotExpiryDate || item.dueDate,
                type: "MOT",
                customerName: item.customerName,
                customerPhone: item.customerPhone
            });
            if (!result.customerPhone) {
                alert("Reminder created, but no phone number found to send message.");
                setStatus("done");
                onSuccess();
                return;
            }
            setStatus("sending");
            await sendMutation.mutateAsync({
                id: Number(result.reminderId),
                phoneNumber: result.customerPhone,
                customerName: result.customerName,
                registration: item.registration,
                messageType: "MOT"
            });
            setStatus("done");
            toast.success(`Reminder sent to ${result.customerPhone}`);
            onSuccess();
        } catch (e: any) {
            console.error(e);
            setStatus("idle");
            toast.error("Error: " + e.message);
        }
    };

    return (
        <Button
            size="sm"
            disabled={status !== "idle"}
            onClick={handleCreateAndSend}
            className={`h-7 px-2.5 text-xs ${status === "done" ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
            title="Create & send a WhatsApp MOT reminder"
        >
            {(status === "creating" || status === "sending") && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
            {status === "idle" && <Send className="w-3 h-3 mr-1.5" />}
            {status === "idle" ? "Send" : status === "creating" ? "Creating…" : status === "sending" ? "Sending…" : "Sent ✓"}
        </Button>
    )
}

export default function GA4Scanner() {
    const [file, setFile] = useState<File | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [results, setResults] = useState<any[]>(() => {
        const saved = localStorage.getItem("ga4_scan_results");
        return saved ? JSON.parse(saved) : [];
    });
    const [isScanning, setIsScanning] = useState(false);
    const [selectedRegs, setSelectedRegs] = useState<Set<string>>(new Set());
    const [isSendingBatch, setIsSendingBatch] = useState(false);
    const [bookedDate, setBookedDate] = useState<string>("");
    const [showBookedDialog, setShowBookedDialog] = useState(false);
    const [bookingTargetRegs, setBookingTargetRegs] = useState<Set<string> | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterMode, setFilterMode] = useState<"all" | "never" | "sent" | "motdone">("all");
    const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

    const createMutation = trpc.reminders.createManualReminder.useMutation();
    const sendMutation = trpc.reminders.sendWhatsApp.useMutation();
    const markBookedMutation = trpc.database.markMOTBooked.useMutation();

    const handleDeleteRow = (reg: string) => {
        const nextResults = results.filter(r => r.registration !== reg);
        setResults(nextResults);
        localStorage.setItem("ga4_scan_results", JSON.stringify(nextResults));
    };

    const toggleSelectRow = (reg: string) => {
        const next = new Set(selectedRegs);
        if (next.has(reg)) next.delete(reg); else next.add(reg);
        setSelectedRegs(next);
    };

    const scanMutation = trpc.reminders.scanFromImage.useMutation({
        onSuccess: (data) => {
            setResults(data);
            localStorage.setItem("ga4_scan_results", JSON.stringify(data));
            setIsScanning(false);
        },
        onError: (err) => {
            setIsScanning(false);
            console.error(err);
            toast.error("Failed to scan: " + err.message);
        }
    });

    const acceptFile = (f: File | undefined | null) => {
        if (f && f.type.startsWith("image/")) setFile(f);
        else if (f) toast.error("Please choose an image file (a screenshot)");
    };

    const handleScan = async () => {
        if (!file) return;
        setIsScanning(true);
        try {
            const base64 = await fileToBase64(file);
            scanMutation.mutate({ imageData: base64 });
        } catch (e) {
            setIsScanning(false);
            toast.error("Error processing file");
        }
    };

    const clearResults = () => {
        setResults([]);
        setSelectedRegs(new Set());
        localStorage.removeItem("ga4_scan_results");
    };

    const handleMarkBooked = async () => {
        if (!bookedDate) { toast.error("Please select a date"); return; }
        const targetRegs = bookingTargetRegs || selectedRegs;
        const vehicleIds = Array.from(targetRegs)
            .map(reg => results.find(r => r.registration === reg)?.vehicleId)
            .filter((id): id is number => id !== null && id !== undefined);
        if (vehicleIds.length === 0) {
            toast.error("No valid databased vehicles selected. Only vehicles in the database can be marked as booked.");
            return;
        }
        try {
            await markBookedMutation.mutateAsync({ vehicleIds, date: bookedDate });
            const targetSet = bookingTargetRegs || selectedRegs;
            const newResults = results.map(r => (targetSet.has(r.registration) && r.vehicleId) ? { ...r, liveMotBookedDate: bookedDate } : r);
            setResults(newResults);
            localStorage.setItem("ga4_scan_results", JSON.stringify(newResults));
            if (!bookingTargetRegs) setSelectedRegs(new Set());
            setBookingTargetRegs(null);
            setShowBookedDialog(false);
            setBookedDate("");
            toast.success(`Marked ${vehicleIds.length} vehicle(s) as booked.`);
        } catch (e: any) {
            toast.error(`Failed to mark as booked: ${e.message}`);
        }
    };

    const handleBulkSend = async () => {
        if (selectedRegs.size === 0) return;
        const itemsToSend = results.filter(r => {
            const isSelected = selectedRegs.has(r.registration);
            const isSent = !!r.lastSent;
            const isBooked = !!r.liveMotBookedDate;
            const motExpiry = r.liveMotExpiryDate ? new Date(r.liveMotExpiryDate) : null;
            const today = new Date();
            const diffTime = motExpiry ? motExpiry.getTime() - today.getTime() : 0;
            const daysLeft = motExpiry ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : null;
            const isValidToSend = motExpiry && (daysLeft! > -300);
            return isSelected && !isSent && !isBooked && isValidToSend;
        });
        if (itemsToSend.length === 0) {
            toast.error("No valid unbooked/unsent MOTs selected to send.");
            return;
        }
        if (!confirm(`Create and send reminders for ${itemsToSend.length} selected vehicles?`)) return;

        setIsSendingBatch(true);
        let successCount = 0;
        let failedCount = 0;
        const newResults = [...results];
        for (const item of itemsToSend) {
            try {
                const result = await createMutation.mutateAsync({
                    registration: item.registration,
                    dueDate: item.liveMotExpiryDate || item.dueDate,
                    type: "MOT",
                    customerName: item.customerName,
                    customerPhone: item.customerPhone
                });
                if (result.customerPhone) {
                    await sendMutation.mutateAsync({
                        id: Number(result.reminderId),
                        phoneNumber: result.customerPhone,
                        customerName: result.customerName,
                        registration: item.registration,
                        messageType: "MOT"
                    });
                    successCount++;
                    const index = newResults.findIndex(r => r.registration === item.registration);
                    if (index !== -1) newResults[index] = { ...item, lastSent: new Date().toISOString() };
                } else {
                    failedCount++;
                }
            } catch (error) {
                console.error(error);
                failedCount++;
            }
        }
        setResults(newResults);
        localStorage.setItem("ga4_scan_results", JSON.stringify(newResults));
        setSelectedRegs(new Set());
        setIsSendingBatch(false);
        if (successCount > 0) toast.success(`Bulk send complete: ${successCount} sent.`);
        if (failedCount > 0) toast.error(`Failed for ${failedCount} item(s).`);
    };

    const selectedVehicleIds = Array.from(selectedRegs)
        .map(reg => results.find(r => r.registration === reg)?.vehicleId)
        .filter((id): id is number => id !== null && id !== undefined);

    const motDaysLeft = (r: any) => r.liveMotExpiryDate ? Math.ceil((new Date(r.liveMotExpiryDate).getTime() - Date.now()) / 86400000) : null;
    // "MOT done" = GA4 flagged it as due, but the live MOT is now comfortably in the future (>60 days),
    // so it's been renewed — it just needs updating in GA4, not a reminder.
    const isMotDone = (r: any) => { const d = motDaysLeft(r); return d != null && d > 60; };
    const filterCounts = {
        all: results.length,
        never: results.filter((r) => !r.lastSent).length,
        sent: results.filter((r) => !!r.lastSent).length,
        motdone: results.filter(isMotDone).length,
    };

    const sortedFilteredResults = [...results].filter(item => {
        const matchesSearch = item.registration.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (item.customerName || "").toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchesSearch) return false;
        if (filterMode === "never" && item.lastSent) return false;
        if (filterMode === "sent" && !item.lastSent) return false;
        if (filterMode === "motdone" && !isMotDone(item)) return false;
        return true;
    }).sort((a, b) => {
        const timeA = a.lastSent ? new Date(a.lastSent).getTime() : 0;
        const timeB = b.lastSent ? new Date(b.lastSent).getTime() : 0;
        return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });

    // select-all works on the rows currently shown (after search/filter)
    const visibleRegs = sortedFilteredResults.map(r => r.registration);
    const allVisibleSelected = visibleRegs.length > 0 && visibleRegs.every(r => selectedRegs.has(r));
    const toggleSelectAll = () => setSelectedRegs(allVisibleSelected ? new Set() : new Set(visibleRegs));

    // headline numbers for the scan
    const stats = useMemo(() => {
        const today = new Date();
        let expired = 0, due = 0, sent = 0, booked = 0;
        for (const r of results) {
            const exp = r.liveMotExpiryDate ? new Date(r.liveMotExpiryDate) : null;
            const days = exp ? Math.ceil((exp.getTime() - today.getTime()) / 86400000) : null;
            if (days !== null && days < 0) expired++;
            else if (days !== null && days <= 30) due++;
            if (r.lastSent) sent++;
            if (r.liveMotBookedDate) booked++;
        }
        return { expired, due, sent, booked };
    }, [results]);

    const hasResults = results.length > 0;

    return (
        <DashboardLayout>
            <div className="space-y-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
                            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><ScanLine className="h-5 w-5" /></span>
                            GA4 Scanner
                        </h1>
                        <p className="text-muted-foreground mt-1.5 text-sm max-w-2xl">
                            Upload a screenshot of your GA4 reminder list — we'll read the registrations, pull each car's live MOT &amp; tax, and show what's already been sent from here.
                        </p>
                    </div>
                    {hasResults && (
                        <Button variant="ghost" size="sm" onClick={clearResults} className="text-muted-foreground hover:text-destructive">
                            <X className="w-4 h-4 mr-1" /> Clear results
                        </Button>
                    )}
                </div>

                {/* Upload dropzone — full-size when empty, slim once there are results */}
                <label
                    htmlFor="ga4-shot"
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
                    className={`block cursor-pointer rounded-xl border-2 border-dashed transition-colors
                        ${dragOver ? "border-violet-400 bg-violet-50" : "border-border bg-card hover:border-violet-300 hover:bg-violet-50/40"}
                        ${hasResults ? "p-3" : "p-10"}`}
                >
                    <input id="ga4-shot" type="file" accept="image/*" className="hidden" disabled={isScanning}
                        onChange={(e) => acceptFile(e.target.files?.[0])} />
                    <div className={`flex items-center gap-4 ${hasResults ? "" : "flex-col text-center"}`}>
                        <div className={`flex items-center justify-center rounded-full bg-violet-100 text-violet-600 ${hasResults ? "h-10 w-10" : "h-14 w-14"}`}>
                            {file ? <ImageIcon className={hasResults ? "h-5 w-5" : "h-6 w-6"} /> : <UploadCloud className={hasResults ? "h-5 w-5" : "h-6 w-6"} />}
                        </div>
                        <div className={hasResults ? "min-w-0 flex-1" : ""}>
                            {file ? (
                                <p className="text-sm font-medium truncate">{file.name} <span className="text-muted-foreground font-normal">· {(file.size / 1024 / 1024).toFixed(1)} MB</span></p>
                            ) : (
                                <p className="text-sm font-medium">Drop a GA4 screenshot here, or <span className="text-violet-600 underline underline-offset-2">browse</span></p>
                            )}
                            <p className="text-xs text-muted-foreground mt-0.5">PNG or JPG of the reminders list</p>
                        </div>
                        <Button
                            onClick={(e) => { e.preventDefault(); handleScan(); }}
                            disabled={!file || isScanning}
                            className={hasResults ? "" : "mt-1"}
                        >
                            {isScanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
                            {isScanning ? "Scanning…" : "Scan & check"}
                        </Button>
                    </div>
                </label>

                {hasResults && (
                    <>
                        {/* Headline stats */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <StatChip icon={ScanLine} label="Vehicles scanned" value={results.length} tone="bg-violet-100 text-violet-700" />
                            <StatChip icon={AlertTriangle} label="MOT expired" value={stats.expired} tone="bg-red-100 text-red-600" />
                            <StatChip icon={CalendarClock} label="Due within 30 days" value={stats.due} tone="bg-amber-100 text-amber-600" />
                            <StatChip icon={Send} label="Reminders sent" value={stats.sent} tone="bg-blue-100 text-blue-600" />
                            <StatChip icon={ShieldCheck} label="Booked in" value={stats.booked} tone="bg-emerald-100 text-emerald-600" />
                        </div>

                        <Card className="overflow-hidden py-0 gap-0">
                            {/* Toolbar */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b bg-slate-50/60">
                                <div className="font-semibold text-sm">
                                    Scan results
                                    <span className="ml-2 rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                        {sortedFilteredResults.length} of {results.length}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 flex-wrap">
                                    <div className="relative w-full sm:w-60">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input placeholder="Search reg or name…" className="pl-8 h-9 bg-white" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                                    </div>
                                    <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                                        {([["all", "All"], ["never", "Never sent"], ["sent", "Sent"], ["motdone", "MOT done"]] as const).map(([key, label]) => (
                                            <button key={key} type="button" onClick={() => setFilterMode(key)}
                                                className={`px-2.5 py-1 rounded-md text-[12px] font-medium whitespace-nowrap transition-colors ${filterMode === key ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                                                {label}<span className={`ml-1 ${filterMode === key ? "text-violet-600" : "text-slate-400"}`}>{filterCounts[key]}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {filterMode === "never" && (
                                <div className="px-4 py-2 text-[12px] text-violet-800 bg-violet-50 border-b border-violet-100">
                                    These haven't had a reminder sent from here yet — select them and hit <span className="font-medium">Send reminders</span>. (Ones sent within the last 7 days live on the <a href="/urgent-follow-ups" className="font-medium underline">Urgent Follow Ups</a> page.)
                                </div>
                            )}
                            {filterMode === "motdone" && (
                                <div className="px-4 py-2 text-[12px] text-emerald-800 bg-emerald-50 border-b border-emerald-100">
                                    These MOTs are no longer due — they've been renewed (60+ days left). No reminder needed; update them in GA4 so they drop off your reminder list.
                                </div>
                            )}

                            {/* Selection action bar */}
                            {selectedRegs.size > 0 && (
                                <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b bg-violet-50">
                                    <span className="text-sm font-medium text-violet-900">{selectedRegs.size} selected</span>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Button size="sm" onClick={handleBulkSend} disabled={isSendingBatch}>
                                            {isSendingBatch ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                                            Send reminders
                                        </Button>
                                        <Button size="sm" variant="outline" className="bg-white" onClick={() => { setBookingTargetRegs(null); setShowBookedDialog(true); }}>
                                            <CalendarCheck className="w-4 h-4 mr-1.5" /> Mark booked
                                        </Button>
                                        <MOTRefreshButton
                                            vehicleIds={selectedVehicleIds}
                                            disabled={selectedVehicleIds.length === 0}
                                            variant="outline"
                                            size="sm"
                                            label="Refresh MOT"
                                            onComplete={(updated) => {
                                                // Merge the freshly-checked MOT/tax straight into the scan results — no
                                                // need to re-upload or re-scan the screenshot.
                                                const byId = new Map((updated || []).map((u) => [u.id, u]));
                                                const next = results.map((r) => {
                                                    const u = r.vehicleId ? byId.get(r.vehicleId) : undefined;
                                                    if (!u) return r;
                                                    return {
                                                        ...r,
                                                        liveMotExpiryDate: u.motExpiryDate ?? r.liveMotExpiryDate,
                                                        liveTaxStatus: u.taxStatus ?? r.liveTaxStatus,
                                                        liveTaxDueDate: u.taxDueDate ?? r.liveTaxDueDate,
                                                        lastChecked: u.lastChecked ?? r.lastChecked,
                                                    };
                                                });
                                                setResults(next);
                                                localStorage.setItem("ga4_scan_results", JSON.stringify(next));
                                                setSelectedRegs(new Set());
                                                const n = (updated || []).length;
                                                toast.success(n ? `MOT & tax refreshed for ${n} vehicle${n === 1 ? "" : "s"}` : "No databased vehicles to refresh");
                                            }}
                                        />
                                        <Button size="sm" variant="ghost" onClick={() => setSelectedRegs(new Set())} className="text-muted-foreground">Clear</Button>
                                    </div>
                                </div>
                            )}

                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="hover:bg-transparent">
                                                <TableHead className="w-[40px] pl-4">
                                                    <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
                                                </TableHead>
                                                <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Vehicle</TableHead>
                                                <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Customer</TableHead>
                                                <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">MOT expiry</TableHead>
                                                <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</TableHead>
                                                <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Tax</TableHead>
                                                <TableHead
                                                    className="text-[11px] uppercase tracking-wider text-muted-foreground cursor-pointer select-none"
                                                    onClick={() => setSortOrder(prev => prev === "desc" ? "asc" : "desc")}
                                                >
                                                    <span className="inline-flex items-center gap-1">
                                                        Last sent {sortOrder === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
                                                    </span>
                                                </TableHead>
                                                <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground text-right pr-4">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sortedFilteredResults.map((item, i) => {
                                                const isSent = !!item.lastSent;
                                                const sentDateObj = item.lastSent ? new Date(item.lastSent) : null;
                                                let sentFull = '';
                                                let sentRelative = '';
                                                if (sentDateObj) {
                                                    sentFull = sentDateObj.toLocaleDateString("en-GB") + ' ' + sentDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                                    try { sentRelative = formatDistanceToNow(sentDateObj, { addSuffix: true }); } catch (e) { /* ignore */ }
                                                }

                                                const motExpiry = item.liveMotExpiryDate ? new Date(item.liveMotExpiryDate) : null;
                                                const today = new Date();
                                                const diffTime = motExpiry ? motExpiry.getTime() - today.getTime() : 0;
                                                const daysLeft = motExpiry ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : null;
                                                let status: 'expired' | 'due' | 'valid' | 'unknown' = 'unknown';
                                                if (motExpiry) {
                                                    if (daysLeft! < 0) status = 'expired';
                                                    else if (daysLeft! <= 30) status = 'due';
                                                    else status = 'valid';
                                                }
                                                const isBooked = !!item.liveMotBookedDate;
                                                const canCreate = !isSent && !isBooked && motExpiry && (daysLeft! > -300);
                                                const taxStatus = item.liveTaxStatus || null;

                                                return (
                                                    <TableRow key={i} className={`group ${status === "expired" ? "bg-red-50/50 hover:bg-red-50" : status === "due" ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-slate-50"}`}>
                                                        <TableCell className="pl-4">
                                                            <Checkbox checked={selectedRegs.has(item.registration)} onCheckedChange={() => toggleSelectRow(item.registration)} />
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col gap-1">
                                                                {item.vehicleId ? (
                                                                    <Link href={`/view-vehicle/${encodeURIComponent(item.registration)}`}>
                                                                        <span className="inline-block w-fit rounded bg-yellow-300 px-1.5 py-0.5 font-mono text-xs font-bold text-black ring-1 ring-yellow-500/60 hover:ring-yellow-600 cursor-pointer">
                                                                            {item.registration}
                                                                        </span>
                                                                    </Link>
                                                                ) : (
                                                                    <span className="inline-block w-fit rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-700 ring-1 ring-slate-300">
                                                                        {item.registration}
                                                                    </span>
                                                                )}
                                                                {(item.vehicleMake || item.vehicleModel) && (
                                                                    <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                                                                        {[item.vehicleMake, item.vehicleModel].filter(Boolean).join(" ")}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col">
                                                                {item.customerId ? (
                                                                    <Link href={`/customers/${item.customerId}`}>
                                                                        <span className="text-sm font-medium text-slate-800 hover:text-violet-700 hover:underline truncate max-w-[160px] cursor-pointer" title={item.customerName || ""}>
                                                                            {item.customerName || "Unknown"}
                                                                        </span>
                                                                    </Link>
                                                                ) : (
                                                                    <span className="text-sm font-medium text-slate-800 truncate max-w-[160px]" title={item.customerName || ""}>
                                                                        {item.customerName || <span className="text-muted-foreground font-normal">Unknown</span>}
                                                                    </span>
                                                                )}
                                                                <span className="text-xs text-muted-foreground font-mono">{item.customerPhone || "—"}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="whitespace-nowrap">
                                                            <div className="flex flex-col">
                                                                <span className={`text-sm ${status === "expired" ? "font-semibold text-red-700" : "font-medium"}`}>
                                                                    {motExpiry ? motExpiry.toLocaleDateString("en-GB") : <span className="text-muted-foreground italic font-normal">No data</span>}
                                                                </span>
                                                                {item.liveMotBookedDate ? (
                                                                    <span className="text-[11px] text-emerald-600 font-medium">Booked {new Date(item.liveMotBookedDate).toLocaleDateString("en-GB")}</span>
                                                                ) : item.lastChecked ? (
                                                                    <span className="text-[10px] text-muted-foreground">checked {new Date(item.lastChecked).toLocaleDateString("en-GB")}</span>
                                                                ) : null}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            {status === 'expired' && <Pill tone="red">Expired {Math.abs(daysLeft!)}d ago</Pill>}
                                                            {status === 'due' && <Pill tone="amber">Due in {daysLeft}d</Pill>}
                                                            {status === 'valid' && <Pill tone="green">{daysLeft}d left</Pill>}
                                                            {status === 'unknown' && <Pill tone="slate">No MOT data</Pill>}
                                                        </TableCell>
                                                        <TableCell>
                                                            {taxStatus ? (
                                                                taxStatus.toLowerCase() === 'taxed'
                                                                    ? <Pill tone="green">Taxed</Pill>
                                                                    : taxStatus.toLowerCase() === 'sorn'
                                                                        ? <Pill tone="slate">SORN</Pill>
                                                                        : <Pill tone="red">{taxStatus}</Pill>
                                                            ) : <span className="text-muted-foreground text-xs">—</span>}
                                                        </TableCell>
                                                        <TableCell className="whitespace-nowrap">
                                                            {isSent ? (
                                                                <div className="flex flex-col gap-0.5">
                                                                    <span className="text-xs font-medium" title={sentFull}>{sentRelative || sentFull}</span>
                                                                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground capitalize">
                                                                        {item.lastStatus === "read" ? <Eye className="w-3 h-3 text-blue-600" /> :
                                                                            item.lastStatus === "delivered" ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> :
                                                                                item.lastStatus === "sent" ? <Clock className="w-3 h-3 text-amber-500" /> :
                                                                                    item.lastStatus === "failed" ? <XCircle className="w-3 h-3 text-red-500" /> :
                                                                                        <Clock className="w-3 h-3 text-slate-400" />}
                                                                        {item.lastStatus || 'queued'}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">Never</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right pr-4">
                                                            <div className="flex items-center justify-end gap-1">
                                                                {isSent ? (
                                                                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium pr-1"><CheckCircle className="w-3.5 h-3.5" /> Sent</span>
                                                                ) : canCreate ? (
                                                                    <>
                                                                        <CreateReminderButton
                                                                            item={item}
                                                                            onSuccess={() => {
                                                                                const newResults = [...results];
                                                                                const index = newResults.findIndex(r => r.registration === item.registration);
                                                                                if (index !== -1) {
                                                                                    newResults[index] = { ...item, lastSent: new Date().toISOString() };
                                                                                    setResults(newResults);
                                                                                    localStorage.setItem("ga4_scan_results", JSON.stringify(newResults));
                                                                                }
                                                                            }}
                                                                        />
                                                                        <Button
                                                                            size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                                                            title="Mark as booked" disabled={!item.vehicleId}
                                                                            onClick={() => { setBookingTargetRegs(new Set([item.registration])); setShowBookedDialog(true); }}
                                                                        >
                                                                            <CalendarCheck className="w-4 h-4" />
                                                                        </Button>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-[11px] text-muted-foreground pr-1" title={isBooked ? "MOT already booked" : "No MOT data or too old"}>
                                                                        {isBooked ? "Booked ✓" : "—"}
                                                                    </span>
                                                                )}
                                                                <Button
                                                                    size="icon" variant="ghost"
                                                                    className="h-7 w-7 text-slate-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                    title="Remove this row"
                                                                    onClick={() => handleDeleteRow(item.registration)}
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                            {sortedFilteredResults.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                                                        Nothing matches — try clearing the search or "Hide sent".
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* Booked dialog (shared by bulk + per-row) */}
                <Dialog open={showBookedDialog} onOpenChange={(open) => { setShowBookedDialog(open); if (!open) setBookingTargetRegs(null); }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Mark MOT booked</DialogTitle>
                            <DialogDescription>
                                Pick the date the MOT is booked for — we won't send reminders for these vehicles this cycle.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-2">
                            <label className="text-sm font-medium block mb-2">Booked date</label>
                            <Input type="date" value={bookedDate} onChange={(e) => setBookedDate(e.target.value)} />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowBookedDialog(false)}>Cancel</Button>
                            <Button onClick={handleMarkBooked} disabled={!bookedDate || markBookedMutation.isPending}>
                                {markBookedMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Save booking
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </DashboardLayout>
    );
}
