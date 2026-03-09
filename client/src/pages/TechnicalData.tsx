import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Wrench, Droplets, AlertTriangle, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export default function TechnicalData() {
    const [vrm, setVrm] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vehicleData, setVehicleData] = useState<any>(null);


    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!vrm.trim()) return;

        setIsLoading(true);
        setError(null);
        setVehicleData(null);

        try {
            // Step 1: Query DVLA/UKVD to get vehicle details (Make/Model/Year) so we can map to Autodata MID
            // For now we will mock this with the Toyota Aygo we know works for testing
            // In production we would map VRM -> Autodata MID
            const testMid = "TOY43021"; // Toyota Aygo

            // Step 2: Request drone fetch via our backend
            const res = await fetch(`/api/autodata/engine-oils?vrm=${encodeURIComponent(vrm)}&mid=${testMid}`);
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || "Failed to fetch technical data");
            }

            setVehicleData(data.data);

            toast.success("Successfully fetched technical data from Autodata via Drone");

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
                        Technical Data (Autodata Proxy)
                    </h1>
                    <p className="text-muted-foreground">
                        Fetch live repair times, engine oil capacities, and service schedules natively via the Browser Drone Proxy without triggering WAF blocks.
                    </p>
                </div>

                <Card className="shadow-lg border-primary/10">
                    <CardHeader className="bg-primary/5 border-b border-primary/10 pb-4">
                        <CardTitle>Vehicle Search</CardTitle>
                        <CardDescription>Enter a registration number to pull manufacturer technical specifications</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <form onSubmit={handleSearch} className="flex gap-4 max-w-xl">
                            <div className="relative flex-1">
                                <Input
                                    type="text"
                                    placeholder="Enter Registration (e.g. RE71VOD)"
                                    className="pl-10 uppercase text-lg h-12"
                                    value={vrm}
                                    onChange={(e) => setVrm(e.target.value)}
                                />
                                <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
                            </div>
                            <Button type="submit" size="lg" className="h-12 px-8" disabled={isLoading || !vrm}>
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Fetching from Drone...
                                    </>
                                ) : (
                                    "Lookup specs"
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {error && (
                    <div className="bg-destructive/10 text-destructive p-4 rounded-lg flex items-center gap-3 border border-destructive/20 mt-4">
                        <AlertTriangle className="h-5 w-5" />
                        <p>{error}</p>
                    </div>
                )}

                {isLoading && (
                    <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                        <p className="text-lg font-medium">Drone is bypassing WAF and fetching data...</p>
                        <p className="text-sm">This can take up to 6 seconds depending on polling interval.</p>
                    </div>
                )}

                {vehicleData && !isLoading && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        {/* Engine Oil Card */}
                        <Card className="border-t-4 border-t-amber-500 shadow-md">
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    <Droplets className="h-5 w-5 text-amber-500" />
                                    Engine Oil Specs
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-baseline gap-2 mb-6">
                                    <span className="text-4xl font-bold">{vehicleData.engine_capacity?.value || "N/A"}</span>
                                    <span className="text-muted-foreground font-medium uppercase">{vehicleData.engine_capacity?.unit || "L"}</span>
                                    <Badge variant="outline" className="ml-2">With Filter</Badge>
                                </div>

                                <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Approved Grades</h4>
                                <div className="space-y-3">
                                    {vehicleData.engine_oils?.map((oil: any, idx: number) => (
                                        <div key={idx} className="bg-secondary/50 p-4 rounded-lg border">
                                            <div className="flex flex-wrap gap-2 mb-2">
                                                {oil.grades?.map((grade: any, gIdx: number) => (
                                                    <Badge key={gIdx} className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-amber-500/20">
                                                        {grade.value}
                                                    </Badge>
                                                ))}
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                {oil.classifications?.map((cls: any, cIdx: number) => (
                                                    <span key={cIdx} className="flex items-center gap-1">
                                                        <span className="font-medium text-foreground">{cls.qualifier}:</span> {cls.value}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Placeholder for future Repair Times / Services */}
                        <Card className="border-t-4 border-t-blue-500 shadow-md opacity-75">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    <Wrench className="h-5 w-5 text-blue-500" />
                                    Service Schedules / Repair Times
                                </CardTitle>
                                <CardDescription>Coming soon to the Drone Proxy</CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col items-center justify-center p-8 text-center bg-secondary/20 rounded-lg mx-6 mb-6">
                                <Wrench className="h-10 w-10 text-muted-foreground mb-3 opacity-50" />
                                <p className="text-muted-foreground">This section will dynamically render the Autodata Service Schedules once the backend endpoint is wired.</p>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
