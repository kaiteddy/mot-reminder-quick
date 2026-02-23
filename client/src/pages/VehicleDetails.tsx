import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Car,
    User,
    Calendar,
    History,
    ArrowLeft,
    AlertCircle,
    ShieldCheck,
    Fuel,
    FileText,
    Zap,
    Loader2,
    Droplet,
    Thermometer,
    Wrench,
    AlertTriangle,
    Copy,
    Check
} from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { formatMOTDate, getMOTStatusBadge } from "@/lib/motUtils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner"; // Added toast import
import { ManufacturerLogo } from "@/components/ManufacturerLogo";
import { ServiceHistory } from "@/components/ServiceHistory";

export default function VehicleDetails() {
    // We try to get the registration from the URL parameter "registration"
    const params = useParams<{ registration: string }>();
    console.log("VehicleDetails: params received:", params);
    const registration = params.registration ? decodeURIComponent(params.registration) : "";
    console.log("VehicleDetails: registration detected from URL:", registration);

    const [, setLocation] = useLocation(); // Added
    const utils = trpc.useUtils(); // Added

    const { data: result, isLoading } = trpc.vehicles.getByRegistration.useQuery(
        { registration: registration || "" },
        { enabled: !!registration }
    );

    const vehicle = result?.vehicle;
    const customer = result?.customer;
    const reminders = result?.reminders || [];

    // Added fetchTechnicalData mutation
    const fetchTechData = trpc.vehicles.fetchTechnicalData.useMutation({
        onSuccess: () => {
            toast.success("Rich technical data updated!");
            utils.vehicles.getByRegistration.invalidate();
        },
        onError: (err) => {
            toast.error("Failed to fetch tech specs: " + err.message);
        }
    });

    const formatDate = (date: Date | string | null) => {
        if (!date) return "-";
        return new Date(date).toLocaleDateString("en-GB");
    };

    if (isLoading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <div className="text-muted-foreground animate-pulse flex items-center gap-2">
                        <Car className="w-6 h-6 animate-bounce" />
                        Loading vehicle details...
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (!vehicle) {
        return (
            <DashboardLayout>
                <div className="p-8 text-center bg-card rounded-xl border-2 border-dashed">
                    <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                    <h2 className="text-xl font-bold">Vehicle Not Found</h2>
                    <p className="text-muted-foreground mb-6">Could not find vehicle with registration: {registration}</p>
                    <Link href="/vehicles">
                        <Button variant="outline">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Vehicles
                        </Button>
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    const motInfo = formatMOTDate(vehicle.motExpiryDate);
    const motBadge = getMOTStatusBadge(motInfo);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header with Logo */}
                <div className="bg-card p-6 rounded-xl border border-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <ManufacturerLogo make={vehicle.make as string} size="xl" />
                        <div>
                            <div className="bg-yellow-400 text-black px-4 py-1 rounded font-mono font-bold text-2xl border-2 border-black inline-block shadow-sm">
                                {vehicle.registration}
                            </div>
                            <h1 className="text-2xl font-bold mt-2">
                                {vehicle.make as string} {vehicle.model as string}
                            </h1>
                            <p className="text-muted-foreground flex items-center gap-2">
                                <Fuel className="w-4 h-4" />
                                {(vehicle.fuelType as string) || "Unknown"} • {(vehicle.colour as string)} • {vehicle.engineCC ? `${vehicle.engineCC}cc` : "Unknown Size"}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 min-w-[200px]">
                        <Button
                            variant="outline"
                            className="bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                            onClick={() => setLocation(`/generate-document?vehicleId=${vehicle.id}&customerId=${customer?.id}&reg=${vehicle.registration}`)}
                        >
                            <FileText className="w-4 h-4 mr-2" />
                            Create Estimate/Invoice
                        </Button>
                        <Button
                            variant="outline"
                            disabled={fetchTechData.isPending}
                            onClick={() => fetchTechData.mutate({ registration: vehicle.registration })}
                        >
                            {fetchTechData.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2 text-yellow-500 fill-yellow-500" />}
                            Fetch Tech Specs
                        </Button>
                    </div>
                    <Link href={`/mot-check?reg=${vehicle.registration}`}>
                        <Button variant="outline">
                            <ShieldCheck className="w-4 h-4 mr-2" />
                            Live DVSA Check
                        </Button>
                    </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Vehicle Specifications */}
                    <Card className="md:col-span-2">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="w-5 h-5" />
                                Specifications & Status
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Make</p>
                                    <p className="text-sm font-bold">{vehicle.make as string || "Unknown"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Model</p>
                                    <p className="text-sm font-bold">{vehicle.model as string || "Unknown"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Fuel Type</p>
                                    <div className="flex items-center gap-2 text-sm font-bold uppercase">
                                        <Fuel className="w-4 h-4 text-orange-500" />
                                        {(vehicle.fuelType as string) || "-"}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Engine CC</p>
                                    <p className="text-sm font-bold">{vehicle.engineCC ? `${vehicle.engineCC}cc` : "-"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Tax Status</p>
                                    <Badge variant={vehicle.taxStatus?.toLowerCase() === 'taxed' ? 'default' : 'destructive'} className="text-[10px] px-2 py-0">
                                        {vehicle.taxStatus as string || "Unknown"}
                                    </Badge>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Tax Due</p>
                                    <p className="text-sm font-bold">{formatDate(vehicle.taxDueDate)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Reg Date</p>
                                    <p className="text-sm font-bold">{formatDate(vehicle.dateOfRegistration)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">VIN</p>
                                    <div className="flex items-center gap-2 group">
                                        <p className="font-mono text-xs font-bold truncate max-w-[120px]">{vehicle.vin || "-"}</p>
                                        {vehicle.vin && (
                                            <button
                                                onClick={() => {
                                                    if (vehicle.vin) {
                                                        navigator.clipboard.writeText(vehicle.vin);
                                                        toast.success("VIN copied to clipboard");
                                                    }
                                                }}
                                                className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                <Copy className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Customer Info */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <User className="w-5 h-5" />
                                Customer
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {customer ? (
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase">Name</p>
                                        <Link href={`/customers/${customer.id}`}>
                                            <p className="text-sm font-bold hover:underline cursor-pointer text-primary">
                                                {customer.name as string}
                                            </p>
                                        </Link>
                                    </div>
                                    {customer.phone && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase">Phone</p>
                                            <p className="text-sm font-bold font-mono">{customer.phone as string}</p>
                                        </div>
                                    )}
                                    {customer.email && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase">Email</p>
                                            <p className="text-sm font-bold truncate">{customer.email as string}</p>
                                        </div>
                                    )}
                                    {customer.optedOut && (
                                        <Badge variant="destructive" className="w-full justify-center">
                                            <AlertCircle className="w-3 h-3 mr-2" />
                                            Opted Out
                                        </Badge>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-muted-foreground italic text-sm">
                                    No customer assigned
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Rich Vehicle Intelligence */}
                    {!!vehicle.comprehensiveTechnicalData && (
                        <Card className="md:col-span-3 border-primary/20 bg-primary/5">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-primary">
                                    <Zap className="w-5 h-5 fill-primary" />
                                    Rich Vehicle Intelligence
                                </CardTitle>
                                <CardDescription>Data sourced from SWS Solutions technical modules</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {/* Lubricants Section */}
                                    {(vehicle.comprehensiveTechnicalData as any).lubricants && (
                                        <div className="space-y-4">
                                            <h3 className="font-bold flex items-center gap-2 border-b pb-2">
                                                <Droplet className="w-4 h-4 text-blue-500" />
                                                Lubricants & Fluids
                                            </h3>
                                            <div className="space-y-3">
                                                {/* This is a simplification, SWS LUF is complex. 
                                                    In v0dashboard-2 they have a better renderer, but let's show key info. */}
                                                {(vehicle.comprehensiveTechnicalData as any).lubricants.map?.((l: any, i: number) => (
                                                    <div key={i} className="text-sm">
                                                        <p className="text-xs font-medium text-muted-foreground uppercase">{(l.description as string) || 'Fluid'}</p>
                                                        <p className="font-bold">{(l.specification as string) || 'N/A'}</p>
                                                        {l.capacity && <p className="text-xs text-primary font-bold mt-0.5">Capacity: {l.capacity}L</p>}
                                                    </div>
                                                )) || (
                                                        <p className="text-sm text-muted-foreground italic">Specifications available in technical documents</p>
                                                    )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Aircon Section */}
                                    {(vehicle.comprehensiveTechnicalData as any).aircon && (
                                        <div className="space-y-4">
                                            <h3 className="font-bold flex items-center gap-2 border-b pb-2">
                                                <Thermometer className="w-4 h-4 text-cyan-500" />
                                                Air Conditioning
                                            </h3>
                                            <div className="space-y-3">
                                                <div className="text-sm">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase">Refrigerant Type</p>
                                                    <p className="font-bold">{((vehicle.comprehensiveTechnicalData as any).aircon.type as string) || 'N/A'}</p>
                                                </div>
                                                <div className="text-sm">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase">Gas Quantity</p>
                                                    <p className="font-bold">{((vehicle.comprehensiveTechnicalData as any).aircon.quantity as string) || 'N/A'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Specs / Generic */}
                                    <div className="space-y-4">
                                        <h3 className="font-bold flex items-center gap-2 border-b pb-2">
                                            <Wrench className="w-4 h-4 text-orange-500" />
                                            Technical Specs
                                        </h3>
                                        <div className="space-y-3">
                                            <div className="text-sm">
                                                <p className="text-xs font-medium text-muted-foreground uppercase">Engine Code</p>
                                                <p className="font-bold">{(vehicle.engineCode as string) || "-"}</p>
                                            </div>
                                            <div className="text-sm">
                                                <p className="text-xs font-medium text-muted-foreground uppercase">Last Deep Scan</p>
                                                <p className="text-xs font-bold">{vehicle.swsLastUpdated ? new Date(vehicle.swsLastUpdated).toLocaleString() : "Never"}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Service History */}
                    <Card className="md:col-span-3">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="w-5 h-5" />
                                Workshop Service History
                            </CardTitle>
                            <CardDescription>Full timeline of garage invoices and estimates</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ServiceHistory vehicleId={vehicle.id} />
                        </CardContent>
                    </Card>

                    {/* Reminder History */}
                    <Card className="md:col-span-3">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Calendar className="w-5 h-5" />
                                communication History
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {reminders.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Due Date</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Sent At</TableHead>
                                            <TableHead>Method</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {reminders.map((reminder) => (
                                            <TableRow key={reminder.id}>
                                                <TableCell>
                                                    <Badge variant={reminder.type === 'MOT' ? 'default' : 'secondary'}>
                                                        {reminder.type}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{formatDate(reminder.dueDate)}</TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={
                                                            reminder.status === 'sent' ? 'outline' :
                                                                reminder.status === 'archived' ? 'secondary' : 'default'
                                                        }
                                                        className={reminder.status === 'sent' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}
                                                    >
                                                        {reminder.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{formatDate(reminder.sentAt)}</TableCell>
                                                <TableCell className="capitalize">{reminder.sentMethod || "-"}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground">
                                    <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                    <p>No communication history found</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
