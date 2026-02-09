import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Phone, MapPin, User, ArrowLeft, Car, History, FileText, Pencil, Send, Plus, DollarSign } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Link } from "wouter";
import { format } from "date-fns";
import { useState, useEffect } from "react";
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

export default function CustomerDetails() {
    const [match, params] = useRoute("/customers/:id");
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

    if (!match || !id) {
        return (
            <DashboardLayout>
                <div className="text-center py-12">
                    <h2 className="text-xl font-semibold text-red-500">Invalid Customer ID</h2>
                    <Link href="/customers">
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
                    <Link href="/customers">
                        <Button variant="link" className="mt-4">Back to Customers</Button>
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    const { customer, vehicles, reminders } = data;

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/customers">
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
                            onClick={() => window.location.href = `/generate-document?customerId=${customer.id}`}
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
                            {customer.email && (
                                <div className="flex items-center gap-2 text-sm">
                                    <Mail className="w-4 h-4 text-muted-foreground" />
                                    <a href={`mailto:${customer.email}`} className="hover:underline">
                                        {customer.email}
                                    </a>
                                </div>
                            )}
                            {customer.phone && (
                                <div className="flex items-center gap-2 text-sm">
                                    <Phone className="w-4 h-4 text-muted-foreground" />
                                    <a href={`tel:${customer.phone}`} className="hover:underline font-mono">
                                        {customer.phone}
                                    </a>
                                </div>
                            )}
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
                                                            <Link href={`/view-vehicle/${encodeURIComponent(v.registration || "")}`}>
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
                                                                    onClick={() => window.location.href = `/generate-document?vehicleId=${v.id}&customerId=${customer.id}&reg=${v.registration}`}
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
                                                    <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer group" onClick={() => {
                                                        setSelectedVehicleForHistory({ id: h.vehicleId, registration: h.registration || "Vehicle" });
                                                        setHistoryOpen(true);
                                                    }}>
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${h.docType === 'SI' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-600'}`}>
                                                                {h.docType === 'SI' ? <FileText className="w-5 h-5" /> : <History className="w-5 h-5" />}
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-bold flex items-center gap-2">
                                                                    {h.docType === 'SI' ? 'Invoice' : 'Estimate'} #{h.docNo || h.id}
                                                                    {h.registration && <span className="bg-yellow-100 text-[10px] px-1.5 py-0.5 rounded border border-yellow-200 font-mono">{h.registration}</span>}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">
                                                                    {h.mainDescription || "No job description"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-sm font-bold">£{Number(h.totalGross || 0).toFixed(2)}</div>
                                                            <div className="text-[10px] text-muted-foreground">{format(new Date(h.dateCreated), "dd MMM yyyy")}</div>
                                                        </div>
                                                    </div>
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
