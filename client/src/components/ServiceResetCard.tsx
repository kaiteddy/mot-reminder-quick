import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Sparkles, Gauge, Usb, Copy, Image as ImageIcon } from "lucide-react";

// Per-vehicle quick-reference: how to reset the service light + where the OBD port is.
// Generated once per vehicle (cached on vehicles.serviceResetInfo) and reused on every job.
export function ServiceResetCard({ vehicleId, info, onSaved, vehicleDesc }: {
    vehicleId: number;
    info: any; // vehicles.serviceResetInfo
    onSaved: () => void;
    vehicleDesc?: string; // "2023 PORSCHE Cayenne" — used for the OBD photo lookup
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

    function copyCard() {
        if (!card) return;
        const text = [
            `OBD port: ${card.obdLocation}`,
            "",
            "Service light reset:",
            ...(card.resetSteps || []).map((s: string, i: number) => `${i + 1}. ${s}`),
            ...((card.alternatives || []).length ? ["", "Variants:", ...card.alternatives.map((s: string) => `- ${s}`)] : []),
            ...((card.cautions || []).length ? ["", "Cautions:", ...card.cautions.map((s: string) => `- ${s}`)] : []),
        ].join("\n");
        navigator.clipboard.writeText(text)
            .then(() => toast.success("Card copied to clipboard"))
            .catch(() => toast.error("Couldn't copy — select the text manually"));
    }

    function openObdPhotos() {
        // We can't fabricate a photo of a specific car's footwell, but Google Images searched
        // for this exact car's OBD port shows real ones instantly. Opens in the shared popup.
        const q = `${vehicleDesc || ""} OBD port location`.trim();
        const w = Math.min(1100, window.screen.availWidth - 80);
        const h = Math.min(800, window.screen.availHeight - 80);
        window.open(`https://www.google.com/search?udm=2&q=${encodeURIComponent(q)}`, "obdPhotoPopup",
            `popup=yes,width=${w},height=${h},left=${Math.max(0, (window.screen.availWidth - w) / 2)},top=${Math.max(0, (window.screen.availHeight - h) / 2)}`)?.focus();
    }

    return (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/40">
            <div className="flex items-center gap-2 p-2">
                <Gauge className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="text-[13px] font-semibold text-emerald-900">Service Reset &amp; OBD</span>
                <div className="ml-auto flex items-center gap-2">
                    {card && (
                        <>
                            <button type="button" onClick={copyCard} title="Copy the whole card as text"
                                className="inline-flex items-center gap-1 text-[12px] text-emerald-800 hover:underline">
                                <Copy className="w-3.5 h-3.5" /> Copy
                            </button>
                            <button type="button" onClick={openObdPhotos} title="Real photos of this car's OBD port (Google Images)"
                                className="inline-flex items-center gap-1 text-[12px] text-emerald-800 hover:underline">
                                <ImageIcon className="w-3.5 h-3.5" /> OBD photos
                            </button>
                        </>
                    )}
                    <button type="button" onClick={generate} disabled={gen.isPending}
                        className="inline-flex items-center gap-1.5 bg-emerald-700 text-white rounded px-2.5 py-1 text-[12px] disabled:opacity-50 hover:bg-emerald-800">
                        {gen.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        {card ? "Regenerate" : "Generate"}
                    </button>
                </div>
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
