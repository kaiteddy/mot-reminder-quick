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
    AlertTriangle,
    History,
    CalendarCheck,
    PhoneCall
} from "lucide-react";
import { Link } from "wouter";
import { followUpShownDelivery, whenAgo, type FollowUp } from "@shared/motFollowUp";
import type { Delivery, DeliveryState } from "@shared/messageDelivery";

interface Vehicle {
    id: number;
    registration: string;
    make: string | null;
    model: string | null;
    motExpiryDate: Date | string | null;
    /** True when motExpiryDate is the first-MOT due date of a car never tested. */
    firstMot?: boolean;
    dateOfRegistration: Date | string | null;
    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    customerOptedOut: number | null;
    customerTrade?: number | null;
    remindersOff?: number | null;
    remindersOffReason?: string | null;
    taxStatus: string | null;
    taxDueDate: Date | string | null;
    lastChecked?: Date | string | null;
    lastReminderSent: Date | string | null;
    lastReminderStatus: string | null;
    lastReminderDelivery?: Delivery | null;
    lastVisit?: Date | string | null;
}

interface ComprehensiveVehicleTableProps {
    vehicles: Vehicle[];
    isLoading: boolean;
    selectedVehicleIds: Set<number>;
    onSelectAll: (checked: boolean) => void;
    onSelectOne: (id: number, checked: boolean) => void;
    onSendReminder: (vehicle: Vehicle) => void;
    onBookMOT: (vehicle: Vehicle) => void;
    onMarkBooked?: (vehicle: Vehicle) => void;
    onDelete: (id: number) => void;
    isSendingBatch?: boolean;
    isDeletingBatch?: boolean;
    pendingVehicleId?: number | null;
    deletePendingId?: number | null;
    onViewHistory: (vehicle: Vehicle) => void;
    /** On the MOT Reminders "Follow up" tab: each car's follow-up state, shown under its MOT date. */
    followUps?: Map<number, FollowUp>;
    /** Log a follow-up phone call. */
    onLogCall?: (vehicle: Vehicle) => void;
    defaultSort?: { field: SortField; direction: SortDirection };
}

type SortField = "registration" | "customer" | "make" | "motExpiry" | "lastSent" | "lastVisit" | "daysLeft";
type SortDirection = "asc" | "desc";

