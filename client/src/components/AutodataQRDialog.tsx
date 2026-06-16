import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { BookOpen, Copy, ExternalLink, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const AUTODATA_BASE = "https://workshop.autodata-group.com";
const vehicleUrl = (mid: string) => `${AUTODATA_BASE}/w1/vehicles/${mid}`;

// Pull the Autodata model id ("mid", e.g. "MER44336") out of the drone's
// resolve-vrm result, which may arrive as a parsed array or a JSON string.
function extractMid(raw: any): string | null {
    let data = raw;
    if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return null; }
    }
    const first = Array.isArray(data) ? data[0] : data;
    const mid = first?.mid ?? first?.modelId ?? first?.id;
    return mid ? String(mid) : null;
}

/**
 * "Autodata QR" — shows a QR code a technician can scan with their phone to open
 * this exact vehicle's page on workshop.autodata-group.com. The Autodata vehicle
 * id ("mid") is resolved once via the existing Drone proxy and cached on the
 * vehicle so subsequent opens are instant.
 */
export function AutodataQRDialog({
    vehicleId,
    registration,
    cachedMid,
}: {
    vehicleId: number;
    registration: string;
    cachedMid?: string | null;
}) {
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState<string | null>(cachedMid ? vehicleUrl(cachedMid) : null);
    const [status, setStatus] = useState<"idle" | "resolving" | "ready" | "error">(
        cachedMid ? "ready" : "idle"
    );
    const [errorMsg, setErrorMsg] = useState<string>("");
    const cacheMid = trpc.vehicles.setAutodataMid.useMutation();

    const pollJob = async (jobId: number, maxAttempts = 30): Promise<any> => {
        for (let i = 0; i < maxAttempts; i++) {
            const res = await fetch(`/api/autodata/job/${jobId}`);
            const data = await res.json();
            if (data.status === "completed") return data.data;
            if (data.status === "failed") throw new Error(data.error || "Autodata lookup failed");
            await new Promise((r) => setTimeout(r, 1500));
        }
        throw new Error("Timed out waiting for the Autodata drone — is the browser extension connected?");
    };

    const resolve = async () => {
        setStatus("resolving");
        setErrorMsg("");
        try {
            const resolveRes = await fetch(`/api/autodata/resolve-vrm?vrm=${encodeURIComponent(registration)}`);
            const resolveData = await resolveRes.json();
            if (!resolveData.success || !resolveData.jobId) {
                throw new Error("Unable to locate this registration in the Autodata database.");
            }
            const result = await pollJob(resolveData.jobId);
            const mid = extractMid(result);
            if (!mid) throw new Error("Autodata returned no vehicle match for this registration.");
            setUrl(vehicleUrl(mid));
            setStatus("ready");
            cacheMid.mutate({ vehicleId, mid }); // persist for next time; non-blocking
        } catch (err: any) {
            setErrorMsg(err.message || "Could not resolve the Autodata vehicle.");
            setStatus("error");
        }
    };

    // Resolve lazily the first time the dialog is opened without a cached id.
    const onOpenChange = (o: boolean) => {
        setOpen(o);
        if (o && status === "idle" && !url) resolve();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button variant="outline" className="w-full bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100">
                    <BookOpen className="w-4 h-4 mr-2" />
                    Autodata QR
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md text-center flex flex-col items-center">
                <DialogHeader>
                    <DialogTitle className="text-center">Open Autodata on Mobile</DialogTitle>
                    <DialogDescription className="text-center">
                        Scan with a phone camera to open this vehicle directly in Autodata. The phone must be signed in to Autodata.
                    </DialogDescription>
                </DialogHeader>

                {status === "resolving" && (
                    <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
                        <p className="text-sm">Looking up <span className="font-mono font-semibold">{registration}</span> in Autodata…</p>
                    </div>
                )}

                {status === "error" && (
                    <div className="flex flex-col items-center gap-3 py-6">
                        <AlertTriangle className="w-8 h-8 text-amber-500" />
                        <p className="text-sm text-muted-foreground px-4">{errorMsg}</p>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={resolve}>Try again</Button>
                            <Button variant="outline" size="sm" onClick={() => window.open(AUTODATA_BASE, "_blank")}>
                                <ExternalLink className="w-4 h-4 mr-2" /> Open Autodata
                            </Button>
                        </div>
                    </div>
                )}

                {status === "ready" && url && (
                    <>
                        <div className="p-6 bg-white rounded-xl shadow-inner border border-slate-100 flex items-center justify-center">
                            <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`}
                                alt="Autodata QR Code"
                                className="w-48 h-48 pointer-events-none"
                            />
                        </div>
                        <p className="text-[11px] text-muted-foreground break-all px-4">{url}</p>
                        <div className="flex w-full gap-2 mt-2">
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => { navigator.clipboard.writeText(url); toast.success("Autodata link copied"); }}
                            >
                                <Copy className="w-4 h-4 mr-2" /> Copy Link
                            </Button>
                            <Button
                                className="flex-1 bg-violet-600 hover:bg-violet-700"
                                onClick={() => window.open(url, "_blank")}
                            >
                                <ExternalLink className="w-4 h-4 mr-2" /> Open Here
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
