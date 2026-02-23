import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from '@/lib/trpc';
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Search, XCircle, Loader2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { fileToBase64 } from '@/lib/utils';
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { MOTRefreshButton } from "@/components/MOTRefreshButton";


function CreateReminderButton({ item, onSuccess }: { item: any, onSuccess: () => void }) {
    const createMutation = trpc.reminders.createManualReminder.useMutation();
    const sendMutation = trpc.reminders.sendWhatsApp.useMutation();
    const [status, setStatus] = useState<"idle" | "creating" | "sending" | "done">("idle");

    const handleCreateAndSend = async () => {
        if (!confirm(`Create and Send MOT reminder for ${item.registration}?`)) return;

        try {
            setStatus("creating");
            // 1. Create
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

            // 2. Send
            setStatus("sending");
            await sendMutation.mutateAsync({
                id: Number(result.reminderId),
                phoneNumber: result.customerPhone,
                customerName: result.customerName,
                registration: item.registration,
                messageType: "MOT"
            });

            setStatus("done");
            alert(`Success! Reminder created and sent to ${result.customerPhone}`);
            onSuccess();

        } catch (e: any) {
            console.error(e);
            setStatus("idle");
            alert("Error: " + e.message);
        }
    };

    return (
        <Button
            size="sm"
            variant="default"
            disabled={status !== "idle"}
            onClick={handleCreateAndSend}
            className={status === "done" ? "bg-green-600 hover:bg-green-700" : ""}
        >
            {status === "creating" && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
            {status === "sending" && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
            {status === "idle" && "Create & Send"}
            {status === "creating" && "Creating..."}
            {status === "sending" && "Sending..."}
            {status === "done" && "Sent!"}
        </Button>
    )
}

export default function GA4Scanner() {
    const [file, setFile] = useState<File | null>(null);
    const [results, setResults] = useState<any[]>(() => {
        // Load from local storage on mount
        const saved = localStorage.getItem("ga4_scan_results");
        return saved ? JSON.parse(saved) : [];
    });
    const [isScanning, setIsScanning] = useState(false);
    const [selectedRegs, setSelectedRegs] = useState<Set<string>>(new Set());

    const toggleSelectAll = () => {
        if (selectedRegs.size === results.length) {
            setSelectedRegs(new Set());
        } else {
            setSelectedRegs(new Set(results.map(r => r.registration)));
        }
    };

    const toggleSelectRow = (reg: string) => {
        const next = new Set(selectedRegs);
        if (next.has(reg)) {
            next.delete(reg);
        } else {
            next.add(reg);
        }
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
            alert("Failed to scan: " + err.message);
        }
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleScan = async () => {
        if (!file) return;
        setIsScanning(true);
        // Don't clear immediately to allow retry if failed, but maybe good UX to clear
        // setResults([]); 
        try {
            const base64 = await fileToBase64(file);
            scanMutation.mutate({ imageData: base64 });
        } catch (e) {
            setIsScanning(false);
            alert("Error processing file");
        }
    };

    // Add clear results button/functionality if needed
    const clearResults = () => {
        setResults([]);
        setSelectedRegs(new Set());
        localStorage.removeItem("ga4_scan_results");
    };

    // Extract valid vehicle IDs for the bulk refresh action
    const selectedVehicleIds = Array.from(selectedRegs)
        .map(reg => results.find(r => r.registration === reg)?.vehicleId)
        .filter((id): id is number => id !== null && id !== undefined);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-bold tracking-tight">GA4 Cross-Check Scanner</h1>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Scan GA4 Screenshot</CardTitle>
                        <CardDescription>Upload a screenshot of your GA4 reminder list. We will scan the registrations and check if we have already sent a reminder for them in this system.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-4 max-w-md">
                            <Input type="file" accept="image/*" onChange={handleFileChange} disabled={isScanning} />
                            <Button onClick={handleScan} disabled={!file || isScanning}>
                                {isScanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                Scan & Check
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {results.length > 0 && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Scan Results ({results.length} found)</CardTitle>
                            <div className="flex items-center gap-2">
                                <MOTRefreshButton
                                    vehicleIds={selectedVehicleIds}
                                    disabled={selectedVehicleIds.length === 0}
                                    variant="outline"
                                    size="sm"
                                    label="Refresh MOT"
                                    onComplete={() => {
                                        if (file) {
                                            handleScan();
                                            setSelectedRegs(new Set());
                                        } else {
                                            alert("Please upload the file and scan again to see the updated results");
                                        }
                                    }}
                                />
                                <Button variant="ghost" size="sm" onClick={clearResults} className="text-muted-foreground hover:text-destructive">
                                    Clear Results
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[40px]">
                                            <Checkbox
                                                checked={results.length > 0 && selectedRegs.size === results.length}
                                                onCheckedChange={toggleSelectAll}
                                            />
                                        </TableHead>
                                        <TableHead className="w-[120px]">Reg</TableHead>
                                        <TableHead className="w-[150px]">Customer</TableHead>
                                        <TableHead className="w-[140px]">Contact</TableHead>
                                        <TableHead className="w-[180px]">Vehicle</TableHead>
                                        <TableHead className="w-[100px]">MOT</TableHead>
                                        <TableHead className="w-[120px]">Status</TableHead>
                                        <TableHead className="w-[100px]">Tax</TableHead>
                                        <TableHead className="w-[100px]">Last Sent</TableHead>
                                        <TableHead className="w-[90px]">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {results.map((item, i) => {
                                        const isSent = !!item.lastSent;
                                        // Handle date parsing safely - lastSent comes as string from JSON
                                        const sentDateObj = item.lastSent ? new Date(item.lastSent) : null;
                                        const sentDate = sentDateObj ? sentDateObj.toLocaleDateString() + ' ' + sentDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';

                                        // Live MOT/Tax Logic
                                        const motExpiry = item.liveMotExpiryDate ? new Date(item.liveMotExpiryDate) : null;

                                        // Calculate days left relative to today
                                        const today = new Date();
                                        const diffTime = motExpiry ? motExpiry.getTime() - today.getTime() : 0;
                                        const daysLeft = motExpiry ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : null;

                                        // Determine status for badge
                                        let status: 'expired' | 'due' | 'valid' | 'unknown' = 'unknown';
                                        if (motExpiry) {
                                            if (daysLeft! < 0) status = 'expired';
                                            else if (daysLeft! <= 30) status = 'due';
                                            else status = 'valid';
                                        }

                                        const motString = motExpiry ? motExpiry.toLocaleDateString("en-GB") : 'No data';
                                        const isMotValid = status === 'valid' || status === 'due'; // Valid enough to create a reminder for (even if due soon)

                                        const taxStatus = item.liveTaxStatus || 'Unknown';
                                        const isTaxed = taxStatus.toLowerCase() === 'taxed';
                                        const canCreate = !isSent && motExpiry && (daysLeft! > -300); // Allow creating if expired reasonably recently or valid

                                        return (
                                            <TableRow key={i} className={
                                                status === "expired" ? "bg-red-50" :
                                                    status === "due" ? "bg-orange-50" :
                                                        ""
                                            }>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedRegs.has(item.registration)}
                                                        onCheckedChange={() => toggleSelectRow(item.registration)}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-mono font-semibold text-xs text-blue-600 hover:underline">
                                                    {item.vehicleId ? (
                                                        <Link href={`/view-vehicle/${encodeURIComponent(item.registration)}`}>
                                                            {item.registration}
                                                        </Link>
                                                    ) : (
                                                        item.registration
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="text-xs">
                                                        {item.customerId ? (
                                                            <Link href={`/customers/${item.customerId}`}>
                                                                <span className="font-medium text-blue-600 hover:underline truncate max-w-[140px]" title={item.customerName || ""}>
                                                                    {item.customerName || "Unknown"}
                                                                </span>
                                                            </Link>
                                                        ) : (
                                                            <span className="font-medium text-blue-600 truncate max-w-[140px]" title={item.customerName || ""}>
                                                                {item.customerName || "Unknown"}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="text-xs text-slate-500 font-mono">{item.customerPhone || "-"}</div>
                                                </TableCell>
                                                <TableCell>
                                                    {item.vehicleMake || item.vehicleModel ? (
                                                        <div className="text-xs">
                                                            <div className="font-medium truncate">{item.vehicleMake || "Unknown"}</div>
                                                            <div className="text-slate-500 truncate">{item.vehicleModel || ""}</div>
                                                        </div>
                                                    ) : "-"}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    {motExpiry ? (
                                                        motString
                                                    ) : (
                                                        <span className="text-slate-400">No data</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {status === 'expired' && <Badge variant="destructive" className="bg-red-500">Expired {Math.abs(daysLeft!)}d ago</Badge>}
                                                    {status === 'due' && <Badge variant="default" className="bg-orange-500">Due in {daysLeft}d</Badge>}
                                                    {status === 'valid' && <Badge variant="default" className="bg-green-500">{daysLeft}d left</Badge>}
                                                    {status === 'unknown' && <Badge variant="secondary">No MOT Data</Badge>}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    {item.liveTaxStatus ? (
                                                        <Badge
                                                            variant={
                                                                item.liveTaxStatus === 'Taxed' ? 'outline' :
                                                                    item.liveTaxStatus === 'SORN' ? 'secondary' :
                                                                        'destructive'
                                                            }
                                                            className={
                                                                item.liveTaxStatus === 'Taxed' ? "text-green-600 border-green-200 bg-green-50" : ""
                                                            }
                                                        >
                                                            {item.liveTaxStatus}
                                                        </Badge>
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className="align-middle text-muted-foreground text-xs">
                                                    {sentDate}
                                                </TableCell>
                                                <TableCell className="align-middle">
                                                    {isSent ? (
                                                        <Button size="icon" variant="ghost" disabled title="Already Sent">
                                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                                        </Button>
                                                    ) : (
                                                        canCreate ? (
                                                            <CreateReminderButton
                                                                item={item}
                                                                onSuccess={() => {
                                                                    // Update local state to show 'sent' for this item temporarily
                                                                    const newResults = [...results];
                                                                    newResults[i] = { ...item, lastSent: new Date().toISOString() };
                                                                    setResults(newResults);
                                                                    localStorage.setItem("ga4_scan_results", JSON.stringify(newResults));
                                                                }}
                                                            />
                                                        ) : (
                                                            <Button size="icon" variant="ghost" disabled title="Cannot create reminder (No MOT data or too old)">
                                                                <XCircle className="w-4 h-4 text-slate-300" />
                                                            </Button>
                                                        )
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}
            </div>
        </DashboardLayout>
    );
}
