import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    MessageSquare,
    AlertTriangle,
    ShieldAlert,
    Zap,
    Loader2,
    Send,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    CalendarCheck,
    History,
    CalendarDays,
    Trash2
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChatHistory } from "@/components/ChatHistory";
import { BookMOTDialog } from "@/components/BookMOTDialog";
import { ServiceHistory } from "@/components/ServiceHistory";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";

type SortConfig = { key: "sentAt" | "registration" | "customerName" | "currentExpiry" | "daysLeft" | "taxStatus"; direction: "asc" | "desc" } | null;

export default function UrgentFollowUps() {
    const [isUpdating, setIsUpdating] = useState(false);
    const [isSendingBatch, setIsSendingBatch] = useState(false);
    const [selectedLogs, setSelectedLogs] = useState<Set<number>>(new Set());
    const [sortConfig, setSortConfig] = useState<SortConfig>(null);

    const { data: logs, isLoading, refetch } = trpc.logs.list.useQuery();
    const utils = trpc.useUtils();
    
    const sendReminderMutation = trpc.reminders.sendWhatsApp.useMutation({
        onSuccess: () => {
            toast.success("Follow-up reminder sent successfully!");
            refetch();
        },
        onError: (err) => {
            toast.error("Failed to send follow-up", { description: err.message });
        }
    });

    const bulkMOTCheck = trpc.database.bulkUpdateMOT.useMutation({
        onSuccess: (res) => {
            toast.success("MOT Check Complete", {
                description: `Updated ${res.updated} vehicles, ${res.failed} failed, ${res.skipped} skipped.`,
            });
            refetch();
            utils.database.getAllVehiclesWithCustomers.invalidate();
        },
        onError: (err) => {
            toast.error("MOT Check Failed", {
                description: err.message,
            });
        },
        onSettled: () => setIsUpdating(false)
    });

    const [selectedVehicleForMOT, setSelectedVehicleForMOT] = useState<{ id: number, registration: string, currentExpiry: string | null } | null>(null);
    const [isBookMOTOpen, setIsBookMOTOpen] = useState(false);

    const [showBookedDialog, setShowBookedDialog] = useState(false);
    const [bookingTargetIds, setBookingTargetIds] = useState<Set<number> | null>(null);
    const [bookedDate, setBookedDate] = useState("");

    const [historyOpen, setHistoryOpen] = useState(false);
    const [selectedVehicleForHistory, setSelectedVehicleForHistory] = useState<{ id: number, registration: string } | null>(null);

    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deletePendingId, setDeletePendingId] = useState<number | null>(null);

    const deleteVehicleMutation = trpc.database.delete.useMutation({
        onSuccess: () => {
            toast.success("Vehicle deleted successfully");
            setDeleteConfirmOpen(false);
            setDeletePendingId(null);
            setSelectedLogs(new Set());
            refetch();
        },
        onError: (err: any) => {
            toast.error("Failed to delete vehicle", { description: err.message });
            setDeletePendingId(null);
            setDeleteConfirmOpen(false);
        }
    });

    const markBookedMutation = trpc.database.markMOTBooked.useMutation({
        onSuccess: () => {
            toast.success("MOT Booked status updated");
            setShowBookedDialog(false);
            setBookingTargetIds(null);
            setBookedDate("");
            refetch();
        },
        onError: (err: any) => {
            toast.error("Failed to update status", { description: err.message });
        }
    });

    const handleMarkBooked = async () => {
        if (!bookingTargetIds) return;
        const arrayIds = Array.from(bookingTargetIds);
        if (arrayIds.length === 0) return;
        
        try {
            await markBookedMutation.mutateAsync({
                vehicleIds: arrayIds,
                date: bookedDate
            });
        } catch (e) {
            console.error("Failed to mark all as booked", e);
        }
    };

    const confirmDelete = async () => {
        if (deletePendingId) {
            deleteVehicleMutation.mutate({ vehicleIds: [deletePendingId] });
        }
    };

    const urgentLogs = useMemo(() => {
        if (!logs) return [];
        const filteredLogs = logs.filter(log => {
            if (!log.currentMOTExpiry || !log.dueDate) return false;

            const sentDate = new Date(log.sentAt);
            const today = new Date();
            const daysSinceSent = Math.floor((today.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));

            // Must be sent WITHIN the last 30 days
            if (daysSinceSent > 30) return false;

            // MOT must NOT be completed (current MOT has not advanced past due date)
            const isCompleted = new Date(log.currentMOTExpiry) > new Date(log.dueDate);
            if (isCompleted) return false;

            // Current MOT must be expired or due to expire within 14 days
            const currentExpiry = new Date(log.currentMOTExpiry);
            const daysToExpiry = Math.ceil((currentExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            
            if (daysToExpiry > 14) return false; // Not expiring soon

            return true;
        });

        if (sortConfig) {
            filteredLogs.sort((a, b) => {
                let aValue: any;
                let bValue: any;

                if (sortConfig.key === "sentAt") {
                    aValue = new Date(a.sentAt).getTime();
                    bValue = new Date(b.sentAt).getTime();
                } else if (sortConfig.key === "currentExpiry") {
                    aValue = new Date(a.currentMOTExpiry || 0).getTime();
                    bValue = new Date(b.currentMOTExpiry || 0).getTime();
                } else if (sortConfig.key === "daysLeft") {
                    const today = new Date().getTime();
                    aValue = Math.ceil((new Date(a.currentMOTExpiry || 0).getTime() - today) / (1000 * 60 * 60 * 24));
                    bValue = Math.ceil((new Date(b.currentMOTExpiry || 0).getTime() - today) / (1000 * 60 * 60 * 24));
                } else {
                    aValue = (a as any)[sortConfig.key] || "";
                    bValue = (b as any)[sortConfig.key] || "";
                }

                if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
                return 0;
            });
            return filteredLogs;
        }

        return filteredLogs.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    }, [logs, sortConfig]);

    const handleSort = (key: NonNullable<SortConfig>["key"]) => {
        setSortConfig((current: SortConfig) => {
            if (current?.key === key) {
                if (current.direction === "asc") return { key, direction: "desc" };
                return null;
            }
            return { key, direction: "asc" };
        });
    };

    const SortIcon = ({ columnKey }: { columnKey: NonNullable<SortConfig>["key"] }) => {
        if (sortConfig?.key !== columnKey) return <ArrowUpDown className="ml-2 h-3 w-3 inline text-slate-300" />;
        return sortConfig.direction === "asc" ? <ArrowUp className="ml-2 h-3 w-3 inline" /> : <ArrowDown className="ml-2 h-3 w-3 inline" />;
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedLogs(new Set(urgentLogs.map((l: any) => l.id)));
        } else {
            setSelectedLogs(new Set());
        }
    };

    const handleSelectOne = (id: number, checked: boolean) => {
        const newSet = new Set(selectedLogs);
        if (checked) newSet.add(id); else newSet.delete(id);
        setSelectedLogs(newSet);
    };

    const handleBatchSend = async () => {
        const logsToSend = urgentLogs.filter((l: any) => selectedLogs.has(l.id));
        if (logsToSend.length === 0) return;

        if (!confirm(`Are you sure you want to send urgent follow-up templates to ${logsToSend.length} numbers? This will charge your Twilio account.`)) {
            return;
        }

        setIsSendingBatch(true);
        let successCount = 0;
        let failCount = 0;

        for (const log of logsToSend) {
            if (!log.recipient) continue;
            try {
                await sendReminderMutation.mutateAsync({
                    id: 0,
                    phoneNumber: log.recipient,
                    messageType: "UrgentFollowUp",
                    customerName: log.customerName || "Customer",
                    registration: log.registration || "Unknown",
                    expiryDate: log.currentMOTExpiry ? new Date(log.currentMOTExpiry).toISOString() : undefined,
                    vehicleId: log.vehicleId || undefined,
                    customerId: log.customerId || undefined
                });
                successCount++;
            } catch (error) {
                failCount++;
            }
        }

        setIsSendingBatch(false);
        setSelectedLogs(new Set());
        if (successCount > 0 || failCount > 0) {
            toast.success(`Batch Complete`, {
                description: `Successfully sent ${successCount}. Failed: ${failCount}.`
            });
        }
    };

    const handleBulkMOTCheck = () => {
        const vehicleIds = Array.from(new Set(urgentLogs.map(log => log.vehicleId).filter((id): id is number => id !== null)));
        if (vehicleIds.length === 0) {
            toast.error("No vehicles found to check");
            return;
        }
        setIsUpdating(true);
        bulkMOTCheck.mutate({ vehicleIds });
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between border-b pb-4">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-2 text-red-600">
                            <ShieldAlert className="h-8 w-8" />
                            Urgent Follow-ups
                        </h1>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Reminders sent in the last 30 days where the MOT is either expired or expiring soon, and the test has not been recorded as completed.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            onClick={handleBatchSend}
                            disabled={isSendingBatch || selectedLogs.size === 0}
                            className="gap-2 shadow-lg"
                        >
                            {isSendingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-white" />}
                            {isSendingBatch ? "Sending..." : `Send Urgent Reminders (${selectedLogs.size})`}
                        </Button>
                        <Button
                            onClick={handleBulkMOTCheck}
                            disabled={isUpdating || urgentLogs.length === 0}
                            variant="secondary"
                            className="gap-2 shadow-sm transition-all"
                        >
                            {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                            {isUpdating ? "Checking MOTs..." : "Re-check MOTs"}
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Card className="border-red-200 bg-red-50/30">
                        <CardContent className="p-6 flex items-center justify-between">
                            <div>
                                <p className="text-red-700 font-medium text-sm">Action Required</p>
                                <p className="text-4xl font-bold text-red-700 mt-1">{urgentLogs.length}</p>
                            </div>
                            <div className="bg-red-100 p-3 rounded-full">
                                <AlertTriangle className="h-8 w-8 text-red-600" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-orange-200 bg-orange-50/30">
                        <CardContent className="p-6 flex items-center justify-between">
                            <div>
                                <p className="text-orange-700 font-medium text-sm">Expired MOTs in this list</p>
                                <p className="text-4xl font-bold text-orange-700 mt-1">
                                    {urgentLogs.filter(log => new Date(log.currentMOTExpiry!) < new Date()).length}
                                </p>
                            </div>
                            <div className="bg-orange-100 p-3 rounded-full">
                                <ShieldAlert className="h-8 w-8 text-orange-600" />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="border-red-100 shadow-md">
                    <CardHeader className="bg-red-50/50 border-b border-red-100 pb-4">
                        <CardTitle className="text-red-800 flex items-center gap-2 text-lg">
                            <AlertTriangle className="h-5 w-5" /> 
                            Critical Pending Follow-ups
                        </CardTitle>
                        <CardDescription className="text-red-600/80">
                            These accounts have received a reminder recently but are driving without a valid MOT, or will be very soon.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50">
                                        <TableHead className="w-[40px] px-4">
                                            <Checkbox 
                                                checked={urgentLogs.length > 0 && selectedLogs.size === urgentLogs.length}
                                                onCheckedChange={(c) => handleSelectAll(!!c)}
                                            />
                                        </TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort("sentAt")}>
                                            Sent Date <SortIcon columnKey="sentAt" />
                                        </TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort("registration")}>
                                            Registration <SortIcon columnKey="registration" />
                                        </TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort("customerName")}>
                                            Customer <SortIcon columnKey="customerName" />
                                        </TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort("taxStatus")}>
                                            Tax Status <SortIcon columnKey="taxStatus" />
                                        </TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort("currentExpiry")}>
                                            Current Expiry <SortIcon columnKey="currentExpiry" />
                                        </TableHead>
                                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort("daysLeft")}>
                                            Status <SortIcon columnKey="daysLeft" />
                                        </TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="h-24 text-center">Loading urgent follow-ups...</TableCell>
                                        </TableRow>
                                    ) : urgentLogs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="h-24 text-center text-muted-foreground font-medium">All clear! No urgent follow-ups found.</TableCell>
                                        </TableRow>
                                    ) : (
                                        urgentLogs.map((log) => {
                                            const sentDate = new Date(log.sentAt);
                                            const currentExpiry = new Date(log.currentMOTExpiry!);
                                            const isExpired = currentExpiry < new Date();
                                            const daysToExpiry = Math.ceil((currentExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                                            const daysSinceSent = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));

                                            return (
                                                <TableRow key={log.id} className={isExpired ? "bg-red-50/40" : "bg-orange-50/20"}>
                                                    <TableCell className="px-4">
                                                        <Checkbox 
                                                            checked={selectedLogs.has(log.id)}
                                                            onCheckedChange={(c) => handleSelectOne(log.id, !!c)}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-sm font-medium">
                                                        {sentDate.toLocaleDateString("en-GB")}
                                                        <div className="text-xs text-muted-foreground">{daysSinceSent} days ago</div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Link href={`/view-vehicle/${encodeURIComponent(log.registration || '')}`}>
                                                            <div className="bg-yellow-400 text-black px-1.5 py-0.5 rounded font-mono font-bold text-[10px] border border-black shadow-sm mb-1 block w-fit tracking-wide cursor-pointer hover:scale-105 transition-transform">
                                                                {log.registration}
                                                            </div>
                                                        </Link>
                                                        <div className="text-[10px] text-muted-foreground uppercase">{log.vehicleMake} {log.vehicleModel}</div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {log.customerId ? (
                                                            <Link href={`/customers/${log.customerId}`}>
                                                                <div className="font-bold cursor-pointer hover:underline text-blue-700 text-sm">{log.customerName || "Unknown"}</div>
                                                            </Link>
                                                        ) : (
                                                            <div className="font-bold text-sm text-slate-700">{log.customerName || "Unknown"}</div>
                                                        )}
                                                        <div className="text-xs text-slate-500 font-mono mt-0.5 opacity-80">{log.recipient}</div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {log.taxStatus && (
                                                            <div className={`text-[10px] uppercase font-black tracking-widest px-1.5 py-0.5 rounded w-fit ${
                                                                log.taxStatus.toLowerCase() === 'taxed' ? 'bg-green-100 text-green-800' :
                                                                log.taxStatus.toLowerCase() === 'sorn' ? 'bg-orange-100 text-orange-800' :
                                                                'bg-red-100 text-red-800'
                                                            }`}>
                                                                {log.taxStatus === "Not Taxed for on Road Use" ? "Not Taxed" : log.taxStatus}
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className={`text-sm font-bold ${isExpired ? "text-red-600" : "text-orange-600"}`}>
                                                            {currentExpiry.toLocaleDateString("en-GB")}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {isExpired ? (
                                                            <Badge variant="destructive" className="uppercase tracking-wider text-[10px] font-black">
                                                                Expired ({Math.abs(daysToExpiry)}d ago)
                                                            </Badge>
                                                        ) : (
                                                            <Badge className="bg-orange-500 hover:bg-orange-600 uppercase tracking-wider text-[10px] font-black border-none">
                                                                Expires in {daysToExpiry}d
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Dialog>
                                                                <DialogTrigger asChild>
                                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                                                                        <span title="Direct Message (Urgent)">
                                                                            <MessageSquare className="h-4 w-4" />
                                                                        </span>
                                                                    </Button>
                                                                </DialogTrigger>
                                                                <DialogContent className="max-w-3xl max-h-[90vh]">
                                                                    <DialogHeader>
                                                                        <DialogTitle>Chat with {log.customerName || log.recipient}</DialogTitle>
                                                                    </DialogHeader>
                                                                    <ChatHistory phoneNumber={log.recipient} />
                                                                </DialogContent>
                                                            </Dialog>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                                                                onClick={() => {
                                                                    if (log.vehicleId) {
                                                                        setBookingTargetIds(new Set([log.vehicleId]));
                                                                        setShowBookedDialog(true);
                                                                    }
                                                                }}
                                                                disabled={!log.vehicleId}
                                                            >
                                                                <span title="Mark as Booked">
                                                                    <CalendarCheck className="h-4 w-4" />
                                                                </span>
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                                onClick={() => {
                                                                    if (log.vehicleId && log.registration) {
                                                                        setSelectedVehicleForHistory({ id: log.vehicleId, registration: log.registration });
                                                                        setHistoryOpen(true);
                                                                    }
                                                                }}
                                                                disabled={!log.vehicleId}
                                                            >
                                                                <span title="View Service History">
                                                                    <History className="h-4 w-4" />
                                                                </span>
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 text-slate-600 hover:text-slate-700 hover:bg-slate-100"
                                                                onClick={() => {
                                                                    if (log.vehicleId && log.registration) {
                                                                        setSelectedVehicleForMOT({
                                                                            id: log.vehicleId,
                                                                            registration: log.registration,
                                                                            currentExpiry: log.currentMOTExpiry ? new Date(log.currentMOTExpiry).toISOString() : null
                                                                        });
                                                                        setIsBookMOTOpen(true);
                                                                    }
                                                                }}
                                                                disabled={!log.vehicleId}
                                                            >
                                                                <span title="Book MOT / Update Date">
                                                                    <CalendarDays className="h-4 w-4" />
                                                                </span>
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                                                onClick={() => {
                                                                    if (log.vehicleId) {
                                                                        setDeletePendingId(log.vehicleId);
                                                                        setDeleteConfirmOpen(true);
                                                                    }
                                                                }}
                                                                disabled={deleteVehicleMutation.isPending || !log.vehicleId}
                                                            >
                                                                <span title="Delete Vehicle">
                                                                    {deletePendingId === log.vehicleId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                                </span>
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                {/* Book MOT Dialog */}
                {selectedVehicleForMOT && (
                    <BookMOTDialog
                        open={isBookMOTOpen}
                        onOpenChange={setIsBookMOTOpen}
                        vehicleId={selectedVehicleForMOT.id}
                        registration={selectedVehicleForMOT.registration}
                        currentExpiryDate={selectedVehicleForMOT.currentExpiry}
                        onSuccess={() => refetch()}
                    />
                )}

                {/* Mark Booked Dialog */}
                <Dialog open={showBookedDialog} onOpenChange={(open) => {
                    setShowBookedDialog(open);
                    if (!open) setBookingTargetIds(null);
                }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Mark MOT Booked</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Booked Date</label>
                                <Input type="date" value={bookedDate} onChange={(e) => setBookedDate(e.target.value)} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowBookedDialog(false)}>Cancel</Button>
                            <Button onClick={handleMarkBooked} disabled={!bookedDate || markBookedMutation.isPending}>
                                {markBookedMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Save Booking
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Service History Dialog */}
                <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Service History: {selectedVehicleForHistory?.registration}</DialogTitle>
                        </DialogHeader>
                        {selectedVehicleForHistory && (
                            <ServiceHistory vehicleId={selectedVehicleForHistory.id} />
                        )}
                    </DialogContent>
                </Dialog>

                {/* Delete Confirmation */}
                <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Vehicle</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete this vehicle? This will also remove all associated reminders. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={(e) => {
                                    e.preventDefault();
                                    confirmDelete();
                                }}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                                {deleteVehicleMutation.isPending ? "Deleting..." : "Delete"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </DashboardLayout>
    );
}
