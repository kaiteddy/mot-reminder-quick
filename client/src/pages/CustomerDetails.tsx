import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Phone, MapPin, User, ArrowLeft, Car, History, FileText, Pencil, Send } from "lucide-react";
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
                <div className="flex items-center gap-4">
                    <Link href="/customers">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="w-4 h-4" />
                        </Button>
                    </Link>
                    <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
                    <Button onClick={() => setIsEditOpen(true)} variant="outline" size="sm" className="ml-2">
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit Details
                    </Button>
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
                                        {customer.postcode && <div className="font-medium text-blue-700">{customer.postcode}</div>}
                                    </div>
                                </div>
                            )}
                            {customer.notes && (
                                <div className="border-t pt-4 mt-4">
                                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">Internal Notes</p>
                                    <p className="text-sm bg-yellow-50 p-3 rounded-md border border-yellow-100 whitespace-pre-wrap">{customer.notes}</p>
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
                                                <TableHead>MOT Expiry</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {vehicles.map((v) => {
                                                const expiry = v.motExpiryDate ? new Date(v.motExpiryDate) : null;
                                                const isExpired = expiry && expiry < new Date();
                                                return (
                                                    <TableRow key={v.id}>
                                                        <TableCell className="font-mono font-bold text-lg">{v.registration}</TableCell>
                                                        <TableCell>
                                                            <div className="text-sm font-medium">{v.make || "Unknown"}</div>
                                                            <div className="text-xs text-muted-foreground">{v.model || ""}</div>
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {expiry ? format(expiry, "dd/MM/yyyy") : "-"}
                                                        </TableCell>
                                                        <TableCell>
                                                            {expiry ? (
                                                                <Badge variant={isExpired ? "destructive" : "outline"}>
                                                                    {isExpired ? "Expired" : "Valid"}
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="secondary">Unknown</Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => {
                                                                    setSelectedVehicleForHistory({ id: v.id, registration: v.registration });
                                                                    setHistoryOpen(true);
                                                                }}
                                                            >
                                                                <History className="w-4 h-4 mr-2" />
                                                                History
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-muted-foreground text-sm py-4 text-center">No vehicles linked to this customer.</p>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Send className="w-5 h-5 text-blue-500" />
                                    Reminder Log
                                </CardTitle>
                                <CardDescription>Message history for this customer</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {reminders && reminders.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Sent At</TableHead>
                                                <TableHead>Vehicle</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead>Status</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {reminders.map((r: any) => (
                                                <TableRow key={r.id}>
                                                    <TableCell className="text-sm whitespace-nowrap">
                                                        {format(new Date(r.sentAt), "dd/MM/yyyy HH:mm")}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {r.registration || `Vehicle #${r.vehicleId}`}
                                                    </TableCell>
                                                    <TableCell className="text-sm">WhatsApp</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="capitalize text-[10px]">
                                                            {r.status}
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-muted-foreground text-sm py-4 text-center">No messages sent yet.</p>
                                )}
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
