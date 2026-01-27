import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Send,
    Trash2,
    Loader2,
    Pencil,
    CalendarDays,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    AlertCircle,
    CheckCircle2,
    Clock,
    XCircle as XCircleIcon,
    Eye,
    ChevronUp,
    ChevronDown
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { formatMOTDate, getMOTStatusBadge } from "@/lib/motUtils";
import { trpc } from "@/lib/trpc";
import { BookMOTDialog } from "./BookMOTDialog";

export interface VehicleData {
    id: number;
    registration: string;
    customerName: string | null;
    customerPhone: string | null;
    customerId: number | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    motExpiryDate: Date | string | null;
    dueDate?: Date | string | null; // For reminders
    type?: string; // For reminders
    status?: string;
    taxStatus?: string | null;
    taxDueDate?: Date | string | null;
    lastReminderSent?: Date | string | null;
    lastReminderStatus?: string | null;
    deliveryStatus?: string | null;
    sentAt?: Date | string | null;
    customerOptedOut?: boolean | number | null;
    dateOfRegistration?: Date | string | null;
    lastChecked?: Date | string | null;
    customerResponded?: boolean | number;
    needsFollowUp?: boolean | number;
}

interface UnifiedVehicleTableProps {
    data: VehicleData[];
    isLoading?: boolean;
    onEdit?: (item: VehicleData) => void;
    onMarkResponded?: (id: number) => void;
    refetch?: () => void;
    showFilters?: boolean;
    itemsPerPage?: number;
    selectedIds?: Set<number>;
    onSelectionChange?: (ids: Set<number>) => void;
}

type SortColumn = "registration" | "customer" | "vehicle" | "motExpiry" | "status" | "lastSent" | "dueDate";
type SortDirection = "asc" | "desc";

