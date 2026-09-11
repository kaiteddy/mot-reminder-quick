import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { normRegKey } from "@shared/vehicleIdentity";

/**
 * Plates per request. The whole visible list used to go in one request: nothing showed until every
 * car was done (57 cars, over a minute, all "Waiting"), and 2,524 cars would have run past the
 * server's time limit. A batch this size answers in a few seconds, so the list fills in as it goes.
 */
const BATCH_SIZE = 8;

interface MOTRefreshButtonLiveProps {
  registrations: string[];
  label?: string;
  onComplete?: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}

interface VehicleUpdate {
  key: string;
  registration: string;
  status: "pending" | "processing" | "success" | "failed";
  message?: string;
  motExpiryDate?: string;
}

export function MOTRefreshButtonLive({
  registrations,
  label = "Refresh MOT Data",
  onComplete,
  variant = "outline",
  size = "default",
  disabled = false,
}: MOTRefreshButtonLiveProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [vehicleUpdates, setVehicleUpdates] = useState<VehicleUpdate[]>([]);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const verifyMutation = trpc.reminders.bulkVerifyMOT.useMutation();

  const patchRows = (keys: Set<string>, patch: (u: VehicleUpdate) => VehicleUpdate) =>
    setVehicleUpdates((list) => list.map((u) => (keys.has(u.key) ? patch(u) : u)));

  const handleRefresh = async () => {
    // One row per plate, however the records space it.
    const seen = new Set<string>();
    const list: VehicleUpdate[] = [];
    for (const registration of registrations) {
      const key = normRegKey(registration);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ key, registration, status: "pending" });
    }
    if (list.length === 0) {
      toast.error("No vehicles to refresh");
      return;
    }

    setVehicleUpdates(list);
    setShowDialog(true);
    setRunning(true);
    setStopping(false);
    stopRequested.current = false;

    let refreshed = 0;
    let failed = 0;
    let checked = 0;
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      if (stopRequested.current) break;
      const batch = list.slice(i, i + BATCH_SIZE);
      const keys = new Set(batch.map((b) => b.key));
      patchRows(keys, (u) => ({ ...u, status: "processing" }));
      try {
        const results = await verifyMutation.mutateAsync({ registrations: batch.map((b) => b.registration) });
        const byKey = new Map(results.map((r) => [normRegKey(r.registration), r]));
        const outcome = new Map<string, Partial<VehicleUpdate>>();
        for (const b of batch) {
          const r = byKey.get(b.key);
          if (r?.success) {
            refreshed++;
            outcome.set(b.key, {
              status: "success",
              motExpiryDate: r.motExpiryDate,
              message: `${r.firstMot ? "First MOT due" : "MOT expires"} ${new Date(r.motExpiryDate || "").toLocaleDateString("en-GB")}${r.taxStatus ? ` · ${r.taxStatus}` : ""}`,
            });
          } else {
            failed++;
            outcome.set(b.key, { status: "failed", message: r?.error || "No answer for this plate" });
          }
        }
        patchRows(keys, (u) => ({ ...u, ...outcome.get(u.key) }));
      } catch (error: any) {
        failed += batch.length;
        patchRows(keys, (u) => ({ ...u, status: "failed", message: error?.message || "The request failed" }));
      }
      checked += batch.length;
    }

    setRunning(false);
    setStopping(false);
    const notChecked = list.length - checked;
    if (refreshed > 0) toast.success(`MOT data refreshed for ${refreshed} vehicle${refreshed !== 1 ? "s" : ""}`);
    if (failed > 0) toast.error(`Could not refresh ${failed} vehicle${failed !== 1 ? "s" : ""}`);
    if (notChecked > 0) toast.info(`Stopped: ${notChecked} vehicle${notChecked !== 1 ? "s" : ""} not checked`);
    onComplete?.();
  };

  // Keep the batch being checked in view as the list works down.
  useEffect(() => {
    if (!running) return;
    listRef.current?.querySelector('[data-status="processing"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [vehicleUpdates, running]);

  const total = vehicleUpdates.length;
  const refreshedCount = vehicleUpdates.filter((v) => v.status === "success").length;
  const failedCount = vehicleUpdates.filter((v) => v.status === "failed").length;
  const done = refreshedCount + failedCount;
  const notCheckedCount = total - done;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const count = registrations.length;

  return (
    <>
      <Button
        onClick={running ? () => setShowDialog(true) : handleRefresh}
        disabled={disabled || (!running && count === 0)}
        variant={variant}
        size={size}
      >
        <RefreshCw className={`h-4 w-4 mr-2 ${running ? "animate-spin" : ""}`} />
        {running ? `${label} (${done}/${total})` : `${label}${count > 0 ? ` (${count})` : ""}`}
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>MOT Data Refresh Progress</DialogTitle>
            <DialogDescription>
              {running
                ? `Checked ${done} of ${total}${stopping ? " · stopping after this batch" : ""}`
                : `Finished: ${refreshedCount} refreshed${failedCount ? `, ${failedCount} could not be` : ""}${notCheckedCount ? `, ${notCheckedCount} not checked` : ""}`}
            </DialogDescription>
          </DialogHeader>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>

          <ScrollArea className="h-[400px] pr-4">
            <div ref={listRef} className="space-y-2">
              {vehicleUpdates.map((vehicle) => (
                <div
                  key={vehicle.key}
                  data-status={vehicle.status}
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
                    vehicle.status === "success" ? "bg-green-50 border-green-200" :
                    vehicle.status === "failed" ? "bg-red-50 border-red-200" :
                    vehicle.status === "processing" ? "bg-blue-50 border-blue-200" :
                    "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="font-mono font-bold text-sm">{vehicle.registration}</div>
                    {vehicle.status === "success" && <CheckCircle className="w-4 h-4 text-green-600" />}
                    {vehicle.status === "failed" && <XCircle className="w-4 h-4 text-red-600" />}
                    {vehicle.status === "processing" && <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />}
                  </div>

                  <div className="text-sm text-slate-600 text-right">
                    {vehicle.status === "pending" && <Badge variant="secondary">{running ? "Waiting" : "Not checked"}</Badge>}
                    {vehicle.status === "processing" && <Badge variant="default" className="bg-blue-600">Checking…</Badge>}
                    {vehicle.status === "success" && <span className="text-green-700">{vehicle.message}</span>}
                    {vehicle.status === "failed" && <span className="text-red-700">{vehicle.message || "Failed"}</span>}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="flex justify-end gap-2 pt-4 border-t">
            {running ? (
              <Button
                variant="outline"
                disabled={stopping}
                onClick={() => { stopRequested.current = true; setStopping(true); }}
              >
                {stopping ? "Stopping…" : "Stop"}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setShowDialog(false)}>Close</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
