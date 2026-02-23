import { useState, useMemo } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    ArrowUpDown,
    ChevronUp,
    ChevronDown,
    Send,
    CalendarDays,
    Trash2,
    Loader2,
    Eye,
    CheckCircle2,
    Clock,
    XCircle,
    AlertTriangle,
    History
} from "lucide-react";
import { Link } from "wouter";

interface Vehicle {
    id: number;
    registration: string;
    make: string | null;
    model: string | null;
    motExpiryDate: Date | string | null;
    dateOfRegistration: Date | string | null;
    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    customerOptedOut: number | null;
    taxStatus: string | null;
    taxDueDate: Date | string | null;
    lastChecked?: Date | string | null;
    lastReminderSent: Date | string | null;
    lastReminderStatus: string | null;
}

interface ComprehensiveVehicleTableProps {
    vehicles: Vehicle[];
    isLoading: boolean;
    selectedVehicleIds: Set<number>;
    onSelectAll: (checked: boolean) => void;
    onSelectOne: (id: number, checked: boolean) => void;
    onSendReminder: (vehicle: Vehicle) => void;
    onBookMOT: (vehicle: Vehicle) => void;
    onDelete: (id: number) => void;
    isSendingBatch?: boolean;
    isDeletingBatch?: boolean;
    pendingVehicleId?: number | null;
    deletePendingId?: number | null;
    onViewHistory: (vehicle: Vehicle) => void;
}

type SortField = "registration" | "customer" | "make" | "motExpiry" | "lastSent" | "daysLeft";
type SortDirection = "asc" | "desc";

