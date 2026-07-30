import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Sparkles, Gauge, Usb, Copy, Image as ImageIcon, Wrench, Printer, MapPin } from "lucide-react";
import { findPartOn7zap } from "@/lib/sevenZap";

// Per-vehicle quick-reference: how to reset the service light + where the OBD port is.
// Generated once per vehicle (cached on vehicles.serviceResetInfo) and reused on every job.
export function ServiceResetCard({ vehicleId, info, onSaved, vehicleDesc, vin, make, registration }: {
    vehicleId: number;
    info: any; // vehicles.serviceResetInfo
    onSaved: () => void;
    vehicleDesc?: string; // "2023 PORSCHE Cayenne" — used for the OBD photo lookup
    vin?: string | null; // enables the 7zap-drawings lookup (VIN-filtered catalogue)
    make?: string | null;
    registration?: string | null; // pasted into the Trakm8 OBD locator (its URL takes no params)
}) {
    const gen = trpc.ai.generateServiceReset.useMutation();
    const [local, setLocal] = useState<any>(null);
    const [locatorOpen, setLocatorOpen] = useState(false);
    const card = local || info;

    async function generate() {
        try {
            const res = await gen.mutateAsync({ vehicleId });
            setLocal(res);
            onSaved();
            toast.success("Service reset card generated");
        } catch (e: any) { toast.error(e.message || "Failed to generate"); }
    }

    function cardText() {
        if (!card) return "";
        return [
            `OBD port: ${card.obdLocation}`,
            "",
            "Service light reset:",
            ...(card.resetSteps || []).map((s: string, i: number) => `${i + 1}. ${s}`),
            ...((card.alternatives || []).length ? ["", "Variants:", ...card.alternatives.map((s: string) => `- ${s}`)] : []),
            ...((card.cautions || []).length ? ["", "Cautions:", ...card.cautions.map((s: string) => `- ${s}`)] : []),
        ].join("\n");
    }

    function copyCard() {
        if (!card) return;
        navigator.clipboard.writeText(cardText())
            .then(() => toast.success("Card copied to clipboard"))
            .catch(() => toast.error("Couldn't copy — select the text manually"));
    }

    // Standalone printout — this sheet goes WITH the job card, not inside the description.
    function printCard() {
        if (!card) return;
        const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const w = window.open("", "_blank", "width=760,height=900");
        if (!w) return;
        w.document.write(`<!doctype html><html><head><title>Service Reset & OBD</title><style>
          body{font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:13px;color:#111;margin:28px;line-height:1.5}
          h1{font-size:17px;margin:0 0 2px} .sub{color:#555;margin-bottom:14px;font-size:12px}
          h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #ccc;padding-bottom:2px;margin:16px 0 6px}
          ol,ul{margin:4px 0;padding-left:22px} li{margin:2px 0}
          .caution{color:#92400e}
        </style></head><body>
          <h1>Service Reset &amp; OBD${registration ? ` — ${esc(registration)}` : ""}</h1>
          <div class="sub">${esc(vehicleDesc || "")}${card.generatedAt ? ` · generated ${new Date(card.generatedAt).toLocaleDateString("en-GB")}` : ""}</div>
          <h2>OBD port location</h2><p>${esc(card.obdLocation || "")}</p>
          <h2>Service light reset</h2><ol>${(card.resetSteps || []).map((s: string) => `<li>${esc(s)}</li>`).join("")}</ol>
          ${(card.alternatives || []).length ? `<h2>Variants</h2><ul>${card.alternatives.map((s: string) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
          ${(card.cautions || []).length ? `<h2>Cautions</h2><ul class="caution">${card.cautions.map((s: string) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        </body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 250);
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

    function toggleLocator() {
        setLocatorOpen((o) => !o);
    }

    return (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/40">
            <div className="flex items-center gap-2 p-2 flex-wrap">
                <Gauge className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="text-[13px] font-semibold text-emerald-900">Service Reset &amp; OBD</span>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                    {card && (
                        <>
                            <button type="button" onClick={copyCard} title="Copy the whole card as text"
                                className="inline-flex items-center gap-1 text-[12px] text-emerald-800 hover:underline">
                                <Copy className="w-3.5 h-3.5" /> Copy
                            </button>
                            <button type="button" onClick={printCard} title="Print this card as its own sheet to go with the job card"
                                className="inline-flex items-center gap-1 text-[12px] text-emerald-800 hover:underline">
                                <Printer className="w-3.5 h-3.5" /> Print
                            </button>
                            <button type="button" onClick={openObdPhotos} title="Real photos of this car's OBD port (Google Images)"
                                className="inline-flex items-center gap-1 text-[12px] text-emerald-800 hover:underline">
                                <ImageIcon className="w-3.5 h-3.5" /> OBD photos
                            </button>
                            {vin && (
                                <button type="button" onClick={() => findPartOn7zap("OBD diagnostic socket", vin, make)}
                                    title="This car's own drawings on 7zap — the diagnostic socket sits in the Electrical section's dash-wiring diagrams"
                                    className="inline-flex items-center gap-1 text-[12px] text-emerald-800 hover:underline">
                                    <Wrench className="w-3.5 h-3.5" /> 7zap drawings
                                </button>
                            )}
                        </>
                    )}
                    <button type="button" onClick={toggleLocator} title="Trakm8's OBD locator with location photos — type the reg in"
                        className="inline-flex items-center gap-1 text-[12px] text-emerald-800 hover:underline">
                        <MapPin className="w-3.5 h-3.5" /> OBD locator
                    </button>
                    <button type="button" onClick={generate} disabled={gen.isPending}
                        className="inline-flex items-center gap-1.5 bg-emerald-700 text-white rounded px-2.5 py-1 text-[12px] disabled:opacity-50 hover:bg-emerald-800">
                        {gen.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        {card ? "Regenerate" : "Generate"}
                    </button>
                </div>
            </div>
            {locatorOpen && (
                <div className="mx-2 mb-2">
                    <iframe src="https://obdchecker.trakm8.net/" title="OBD port locator (Trakm8)"
                        className="w-full rounded border bg-white" style={{ height: 360 }} />
                    <p className="text-[11px] text-muted-foreground mt-1">Trakm8's free OBD locator — pick {make ? `${make} and the model` : "the make and model"} above and it highlights the port on an interior diagram. Screenshot the result into Job Images to keep it.</p>
                </div>
            )}
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
