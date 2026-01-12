import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, RefreshCcw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";
import { toast } from "sonner";

export default function SystemStatus() {
    const { data: statusResults, isLoading, refetch, isFetching } = trpc.diagnostics.checkCredentials.useQuery(undefined, {
        refetchOnWindowFocus: false,
        retry: false,
    });

    const handleRefresh = async () => {
        try {
            await refetch();
            toast.success("System status updated");
        } catch (error) {
            toast.error("Failed to update system status");
        }
    };

    return (
        <DashboardLayout>
            <div className="space-y-8">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">System Status</h1>
                        <p className="text-muted-foreground mt-2">
                            Diagnostics and connectivity status for external services
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleRefresh}
                        disabled={isLoading || isFetching}
                    >
                        <RefreshCcw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                        Refresh Status
                    </Button>
                </div>

                {/* 1. Status Grid */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {isLoading ? (
                        Array(3).fill(0).map((_, i) => (
                            <Card key={i} className="animate-pulse">
                                <CardHeader className="h-24 bg-slate-100" />
                                <CardContent className="h-32" />
                            </Card>
                        ))
                    ) : (
                        statusResults?.map((result: any, index: number) => (
                            <Card key={index} className={result.status === "Error" ? "border-red-200" : ""}>
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-xl">{result.service}</CardTitle>
                                        <Badge
                                            variant={result.status === "Healthy" ? "outline" : "destructive"}
                                            className={result.status === "Healthy" ? "bg-green-50 text-green-700 border-green-200" : ""}
                                        >
                                            {result.status === "Healthy" ? (
                                                <CheckCircle className="mr-1 h-3 w-3" />
                                            ) : (
                                                <AlertCircle className="mr-1 h-3 w-3" />
                                            )}
                                            {result.status}
                                        </Badge>
                                    </div>
                                    <CardDescription>
                                        {result.status === "Healthy" ? "Connected" : "Action Required"}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="text-sm">
                                            <p className="font-medium text-slate-900">{result.message}</p>
                                            {result.details && (
                                                <p className="text-slate-500 mt-1 font-mono text-xs">{result.details}</p>
                                            )}
                                        </div>

                                        {result.status === "Error" && (
                                            <div className="bg-red-50 p-3 rounded-md border border-red-100">
                                                <div className="flex items-start gap-2">
                                                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                                                    <div className="text-xs text-red-800">
                                                        <p className="font-semibold">Diagnostic details:</p>
                                                        <p className="mt-1">Code: {result.code || "UNKNOWN_ERROR"}</p>
                                                        {result.moreInfo && (
                                                            <a
                                                                href={result.moreInfo}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="underline mt-1 block"
                                                            >
                                                                View troubleshooting guide
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>

                {/* 2. About Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>About System Diagnostics</CardTitle>
                        <CardDescription>
                            This tool checks that the environment variables and API credentials in your .env file
                            are correctly configured and accepted by external service providers.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="border rounded-lg p-4">
                                <h4 className="font-semibold flex items-center gap-2">
                                    <Wifi className="h-4 w-4 text-blue-500" />
                                    Twilio WhatsApp
                                </h4>
                                <p className="text-sm text-slate-600 mt-2">
                                    Used for sending MOT and Service reminders via WhatsApp. Requires a valid Account SID,
                                    Auth Token, and a WhatsApp-enabled From number.
                                </p>
                            </div>
                            <div className="border rounded-lg p-4">
                                <h4 className="font-semibold flex items-center gap-2">
                                    <Wifi className="h-4 w-4 text-orange-500" />
                                    DVLA Vehicle API
                                </h4>
                                <p className="text-sm text-slate-600 mt-2">
                                    Used for looking up vehicle details (make, model) and MOT expiry dates.
                                    Requires a valid DVLA API Key.
                                </p>
                            </div>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                            <h4 className="font-semibold text-sm">How to fix errors:</h4>
                            <ul className="list-disc list-inside text-sm text-slate-600 mt-2 space-y-1">
                                <li>Check your <code className="bg-slate-200 px-1 rounded">.env</code> file for typos or missing values.</li>
                                <li>Ensure there are no extra spaces or quotes around the credential values.</li>
                                <li>Verify your Twilio account is active and has sufficient balance.</li>
                                <li>Restart the server after making any changes to your environment variables.</li>
                            </ul>
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Debug Vehicle Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Debug Vehicle Data</CardTitle>
                        <CardDescription>
                            Enter a registration number to see the raw data coming from the government API.
                            Use this to verify if the date we see matches the official record.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-4">
                            <div className="grid w-full max-w-sm items-center gap-1.5">
                                <DebugVehicleForm />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}

function DebugVehicleForm() {
    const [reg, setReg] = useState("");
    const [result, setResult] = useState<any>(null);
    const debugMutation = trpc.diagnostics.debugVehicle.useMutation();

    const handleDebug = async () => {
        if (!reg) return;
        const res = await debugMutation.mutateAsync({ registration: reg });
        setResult(res);
    };

    return (
        <div className="space-y-4 w-full">
            <div className="flex gap-2">
                <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Enter Registration (e.g. BN66HUZ)"
                    value={reg}
                    onChange={(e) => setReg(e.target.value.toUpperCase())}
                />
                <Button onClick={handleDebug} disabled={debugMutation.isPending}>
                    {debugMutation.isPending ? "Checking..." : "Inspect"}
                </Button>
            </div>

            {result && (
                <div className="mt-4 p-4 bg-slate-100 rounded-md overflow-auto max-h-[500px]">
                    <h4 className="font-semibold mb-2">
                        {result.success ? "✅ API Response Found" : "❌ Error / Not Found"}
                    </h4>
                    {result.error && <p className="text-red-600">{result.error}</p>}
                    {result.message && <p className="text-amber-600">{result.message}</p>}

                    {result.success && result.data && (
                        <div className="space-y-4">
                            <div>
                                <span className="font-bold">Make/Model:</span> {result.data.make} {result.data.model}
                            </div>
                            <div>
                                <h5 className="font-semibold mt-2">MOT History (Raw):</h5>
                                <pre className="text-xs font-mono whitespace-pre-wrap mt-1">
                                    {JSON.stringify(result.data.motTests, null, 2)}
                                </pre>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
