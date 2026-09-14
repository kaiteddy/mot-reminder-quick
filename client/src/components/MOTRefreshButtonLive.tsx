import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { normRegKey } from "@shared/vehicleIdentity";
import { daysSince, whenAgo } from "@shared/motFollowUp";

/**
 * Plates per request. The whole visible list used to go in one request: nothing showed until every
 * car was done (57 cars, over a minute, all "Waiting"), and 2,524 cars would have run past the
 * server's time limit. A batch this size answers in a few seconds, so the list fills in as it goes.
 */
const BATCH_SIZE = 8;

/** Days before an MOT runs out that it counts as due soon, as on the MOT Reminders list. */
const DUE_SOON_DAYS = 30;

interface MOTRefreshButtonLiveProps {
  registrations: string[];
  label?: string;
  onComplete?: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}

type MotState = "expired" | "due" | "valid";

interface VehicleUpdate {
  key: string;
  registration: string;
  status: "pending" | "processing" | "success" | "failed";
  message?: string;
  motExpiryDate?: string;
  /** Where the MOT stands today. A check that worked can still find the MOT has run out. */
  mot?: MotState;
}

/**
 * What a successful check found, in words, judged against today on the UK calendar. A check that
 * worked used to show every car green, "MOT expires 07/09/2026", even a week after that MOT had run
 * out (Adam, 14/09/2026: "they look confirmed but we are past that date").
 */
function describeMot(r: { motExpiryDate?: string; firstMot?: boolean; taxStatus?: string | null }): { mot: MotState; message: string } {
  const expiry = r.motExpiryDate || "";
  const daysLeft = -daysSince(expiry);
  const mot: MotState = daysLeft < 0 ? "expired" : daysLeft <= DUE_SOON_DAYS ? "due" : "valid";
  const date = new Date(expiry).toLocaleDateString("en-GB", { timeZone: "Europe/London" });
  const inDays = `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const what = r.firstMot
    ? mot === "expired" ? `First MOT overdue since ${date}` : mot === "due" ? `First MOT due ${date}, ${inDays}` : `First MOT due ${date}`
    : mot === "expired" ? `MOT expired ${date}, ${whenAgo(expiry)}`
      : daysLeft === 0 ? `MOT runs out today`
        : mot === "due" ? `MOT runs out ${date}, ${inDays}`
          : `MOT valid to ${date}`;
  return { mot, message: `${what}${r.taxStatus ? ` · ${r.taxStatus}` : ""}` };
}

const ROW_TONE: Record<MotState | VehicleUpdate["status"], string> = {
  expired: "bg-red-50 border-red-200",
  due: "bg-amber-50 border-amber-200",
  valid: "bg-green-50 border-green-200",
  success: "bg-green-50 border-green-200",
  failed: "bg-slate-50 border-slate-300",
  processing: "bg-blue-50 border-blue-200",
  pending: "bg-slate-50 border-slate-200",
};
const TEXT_TONE: Record<MotState, string> = { expired: "text-red-700", due: "text-amber-800", valid: "text-green-700" };

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

    const tally = { expired: 0, due: 0, valid: 0 };
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
          if (r?.success && r.motExpiryDate) {
            const { mot, message } = describeMot(r);
            tally[mot]++;
            outcome.set(b.key, { status: "success", motExpiryDate: r.motExpiryDate, mot, message });
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
    const found = tally.expired + tally.due + tally.valid;
    const notChecked = list.length - checked;
    if (found > 0) {
      toast.success(`Checked ${found} vehicle${found !== 1 ? "s" : ""}: ${tally.expired} expired, ${tally.due} due soon, ${tally.valid} valid`);
    }
    if (failed > 0) toast.error(`Couldn't check ${failed} vehicle${failed !== 1 ? "s" : ""}`);
    if (notChecked > 0) toast.info(`Stopped: ${notChecked} vehicle${notChecked !== 1 ? "s" : ""} not checked`);
    onComplete?.();
  };

  // Keep the batch being checked in view as the list works down.
  useEffect(() => {
    if (!running) return;
    listRef.current?.querySelector('[data-status="processing"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [vehicleUpdates, running]);

  const total = vehicleUpdates.length;
  const expiredCount = vehicleUpdates.filter((v) => v.mot === "expired").length;
  const dueCount = vehicleUpdates.filter((v) => v.mot === "due").length;
  const validCount = vehicleUpdates.filter((v) => v.mot === "valid").length;
  const failedCount = vehicleUpdates.filter((v) => v.status === "failed").length;
  const done = expiredCount + dueCount + validCount + failedCount;
  const notCheckedCount = total - done;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const count = registrations.length;
  const breakdown = [
    `${expiredCount} expired`,
    `${dueCount} due soon`,
    `${validCount} valid`,
    failedCount ? `${failedCount} couldn't be checked` : "",
  ].filter(Boolean).join(" · ");

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
            <DialogTitle>Refreshing MOT and tax</DialogTitle>
            <DialogDescription>
              {running
                ? `Checked ${done} of ${total}${done ? ` · ${breakdown}` : ""}${stopping ? " · stopping after this batch" : ""}`
                : `Finished: ${breakdown}${notCheckedCount ? ` · ${notCheckedCount} not checked` : ""}`}
            </DialogDescription>
          </DialogHeader>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>

          <ScrollArea className="h-[400px] pr-4">
            <div ref={listRef} className="space-y-1">
              {vehicleUpdates.map((vehicle) => (
                <div
                  key={vehicle.key}
                  data-status={vehicle.status}
                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 ${ROW_TONE[vehicle.mot ?? vehicle.status]}`}
                >
                  <div className="flex flex-1 items-center gap-2">
                    <div className="font-mono text-sm font-semibold">{vehicle.registration}</div>
                    {vehicle.mot === "valid" && <CheckCircle className="h-4 w-4 text-green-600" />}
                    {vehicle.mot === "due" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                    {vehicle.mot === "expired" && <AlertTriangle className="h-4 w-4 text-red-600" />}
                    {vehicle.status === "failed" && <XCircle className="h-4 w-4 text-slate-500" />}
                    {vehicle.status === "processing" && <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />}
                  </div>

                  <div className="text-right text-[13px] text-slate-600">
                    {vehicle.status === "pending" && <Badge variant="secondary">{running ? "Waiting" : "Not checked"}</Badge>}
                    {vehicle.status === "processing" && <Badge variant="default" className="bg-blue-600">Checking…</Badge>}
                    {vehicle.status === "success" && vehicle.mot && <span className={TEXT_TONE[vehicle.mot]}>{vehicle.message}</span>}
                    {vehicle.status === "failed" && <span className="text-slate-600">Couldn't check: {vehicle.message || "no answer"}</span>}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="flex justify-end gap-2 border-t pt-4">
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
