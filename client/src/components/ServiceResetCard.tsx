import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Sparkles, Gauge, Usb } from "lucide-react";

// Per-vehicle quick-reference: how to reset the service light + where the OBD port is.
// Generated once per vehicle (cached on vehicles.serviceResetInfo) and reused on every job.
export function ServiceResetCard({ vehicleId, info, onSaved }: {
    vehicleId: number;
    info: any; // vehicles.serviceResetInfo
    onSaved: () => void;
}) {
    const gen = trpc.ai.generateServiceReset.useMutation();
    const [local, setLocal] = useState<any>(null);
    const card = local || info;

    async function generate() {
        try {
            const res = await gen.mutateAsync({ vehicleId });
            setLocal(res);
            onSaved();
            toast.success("Service reset card generated");
        } catch (e: any) { toast.error(e.message || "Failed to generate"); }
    }

    return (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/40">
            <div className="flex items-center gap-2 p-2">
                <Gauge className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="text-[13px] font-semibold text-emerald-900">Service Reset &amp; OBD</span>
                <button type="button" onClick={generate} disabled={gen.isPending}
                    className="ml-auto inline-flex items-center gap-1.5 bg-emerald-700 text-white rounded px-2.5 py-1 text-[12px] disabled:opacity-50 hover:bg-emerald-800">
                    {gen.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {card ? "Regenerate" : "Generate"}
                </button>
            </div>
            {card ? (
                <div className="px-3 pb-3 text-[13px] leading-relaxed text-slate-800 space-y-2">
                    <div className="flex gap-2">
                        <Usb className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <p><span className="font-semibold">OBD port:</span> {card.obdLocation}</p>
                    </div>
                    <div>
                        <p className="font-semibold text-[12px] uppercase tracking-wide text-emerald-900 mb-1">Service light reset</p>
                        <ol className="list-decimal pl-5 space-y-0.5">{(card.resetSteps || []).map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
                    </div>
                    {(card.alternatives || []).length > 0 && (
                        <div>
                            <p className="font-semibold text-[12px] uppercase tracking-wide text-emerald-900 mb-1">Variants</p>
                            <ul className="list-disc pl-5 space-y-0.5">{card.alternatives.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                        </div>
                    )}
                    {(card.cautions || []).length > 0 && (
                        <ul className="list-disc pl-5 space-y-0.5 text-amber-900">{card.cautions.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                    )}
                    <p className="text-[11px] text-muted-foreground">AI-generated guidance — procedures vary by year/cluster; confirm on the car.</p>
                </div>
            ) : (
                <p className="px-3 pb-3 text-[12px] text-muted-foreground">Not generated yet — one click creates this car's reset procedure and OBD port location.</p>
            )}
        </div>
    );
}
