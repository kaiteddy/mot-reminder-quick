import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Wrench, Droplets, AlertTriangle, ChevronRight, Clock, CalendarHeart } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface ParsedServiceData {
    vehicleDetails: string;
    engineDetails: string;
    mainServiceInterval: string;
    additionalItems: { name: string, time: string }[];
    groups: { title: string, items: string[] }[];
    totalTime: string;
}

const parseServiceSchedules = (html: string): ParsedServiceData => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const vehicleDetails = doc.querySelector('.vehicle-details .print-manufacturer-model')?.textContent?.trim().replace(/\s+/g, ' ') ||
        doc.querySelector('.vehicle-info .displayModel')?.textContent?.trim() || "Vehicle";

    const engineDetails = doc.querySelector('.vehicle-details .print-other-details')?.textContent?.trim().replace(/\s+/g, ' ') ||
        doc.querySelector('.vehicle-info .engine-size')?.textContent?.trim() || "Engine";

    // Default service items (e.g. "Standard workshop operations")
    const mainServiceInterval = doc.querySelector('#main-service-interval .main-service-tag[data-name]')?.getAttribute('data-name') || "Standard workshop operations";

    const additionalItems: any[] = [];
    doc.querySelectorAll('li[additonal-service-nid]').forEach(li => {
        const nameNode = li.querySelector('label span');
        const name = nameNode?.textContent?.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        const timeField = li.querySelector('.sub label')?.textContent?.trim();
        if (name) {
            additionalItems.push({ name, time: timeField?.replace('Service time ', '') || "N/A" });
        }
    });

    const groups: any[] = [];
    doc.querySelectorAll('.accordian-module').forEach(module => {
        const titleRaw = module.querySelector('.accordian-head h3')?.textContent || "";
        const title = titleRaw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

        const items: string[] = [];
        module.querySelectorAll('.operation-item').forEach(item => {
            let itemName = item.querySelector('span[id^="additional-list-name"]')?.textContent ||
                item.querySelector('.op_illus')?.textContent || "";
            itemName = itemName.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (itemName) items.push(itemName);
        });

        if (title && items.length > 0) {
            groups.push({ title, items });
        }
    });

    const totalTime = doc.querySelector('.calculated-time')?.textContent?.trim() || "0.00";

    return { vehicleDetails, engineDetails, mainServiceInterval, additionalItems, groups, totalTime };
};

interface ParsedRepairData {
    vehicleDetails: string;
    engineDetails: string;
    groups: {
        title: string;
        items: {
            action?: string;
            description: string;
            time: string;
        }[];
    }[];
}

