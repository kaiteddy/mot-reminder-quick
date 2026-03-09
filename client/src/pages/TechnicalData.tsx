import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Wrench, Droplets, AlertTriangle, ChevronRight, Clock, CalendarHeart } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export default function TechnicalData() {
    const [vrm, setVrm] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"specs" | "service" | "repair">("specs");
    const initialLoadDone = useRef(false);

    useEffect(() => {
        if (initialLoadDone.current) return;
        const params = new URLSearchParams(window.location.search);
        const urlVrm = params.get("vrm");
        if (urlVrm) {
            setVrm(urlVrm);
            // Trigger automatic search
            handleSearch("specs", urlVrm);
        }
        initialLoadDone.current = true;
    }, []);

    // Extracted Data
    const [vehicleSpecs, setVehicleSpecs] = useState<any>(null);
    const [htmlContent, setHtmlContent] = useState<string | null>(null);

    const pollJob = async (jobId: number, retries = 20): Promise<any> => {
        let attempts = 0;
        while (attempts < retries) {
            const res = await fetch(`/api/autodata/job/${jobId}`);
            const data = await res.json();

            if (data.status === "completed") {
                return data.data;
            } else if (data.status === "failed") {
                throw new Error(data.error || "Drone failed fetching Autodata proxy");
            }

            attempts++;
            await new Promise(r => setTimeout(r, 1500));
        }
        throw new Error("Drone proxy timed out waiting for browser extension");
    };

    const handleSearch = async (tab: "specs" | "service" | "repair", overrideVrm?: string) => {
        const targetVrm = overrideVrm || vrm;
        if (!targetVrm.trim()) return;

        setIsLoading(true);
        setError(null);
        setHtmlContent(null);

        if (tab === "specs") setVehicleSpecs(null);

        try {
            // Wait for VRM Resolution 
            const resolveRes = await fetch(`/api/autodata/resolve-vrm?vrm=${encodeURIComponent(targetVrm)}`);
            const resolveData = await resolveRes.json();

            if (!resolveData.success || !resolveData.jobId) {
                throw new Error("Unable to locate VRM in Autodata Database.");
            }
            const vrmResult = await pollJob(resolveData.jobId);
            const mid = vrmResult?.[0]?.mid;

            if (!mid) {
                throw new Error("No vehicle match found from Autodata");
            }

            if (tab === "specs") {
                const res = await fetch(`/api/autodata/engine-oils?vrm=${encodeURIComponent(vrm)}&mid=${mid}`);
                const data = await res.json();
                if (!data.success || !data.jobId) throw new Error(data.error);

                const oilResult = await pollJob(data.jobId);
                setVehicleSpecs(oilResult);
                toast.success("Successfully fetched specs via Drone");
            }
            else if (tab === "service") {
                const path = `/w1/service-schedules/${mid}?vrm=${encodeURIComponent(targetVrm)}`;
                const res = await fetch(`/api/autodata/scrape`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });
                const data = await res.json();
                if (!data.success || !data.jobId) throw new Error(data.error);

                const resData = await pollJob(data.jobId, 60);
                if (resData?.rawHtml) {
                    const styledHtml = resData.rawHtml.replace(/<head>/i, '<head><base target="_blank" href="https://workshop.autodata-group.com/">');
                    setHtmlContent(styledHtml);
                    toast.success("Captured Service Schedules UI");
                }
            }
            else if (tab === "repair") {
                const path = `/w1/vehicles/variants/repair-times/${mid}?vrm=${encodeURIComponent(targetVrm)}`;
                const res = await fetch(`/api/autodata/scrape`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });
                const data = await res.json();
                if (!data.success || !data.jobId) throw new Error(data.error);

                const resData = await pollJob(data.jobId, 60);
                if (resData?.rawHtml) {
                    const styledHtml = resData.rawHtml.replace(/<head>/i, '<head><base target="_blank" href="https://workshop.autodata-group.com/">');
                    setHtmlContent(styledHtml);
                    toast.success("Captured Repair Times UI");
                }
            }

        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <DashboardLayout>
            <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
                        <Wrench className="h-8 w-8 text-primary" />
                        Technical Workspace
                    </h1>
                    <p className="text-muted-foreground">
                        Native Drone injection into Autodata systems, bypassing WAF restrictions.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="flex flex-col gap-4 lg:col-span-1">
                        <Card className="shadow-lg border-primary/10">
                            <CardHeader className="bg-primary/5 border-b border-primary/10 pb-4">
                                <CardTitle>Lookup</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <form onSubmit={(e) => { e.preventDefault(); handleSearch(activeTab); }} className="flex flex-col gap-4">
                                    <div className="relative">
                                        <Input
                                            type="text"
                                            placeholder="VRM (e.g. DY60WXE)"
                                            className="pl-10 uppercase font-bold text-center text-lg h-12 bg-secondary/50"
                                            value={vrm}
                                            onChange={(e) => setVrm(e.target.value)}
                                        />
                                        <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
                                    </div>

                                    <div className="space-y-2 pt-4">
                                        <Button
                                            type="button"
                                            variant={activeTab === 'specs' ? 'default' : 'outline'}
                                            className="w-full justify-start h-11"
                                            onClick={() => { setActiveTab('specs'); handleSearch('specs'); }}
                                            disabled={isLoading || !vrm}
                                        >
                                            <Droplets className="mr-2 h-4 w-4" /> Engine Specs
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={activeTab === 'service' ? 'default' : 'outline'}
                                            className="w-full justify-start h-11"
                                            onClick={() => { setActiveTab('service'); handleSearch('service'); }}
                                            disabled={isLoading || !vrm}
                                        >
                                            <CalendarHeart className="mr-2 h-4 w-4" /> Service Schedules
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={activeTab === 'repair' ? 'default' : 'outline'}
                                            className="w-full justify-start h-11"
                                            onClick={() => { setActiveTab('repair'); handleSearch('repair'); }}
                                            disabled={isLoading || !vrm}
                                        >
                                            <Clock className="mr-2 h-4 w-4" /> Repair Times
                                        </Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="lg:col-span-3">
                        {error && (
                            <div className="bg-destructive/10 text-destructive p-4 rounded-lg flex items-center gap-3 border border-destructive/20 mb-4">
                                <AlertTriangle className="h-5 w-5" />
                                <p>{error}</p>
                            </div>
                        )}

                        {isLoading && (
                            <Card className="flex flex-col items-center justify-center p-24 bg-card/50 text-muted-foreground shadow-sm">
                                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                                <p className="text-lg font-medium">Bypassing Firewalls & Fetching Data...</p>
                                <p className="text-sm">Drone execution can take 5-10 seconds per run.</p>
                            </Card>
                        )}

                        {/* Specs View */}
                        {vehicleSpecs && !isLoading && activeTab === 'specs' && (
                            <Card className="border-t-4 border-t-amber-500 shadow-xl overflow-hidden">
                                <CardHeader className="pb-2 bg-gradient-to-br from-amber-500/5 to-transparent">
                                    <CardTitle className="flex items-center gap-2 text-2xl">
                                        <Droplets className="h-6 w-6 text-amber-500" />
                                        Engine Oil Subsystems
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="flex items-baseline gap-2 mb-8">
                                        <span className="text-6xl font-bold tracking-tighter text-amber-500 drop-shadow-sm">{vehicleSpecs.engine_capacity?.value || "N/A"}</span>
                                        <span className="text-2xl text-muted-foreground font-medium uppercase font-mono">{vehicleSpecs.engine_capacity?.unit || "L"}</span>
                                        <Badge variant="outline" className="ml-4 text-sm px-3 py-1 bg-amber-500/10 text-amber-700 border-amber-500/20">Includes Filter Capacity</Badge>
                                    </div>

                                    <div className="grid gap-4">
                                        {vehicleSpecs.engine_oils?.map((oil: any, idx: number) => (
                                            <div key={idx} className="bg-card hover:bg-muted/50 transition-colors p-6 rounded-xl border shadow-sm">
                                                <div className="flex flex-col gap-4 relative">
                                                    <div className="flex justify-between items-start">
                                                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Recommended Viscosities</h4>
                                                    </div>

                                                    <div className="flex flex-wrap gap-2">
                                                        {oil.grades?.map((grade: any, gIdx: number) => (
                                                            <div key={gIdx} className="bg-background border-2 border-amber-500/40 text-foreground font-bold px-4 py-2 rounded-lg shadow-sm">
                                                                {grade.value}
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div className="mt-4 pt-4 border-t flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                                        {oil.classifications?.map((cls: any, cIdx: number) => (
                                                            <span key={cIdx} className="flex items-center gap-2 font-mono text-muted-foreground">
                                                                <ChevronRight className="h-3 w-3 text-amber-500" />
                                                                {cls.value}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Interactive UI Proxy View */}
                        {htmlContent && !isLoading && (activeTab === 'service' || activeTab === 'repair') && (
                            <Card className="shadow-xl overflow-hidden h-[800px] border-secondary/50 relative">
                                {/* The magic! Render the Autodata DOM purely isolated via data URI so css isn't bled */}
                                <iframe
                                    srcDoc={htmlContent}
                                    className="w-full h-full border-0 absolute inset-0 bg-white"
                                    sandbox="allow-same-origin allow-scripts"
                                />
                            </Card>
                        )}

                        {!isLoading && !vehicleSpecs && !htmlContent && !error && (
                            <div className="flex flex-col items-center justify-center p-24 text-muted-foreground border-2 border-dashed rounded-xl bg-card/30">
                                <Wrench className="h-16 w-16 mb-6 opacity-20" />
                                <p className="text-xl font-medium">Ready to fetch live specifications</p>
                                <p className="text-sm text-center max-w-sm mt-2">Enter a VRM and select a workspace tab to extract technical diagrams natively via the system extension.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