const FOLLOW_UP_LABEL: Record<FollowUp["stage"], { text: string; tone: string }> = {
    missed: { text: "Missed MOT", tone: "text-red-700" },
    expired_unchecked: { text: "Expired, checking", tone: "text-amber-700" },
    due: { text: "Reminded, not done", tone: "text-blue-700" },
};
// Did they get it (shared/messageDelivery.ts). Adam, 14/09/2026: "a little status update next to these so we
// know if delivered, read, not received, sent as SMS".
const DELIVERY_LABEL: Record<DeliveryState, { text: string; tone: string }> = {
    read: { text: "Read", tone: "bg-blue-50 text-blue-700" },
    delivered: { text: "Delivered", tone: "bg-green-50 text-green-700" },
    sent: { text: "Sent", tone: "bg-slate-100 text-slate-600" },
    not_received: { text: "Not received", tone: "bg-red-50 text-red-700" },
    sms_sent: { text: "Sent as SMS", tone: "bg-violet-50 text-violet-700" },
    sms_delivered: { text: "SMS delivered", tone: "bg-violet-50 text-violet-700" },
};
const deliveryPill = (d: Delivery) => (
    <span className={`shrink-0 rounded px-1.5 py-px text-[11px] font-medium leading-4 ${DELIVERY_LABEL[d.state].tone}`} title={d.note}>
        {DELIVERY_LABEL[d.state].text}
    </span>
);
const ukDayMonth = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", timeZone: "Europe/London" });
const ukTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export function ComprehensiveVehicleTable({
    vehicles,
    isLoading,
    selectedVehicleIds,
    onSelectAll,
    onSelectOne,
    onSendReminder,
    onBookMOT,
    onMarkBooked,
    onDelete,
    isSendingBatch = false,
    isDeletingBatch = false,
    pendingVehicleId = null,
    deletePendingId = null,
    onViewHistory,
    followUps,
    onLogCall,
    defaultSort,
}: ComprehensiveVehicleTableProps) {
    const [sortField, setSortField] = useState<SortField>(defaultSort?.field ?? "registration");
    const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSort?.direction ?? "asc");

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
                case "lastVisit":
                    aVal = a.lastVisit ? new Date(a.lastVisit).getTime() : 0;
                    bVal = b.lastVisit ? new Date(b.lastVisit).getTime() : 0;
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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            </div>
        );
    }

    // Thin rows (Adam, 14/09/2026: "make it easy for me to read, I like thinner UI lines"):
    // one line per cell, with the extra detail in hover notes rather than stacked under it.
    const HEAD = "h-8 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500";
    const CELL = "px-2 py-1 text-[13px] leading-tight";
    const ICON = "size-3.5";
    const iconButton = "h-7 w-7";
    const shortDate = (d: Date | string) =>
        new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/London" });
    const sortHead = (field: SortField, label: string) => (
        <TableHead className={`${HEAD} cursor-pointer select-none`} onClick={() => toggleSort(field)}>
            <span className="inline-flex items-center">{label}{getSortIcon(field)}</span>
        </TableHead>
    );
    const tag = (text: string, tone: string, title?: string) => (
        <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold uppercase leading-none ${tone}`} title={title}>{text}</span>
    );
    const statusPill = (status: string, daysLeft: number | null) => {
        const d = daysLeft ?? 0;
        const pill = "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset";
        if (status === "expired") return <span className={`${pill} bg-red-50 text-red-700 ring-red-200`}>Expired {Math.abs(d)}d</span>;
        if (status === "due") return <span className={`${pill} bg-orange-50 text-orange-700 ring-orange-200`}>{d === 0 ? "Due today" : `Due ${d}d`}</span>;
        if (status === "valid") return <span className={`${pill} bg-green-50 text-green-700 ring-green-200`}>Valid</span>;
        return <span className="text-[11px] text-slate-400">No data</span>;
    };
    const followUpNote = (fu: FollowUp) => [
        `Reminder sent ${ukDayMonth(fu.remindedAt)} at ${ukTime(fu.remindedAt)}.${fu.reminderDelivery ? ` ${fu.reminderDelivery.note}` : ""}`,
        fu.checkedAfterExpiry
            ? `Checked ${ukDayMonth(fu.checkedAfterExpiry)} at ${ukTime(fu.checkedAfterExpiry)}: no new MOT.`
            : fu.stage === "expired_unchecked" ? "Not checked since the MOT ran out; the midnight check will confirm." : "",
        fu.followedUpAt
            ? `Followed up ${ukDayMonth(fu.followedUpAt)} at ${ukTime(fu.followedUpAt)} by ${fu.followedUpHow === "call" ? "phone" : "message"}.${fu.followUpDelivery ? ` ${fu.followUpDelivery.note}` : ""}`
            : "",
        fu.bookedFor ? `Booked for ${ukDayMonth(fu.bookedFor)}.` : "",
        fu.todo === "wait"
            ? `Giving them time to book: follow up from ${fu.followUpFrom.slice(8, 10)}/${fu.followUpFrom.slice(5, 7)} if there's still no MOT.`
            : "",
        fu.todo === "call"
            ? fu.followUpDelivery?.state === "not_received"
                ? "The follow-up didn't arrive: give them a call, or fix the number and send it again."
                : `Still no MOT ${whenAgo(fu.followedUpAt!)} after the follow-up: give them a call.`
            : "",
    ].filter(Boolean).join(" ");

    return (
        <Table>
            <TableHeader className="bg-slate-50/80">
                <TableRow className="hover:bg-transparent">
                    <TableHead className={`${HEAD} w-8 pl-3`}>
                        <Checkbox
                            checked={vehicles.length > 0 && selectedVehicleIds.size === vehicles.filter(v => v.customerPhone).length && selectedVehicleIds.size > 0}
                            onCheckedChange={(checked) => onSelectAll(!!checked)}
                        />
                    </TableHead>
                    {sortHead("registration", "Reg")}
                    {sortHead("customer", "Customer")}
                    <TableHead className={HEAD}>Phone</TableHead>
                    {sortHead("make", "Vehicle")}
                    {sortHead("motExpiry", "MOT")}
                    {sortHead("daysLeft", "Status")}
                    {followUps ? <TableHead className={HEAD}>Follow-up</TableHead> : sortHead("lastSent", "Last sent")}
                    <TableHead className={HEAD}>Tax</TableHead>
                    {sortHead("lastVisit", "Last visit")}
                    <TableHead className={`${HEAD} pr-3 text-right`}><span className="sr-only">Actions</span></TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {sortedVehicles.length === 0 ? (
                    <TableRow>
                        <TableCell colSpan={11} className="h-20 text-center text-sm text-muted-foreground">
                            No cars match these filters.
                        </TableCell>
                    </TableRow>
                ) : (
                    sortedVehicles.map((vehicle) => {
                        const { status, daysLeft } = getMOTStatus(vehicle.motExpiryDate);
                        const fu = followUps?.get(vehicle.id);
                        const shownDelivery = fu ? followUpShownDelivery(fu) : null;
                        const year = vehicle.dateOfRegistration ? new Date(vehicle.dateOfRegistration).getFullYear() : null;
                        const vehicleTitle = `${[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unknown"}${year ? ` (${year})` : ""}`;

                        return (
                            <TableRow key={vehicle.id} className="border-slate-100 hover:bg-slate-50">
                                <TableCell className={`${CELL} pl-3`}>
                                    <Checkbox
                                        checked={selectedVehicleIds.has(vehicle.id)}
                                        onCheckedChange={(checked) => onSelectOne(vehicle.id, !!checked)}
                                        disabled={!vehicle.customerPhone || isSendingBatch}
                                    />
                                </TableCell>
                                <TableCell className={CELL}>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Link href={`/view-vehicle/${encodeURIComponent(vehicle.registration)}`}>
                                            <span className="cursor-pointer font-mono font-semibold text-blue-700 hover:underline">{vehicle.registration}</span>
                                        </Link>
                                        {(vehicle as any).bookingRequested === 1 && tag("Booking", "bg-green-100 text-green-800", "The customer asked to book")}
                                    </span>
                                </TableCell>
                                <TableCell className={CELL}>
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        {vehicle.customerId ? (
                                            <Link href={`/customers/${vehicle.customerId}`}>
                                                <span className="block max-w-[170px] cursor-pointer truncate text-slate-900 hover:underline" title={vehicle.customerName || undefined}>
                                                    {vehicle.customerName || "Unknown"}
                                                </span>
                                            </Link>
                                        ) : (
                                            <span className="block max-w-[170px] truncate text-slate-500">{vehicle.customerName || "Unknown"}</span>
                                        )}
                                        {!!vehicle.customerOptedOut && tag("Opted out", "bg-red-100 text-red-700")}
                                        {!!vehicle.customerTrade && tag("Trade", "bg-amber-100 text-amber-800", "Trade account: never sent reminders")}
                                        {!!vehicle.remindersOff && tag("Off", "bg-slate-200 text-slate-700", vehicle.remindersOffReason || "Reminders switched off for this car")}
                                    </span>
                                </TableCell>
                                <TableCell className={`${CELL} font-mono text-[12px] text-slate-500`}>{vehicle.customerPhone || "—"}</TableCell>
                                <TableCell className={CELL}>
                                    <span className="block max-w-[220px] truncate" title={vehicleTitle}>
                                        <span className="text-slate-900">{vehicle.make || "Unknown"}</span>
                                        {vehicle.model && <span className="text-slate-500"> {vehicle.model}</span>}
                                        {year && <span className="text-slate-400"> · {year}</span>}
                                    </span>
                                </TableCell>
                                <TableCell
                                    className={`${CELL} tabular-nums`}
                                    title={vehicle.lastChecked ? `Last checked ${new Date(vehicle.lastChecked).toLocaleDateString("en-GB")}` : "Not checked yet"}
                                >
                                    <span className="inline-flex items-center gap-1.5">
                                        {vehicle.motExpiryDate ? shortDate(vehicle.motExpiryDate) : <span className="text-slate-400">—</span>}
                                        {vehicle.firstMot && tag("1st MOT", "bg-blue-100 text-blue-700", "Never had an MOT: this is when its first one is due, from DVSA")}
                                    </span>
                                </TableCell>
                                <TableCell className={CELL}>{statusPill(status, daysLeft)}</TableCell>
                                {followUps ? (
                                    <TableCell className={CELL} title={fu ? followUpNote(fu) : undefined}>
                                        {fu ? (
                                            <span className="flex max-w-[320px] min-w-0 items-center gap-1.5">
                                                <span className={`shrink-0 font-semibold ${FOLLOW_UP_LABEL[fu.stage].tone}`}>{FOLLOW_UP_LABEL[fu.stage].text}</span>
                                                <span className="truncate text-slate-500">
                                                    {fu.followedUpAt
                                                        ? `${fu.followedUpHow === "call" ? "called" : "messaged"} ${whenAgo(fu.followedUpAt)}`
                                                        : fu.bookedFor ? `booked for ${ukDayMonth(fu.bookedFor)}` : `reminded ${whenAgo(fu.remindedAt)}`}
                                                </span>
                                                {shownDelivery && deliveryPill(shownDelivery)}
                                                {fu.todo === "call" && tag("Call", "bg-amber-100 text-amber-800", "One follow-up message per MOT; the next step is a phone call")}
                                            </span>
                                        ) : <span className="text-slate-400">—</span>}
                                    </TableCell>
                                ) : (
                                    <TableCell
                                        className={CELL}
                                        title={vehicle.lastReminderSent ? `Sent ${shortDate(vehicle.lastReminderSent)}.${vehicle.lastReminderDelivery ? ` ${vehicle.lastReminderDelivery.note}` : ""}` : undefined}
                                    >
                                        {vehicle.lastReminderSent ? (
                                            <span className="inline-flex items-center gap-1.5">
                                                {whenAgo(vehicle.lastReminderSent)}
                                                {vehicle.lastReminderDelivery && deliveryPill(vehicle.lastReminderDelivery)}
                                            </span>
                                        ) : <span className="text-slate-400">Never</span>}
                                    </TableCell>
                                )}
                                <TableCell className={CELL}>
                                    {vehicle.taxStatus ? (
                                        <span className={vehicle.taxStatus === "Taxed" ? "text-green-700" : vehicle.taxStatus === "SORN" ? "text-slate-500" : "text-red-600"}>
                                            {/^not taxed/i.test(vehicle.taxStatus) ? "Not taxed" : vehicle.taxStatus}
                                        </span>
                                    ) : <span className="text-slate-400">—</span>}
                                </TableCell>
                                <TableCell className={`${CELL} text-slate-600`} title={vehicle.lastVisit ? shortDate(vehicle.lastVisit) : undefined}>
                                    {vehicle.lastVisit ? whenAgo(vehicle.lastVisit) : <span className="text-slate-400">Never</span>}
                                </TableCell>
                                <TableCell className={`${CELL} pr-3`}>
                                    <div className="flex items-center justify-end gap-0.5">
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className={`${iconButton} text-blue-600 hover:bg-blue-50 hover:text-blue-700`}
                                            onClick={() => onSendReminder(vehicle)}
                                            disabled={isSendingBatch || !vehicle.customerPhone || (pendingVehicleId === vehicle.id)}
                                            title={followUps ? "Send follow-up message" : "Send reminder"}
                                        >
                                            {pendingVehicleId === vehicle.id ? <Loader2 className={`${ICON} animate-spin`} /> : <Send className={ICON} />}
                                        </Button>
                                        {onLogCall && (
                                            <Button size="icon" variant="ghost" className={`${iconButton} text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800`} onClick={() => onLogCall(vehicle)} title="Log a follow-up call">
                                                <PhoneCall className={ICON} />
                                            </Button>
                                        )}
                                        {onMarkBooked && (
                                            <Button size="icon" variant="ghost" className={`${iconButton} text-green-600 hover:bg-green-50 hover:text-green-700`} onClick={() => onMarkBooked(vehicle)} title="Mark as booked">
                                                <CalendarCheck className={ICON} />
                                            </Button>
                                        )}
                                        <Button size="icon" variant="ghost" className={`${iconButton} text-slate-500 hover:bg-slate-100 hover:text-slate-800`} onClick={() => onViewHistory(vehicle)} title="Service history">
                                            <History className={ICON} />
                                        </Button>
                                        <Button size="icon" variant="ghost" className={`${iconButton} text-slate-500 hover:bg-slate-100 hover:text-slate-800`} onClick={() => onBookMOT(vehicle)} title="Book MOT / update date">
                                            <CalendarDays className={ICON} />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className={`${iconButton} text-slate-400 hover:bg-red-50 hover:text-red-600`}
                                            onClick={() => onDelete(vehicle.id)}
                                            disabled={isDeletingBatch || (deletePendingId === vehicle.id)}
                                            title="Delete car"
                                        >
                                            {deletePendingId === vehicle.id ? <Loader2 className={`${ICON} animate-spin`} /> : <Trash2 className={ICON} />}
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })
                )}
            </TableBody>
        </Table>
    );
}
