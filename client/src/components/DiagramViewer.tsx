/**
 * A workshop diagram popped out over the page — fuse box map, part location, drawing or torque
 * diagram — with whatever belongs with it underneath (the fuse list, the numbered parts, the
 * tightening stages) and a Print button that prints just that.
 *
 * Adam, 10/09/2026: "the images or diagrams open in a new window, rather it be a pop out and
 * then be able to print it".
 *
 * Printing: the app prints documents by loading a PDF into a hidden iframe on a desktop and handing
 * the PDF to the phone's own viewer on a handheld (lib/printDocument.ts), because no phone browser
 * prints an iframe. A single picture needs neither. While printing, a print-only copy is placed on
 * the page itself and everything else is hidden from the printer, then window.print() is called —
 * which prints the page in front of you on desktops, iPhones and Android alike.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";

export type DiagramItem = {
    src: string;
    title: string;
    /** What kind of picture it is, e.g. "Fuse layout" or the section it came from. */
    subtitle?: string | null;
    notes?: string[];
    table?: { head: string[]; rows: string[][] };
};

const PRINT_CLASS = "eli-diagram-printing";

const PRINT_CSS = `
@media screen { .eli-diagram-print { display: none !important; } }
@media print {
  html.${PRINT_CLASS} body > *:not(.eli-diagram-print) { display: none !important; }
  html.${PRINT_CLASS} .eli-diagram-print { display: block !important; }
  @page { margin: 12mm; }
}
.eli-diagram-print { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111; }
.eli-diagram-print h1 { font-size: 18px; margin: 0 0 2px; }
.eli-diagram-print .sub { font-size: 12px; color: #444; margin: 0 0 10px; }
.eli-diagram-print img { display: block; max-width: 100%; max-height: 165mm; margin: 0 auto 10px; }
.eli-diagram-print .note { font-size: 11px; color: #444; margin: 0 0 4px; }
.eli-diagram-print table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
.eli-diagram-print th { text-align: left; font-weight: 600; border-bottom: 1.5px solid #333; padding: 3px 6px; }
.eli-diagram-print td { border-bottom: 1px solid #ddd; padding: 3px 6px; vertical-align: top; }
.eli-diagram-print .foot { margin-top: 10px; font-size: 9px; color: #777; }
`;

function printedOn() {
    return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function DiagramViewer({ item, vehicleLabel, onClose }: { item: DiagramItem | null; vehicleLabel?: string | null; onClose: () => void }) {
    const [printing, setPrinting] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => { setLoaded(false); }, [item?.src]);

    // Once the print-only copy is on the page and its picture has loaded, print, then tidy up
    // after the printer dialog closes (afterprint), with a fallback in case a browser never says.
    useEffect(() => {
        if (!printing || !item) return;
        let done = false;
        const cleanup = () => {
            if (done) return;
            done = true;
            document.documentElement.classList.remove(PRINT_CLASS);
            window.removeEventListener("afterprint", cleanup);
            setPrinting(false);
        };
        const go = () => {
            document.documentElement.classList.add(PRINT_CLASS);
            window.addEventListener("afterprint", cleanup);
            window.setTimeout(() => {
                window.print();
                window.setTimeout(cleanup, 120_000);
            }, 50);
        };
        const img = document.querySelector<HTMLImageElement>(".eli-diagram-print img");
        if (!img || img.complete) go();
        else { img.onload = go; img.onerror = go; }
        return () => { if (!done) { document.documentElement.classList.remove(PRINT_CLASS); window.removeEventListener("afterprint", cleanup); } };
    }, [printing, item]);

    const subtitle = [vehicleLabel, item?.subtitle].filter(Boolean).join(" · ");

    return (
        <>
            <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
                <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[92vh] overflow-y-auto">
                    {item && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="pr-6">{item.title}</DialogTitle>
                                {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
                            </DialogHeader>
                            <div className="relative flex min-h-40 items-center justify-center rounded-md border bg-white p-2">
                                {!loaded && <Loader2 className="absolute h-6 w-6 animate-spin text-muted-foreground" />}
                                <img src={item.src} alt={item.title} referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)}
                                    className="max-h-[62vh] w-full object-contain" />
                            </div>
                            {item.notes?.map((n, i) => <p key={i} className="text-xs text-muted-foreground">{n}</p>)}
                            {item.table && item.table.rows.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead><tr className="text-left text-xs text-muted-foreground">{item.table.head.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
                                        <tbody>{item.table.rows.map((r, i) => <tr key={i} className="border-t border-border/60">{r.map((c, j) => <td key={j} className={`py-1 pr-3 ${j === 0 ? "font-medium tabular-nums" : ""}`}>{c}</td>)}</tr>)}</tbody>
                                    </table>
                                </div>
                            )}
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={onClose}>Close</Button>
                                <Button onClick={() => setPrinting(true)} disabled={printing}>
                                    {printing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}Print
                                </Button>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {printing && item && createPortal(
                <div className="eli-diagram-print">
                    <style>{PRINT_CSS}</style>
                    <h1>{item.title}</h1>
                    {subtitle && <p className="sub">{subtitle}</p>}
                    <img src={item.src} alt={item.title} referrerPolicy="no-referrer" />
                    {item.notes?.map((n, i) => <p key={i} className="note">{n}</p>)}
                    {item.table && item.table.rows.length > 0 && (
                        <table>
                            <thead><tr>{item.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                            <tbody>{item.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                        </table>
                    )}
                    <p className="foot">ELI Motors · technical data from HaynesPro via SWS · printed {printedOn()}</p>
                </div>,
                document.body,
            )}
        </>
    );
}
