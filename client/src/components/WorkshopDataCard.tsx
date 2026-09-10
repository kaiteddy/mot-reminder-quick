/**
 * The workshop data kept on a car: torque settings, brake limits, wheel alignment, electrical,
 * cooling, capacities, fuse boxes, the diagnostic port, part locations and drawings.
 * Bought once from the technical data service (GA4 credits) and stored — see shared/workshopData.ts.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Loader2, MapPin, RefreshCw, Search, Wrench, Zap } from "lucide-react";
import { entryCount, matchingRows, type WorkshopData, type WorkshopGroup, type FuseBox } from "../../../shared/workshopData";

type Props = { workshop?: WorkshopData | null; loading?: boolean; onFetch?: () => void };

const ukDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

function Picture({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
    return (
        <a href={src} target="_blank" rel="noopener noreferrer" className={`group block rounded-md border bg-white p-1.5 hover:border-primary ${className}`} title="Open full size">
            <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="mx-auto max-h-56 w-full object-contain" />
            <span className="mt-1 block truncate text-center text-[11px] text-muted-foreground group-hover:text-foreground">{alt}</span>
        </a>
    );
}

function GroupTable({ group, filter }: { group: WorkshopGroup; filter: string }) {
    const rows = matchingRows(group.rows, filter);
    if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing matches.</p>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <tbody>
                    {rows.map((r, i) => {
                        const heading = !r.value && !r.image;
                        return (
                            <tr key={i} className={heading ? "" : "border-b border-border/60 last:border-0"}>
                                <td className="py-1.5 pr-3 align-top" style={{ paddingLeft: `${r.depth * 16}px` }}>
                                    <span className={heading ? "text-xs font-semibold uppercase tracking-wide text-muted-foreground" : ""}>{r.label}</span>
                                    {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                                </td>
                                <td className="py-1.5 text-right align-top font-medium tabular-nums whitespace-nowrap">
                                    {r.value && <>{r.value}{r.unit ? <span className="ml-1 text-xs font-normal text-muted-foreground">{r.unit}</span> : null}</>}
                                    {r.image && <a href={r.image} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><ImageIcon className="h-3 w-3" />Diagram</a>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function FuseBoxView({ box, filter }: { box: FuseBox; filter: string }) {
    const items = filter ? box.items.filter((f) => `${f.ref} ${f.what}`.toLowerCase().includes(filter)) : box.items;
    if (filter && !items.length) return null;
    return (
        <div className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">{box.name}</p>
            {box.notes.map((n, i) => <p key={i} className="text-xs text-muted-foreground">{n}</p>)}
            {(box.mapImage || box.whereImage) && (
                <div className="grid gap-2 sm:grid-cols-2">
                    {box.mapImage && <Picture src={box.mapImage} alt="Fuse layout" />}
                    {box.whereImage && <Picture src={box.whereImage} alt="Where the box is" />}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-medium">No.</th><th className="py-1 pr-2 font-medium">Amps</th><th className="py-1 font-medium">What it protects</th></tr></thead>
                    <tbody>
                        {items.map((f, i) => (
                            <tr key={i} className="border-t border-border/60">
                                <td className="py-1 pr-2 font-medium tabular-nums">{f.ref}</td>
                                <td className="py-1 pr-2 tabular-nums">{f.amps ? `${f.amps}A` : "–"}</td>
                                <td className="py-1">{f.what}{f.kind !== "fuse" && <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] capitalize">{f.kind}</Badge>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function WorkshopDataCard({ workshop, loading, onFetch }: Props) {
    const [query, setQuery] = useState("");
    const filter = query.trim().toLowerCase();

    const counts = useMemo(() => {
        if (!workshop) return null;
        return {
            values: workshop.adjustments.reduce((n, g) => n + g.rows.filter((r) => r.value).length, 0),
            fuses: workshop.fuses.reduce((n, b) => n + b.items.length, 0),
            pictures: workshop.drawings.reduce((n, g) => n + g.drawings.length, 0) + workshop.locations.length + workshop.diagnosticPort.length,
        };
    }, [workshop]);

    const header = (
        <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />Workshop Data</CardTitle>
            {workshop && counts && (
                <p className="text-sm text-muted-foreground">
                    {counts.values} settings, {counts.fuses} fuses and {counts.pictures} diagrams, fetched {ukDate(workshop.fetchedAt)}. Kept on the car, so it is never paid for twice.
                </p>
            )}
        </CardHeader>
    );

    if (!workshop) {
        return (
            <Card className="md:col-span-2">
                {header}
                <CardContent>
                    {loading ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Fetching torque settings, fuse boxes and diagrams…</p>
                    ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm text-muted-foreground">Not fetched for this car yet.</p>
                            {onFetch && <Button size="sm" variant="outline" onClick={onFetch}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Fetch workshop data</Button>}
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    }

    const fuseMatches = filter
        ? workshop.fuses.reduce((n, b) => n + b.items.filter((f) => `${f.ref} ${f.what}`.toLowerCase().includes(filter)).length, 0)
        : workshop.fuses.length;

    const nothing = !workshop.adjustments.length && !workshop.fuses.length && !workshop.diagnosticPort.length && !workshop.locations.length && !workshop.drawings.length;

    return (
        <Card className="md:col-span-2">
            {header}
            <CardContent className="space-y-3">
                {nothing ? (
                    <p className="text-sm text-muted-foreground">The technical data service has no workshop data for this car.</p>
                ) : (
                    <>
                        <label className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring">
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, e.g. wheel bolt, disc thickness, headlight fuse"
                                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                        </label>
                        <Accordion type="multiple" defaultValue={filter ? undefined : ["Torque settings"]} className="w-full">
                            {workshop.adjustments.map((g) => {
                                const shown = matchingRows(g.rows, filter);
                                if (filter && !shown.length) return null;
                                const hits = entryCount(shown);
                                return (
                                    <AccordionItem key={g.name} value={g.name}>
                                        <AccordionTrigger className="py-2.5 text-sm">
                                            <span className="flex items-center gap-2">{g.name}<span className="text-xs font-normal text-muted-foreground">{hits}</span></span>
                                        </AccordionTrigger>
                                        <AccordionContent><GroupTable group={g} filter={filter} /></AccordionContent>
                                    </AccordionItem>
                                );
                            })}
                            {fuseMatches > 0 && (
                                <AccordionItem value="fuses">
                                    <AccordionTrigger className="py-2.5 text-sm"><span className="flex items-center gap-2"><Zap className="h-4 w-4" />Fuse boxes<span className="text-xs font-normal text-muted-foreground">{filter ? `${fuseMatches} matching` : workshop.fuses.length}</span></span></AccordionTrigger>
                                    <AccordionContent className="space-y-3">{workshop.fuses.map((b, i) => <FuseBoxView key={i} box={b} filter={filter} />)}</AccordionContent>
                                </AccordionItem>
                            )}
                            {!filter && workshop.diagnosticPort.length > 0 && (
                                <AccordionItem value="port">
                                    <AccordionTrigger className="py-2.5 text-sm"><span className="flex items-center gap-2"><MapPin className="h-4 w-4" />Diagnostic port</span></AccordionTrigger>
                                    <AccordionContent><div className="grid gap-2 sm:grid-cols-2">{workshop.diagnosticPort.map((p, i) => p.image ? <Picture key={i} src={p.image} alt={p.note ?? "Diagnostic port"} /> : <p key={i} className="text-sm">{p.note}</p>)}</div></AccordionContent>
                                </AccordionItem>
                            )}
                            {!filter && workshop.locations.length > 0 && (
                                <AccordionItem value="locations">
                                    <AccordionTrigger className="py-2.5 text-sm"><span className="flex items-center gap-2"><MapPin className="h-4 w-4" />Where parts are<span className="text-xs font-normal text-muted-foreground">{workshop.locations.length}</span></span></AccordionTrigger>
                                    <AccordionContent className="space-y-3">
                                        {workshop.locations.map((l, i) => (
                                            <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                                {l.image ? <Picture src={l.image} alt={l.title} /> : <p className="text-sm font-medium">{l.title}</p>}
                                                <ol className="space-y-0.5 text-sm">{l.parts.map((p, j) => <li key={j}><span className="mr-2 inline-block w-6 text-right font-medium tabular-nums">{p.ref}</span>{p.name}</li>)}</ol>
                                            </div>
                                        ))}
                                    </AccordionContent>
                                </AccordionItem>
                            )}
                            {!filter && workshop.drawings.length > 0 && (
                                <AccordionItem value="drawings">
                                    <AccordionTrigger className="py-2.5 text-sm"><span className="flex items-center gap-2"><ImageIcon className="h-4 w-4" />Drawings<span className="text-xs font-normal text-muted-foreground">{counts?.pictures}</span></span></AccordionTrigger>
                                    <AccordionContent className="space-y-3">
                                        {workshop.drawings.map((g, i) => (
                                            <div key={i}>
                                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</p>
                                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{g.drawings.map((d, j) => <Picture key={j} src={d.image} alt={d.title} />)}</div>
                                            </div>
                                        ))}
                                    </AccordionContent>
                                </AccordionItem>
                            )}
                        </Accordion>
                        {workshop.empty.length > 0 && <p className="text-xs text-muted-foreground">Not available for this car: {workshop.empty.join(", ").toLowerCase()}.</p>}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