export function UnifiedVehicleTable({
    data,
    isLoading,
    onEdit,
    onMarkResponded,
    refetch,
    showFilters = true,
    itemsPerPage = 50,
    selectedIds: propsSelectedIds,
    onSelectionChange
}: UnifiedVehicleTableProps) {
    const [sortColumn, setSortColumn] = useState<SortColumn>("motExpiry");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [currentPage, setCurrentPage] = useState(1);
    const [internalSelectedIds, setInternalSelectedIds] = useState<Set<number>>(new Set());

    const selectedIds = propsSelectedIds ?? internalSelectedIds;
    const setSelectedIds = (ids: Set<number>) => {
        if (onSelectionChange) onSelectionChange(ids);
        else setInternalSelectedIds(ids);
    };
    const [isSendingBatch, setIsSendingBatch] = useState(false);
    const [isDeletingBatch, setIsDeletingBatch] = useState(false);

    // Book MOT State
    const [isBookMOTOpen, setIsBookMOTOpen] = useState(false);
    const [selectedVehicleForMOT, setSelectedVehicleForMOT] = useState<{ id: number, registration: string, currentExpiry?: Date | string } | null>(null);

    const utils = trpc.useUtils();

    // Mutations
    const deleteMutation = trpc.database.delete.useMutation({
        onSuccess: () => {
            toast.success("Deleted successfully");
            refetch?.();
            utils.reminders.list.invalidate();
        },
        onError: (error) => toast.error(`Failed to delete: ${error.message}`),
    });

    const sendWhatsApp = trpc.reminders.sendWhatsApp.useMutation({
        onSuccess: async () => {
            toast.success("WhatsApp message sent");
            await new Promise(resolve => setTimeout(resolve, 500));
            refetch?.();
            utils.reminders.list.invalidate();
        },
        onError: (error) => toast.error(`Failed to send: ${error.message}`),
    });

    // Handlers
    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortColumn(column);
            setSortDirection("asc");
        }
    };

    const getSortIcon = (column: SortColumn) => {
        if (sortColumn !== column) return <ArrowUpDown className="w-4 h-4 ml-1 opacity-30" />;
        return sortDirection === "asc" ? <ArrowUp className="w-4 h-4 ml-1" /> : <ArrowDown className="w-4 h-4 ml-1" />;
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            const ids = sortedData.map(v => v.id);
            setSelectedIds(new Set(ids));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectOne = (id: number, checked: boolean) => {
        const newSelected = new Set(selectedIds);
        if (checked) newSelected.add(id);
        else newSelected.delete(id);
        setSelectedIds(newSelected);
    };

    const handleBatchSend = async () => {
        const selected = sortedData.filter(v => selectedIds.has(v.id));
        if (selected.length === 0) return;

        setIsSendingBatch(true);
        let success = 0, fail = 0;

        for (const item of selected) {
            if (!item.customerPhone) {
                fail++;
                continue;
            }
            try {
                await sendWhatsApp.mutateAsync({
                    id: 0,
                    phoneNumber: item.customerPhone,
                    messageType: (item.type || "MOT") as "MOT" | "Service",
                    customerName: item.customerName || "Customer",
                    registration: item.registration,
                    expiryDate: item.motExpiryDate ? new Date(item.motExpiryDate).toLocaleDateString("en-GB") : undefined,
                    vehicleId: item.id,
                    customerId: item.customerId ?? undefined,
                });
                success++;
            } catch {
                fail++;
            }
        }

        setIsSendingBatch(false);
        setSelectedIds(new Set());
        if (success > 0) toast.success(`Sent ${success} messages`);
        if (fail > 0) toast.error(`Failed to send ${fail} messages`);
        refetch?.();
        utils.reminders.list.invalidate();
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${selectedIds.size} vehicles?`)) return;

        setIsDeletingBatch(true);
        try {
            await deleteMutation.mutateAsync({ vehicleIds: Array.from(selectedIds) });
            setSelectedIds(new Set());
        } catch (e) {
            console.error(e);
        } finally {
            setIsDeletingBatch(false);
        }
    };

    const handleBookMOTClick = (item: VehicleData) => {
        setSelectedVehicleForMOT({
            id: item.id,
            registration: item.registration,
            currentExpiry: item.motExpiryDate || undefined
        });
        setIsBookMOTOpen(true);
    };

    const getDeliveryStatusIcon = (status: string | null | undefined) => {
        if (!status) return null;
        switch (status) {
            case "read": return <span title="Read"><Eye className="w-4 h-4 text-blue-600" /></span>;
            case "delivered": return <span title="Delivered"><CheckCircle2 className="w-4 h-4 text-green-600" /></span>;
            case "sent": return <span title="Sent"><Clock className="w-4 h-4 text-yellow-600" /></span>;
            case "failed": return <span title="Failed"><XCircleIcon className="w-4 h-4 text-red-600" /></span>;
            default: return <span title="Queued"><Clock className="w-4 h-4 text-gray-400" /></span>;
        }
    };

    // Filter and Sort Logic
    const filteredData = useMemo(() => {
        return data.filter(item => {
            if (typeFilter !== "all" && item.type?.toLowerCase() !== typeFilter.toLowerCase()) return false;

            if (statusFilter !== "all") {
                if (statusFilter === "responded" && !item.customerResponded) return false;
                if (statusFilter === "needs_followup" && !item.needsFollowUp) return false;
                if (statusFilter === "sent" && (item.customerResponded || item.needsFollowUp)) return false;
                if (statusFilter !== "responded" && statusFilter !== "needs_followup" && statusFilter !== "sent" && item.status !== statusFilter) return false;
            }

            return true;
        });
    }, [data, typeFilter, statusFilter]);

    const sortedData = useMemo(() => {
        return [...filteredData].sort((a, b) => {
            let aVal: any, bVal: any;
            switch (sortColumn) {
                case "registration": aVal = a.registration; bVal = b.registration; break;
                case "customer": aVal = a.customerName || ""; bVal = b.customerName || ""; break;
                case "vehicle": aVal = `${a.vehicleMake || ""} ${a.vehicleModel || ""}`; bVal = `${b.vehicleMake || ""} ${b.vehicleModel || ""}`; break;
                case "motExpiry": aVal = a.motExpiryDate ? new Date(a.motExpiryDate).getTime() : 0; bVal = b.motExpiryDate ? new Date(b.motExpiryDate).getTime() : 0; break;
                case "dueDate": aVal = a.dueDate ? new Date(a.dueDate).getTime() : 0; bVal = b.dueDate ? new Date(b.dueDate).getTime() : 0; break;
                case "status": aVal = a.status || ""; bVal = b.status || ""; break;
                case "lastSent": aVal = (a.lastReminderSent || a.sentAt) ? new Date((a.lastReminderSent || a.sentAt)!).getTime() : 0; bVal = (b.lastReminderSent || b.sentAt) ? new Date((b.lastReminderSent || b.sentAt)!).getTime() : 0; break;
                default: return 0;
            }
            if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
            if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
            return 0;
        });
    }, [filteredData, sortColumn, sortDirection]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return sortedData.slice(start, start + itemsPerPage);
    }, [sortedData, currentPage, itemsPerPage]);

    const totalPages = Math.ceil(sortedData.length / itemsPerPage);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {showFilters && (
                <div className="flex flex-wrap gap-4 items-center mb-4">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium">Type:</label>
                        <Select value={typeFilter} onValueChange={setTypeFilter}>
                            <SelectTrigger className="w-[140px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="mot">MOT</SelectItem>
                                <SelectItem value="service">Service</SelectItem>
                                <SelectItem value="cambelt">Cambelt</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium">Status:</label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[140px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="sent">Sent</SelectItem>
                                <SelectItem value="responded">Responded</SelectItem>
                                <SelectItem value="needs_followup">Follow-up</SelectItem>
                                <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="ml-auto flex gap-2">
                        {selectedIds.size > 0 && (
                            <>
                                <Button onClick={handleBatchSend} disabled={isSendingBatch} size="sm">
                                    {isSendingBatch ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                                    Send ({selectedIds.size})
                                </Button>
                                <Button onClick={handleBatchDelete} variant="destructive" size="sm" disabled={isDeletingBatch}>
                                    {isDeletingBatch ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                    Delete ({selectedIds.size})
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="rounded-md border overflow-hidden bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-12">
                                <Checkbox
                                    checked={selectedIds.size > 0 && selectedIds.size === paginatedData.length}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead onClick={() => handleSort("registration")} className="cursor-pointer">
                                <div className="flex items-center">Reg {getSortIcon("registration")}</div>
                            </TableHead>
                            <TableHead onClick={() => handleSort("customer")} className="cursor-pointer">
                                <div className="flex items-center">Customer {getSortIcon("customer")}</div>
                            </TableHead>
                            <TableHead onClick={() => handleSort("vehicle")} className="cursor-pointer">
                                <div className="flex items-center">Vehicle {getSortIcon("vehicle")}</div>
                            </TableHead>
                            <TableHead onClick={() => handleSort("motExpiry")} className="cursor-pointer">
                                <div className="flex items-center">MOT Expiry {getSortIcon("motExpiry")}</div>
                            </TableHead>
                            <TableHead>Tax</TableHead>
                            <TableHead onClick={() => handleSort("lastSent")} className="cursor-pointer">
                                <div className="flex items-center">Last Sent {getSortIcon("lastSent")}</div>
                            </TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paginatedData.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                    No vehicles found matching filters
                                </TableCell>
                            </TableRow>
                        ) : (
                            paginatedData.map((item) => {
                                const motInfo = item.motExpiryDate ? formatMOTDate(item.motExpiryDate) : null;
                                const statusBadge = motInfo ? getMOTStatusBadge(motInfo) : null;
                                const lastSentDate = item.lastReminderSent || item.sentAt;
                                const lastStatus = item.lastReminderStatus || item.deliveryStatus;

                                return (
                                    <TableRow key={item.id} className={statusBadge?.text.includes("Expired") ? "bg-red-50/50" : statusBadge?.text.includes("Due") ? "bg-orange-50/50" : ""}>
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedIds.has(item.id)}
                                                onCheckedChange={(checked) => handleSelectOne(item.id, checked as boolean)}
                                                disabled={!!item.customerOptedOut || !item.customerPhone}
                                            />
                                        </TableCell>
                                        <TableCell className="font-mono font-bold text-sm">
                                            <div className="flex flex-col">
                                                <Link href={`/vehicles/${encodeURIComponent(item.registration)}`}>
                                                    <span className="text-primary hover:underline cursor-pointer">{item.registration}</span>
                                                </Link>
                                                {item.dateOfRegistration && (
                                                    <span className="text-[10px] text-muted-foreground">
                                                        ({new Date(item.dateOfRegistration).getFullYear()})
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <Link href={item.customerId ? `/customers/${item.customerId}` : "#"}>
                                                    <span className={`${item.customerId ? 'text-blue-600 hover:underline cursor-pointer' : ''} font-medium`}>
                                                        {item.customerName || "Unknown"}
                                                    </span>
                                                </Link>
                                                <span className="text-xs text-muted-foreground font-mono">{item.customerPhone || "-"}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            <div className="flex flex-col">
                                                <span>{item.vehicleMake || "-"}</span>
                                                <span className="text-xs text-muted-foreground">{item.vehicleModel || ""}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {motInfo ? (
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-sm">{typeof motInfo === 'string' ? motInfo : motInfo.date}</span>
                                                    {statusBadge && <Badge variant={statusBadge.variant} className={statusBadge.className + " w-fit text-[10px]"}>{statusBadge.text}</Badge>}
                                                </div>
                                            ) : "-"}
                                        </TableCell>
                                        <TableCell>
                                            {item.taxStatus ? (
                                                <div className="flex flex-col gap-0.5">
                                                    <Badge
                                                        variant={item.taxStatus === 'Taxed' ? 'outline' : item.taxStatus === 'SORN' ? 'secondary' : 'destructive'}
                                                        className={item.taxStatus === 'Taxed' ? "text-green-600 border-green-200 bg-green-50 text-[10px]" : "text-[10px]"}
                                                    >
                                                        {item.taxStatus}
                                                    </Badge>
                                                    {item.taxDueDate && (
                                                        <span className="text-[9px] text-muted-foreground whitespace-nowrap">Exp: {new Date(item.taxDueDate).toLocaleDateString("en-GB")}</span>
                                                    )}
                                                </div>
                                            ) : "-"}
                                        </TableCell>
                                        <TableCell>
                                            {lastSentDate ? (
                                                <div className="flex flex-col text-xs">
                                                    <span className="font-medium">{new Date(lastSentDate).toLocaleDateString("en-GB")}</span>
                                                    <div className="flex flex-col gap-1 mt-1">
                                                        <div className="flex items-center gap-1">
                                                            {getDeliveryStatusIcon(lastStatus)}
                                                            <span className="text-[10px] text-muted-foreground capitalize">{lastStatus || "sent"}</span>
                                                        </div>
                                                        {item.customerResponded ? (
                                                            <Badge variant="default" className="text-[9px] h-4 px-1 gap-1 w-fit">
                                                                <CheckCircle2 className="h-2.5 w-2.5" />
                                                                Responded
                                                            </Badge>
                                                        ) : item.needsFollowUp ? (
                                                            <Badge variant="destructive" className="text-[9px] h-4 px-1 gap-1 w-fit">
                                                                <Clock className="h-2.5 w-2.5" />
                                                                Follow-up
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            ) : <span className="text-slate-400 text-xs italic">Never</span>}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {item.sentAt && !item.customerResponded && onMarkResponded && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => onMarkResponded(item.id)}
                                                        className="text-[10px] h-7 px-2"
                                                    >
                                                        Mark Responded
                                                    </Button>
                                                )}
                                                <Button variant="ghost" size="sm" onClick={() => onEdit?.(item)}>
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleBookMOTClick(item)} title="Book MOT">
                                                    <CalendarDays className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={!item.customerPhone}
                                                    onClick={() => sendWhatsApp.mutate({
                                                        id: 0,
                                                        phoneNumber: item.customerPhone!,
                                                        messageType: (item.type || "MOT") as "MOT" | "Service",
                                                        customerName: item.customerName || "Customer",
                                                        registration: item.registration,
                                                        expiryDate: item.motExpiryDate ? new Date(item.motExpiryDate).toLocaleDateString("en-GB") : undefined,
                                                        vehicleId: item.id,
                                                        customerId: item.customerId ?? undefined,
                                                    })}
                                                >
                                                    {sendWhatsApp.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => {
                                                    if (confirm("Delete this vehicle?")) {
                                                        deleteMutation.mutate({ vehicleIds: [item.id] });
                                                    }
                                                }}>
                                                    <Trash2 className="w-4 h-4 text-red-500" />
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

            {totalPages > 1 && (
                <div className="flex items-center justify-between py-2">
                    <div className="text-sm text-muted-foreground">
                        Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedData.length)} of {sortedData.length}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</Button>
                        <div className="flex items-center text-sm font-medium px-2">Page {currentPage} of {totalPages}</div>
                        <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
                    </div>
                </div>
            )}

            {selectedVehicleForMOT && (
                <BookMOTDialog
                    open={isBookMOTOpen}
                    onOpenChange={setIsBookMOTOpen}
                    vehicleId={selectedVehicleForMOT.id}
                    registration={selectedVehicleForMOT.registration}
                    currentExpiryDate={selectedVehicleForMOT.currentExpiry}
                    onSuccess={() => {
                        refetch?.();
                        utils.reminders.list.invalidate();
                    }}
                />
            )}
        </div>
    );
}
