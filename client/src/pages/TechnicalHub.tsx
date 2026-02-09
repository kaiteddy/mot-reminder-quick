import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Search,
    Zap,
    Droplet,
    Thermometer,
    Wrench,
    Settings,
    Loader2,
    AlertCircle,
    CheckCircle2,
    Info,
    ShieldCheck,
    Gauge
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function TechnicalHub() {
    const [registration, setRegistration] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const utils = trpc.useUtils();

    const { data: result, isLoading: isQueryLoading } = trpc.vehicles.getByRegistration.useQuery(
        { registration: searchQuery },
        { enabled: !!searchQuery, retry: false }
    );

    const vehicle = result?.vehicle;

    const fetchTechData = trpc.vehicles.fetchTechnicalData.useMutation({
        onSuccess: () => {
            toast.success("Deep technical scan complete!");
            utils.vehicles.getByRegistration.invalidate({ registration: searchQuery });
        },
        onError: (err) => {
            toast.error("Deep scan failed: " + err.message);
        }
    });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (registration.length < 5) {
            toast.error("Please enter a valid registration");
            return;
        }
        setSearchQuery(registration.toUpperCase().replace(/\s/g, ""));
    };

    const techData = vehicle?.comprehensiveTechnicalData as any;

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-6xl mx-auto">
                {/* Search Header */}
                <div className="bg-slate-900 text-white p-8 rounded-2xl shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <Settings className="w-32 h-32 rotate-12" />
                    </div>

                    <div className="relative z-10 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500 rounded-lg">
                                <Zap className="w-6 h-6 fill-white" />
                            </div>
                            <h1 className="text-3xl font-black tracking-tight uppercase">Technical Intelligence Hub</h1>
                        </div>
                        <p className="text-slate-400 max-w-xl font-medium">
                            Access deep technical specifications, lubricant requirements, and AC system data sourced directly from SWS Solutions.
                        </p>

                        <form onSubmit={handleSearch} className="flex gap-2 max-w-md pt-4">
                            <div className="relative flex-1">
                                <Input
                                    placeholder="ENTER REGISTRATION"
                                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 font-mono font-bold text-xl uppercase h-12 tracking-widest pl-4"
                                    value={registration}
                                    onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                                />
                            </div>
                            <Button type="submit" size="lg" className="bg-blue-600 hover:bg-blue-700 h-12 px-6 font-bold shadow-lg shadow-blue-900/20">
                                {isQueryLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Search className="w-5 h-5 mr-2" />}
                                LOOKUP
                            </Button>
                        </form>
                    </div>
                </div>

                {searchQuery && !isQueryLoading && !vehicle && (
                    <Card className="border-dashed border-2">
                        <CardContent className="flex flex-col items-center py-12 text-center space-y-4">
                            <div className="p-4 bg-amber-50 rounded-full">
                                <AlertCircle className="w-12 h-12 text-amber-500" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold uppercase">Vehicle Not Found In Database</h3>
                                <p className="text-muted-foreground">Make sure the vehicle has been searched in the main system or MOT history first.</p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {vehicle && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-500">
                        {/* Vehicle Identity Sidebar */}
                        <div className="lg:col-span-4 space-y-6">
                            <Card className="overflow-hidden border-2 border-blue-100 shadow-lg">
                                <div className="bg-blue-600 p-6 text-white text-center">
                                    <div className="bg-yellow-400 text-black px-4 py-1.5 rounded-md font-mono font-black text-3xl border-2 border-black inline-block shadow-md mb-4 tracking-tighter">
                                        {vehicle.registration}
                                    </div>
                                    <h2 className="text-xl font-black uppercase tracking-tight">{vehicle.make} {vehicle.model}</h2>
                                    <p className="text-blue-100 text-sm font-medium mt-1">{vehicle.fuelType} • {vehicle.colour} • {vehicle.engineCC}cc</p>
                                </div>
                                <CardContent className="p-0">
                                    <div className="divide-y text-sm">
                                        <div className="p-4 flex justify-between">
                                            <span className="text-muted-foreground font-bold uppercase text-[10px]">VIN / Chassis</span>
                                            <span className="font-mono font-medium">{vehicle.vin || "N/A"}</span>
                                        </div>
                                        <div className="p-4 flex justify-between">
                                            <span className="text-muted-foreground font-bold uppercase text-[10px]">Engine Code</span>
                                            <span className="font-bold">{vehicle.engineCode || "N/A"}</span>
                                        </div>
                                        <div className="p-4 flex justify-between">
                                            <span className="text-muted-foreground font-bold uppercase text-[10px]">First Registered</span>
                                            <span className="font-bold">{vehicle.dateOfRegistration ? new Date(vehicle.dateOfRegistration).toLocaleDateString() : "N/A"}</span>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-slate-50 border-t">
                                        {!techData ? (
                                            <Button
                                                className="w-full bg-blue-600 hover:bg-blue-700 font-bold"
                                                onClick={() => fetchTechData.mutate({ registration: searchQuery })}
                                                disabled={fetchTechData.isPending}
                                            >
                                                {fetchTechData.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2 fill-white" />}
                                                TRIGGER DEEP SCAN
                                            </Button>
                                        ) : (
                                            <div className="flex flex-col items-center py-2">
                                                <div className="flex items-center text-green-600 font-black text-xs uppercase gap-1 mb-2">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    Intelligence Synced
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    className="w-full text-[11px] h-8"
                                                    onClick={() => fetchTechData.mutate({ registration: searchQuery })}
                                                    disabled={fetchTechData.isPending}
                                                >
                                                    Refresh Data
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="bg-blue-600 text-white shadow-lg overflow-hidden border-0">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-black uppercase flex items-center gap-2">
                                        <ShieldCheck className="w-4 h-4" />
                                        DVSA STATUS
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex justify-between items-center border-b border-white/20 pb-3">
                                        <span className="text-white/70 text-xs font-bold uppercase">MOT Expiry</span>
                                        <span className="font-black">{vehicle.motExpiryDate ? new Date(vehicle.motExpiryDate).toLocaleDateString('en-GB') : "N/A"}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-white/70 text-xs font-bold uppercase">Tax Status</span>
                                        <span className="bg-white text-blue-700 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">{vehicle.taxStatus || "Unknown"}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Main Technical Content */}
                        <div className="lg:col-span-8 space-y-6">
                            {!techData ? (
                                <div className="bg-white border-2 border-dashed rounded-2xl h-[400px] flex flex-col items-center justify-center text-center p-8 space-y-4 shadow-sm">
                                    <div className="p-4 bg-slate-100 rounded-full animate-pulse">
                                        <Gauge className="w-16 h-16 text-slate-300" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold uppercase tracking-tight">Intelligence Not Initialized</h3>
                                        <p className="text-muted-foreground max-w-md mx-auto">
                                            This vehicle has not yet undergone a deep technical scan. Use the scan button to pull official oil, aircon, and spec data.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Lubricants Card */}
                                    <Card className="shadow-lg border-blue-50">
                                        <CardHeader className="bg-blue-50/50 border-b border-blue-100">
                                            <CardTitle className="flex items-center gap-3 text-blue-900 uppercase font-black text-lg">
                                                <Droplet className="w-6 h-6 text-blue-500" />
                                                Lubricants & Fluids
                                            </CardTitle>
                                            <CardDescription className="text-blue-700/70 font-medium">Original Manufacturer Specification</CardDescription>
                                        </CardHeader>
                                        <CardContent className="p-6">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {techData.lubricants?.map?.((item: any, i: number) => (
                                                    <div key={i} className="group bg-slate-50 p-4 rounded-xl border border-slate-200 hover:border-blue-300 transition-all hover:shadow-md">
                                                        <p className="text-[10px] font-black uppercase text-slate-500 mb-1 group-hover:text-blue-600">{item.description || "Fluid Specification"}</p>
                                                        <p className="font-bold text-slate-900 leading-tight">{item.specification || "See technical note"}</p>
                                                        {item.capacity && (
                                                            <div className="mt-3 inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-black">
                                                                CAPACITY: {item.capacity} LITRES
                                                            </div>
                                                        )}
                                                    </div>
                                                )) || (
                                                        <div className="col-span-2 text-center py-8 italic text-muted-foreground">
                                                            No lubricant data returned from API
                                                        </div>
                                                    )}
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Labor Times Card */}
                                    {techData.repairTimes && (
                                        <Card className="shadow-lg border-indigo-50">
                                            <CardHeader className="bg-indigo-50/50 border-b border-indigo-100">
                                                <CardTitle className="flex items-center gap-3 text-indigo-900 uppercase font-black text-lg">
                                                    <Wrench className="w-6 h-6 text-indigo-500" />
                                                    Repair Strategy & Labor Times
                                                </CardTitle>
                                                <CardDescription className="text-indigo-700/70 font-medium">Standard Manufacturer Labor Durations</CardDescription>
                                            </CardHeader>
                                            <CardContent className="p-6">
                                                <div className="space-y-6">
                                                    {/* Categories Tree */}
                                                    <div className="flex flex-wrap gap-2">
                                                        {techData.repairTimes.tree?.map((node: any) => (
                                                            <div key={node.id} className="bg-white px-3 py-1 rounded-full text-[10px] font-bold text-slate-600 uppercase border border-slate-200 shadow-sm">
                                                                {node.text}
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Specific Times (Details) */}
                                                    <div className="grid grid-cols-1 gap-3">
                                                        {Array.isArray(techData.repairTimes.details) ? techData.repairTimes.details.map((detail: any, i: number) => {
                                                            const item = detail.TechnicalData;
                                                            if (!item?.descriptions?.item) return null;
                                                            return (
                                                                <div key={i} className="flex justify-between items-center bg-indigo-50/20 p-4 rounded-xl border border-indigo-100/50 hover:bg-white hover:shadow-md transition-all group">
                                                                    <div className="space-y-0.5">
                                                                        <p className="font-black uppercase text-[10px] text-indigo-600 tracking-wider opacity-60">{item.ids?.item}</p>
                                                                        <p className="font-bold text-slate-900 group-hover:text-indigo-900">{item.descriptions?.item}</p>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <div className="text-2xl font-black text-indigo-600 flex items-baseline gap-1">
                                                                            {item.totalTime}
                                                                            <span className="text-[10px] uppercase text-indigo-400">Min</span>
                                                                        </div>
                                                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Allowance</p>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }) : (
                                                            <div className="text-center py-4 text-xs italic text-muted-foreground bg-indigo-50/10 rounded-lg">
                                                                Deeper labor data available in technical sub-menus
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )}

                                    {/* Aircon & System Card */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <Card className="shadow-lg border-cyan-50">
                                            <CardHeader className="bg-cyan-50/50 border-b border-cyan-100">
                                                <CardTitle className="flex items-center gap-2 text-cyan-900 uppercase font-black text-sm">
                                                    <Thermometer className="w-5 h-5 text-cyan-500" />
                                                    AC System
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-6 space-y-6">
                                                {techData.aircon ? (
                                                    <>
                                                        <div className="space-y-1">
                                                            <p className="text-[10px] font-black uppercase text-cyan-600">Refrigerant Type</p>
                                                            <p className="text-2xl font-black text-slate-900 uppercase">{techData.aircon.type || "N/A"}</p>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <p className="text-[10px] font-black uppercase text-cyan-600">Gas Quantity (Grams)</p>
                                                            <div className="flex items-baseline gap-1">
                                                                <span className="text-3xl font-black text-slate-900">{techData.aircon.quantity || "N/A"}</span>
                                                                <span className="text-sm font-bold text-slate-400">g</span>
                                                            </div>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <p className="text-center py-8 italic text-muted-foreground">AC data unavailable</p>
                                                )}
                                            </CardContent>
                                        </Card>

                                        <Card className="shadow-lg border-orange-50">
                                            <CardHeader className="bg-orange-50/50 border-b border-orange-100">
                                                <CardTitle className="flex items-center gap-2 text-orange-900 uppercase font-black text-sm">
                                                    <Wrench className="w-5 h-5 text-orange-500" />
                                                    System Overview
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-6 space-y-4">
                                                <div className="flex items-start gap-3">
                                                    <div className="p-2 bg-slate-100 rounded-lg">
                                                        <Info className="w-4 h-4 text-slate-600" />
                                                    </div>
                                                    <div className="text-sm">
                                                        <p className="font-black uppercase text-[10px] text-slate-500">Intelligence Sync Source</p>
                                                        <p className="font-bold">SWS Multi-API V4 Bridge</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-3">
                                                    <div className="p-2 bg-slate-100 rounded-lg">
                                                        <Settings className="w-4 h-4 text-slate-600" />
                                                    </div>
                                                    <div className="text-sm">
                                                        <p className="font-black uppercase text-[10px] text-slate-500">Last Database Update</p>
                                                        <p className="font-bold">{vehicle.swsLastUpdated ? new Date(vehicle.swsLastUpdated).toLocaleString() : "Sync required"}</p>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
