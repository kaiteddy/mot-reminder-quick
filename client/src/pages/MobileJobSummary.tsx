import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { MapPin, Phone, Car, FileText, Navigation, ArrowLeft, Calendar, Construction } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function MobileJobSummary() {
    const { id } = useParams<{ id: string }>();
    const { data: result, isLoading } = trpc.vehicles.getById.useQuery({ id: parseInt(id) }, {
        enabled: !!id,
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 p-4 space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
            </div>
        );
    }

    if (!result?.vehicle) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
                <Construction className="w-16 h-16 text-slate-300 mb-4" />
                <h1 className="text-xl font-bold text-slate-700">Vehicle Not Found</h1>
                <p className="text-slate-500 mt-2">The requested job summary could not be found.</p>
            </div>
        );
    }

    const { vehicle, customer } = result;
    const addressString = customer ? [customer.address, customer.postcode].filter(Boolean).join(", ") : "";

    const openGoogleMaps = () => {
        if (!addressString) return;
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressString)}`, "_blank");
    };

    const openWaze = () => {
        if (!addressString) return;
        window.open(`https://waze.com/ul?navigate=yes&q=${encodeURIComponent(addressString)}`, "_blank");
    };

    const callCustomer = () => {
        if (!customer?.phone) return;
        window.location.href = `tel:${customer.phone}`;
    };

    return (
        <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
            {/* Mobile Header */}
            <div className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Car className="w-5 h-5 opacity-80" />
                    <h1 className="font-bold text-lg tracking-tight">Job Summary</h1>
                </div>
            </div>

            <div className="flex-1 p-4 space-y-4 max-w-md mx-auto w-full">

                {/* Vehicle Identity */}
                <Card className="border-none shadow-sm overflow-hidden rounded-2xl">
                    <div className="bg-slate-900 p-4 text-center">
                        <div className="inline-block bg-yellow-400 text-black px-4 py-1.5 rounded-md font-mono font-black text-2xl border-2 border-black shadow mb-2">
                            {vehicle.registration}
                        </div>
                        <h2 className="text-white font-bold text-lg uppercase">{vehicle.make} {vehicle.model}</h2>
                        <p className="text-slate-400 text-sm mt-1">{vehicle.colour} • {vehicle.fuelType}</p>
                    </div>
                </Card>

                {/* Customer Details */}
                {customer ? (
                    <Card className="border-none shadow-sm rounded-2xl">
                        <CardContent className="p-0">
                            <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                                <div className="bg-blue-100 p-2 rounded-full text-blue-600">
                                    <Phone className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Customer</p>
                                    <p className="font-bold text-slate-800 text-base truncate">{customer.name}</p>
                                    {customer.phone && <p className="text-sm text-slate-600">{customer.phone}</p>}
                                </div>
                                {customer.phone && (
                                    <Button size="icon" className="rounded-full bg-green-500 hover:bg-green-600 shadow-md shrink-0" onClick={callCustomer}>
                                        <Phone className="w-4 h-4 fill-white text-white" />
                                    </Button>
                                )}
                            </div>

                            <div className="p-4 flex items-start gap-3">
                                <div className="bg-red-100 p-2 rounded-full text-red-600 mt-1 shrink-0">
                                    <MapPin className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Address</p>
                                    {addressString ? (
                                        <p className="font-medium text-slate-800 text-sm leading-relaxed">{customer.address}<br />{customer.postcode}</p>
                                    ) : (
                                        <p className="text-sm text-slate-400 italic">No address on file</p>
                                    )}
                                </div>
                            </div>

                            {/* Navigation Buttons */}
                            {addressString && (
                                <div className="bg-slate-50 p-4 rounded-b-2xl flex gap-2">
                                    <Button onClick={openGoogleMaps} className="flex-1 bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 shadow-sm" variant="outline">
                                        <Navigation className="w-4 h-4 mr-2" />
                                        Google Maps
                                    </Button>
                                    <Button onClick={openWaze} className="flex-1 bg-white text-cyan-600 border border-cyan-200 hover:bg-cyan-50 shadow-sm" variant="outline">
                                        <Navigation className="w-4 h-4 mr-2" />
                                        Waze
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="border-none shadow-sm rounded-2xl">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-sm">Customer Details</CardTitle>
                            <CardDescription>No customer is assigned to this vehicle.</CardDescription>
                        </CardHeader>
                    </Card>
                )}

                {/* Technical Overview (Optional stuff) */}
                <Card className="border-none shadow-sm rounded-2xl">
                    <CardHeader className="pb-3 border-b border-slate-100">
                        <CardTitle className="text-sm font-bold uppercase text-slate-800 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-400" />
                            Overview
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">MOT Due</p>
                            <p className="font-bold text-slate-800 text-sm">
                                {vehicle.motExpiryDate ? new Date(vehicle.motExpiryDate).toLocaleDateString() : 'N/A'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">VIN Number</p>
                            <p className="font-mono font-medium text-slate-800 text-xs">
                                {vehicle.vin || 'N/A'}
                            </p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Notes</p>
                            <p className="text-sm text-slate-700">{vehicle.notes || <span className="text-slate-400 italic">No notes</span>}</p>
                        </div>
                    </CardContent>
                </Card>

            </div>
        </div>
    );
}
