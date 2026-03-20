import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Droplet, Wrench, Thermometer, Box, Activity, ChevronRight, ArrowLeft, Loader2, Gauge, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SWSDeepIntelEmbedProps {
    registration: string;
    vehicle: any; // Entire vehicle record from DB including comprehensiveTechnicalData
    onDataFetched?: () => void;
}

export function SWSDeepIntelEmbed({ registration, vehicle, onDataFetched }: SWSDeepIntelEmbedProps) {
    const [techData, setTechData] = useState<any>(vehicle?.comprehensiveTechnicalData);

    const fetchTechData = trpc.vehicles.fetchTechnicalData.useMutation({
        onSuccess: (response) => {
            if (response.success && response.data) {
                setTechData(response.data);
                if (onDataFetched) {
                    onDataFetched();
                }
            }
        }
    });

    useEffect(() => {
        if (vehicle && !techData && registration && !fetchTechData.isPending && !fetchTechData.isError && !fetchTechData.isSuccess) {
            fetchTechData.mutate({ registration });
        }
    }, [vehicle, techData, registration, fetchTechData]);

    if (fetchTechData.isPending || (!techData && !fetchTechData.isError)) {
        return (
            <div className="bg-white border-2 border-dashed border-blue-200 rounded-2xl h-[300px] flex flex-col items-center justify-center text-center p-8 space-y-4 shadow-sm mb-6">
                <div className="p-4 bg-blue-50 rounded-full animate-pulse">
                    <Gauge className="w-12 h-12 text-blue-400" />
                </div>
                <div>
                    <h3 className="text-lg font-bold uppercase tracking-tight text-blue-900">SWS Intelligence Scanning...</h3>
                    <p className="text-muted-foreground text-sm max-w-sm mx-auto mt-2">
                        Auto-pulling official fluid, aircon, and capacity data from the manufacturer deep network for {registration}...
                    </p>
                </div>
            </div>
        );
    }

    if (fetchTechData.isError && !techData) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center mb-6">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <h3 className="text-red-900 font-bold">Intelligence Scan Failed</h3>
                <p className="text-red-700 text-sm mt-1">SWS Data could not be pulled for this vehicle.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchTechData.mutate({ registration })}>Retry Scan</Button>
            </div>
        );
    }

    if (!techData) return null;

    // Data Processing 
    const uniqueLubricants = Array.isArray(techData?.lubricants)
        ? techData.lubricants.reduce((acc: any[], item: any) => {
            const existing = acc.find(
                (t: any) => t.description === item.description && t.capacity === item.capacity
            );
            if (existing) {
                if (item.specification && !existing._specs.includes(item.specification)) {
                    existing._specs.push(item.specification);
                }
            } else {
                acc.push({ ...item, _specs: item.specification ? [item.specification] : [] });
            }
            return acc;
        }, []).map((lub: any) => {
            if (lub._specs.length > 1) {
                const viscosities = new Set<string>();
                for (const spec of lub._specs) {
                    const match = spec.match(/\b\d{1,2}W-\d{2,3}\b/i);
                    if (match) viscosities.add(match[0].toUpperCase());
                }
                
                if (viscosities.size > 0) {
                    lub.specification = Array.from(viscosities).join(" OR ");
                    if (lub._specs[0].includes("API") || lub._specs[0].includes("ACEA")) {
                         lub.specification += ` (Any API/ACEA)`;
                    }
                } else {
                    lub.specification = lub._specs[0] + ` (+${lub._specs.length - 1} alt)`;
                }
            } else if (lub._specs.length === 1) {
                lub.specification = lub._specs[0];
            }
            return lub;
        })
        : [];

    return (
        <div className="space-y-6 mb-6">
            <h2 className="text-xl font-black uppercase text-slate-800 tracking-tight flex items-center gap-2 border-b pb-2">
                <ZapIcon className="w-5 h-5 text-blue-600 fill-blue-600" />
                SWS Deep Intelligence
            </h2>
            
            {/* Embedded Grid Wrapper */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                
                {/* Lubricants Card */}
                <Card className="shadow-md border-blue-50 lg:col-span-2">
                    <CardHeader className="bg-blue-50/50 border-b border-blue-100 py-3 px-4">
                        <CardTitle className="flex items-center gap-2 text-blue-900 uppercase font-black text-sm md:text-base">
                            <Droplet className="w-5 h-5 text-blue-500" />
                            Lubricants & Fluids
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 overflow-hidden rounded-b-xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-blue-50/50 text-blue-900 uppercase text-[10px] font-black border-y border-blue-100">
                                    <tr>
                                        <th className="px-3 md:px-5 py-3">Component / System</th>
                                        <th className="px-3 md:px-5 py-3">Specification / Grade</th>
                                        <th className="px-3 md:px-5 py-3 text-right whitespace-nowrap">Capacity</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-blue-50">
                                    {uniqueLubricants.length > 0 ? (
                                        uniqueLubricants.map((item: any, i: number) => (
                                            <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                                                <td className="px-3 md:px-5 py-3 font-bold text-slate-800 text-xs md:text-sm">
                                                    {item.description || "Fluid Specification"}
                                                </td>
                                                <td className="px-3 md:px-5 py-3 text-slate-600 font-medium min-w-[120px] break-words leading-snug text-xs md:text-sm">
                                                    {item.specification || "See technical note"}
                                                </td>
                                                <td className="px-3 md:px-5 py-3 text-right whitespace-nowrap text-xs md:text-sm">
                                                    {item.capacity ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-black">
                                                            {item.capacity} L
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 font-medium text-xs">N/A</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={3} className="text-center py-6 italic text-muted-foreground text-xs">
                                                No lubricant data returned from API
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {/* Aircon & System Card */}
                <Card className="shadow-md border-cyan-50">
                    <CardHeader className="bg-cyan-50/50 border-b border-cyan-100 py-3 px-4">
                        <CardTitle className="flex items-center gap-2 text-cyan-900 uppercase font-black text-sm">
                            <Thermometer className="w-4 h-4 text-cyan-500" />
                            AC System
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                        {techData.aircon ? (
                            <>
                                <div className="space-y-0.5">
                                    <p className="text-[9px] font-black uppercase text-cyan-600 tracking-wider">Refrigerant Type</p>
                                    <p className="text-xl font-black text-slate-900 uppercase">{techData.aircon.type || "N/A"}</p>
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-[9px] font-black uppercase text-cyan-600 tracking-wider">Gas Quantity (Grams)</p>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-2xl font-black text-slate-900">{techData.aircon.quantity || "N/A"}</span>
                                        <span className="text-xs font-bold text-slate-400">g</span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <p className="text-center py-4 italic text-muted-foreground text-xs">AC data unavailable</p>
                        )}
                    </CardContent>
                </Card>

                {/* Physical Infrastructure */}
                {techData.ukvd && (
                    <Card className="shadow-md border-purple-50">
                        <CardHeader className="bg-purple-50/50 border-b border-purple-100 py-3 px-4">
                            <CardTitle className="flex items-center gap-2 text-purple-900 uppercase font-black text-sm">
                                <Box className="w-4 h-4 text-purple-500" />
                                Dimensions
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 grid grid-cols-2 gap-y-4 gap-x-2">
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-black uppercase text-purple-600">Height/Width</p>
                                <p className="font-bold text-slate-900 text-xs text-nowrap">
                                    {techData.ukvd.dimensions?.height || "?"} / {techData.ukvd.dimensions?.width || "?"} <span className="text-[9px] text-slate-400">mm</span>
                                </p>
                            </div>
                            <div className="space-y-0.5 text-right">
                                <p className="text-[9px] font-black uppercase text-purple-600">Length/WB</p>
                                <p className="font-bold text-slate-900 text-xs text-nowrap">
                                    {techData.ukvd.dimensions?.length || "?"} / {techData.ukvd.dimensions?.wheelbase || "?"}<span className="text-[9px] text-slate-400">mm</span>
                                </p>
                            </div>
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-black uppercase text-purple-600">Gross Wt</p>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-lg font-black text-slate-900 leading-none">{techData.ukvd.weights?.gross || "N/A"}</span>
                                    <span className="text-[9px] font-bold text-slate-400">KG</span>
                                </div>
                            </div>
                            <div className="space-y-0.5 text-right">
                                <p className="text-[9px] font-black uppercase text-purple-600">Payload</p>
                                <div className="flex items-baseline justify-end gap-1">
                                    <span className="text-lg font-black text-slate-900 leading-none">{techData.ukvd.weights?.payload || "N/A"}</span>
                                    <span className="text-[9px] font-bold text-slate-400">KG</span>
                                </div>
                            </div>
                            {techData.ukvd.fuelTankCapacity && (
                                <div className="col-span-2 pt-2 border-t border-purple-100 flex justify-between items-center mt-1">
                                    <span className="text-[9px] font-black uppercase text-purple-600 tracking-wider">Fuel Tank Capacity</span>
                                    <span className="font-black text-slate-900 text-sm">{techData.ukvd.fuelTankCapacity} <span className="text-[9px] font-bold text-slate-400 uppercase">Litres</span></span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
            
        </div>
    );
}

function ZapIcon(props: any) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    )
}