export function ComprehensiveVehicleTable({
    vehicles,
    isLoading,
    selectedVehicleIds,
    onSelectAll,
    onSelectOne,
    onSendReminder,
    onBookMOT,
    onDelete,
    isSendingBatch = false,
    isDeletingBatch = false,
    pendingVehicleId = null,
    deletePendingId = null,
    onViewHistory,
}: ComprehensiveVehicleTableProps) {
    const [sortField, setSortField] = useState<SortField>("registration");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("asc");
        }
    };

    const getSortIcon = (field: SortField) => {
        if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
        return sortDirection === "asc" ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />;
    };

    const getMOTStatus = (motExpiryDate: Date | string | null) => {
        if (!motExpiryDate) return { status: "none", daysLeft: null };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(motExpiryDate);
        expiry.setHours(0, 0, 0, 0);

        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return { status: "expired", daysLeft: diffDays };
        if (diffDays <= 30) return { status: "due", daysLeft: diffDays };
        return { status: "valid", daysLeft: diffDays };
    };

    const sortedVehicles = useMemo(() => {
        return [...vehicles].sort((a, b) => {
            let aVal: any;
            let bVal: any;

            switch (sortField) {
                case "registration":
                    aVal = a.registration || "";
                    bVal = b.registration || "";
                    break;
                case "customer":
                    aVal = a.customerName || "";
                    bVal = b.customerName || "";
                    break;
                case "make":
                    aVal = `${a.make || ""} ${a.model || ""}`;
                    bVal = `${b.make || ""} ${b.model || ""}`;
                    break;
                case "motExpiry":
                    aVal = a.motExpiryDate ? new Date(a.motExpiryDate).getTime() : 0;
                    bVal = b.motExpiryDate ? new Date(b.motExpiryDate).getTime() : 0;
                    break;
                case "lastSent":
                    aVal = a.lastReminderSent ? new Date(a.lastReminderSent).getTime() : 0;
                    bVal = b.lastReminderSent ? new Date(b.lastReminderSent).getTime() : 0;
                    break;
                case "daysLeft":
                    const aStatus = getMOTStatus(a.motExpiryDate);
                    const bStatus = getMOTStatus(b.motExpiryDate);
                    aVal = aStatus.daysLeft ?? 999999;
                    bVal = bStatus.daysLeft ?? 999999;
                    break;
                default:
                    return 0;
            }

            if (sortDirection === "asc") return aVal > bVal ? 1 : -1;
            return aVal < bVal ? 1 : -1;
        });
    }, [vehicles, sortField, sortDirection]);

    const getDeliveryStatusIcon = (status: string | null | undefined) => {
        if (!status) return null;
        switch (status) {
            case "read": return <span title="Read"><Eye className="w-3.5 h-3.5 text-blue-600" /></span>;
            case "delivered": return <span title="Delivered"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" /></span>;
            case "sent": return <span title="Sent"><Clock className="w-3.5 h-3.5 text-yellow-600" /></span>;
            case "failed": return <span title="Failed"><XCircle className="w-3.5 h-3.5 text-red-600" /></span>;
            default: return <span title="Queued"><Clock className="w-3.5 h-3.5 text-gray-400" /></span>;
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="rounded-md border overflow-hidden">
            <Table>
                <TableHeader className="bg-slate-50">
                    <TableRow>
                        <TableHead className="w-12 px-4">
                            <Checkbox
                                checked={vehicles.length > 0 && selectedVehicleIds.size === vehicles.filter(v => v.customerPhone).length && selectedVehicleIds.size > 0}
                                onCheckedChange={(checked) => onSelectAll(!!checked)}
                            />
                        </TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("registration")}>
                            <div className="flex items-center">Registration {getSortIcon("registration")}</div>
                        </TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("customer")}>
                            <div className="flex items-center">Customer {getSortIcon("customer")}</div>
                        </TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("make")}>
                            <div className="flex items-center">Vehicle {getSortIcon("make")}</div>
                        </TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("motExpiry")}>
                            <div className="flex items-center">MOT Expiry {getSortIcon("motExpiry")}</div>
                        </TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("daysLeft")}>
                            <div className="flex items-center">Days {getSortIcon("daysLeft")}</div>
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tax Status</TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("lastSent")}>
                            <div className="flex items-center">Last Sent {getSortIcon("lastSent")}</div>
                        </TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedVehicles.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                                No vehicles found matching the criteria.
                            </TableCell>
                        </TableRow>
                    ) : (
                        sortedVehicles.map((vehicle) => {
                            const { status, daysLeft } = getMOTStatus(vehicle.motExpiryDate);
                            const rowClass = status === "expired" ? "bg-red-50/50" : status === "due" ? "bg-orange-50/50" : "";

                            return (
                                <TableRow key={vehicle.id} className={rowClass}>
                                    <TableCell className="px-4">
                                        <Checkbox
                                            checked={selectedVehicleIds.has(vehicle.id)}
                                            onCheckedChange={(checked) => onSelectOne(vehicle.id, !!checked)}
                                            disabled={!vehicle.customerPhone || isSendingBatch}
                                        />
                                    </TableCell>
                                    <TableCell className="font-mono font-bold whitespace-nowrap">
                                        <Link href={`/view-vehicle/${encodeURIComponent(vehicle.registration)}`}>
                                            <span className="cursor-pointer hover:underline text-blue-600">
                                                {vehicle.registration}
                                            </span>
                                        </Link>
                                        {vehicle.dateOfRegistration && (
                                            <span className="ml-2 text-[10px] text-slate-400 font-normal">
                                                ({new Date(vehicle.dateOfRegistration).getFullYear()})
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium">
                                                {vehicle.customerId ? (
                                                    <Link href={`/customers/${vehicle.customerId}`}>
                                                        <span className="cursor-pointer hover:underline text-blue-600 truncate max-w-[120px] inline-block">
                                                            {vehicle.customerName || "Unknown"}
                                                        </span>
                                                    </Link>
                                                ) : (
                                                    vehicle.customerName || "Unknown"
                                                )}
                                            </span>
                                            {!!vehicle.customerOptedOut && (
                                                <Badge variant="destructive" className="h-4 text-[9px] px-1 w-fit">OPTED OUT</Badge>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs font-mono text-slate-500 whitespace-nowrap">
                                        {vehicle.customerPhone || "-"}
                                    </TableCell>
                                    <TableCell className="text-xs max-w-[150px]">
                                        <div className="truncate font-medium">{vehicle.make || "Unknown"}</div>
                                        <div className="truncate text-slate-500">{vehicle.model || ""}</div>
                                    </TableCell>
                                    <TableCell className="text-sm whitespace-nowrap">
                                        <div className="flex flex-col">
                                            {vehicle.motExpiryDate ? (
                                                <span className="font-medium">{new Date(vehicle.motExpiryDate).toLocaleDateString("en-GB")}</span>
                                            ) : (
                                                <span className="text-slate-400 italic">No data</span>
                                            )}
                                            {vehicle.lastChecked && (
                                                <span className="text-[10px] text-muted-foreground mt-0.5">
                                                    Updated: {new Date(vehicle.lastChecked).toLocaleDateString("en-GB")}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm font-medium">
                                        {daysLeft !== null ? (
                                            <span className={daysLeft < 0 ? "text-red-600" : daysLeft <= 30 ? "text-orange-600" : "text-green-600"}>
                                                {daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d`}
                                            </span>
                                        ) : "-"}
                                    </TableCell>
                                    <TableCell>
                                        {status === "expired" && <Badge className="bg-red-500">Expired</Badge>}
                                        {status === "due" && <Badge className="bg-orange-500">Due Soon</Badge>}
                                        {status === "valid" && <Badge className="bg-green-500 text-white border-none">Valid</Badge>}
                                        {status === "none" && <Badge variant="secondary">No Data</Badge>}
                                    </TableCell>
                                    <TableCell>
                                        {vehicle.taxStatus ? (
                                            <Badge
                                                variant="outline"
                                                className={vehicle.taxStatus === "Taxed" ? "text-green-600 border-green-200 bg-green-50" : vehicle.taxStatus === "SORN" ? "bg-slate-100" : "text-red-600 border-red-200 bg-red-50"}
                                            >
                                                {vehicle.taxStatus}
                                            </Badge>
                                        ) : "-"}
                                    </TableCell>
                                    <TableCell>
                                        {vehicle.lastReminderSent ? (
                                            <div className="flex flex-col text-[11px]">
                                                <span className="font-medium">{new Date(vehicle.lastReminderSent).toLocaleDateString("en-GB")}</span>
                                                <div className="flex items-center gap-1">
                                                    {getDeliveryStatusIcon(vehicle.lastReminderStatus)}
                                                    <span className="text-slate-400 capitalize">{vehicle.lastReminderStatus || 'queued'}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-slate-400 text-xs">Never</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                onClick={() => onSendReminder(vehicle)}
                                                disabled={isSendingBatch || !vehicle.customerPhone || (pendingVehicleId === vehicle.id)}
                                            >
                                                {pendingVehicleId === vehicle.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <span title="Send Reminder">
                                                        <Send className="h-4 w-4" />
                                                    </span>
                                                )}
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                onClick={() => onViewHistory(vehicle)}
                                            >
                                                <span title="View Service History">
                                                    <History className="h-4 w-4" />
                                                </span>
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-slate-600 hover:text-slate-700 hover:bg-slate-100"
                                                onClick={() => onBookMOT(vehicle)}
                                            >
                                                <span title="Book MOT / Update Date">
                                                    <CalendarDays className="h-4 w-4" />
                                                </span>
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                                onClick={() => onDelete(vehicle.id)}
                                                disabled={isDeletingBatch || (deletePendingId === vehicle.id)}
                                            >
                                                {deletePendingId === vehicle.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-4 w-4" />
                                                )}
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
    );
}
