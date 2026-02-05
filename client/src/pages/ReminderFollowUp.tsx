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
    Clock,
    Calendar,
    CheckCircle2,
    AlertCircle,
    MessageSquare,
    History,
    Filter,
    Check,
    X,
    ShieldAlert
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChatHistory } from "@/components/ChatHistory";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Zap } from "lucide-react";

type RangeFilter = "all" | "7" | "14" | "30";
type StatusFilter = "all" | "completed" | "pending";

export default function ReminderFollowUp() {
    const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
    const [rangeFilter, setRangeFilter] = useState<RangeFilter>("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [searchTerm, setSearchTerm] = useState("");
    const [hideSorn, setHideSorn] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);

    const { data: logs, isLoading, refetch } = trpc.logs.list.useQuery();
    const utils = trpc.useUtils();

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

    const handleBulkMOTCheck = () => {
        const vehicleIds = Array.from(new Set(filteredLogs.map(log => log.vehicleId).filter((id): id is number => id !== null)));

        if (vehicleIds.length === 0) {
            toast.error("No vehicles found to check");
            return;
        }

        setIsUpdating(true);
        bulkMOTCheck.mutate({ vehicleIds });
    };

    const filteredLogs = useMemo(() => {
        if (!logs) return [];

        return logs.filter(log => {
            const sentDate = new Date(log.sentAt);
            const today = new Date();
            const diffDays = Math.floor((today.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));

            // Range Filter
            if (rangeFilter === "7" && diffDays < 7) return false;
            if (rangeFilter === "14" && diffDays < 14) return false;
            if (rangeFilter === "30" && diffDays < 30) return false;

            // Status Filter (Completed Check)
            const isCompleted = log.currentMOTExpiry && log.dueDate && new Date(log.currentMOTExpiry) > new Date(log.dueDate);
            if (statusFilter === "completed" && !isCompleted) return false;
            if (statusFilter === "pending" && isCompleted) return false;

            // Search Filter
            const term = searchTerm.toLowerCase();
            const matchesSearch =
                (log.registration?.toLowerCase() || "").includes(term) ||
                (log.customerName?.toLowerCase() || "").includes(term) ||
                (log.recipient?.toLowerCase() || "").includes(term);

            if (!matchesSearch) return false;

            // Filter: Hide SORN vehicles
            if (hideSorn && log.taxStatus?.toLowerCase() === 'sorn') {
                return false;
            }

            return true;
        });
    }, [logs, rangeFilter, statusFilter, searchTerm, hideSorn]);

    const stats = useMemo(() => {
        if (!logs) return { total: 0, completed: 0, pending: 0 };

        let completed = 0;
        logs.forEach(log => {
            if (log.currentMOTExpiry && log.dueDate && new Date(log.currentMOTExpiry) > new Date(log.dueDate)) {
                completed++;
            }
        });

        return {
            total: logs.length,
            completed,
            pending: logs.length - completed
        };
    }, [logs]);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-2">
                            <History className="h-8 w-8 text-blue-600" />
                            Reminder Follow-up Analysis
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Analyze all sent reminders and verify if MOT tests have been completed
                        </p>
                    </div>
                    <Button
                        onClick={handleBulkMOTCheck}
                        disabled={isUpdating || filteredLogs.length === 0}
                        className="gap-2 shadow-lg hover:shadow-xl transition-all"
                    >
                        {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-yellow-400 fill-yellow-400" />}
                        {isUpdating ? "Checking MOTs..." : "Run MOT Check for these Vehicles"}
                    </Button>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Total Reminders Sent</CardDescription>
                            <CardTitle className="text-3xl font-bold">{stats.total}</CardTitle>
                        </CardHeader>
                    </Card>
                    <Card className="border-green-100 bg-green-50/30">
                        <CardHeader className="pb-2">
                            <CardDescription className="text-green-700 font-medium">MOT Completed After Reminder</CardDescription>
                            <CardTitle className="text-3xl font-bold text-green-700">{stats.completed}</CardTitle>
                        </CardHeader>
                    </Card>
                    <Card className="border-orange-100 bg-orange-50/30">
                        <CardHeader className="pb-2">
                            <CardDescription className="text-orange-700 font-medium">Still Pending / Unchanged</CardDescription>
                            <CardTitle className="text-3xl font-bold text-orange-700">{stats.pending}</CardTitle>
                        </CardHeader>
                    </Card>
                </div>

                {/* Filters */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex flex-col md:flex-row gap-4">
                            <div className="flex-1 relative">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search registration, customer or phone..."
                                    className="pl-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>

                            <div className="flex gap-2">
                                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                                    <Button
                                        size="sm"
                                        variant={rangeFilter === "all" ? "default" : "ghost"}
                                        onClick={() => setRangeFilter("all")}
                                    >All</Button>
                                    <Button
                                        size="sm"
                                        variant={rangeFilter === "7" ? "default" : "ghost"}
                                        onClick={() => setRangeFilter("7")}
                                    >7d+</Button>
                                    <Button
                                        size="sm"
                                        variant={rangeFilter === "14" ? "default" : "ghost"}
                                        onClick={() => setRangeFilter("14")}
                                    >14d+</Button>
                                    <Button
                                        size="sm"
                                        variant={rangeFilter === "30" ? "default" : "ghost"}
                                        onClick={() => setRangeFilter("30")}
                                    >30d+</Button>
                                </div>

                                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                                    <Button
                                        size="sm"
                                        variant={statusFilter === "all" ? "default" : "ghost"}
                                        onClick={() => setStatusFilter("all")}
                                    >All Status</Button>
                                    <Button
                                        size="sm"
                                        variant={statusFilter === "completed" ? "default" : "ghost"}
                                        onClick={() => setStatusFilter("completed")}
                                    >Completed</Button>
                                    <Button
                                        size="sm"
                                        variant={statusFilter === "pending" ? "default" : "ghost"}
                                        onClick={() => setStatusFilter("pending")}
                                    >Pending</Button>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                                    <div className="flex items-center space-x-2 px-2">
                                        <Checkbox
                                            id="hide-sorn-followup"
                                            checked={hideSorn}
                                            onCheckedChange={(checked) => setHideSorn(checked as boolean)}
                                        />
                                        <label
                                            htmlFor="hide-sorn-followup"
                                            className="text-xs font-medium leading-none"
                                        >
                                            Hide SORN
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Table */}
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Sent Date</TableHead>
                                        <TableHead>Registration</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Old MOT Expiry</TableHead>
                                        <TableHead>Current MOT Expiry</TableHead>
                                        <TableHead>Actioned?</TableHead>
                                        <TableHead>Days Left</TableHead>
                                        <TableHead>Sent</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="h-24 text-center">Loading reminders...</TableCell>
                                        </TableRow>
                                    ) : filteredLogs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No matching reminders found</TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredLogs.map((log) => {
                                            const sentDate = new Date(log.sentAt);
                                            const originalExpiry = log.dueDate ? new Date(log.dueDate) : null;
                                            const currentExpiry = log.currentMOTExpiry ? new Date(log.currentMOTExpiry) : null;

                                            const isCompleted = currentExpiry && originalExpiry && currentExpiry > originalExpiry;
                                            const daysAgo = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));

                                            return (
                                                <TableRow key={log.id} className={isCompleted ? "bg-green-50/30" : ""}>
                                                    <TableCell className="text-sm font-medium">
                                                        {sentDate.toLocaleDateString("en-GB")}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-mono font-bold">{log.registration}</div>
                                                        <div className="text-[10px] text-muted-foreground uppercase">{log.vehicleMake} {log.vehicleModel}</div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-medium">{log.customerName || "Unknown"}</div>
                                                        <div className="text-xs text-muted-foreground">{log.recipient}</div>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-slate-500">
                                                        {originalExpiry ? originalExpiry.toLocaleDateString("en-GB") : "-"}
                                                    </TableCell>
                                                    <TableCell>
                                                        {currentExpiry ? (
                                                            <div className={`text-sm font-semibold ${isCompleted ? "text-green-600" : "text-slate-600"}`}>
                                                                {currentExpiry.toLocaleDateString("en-GB")}
                                                            </div>
                                                        ) : "-"}
                                                    </TableCell>
                                                    <TableCell>
                                                        {isCompleted ? (
                                                            <Badge className="bg-green-500 text-white hover:bg-green-600 border-none">
                                                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                                                Actioned
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="text-slate-400 border-slate-200">
                                                                <Clock className="w-3 h-3 mr-1" />
                                                                No Change
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        {currentExpiry ? (
                                                            <div className={`text-sm font-bold ${Math.ceil((currentExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) < 0
                                                                ? "text-red-600"
                                                                : Math.ceil((currentExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) < 30
                                                                    ? "text-orange-600"
                                                                    : "text-green-600"
                                                                }`}>
                                                                {Math.ceil((currentExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))}d
                                                            </div>
                                                        ) : "-"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="text-sm text-muted-foreground">{daysAgo}d ago</span>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <Dialog>
                                                                <DialogTrigger asChild>
                                                                    <Button size="icon" variant="ghost" className="h-8 w-8">
                                                                        <MessageSquare className="h-4 w-4" />
                                                                    </Button>
                                                                </DialogTrigger>
                                                                <DialogContent className="max-w-3xl max-h-[90vh]">
                                                                    <DialogHeader>
                                                                        <DialogTitle>Chat with {log.customerName || log.recipient}</DialogTitle>
                                                                    </DialogHeader>
                                                                    <ChatHistory phoneNumber={log.recipient} />
                                                                </DialogContent>
                                                            </Dialog>
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
            </div>
        </DashboardLayout>
    );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    )
}
