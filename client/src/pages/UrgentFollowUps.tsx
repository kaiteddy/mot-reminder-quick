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
    Loader2
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChatHistory } from "@/components/ChatHistory";
import { toast } from "sonner";

export default function UrgentFollowUps() {
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

    const urgentLogs = useMemo(() => {
        if (!logs) return [];
        return logs.filter(log => {
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
        }).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    }, [logs]);

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
                    <Button
                        onClick={handleBulkMOTCheck}
                        disabled={isUpdating || urgentLogs.length === 0}
                        className="gap-2 shadow-lg hover:shadow-xl transition-all"
                    >
                        {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-yellow-400 fill-yellow-400" />}
                        {isUpdating ? "Checking MOTs..." : "Re-check MOTs for these vehicles"}
                    </Button>
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
                                        <TableHead>Sent Date</TableHead>
                                        <TableHead>Registration</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Current Expiry</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Reach Out</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-24 text-center">Loading urgent follow-ups...</TableCell>
                                        </TableRow>
                                    ) : urgentLogs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-24 text-center text-muted-foreground font-medium">All clear! No urgent follow-ups found.</TableCell>
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
                                                        <Dialog>
                                                            <DialogTrigger asChild>
                                                                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-8">
                                                                    <MessageSquare className="h-3 w-3 mr-2" />
                                                                    Message
                                                                </Button>
                                                            </DialogTrigger>
                                                            <DialogContent className="max-w-3xl max-h-[90vh]">
                                                                <DialogHeader>
                                                                    <DialogTitle>Chat with {log.customerName || log.recipient}</DialogTitle>
                                                                </DialogHeader>
                                                                <ChatHistory phoneNumber={log.recipient} />
                                                            </DialogContent>
                                                        </Dialog>
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