const parseRepairTimes = (html: string): ParsedRepairData => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const vehicleDetails = doc.querySelector('.vehicle-details .print-manufacturer-model')?.textContent?.trim().replace(/\s+/g, ' ') ||
        doc.querySelector('.vehicle-info .displayModel')?.textContent?.trim() || "Vehicle";

    const engineDetails = doc.querySelector('.vehicle-details .print-other-details')?.textContent?.trim().replace(/\s+/g, ' ') ||
        doc.querySelector('.vehicle-info .engine-size')?.textContent?.trim() || "Engine";

    const groups: any[] = [];
    doc.querySelectorAll('.accordian-module').forEach(module => {
        const titleRaw = module.querySelector('.accordian-head h3, .accordian-head')?.textContent || "";
        const title = titleRaw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

        const items: any[] = [];

        // Method 1: Tables
        module.querySelectorAll('tr').forEach(tr => {
            const tds = Array.from(tr.querySelectorAll('td'));
            if (tds.length >= 2) {
                let action = "";
                let description = "";
                let time = "0.00";

                if (tds.length === 2) {
                    description = tds[0].textContent?.trim() || "";
                    time = tds[1].textContent?.trim() || "0.00";
                } else if (tds.length >= 3) {
                    action = tds[0].textContent?.trim() || "";
                    description = tds[1].textContent?.trim() || "";
                    time = tr.querySelector('.data-adjuster-initialized')?.textContent?.trim() || tds[tds.length - 1].textContent?.trim() || "0.00";
                }

                description = description.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                action = action.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

                const matchTime = time.match(/[\d.]+/);
                if (description && matchTime) {
                    items.push({ action, description, time: matchTime[0] });
                }
            }
        });

        // Method 2: Lists
        if (items.length === 0) {
            module.querySelectorAll('.operation-item, li').forEach(item => {
                // Ignore items lacking an explicit time field
                const timeEl = item.querySelector('.data-adjuster-initialized, .time');
                if (timeEl) {
                    let itemName = item.querySelector('span[id^="additional-list-name"]')?.textContent ||
                        item.querySelector('.op_illus')?.textContent || item.textContent || "";
                    itemName = itemName.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

                    let time = timeEl.textContent?.trim() || "0.00";
                    const matchTime = time.match(/[\d.]+/);
                    if (itemName && matchTime) items.push({ action: "", description: itemName, time: matchTime[0] });
                }
            });
        }

        const uniqueItems = items.filter((v, i, a) => a.findIndex(t => (t.description === v.description && t.time === v.time)) === i);

        if (title && uniqueItems.length > 0) {
            groups.push({ title, items: uniqueItems });
        }
    });

    return { vehicleDetails, engineDetails, groups };
};

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
    const [parsedServiceData, setParsedServiceData] = useState<ParsedServiceData | null>(null);
    const [parsedRepairData, setParsedRepairData] = useState<ParsedRepairData | null>(null);

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
        setParsedServiceData(null);
        setParsedRepairData(null);

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
                const path = `/w1/vehicles/variants/service-schedules/${mid}?route_name=service-schedules&module=SG&vrm=${encodeURIComponent(targetVrm)}`;
                const res = await fetch(`/api/autodata/scrape`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });
                const data = await res.json();
                if (!data.success || !data.jobId) throw new Error(data.error);

                const resData = await pollJob(data.jobId, 60);
                if (resData?.rawHtml) {
                    const parsed = parseServiceSchedules(resData.rawHtml);
                    if (parsed.groups.length > 0) {
                        setParsedServiceData(parsed);
                        toast.success("Successfully parsed Service Schedules natively");
                    } else {
                        // Fallback to iframe
                        const styledHtml = resData.rawHtml.replace(/<head>/i, '<head><base target="_blank" href="https://workshop.autodata-group.com/">');
                        setHtmlContent(styledHtml);
                        toast.success("Captured Service Schedules UI");
                    }
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
                    const parsed = parseRepairTimes(resData.rawHtml);
                    if (parsed.groups.length > 0) {
                        setParsedRepairData(parsed);
                        toast.success("Successfully parsed Repair Times natively");
                    } else {
                        const styledHtml = resData.rawHtml.replace(/<head>/i, '<head><base target="_blank" href="https://workshop.autodata-group.com/">');
                        setHtmlContent(styledHtml);
                        toast.success("Captured Repair Times UI");
                    }
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

                        {/* Parsed Service UI View */}
                        {parsedServiceData && !isLoading && activeTab === 'service' && (
                            <div className="flex flex-col gap-6">
                                <Card className="border-t-4 border-t-primary shadow-xl">
                                    <CardHeader className="bg-primary/5 pb-4">
                                        <CardTitle className="text-2xl flex items-center gap-2">
                                            <CalendarHeart className="h-6 w-6 text-primary" />
                                            {parsedServiceData.vehicleDetails}
                                        </CardTitle>
                                        <CardDescription className="text-base text-foreground font-medium">
                                            {parsedServiceData.engineDetails}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="pt-6">
                                        <div className="flex justify-between items-center mb-6 p-4 rounded-xl border bg-card shadow-sm">
                                            <div className="flex flex-col gap-1">
                                                <h3 className="font-semibold text-muted-foreground uppercase tracking-widest text-sm">Main Service Operation</h3>
                                                <span className="font-bold text-lg">{parsedServiceData.mainServiceInterval}</span>
                                            </div>
                                            <div className="text-right">
                                                <h3 className="font-semibold text-muted-foreground uppercase tracking-widest text-sm">Base Time</h3>
                                                <span className="font-bold text-lg text-primary">{parsedServiceData.totalTime} hrs</span>
                                            </div>
                                        </div>

                                        {parsedServiceData.additionalItems.length > 0 && (
                                            <div className="mb-8">
                                                <h3 className="text-lg font-bold mb-3 border-b pb-2 flex items-center gap-2">
                                                    <Wrench className="h-5 w-5 text-slate-500" />
                                                    Available Additional Services
                                                </h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {parsedServiceData.additionalItems.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between items-center bg-secondary/30 p-3 rounded-md border">
                                                            <span className="font-medium text-sm text-muted-foreground">{item.name}</span>
                                                            <Badge variant="secondary" className="font-mono">{item.time}</Badge>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-6">
                                            <h3 className="text-lg font-bold flex items-center gap-2">
                                                <Clock className="h-5 w-5 text-slate-500" />
                                                Core Operations List
                                            </h3>
                                            {parsedServiceData.groups.map((group, idx) => (
                                                <Card key={idx} className="shadow-sm border-l-4 border-l-slate-400">
                                                    <CardHeader className="p-4 py-3 bg-muted/40">
                                                        <CardTitle className="text-md capitalize">{group.title.toLowerCase()}</CardTitle>
                                                    </CardHeader>
                                                    <CardContent className="p-4">
                                                        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-x-4 gap-y-2">
                                                            {group.items.map((item, idxx) => (
                                                                <li key={idxx} className="flex items-start gap-2 text-sm text-foreground">
                                                                    <div className="h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                                                                    <span>{item}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Parsed Repair UI View */}
                        {parsedRepairData && !isLoading && activeTab === 'repair' && (
                            <div className="flex flex-col gap-6">
                                <Card className="border-t-4 border-t-primary shadow-xl">
                                    <CardHeader className="bg-primary/5 pb-4">
                                        <CardTitle className="text-2xl flex items-center gap-2">
                                            <Clock className="h-6 w-6 text-primary" />
                                            {parsedRepairData.vehicleDetails}
                                        </CardTitle>
                                        <CardDescription className="text-base text-foreground font-medium">
                                            {parsedRepairData.engineDetails}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="pt-6">
                                        <div className="space-y-6">
                                            {parsedRepairData.groups.map((group, idx) => (
                                                <Card key={idx} className="shadow-sm border-l-4 border-l-slate-400">
                                                    <CardHeader className="p-4 py-3 bg-muted/40 flex flex-row items-center justify-between">
                                                        <CardTitle className="text-md capitalize">{group.title.toLowerCase()}</CardTitle>
                                                        <Badge variant="outline">{group.items.length} records</Badge>
                                                    </CardHeader>
                                                    <CardContent className="p-0">
                                                        <div className="divide-y max-h-[600px] overflow-y-auto">
                                                            {group.items.map((item, idxx) => (
                                                                <div key={idxx} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 hover:bg-muted/30 transition-colors gap-4">
                                                                    <div className="flex flex-col">
                                                                        {item.action && (
                                                                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{item.action}</span>
                                                                        )}
                                                                        <span className="text-sm font-medium text-foreground">{item.description}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <span className="text-xs text-muted-foreground font-medium uppercase min-w-[30px] text-right">Hrs</span>
                                                                        <Badge variant="secondary" className="font-mono text-base font-bold bg-primary/10 text-primary px-3 py-1">{item.time}</Badge>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Interactive UI Proxy View Fallback */}
                        {htmlContent && !isLoading && !parsedServiceData && !parsedRepairData && (activeTab === 'service' || activeTab === 'repair') && (
                            <Card className="shadow-xl overflow-hidden h-[800px] border-secondary/50 relative">
                                {/* The magic! Render the Autodata DOM purely isolated via data URI so css isn't bled */}
                                <iframe
                                    srcDoc={htmlContent}
                                    className="w-full h-full border-0 absolute inset-0 bg-white"
                                    sandbox="allow-same-origin allow-scripts"
                                />
                            </Card>
                        )}

                        {!isLoading && !vehicleSpecs && !htmlContent && !parsedServiceData && !parsedRepairData && !error && (
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
