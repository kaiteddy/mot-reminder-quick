import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Wrench, Droplets, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AutodataMini({ vrm }: { vrm: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleData, setVehicleData] = useState<any>(null);

  const pollJob = async (jobId: number): Promise<any> => {
    let attempts = 0;
    while (attempts < 20) {
      const res = await fetch(`/api/autodata/job/${jobId}`);
      const data = await res.json();

      if (data.status === "completed") {
        return data.data; // Return the actual successful JSON payload
      } else if (data.status === "failed") {
        throw new Error(data.error || "Drone failed fetching data");
      }

      // Still pending
      attempts++;
      await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error("Drone proxy timed out waiting for browser extension");
  };

  const fetchAutodata = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Request VRM -> MID Job
      const resolveRes = await fetch(`/api/autodata/resolve-vrm?vrm=${encodeURIComponent(vrm)}`);
      const resolveData = await resolveRes.json();

      if (!resolveData.success || !resolveData.jobId) {
        throw new Error(resolveData.error || "Failed to create VRM resolution job");
      }

      // Step 1a: Poll for resolve result
      const vrmResult = await pollJob(resolveData.jobId);

      if (!vrmResult?.[0]?.mid) {
        throw new Error("No vehicle found in Autodata for this VRM");
      }

      const mid = vrmResult[0].mid;

      // Step 2: Request Engine Oils Job
      const oilRes = await fetch(`/api/autodata/engine-oils?vrm=${encodeURIComponent(vrm)}&mid=${mid}`);
      const oilData = await oilRes.json();

      if (!oilData.success || !oilData.jobId) {
        throw new Error(oilData.error || "Failed to create engine oils job");
      }

      // Step 2a: Poll for oil result
      const oilResult = await pollJob(oilData.jobId);

      setVehicleData(oilResult);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!vrm) return null;

  return (
    <Card className="border-2 mt-6">
      <CardHeader className="bg-primary/5 pb-4 border-b">
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              Autodata Technical Data
            </CardTitle>
            <CardDescription>Live data directly from Autodata</CardDescription>
          </div>
          {!vehicleData && !isLoading && !error && (
            <Button onClick={fetchAutodata} size="sm">
              Fetch Specs
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {isLoading && (
          <div className="flex items-center gap-3 text-muted-foreground p-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>Drone Proxy fetching Autodata...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive bg-destructive/10 p-4 rounded-lg">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        {vehicleData && !isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Droplets className="h-5 w-5 text-amber-500" />
                <h3 className="font-semibold text-lg">Engine Oil Specs</h3>
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold">{vehicleData.engine_capacity?.value || "N/A"}</span>
                <span className="text-muted-foreground font-medium uppercase">{vehicleData.engine_capacity?.unit || "L"}</span>
                <Badge variant="outline" className="ml-2">With Filter</Badge>
              </div>

              <div className="space-y-3">
                {vehicleData.engine_oils?.slice(0, 1).map((oil: any, idx: number) => (
                  <div key={idx} className="bg-secondary/50 p-4 rounded-lg border">
                    <div className="flex flex-wrap gap-2 mb-2">
                      {oil.grades?.map((grade: any, gIdx: number) => (
                        <Badge key={gIdx} className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-amber-500/20">
                          {grade.value}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
                      {oil.classifications?.map((cls: any, cIdx: number) => (
                        <span key={cIdx} className="flex items-center gap-1">
                          {cls.value}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center justify-center p-6 border rounded-xl bg-primary/5">
              <Wrench className="h-8 w-8 text-primary mb-2" />
              <p className="font-bold text-center mb-1">Deep Technical Specs</p>
              <p className="text-xs text-muted-foreground text-center mb-4 leading-tight">
                Live interactive Service Schedules, Repair Times, and Component Layouts are now available in the dedicated Technical Workspace.
              </p>
              <Button onClick={() => window.location.href = `/technical-data?vrm=${encodeURIComponent(vrm)}`} className="w-full">
                Open Technical Workspace
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
