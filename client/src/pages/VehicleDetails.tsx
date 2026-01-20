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
    CheckCircle2,
    AlertCircle,
    ShieldCheck,
    Fuel,
    Fingerprint,
    Wrench
} from "lucide-react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { formatMOTDate, getMOTStatusBadge } from "@/lib/motUtils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useParams, useRoute } from "wouter";

export default function VehicleDetails() {
    const params = useParams<{ registration: string }>();
    const [match, routeParams] = useRoute("/v/:registration");
    const [matchAlt, routeParamsAlt] = useRoute("/vehicles/:registration");

    const regParam = params.registration || routeParams?.registration || routeParamsAlt?.registration;
    const registration = regParam ? decodeURIComponent(regParam) : "";

    console.log("VehicleDetails debug:", { params, routeParams, routeParamsAlt, registration });

    const { data, isLoading } = trpc.vehicles.getByRegistration.useQuery(
        { registration: registration || "" },
        { enabled: !!registration }
    );

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

    if (!data || !data.vehicle) {
        return (
            <DashboardLayout>
                <div className="text-center py-12">
                    <Car className="w-12 h-12 mx-auto mb-4 opacity-50 text-destructive" />
                    <h2 className="text-2xl font-bold">Vehicle Not Found</h2>
                    <p className="text-muted-foreground mt-2">
                        We couldn't find a vehicle with registration <strong>{registration}</strong>
                    </p>
                    <Link href="/vehicles">
                        <Button variant="outline" className="mt-6">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Vehicles
                        </Button>
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    const { vehicle, customer, reminders } = data;
    const motInfo = formatMOTDate(vehicle.motExpiryDate);
    const motBadge = getMOTStatusBadge(motInfo);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/vehicles">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                        </Link>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-4xl font-bold tracking-tight font-mono uppercase">
                                    {vehicle.registration}
                                </h1>
                                <Badge
                                    variant={motBadge.variant}
                                    className={`${motBadge.className} text-sm px-3 py-1`}
                                >
                                    {motBadge.text}
                                </Badge>
                            </div>
                            <p className="text-muted-foreground mt-1">
                                {vehicle.make} {vehicle.model} • {vehicle.colour}
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Link href={`/mot-check?reg=${vehicle.registration}`}>
                            <Button variant="outline">
                                <ShieldCheck className="w-4 h-4 mr-2" />
                                Live TV Check
                            </Button>
                        </Link>
                    </div>
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
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Make</p>
                                    <p className="font-semibold">{vehicle.make || "Unknown"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Model</p>
                                    <p className="font-semibold">{vehicle.model || "Unknown"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Fuel Type</p>
                                    <div className="flex items-center gap-2 font-semibold">
                                        <Fuel className="w-4 h-4 text-orange-500" />
                                        {vehicle.fuelType || "-"}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Engine CC</p>
                                    <p className="font-semibold">{vehicle.engineCC ? `${vehicle.engineCC}cc` : "-"}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Tax Status</p>
                                    <Badge variant={vehicle.taxStatus?.toLowerCase() === 'taxed' ? 'default' : 'destructive'}>
                                        {vehicle.taxStatus || "Unknown"}
                                    </Badge>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Tax Due</p>
                                    <p className="font-semibold">{formatDate(vehicle.taxDueDate)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Registration Date</p>
                                    <p className="font-semibold">{formatDate(vehicle.dateOfRegistration)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">VIN</p>
                                    <p className="font-mono text-xs">{vehicle.vin || "-"}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Customer Info */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <User className="w-5 h-5" />
                                Assigned Customer
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {customer ? (
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase">Name</p>
                                        <Link href={`/customers/${customer.id}`}>
                                            <p className="font-bold text-lg hover:underline cursor-pointer text-primary">
                                                {customer.name}
                                            </p>
                                        </Link>
                                    </div>
                                    {customer.phone && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase">Phone</p>
                                            <p className="font-mono">{customer.phone}</p>
                                        </div>
                                    )}
                                    {customer.email && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase">Email</p>
                                            <p className="text-sm">{customer.email}</p>
                                        </div>
                                    )}
                                    {customer.optedOut && (
                                        <Badge variant="destructive" className="w-full justify-center">
                                            <AlertCircle className="w-3 h-3 mr-2" />
                                            Opted Out of Notifications
                                        </Badge>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-muted-foreground italic">
                                    No customer assigned
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Reminder History */}
                    <Card className="md:col-span-3">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Calendar className="w-5 h-5" />
                                Reminder History
                            </CardTitle>
                            <CardDescription>
                                History of all MOT and service reminders sent for this vehicle
                            </CardDescription>
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
                                    <p>No reminder history found for this vehicle</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
