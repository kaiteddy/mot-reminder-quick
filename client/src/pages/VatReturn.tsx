import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Loader2, Printer, Lock, Unlock, AlertTriangle } from "lucide-react";

/** Pounds and pence, with a proper minus. */
const gbp = (n: number | null | undefined) =>
  n == null ? "—" : (n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ukDate = (iso: string | null | undefined) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** ELI's VAT quarters end January, April, July and October. */
function quarterContaining(d: Date) {
  const m = d.getMonth(); // 0-based
  const starts = [1, 4, 7, 10]; // Feb, May, Aug, Nov
  let start = starts.filter((s) => s <= m).pop();
  let y = d.getFullYear();
  if (start === undefined) { start = 10; y -= 1; } // January belongs to the quarter that began in November
  const from = new Date(y, start, 1);
  const to = new Date(y, start + 3, 0);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
}
const shiftQuarter = (from: string, n: number) => quarterContaining(new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + 3 * n, 15));
const quarterLabel = (from: string, to: string) => `${ukDate(from)} – ${ukDate(to)}`;

const DocLink = ({ id, docNo }: { id: number; docNo: string | null }) => (
  <Link href={`/documents/${id}`} className="font-medium text-primary hover:underline">{docNo || `#${id}`}</Link>
);

export default function VatReturn() {
  const [q, setQ] = useState(() => quarterContaining(new Date()));
  const period = trpc.vat.period.useQuery({ from: q.from, to: q.to }, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const record = trpc.vat.recordFiling.useMutation({
    onSuccess: (r) => { toast.success(`Recorded as filed — ${plural(r.docs, "document")} and ${plural(r.cars, "car")} snapshotted`); setRecording(false); utils.vat.period.invalidate(); utils.vat.filings.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const unrecord = trpc.vat.deleteFiling.useMutation({
    onSuccess: () => { toast.success("Filing record removed"); utils.vat.period.invalidate(); utils.vat.filings.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const [recording, setRecording] = useState(false);
  const [boxes, setBoxes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const printRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({ contentRef: printRef, documentTitle: `VAT ${q.from} to ${q.to}` });

  const d = period.data;
  const filed = d?.filing;
  const openRecord = () => {
    setBoxes({ box1: d ? String(d.boxes.box1) : "", box4: d?.boxes.box4 != null ? String(d.boxes.box4) : "", box6: d ? String(d.boxes.box6) : "", box7: "" });
    setNotes(""); setRecording(true);
  };
  const submitRecord = () => {
    const num = (k: string) => (boxes[k]?.trim() ? Number(boxes[k].replace(/[£,\s]/g, "")) : null);
    record.mutate({ from: q.from, to: q.to, boxes: { box1: num("box1"), box4: num("box4"), box6: num("box6"), box7: num("box7") }, notes: notes.trim() || undefined });
  };
  const filedBox = (k: string): number | null => (filed?.boxes && filed.boxes[k] != null ? Number(filed.boxes[k]) : null);
  const kindLabel: Record<string, string> = { motVat: "MOT taxed", high: "VAT high", low: "VAT low", excess: "Insurance excess", duplicate: "Counted twice" };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-6xl" ref={printRef}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">VAT</h1>
          <div className="flex items-center gap-1 print:hidden">
            <Button variant="outline" size="icon" onClick={() => setQ(shiftQuarter(q.from, -1))} aria-label="Previous quarter"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => setQ(shiftQuarter(q.from, 1))} aria-label="Next quarter"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="text-lg">{quarterLabel(q.from, q.to)}</div>
          {filed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-medium"><Lock className="h-3 w-3" /> Filed {ukDate(String(filed.filedAt))}</span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-medium">Not yet recorded as filed</span>
          )}
          <div className="ml-auto flex gap-2 print:hidden">
            <Button variant="outline" onClick={() => print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
            {filed ? (
              <Button variant="outline" onClick={() => { if (confirm("Remove the record that this quarter was filed? The snapshot goes with it.")) unrecord.mutate({ id: filed.id }); }}><Unlock className="h-4 w-4 mr-1" /> Un-record</Button>
            ) : (
              <Button onClick={openRecord} disabled={!d}><Lock className="h-4 w-4 mr-1" /> Record as filed</Button>
            )}
          </div>
        </div>

        {period.isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Adding up the quarter…</div>}
        {period.error && <div className="text-destructive">{period.error.message}</div>}

        {d && (
          <>
            {/* The boxes, the way the return reads */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { k: "box1", title: "Box 1 · VAT on sales", value: d.boxes.box1, sub: `workshop ${gbp(d.totals.vat)} + cars ${gbp(d.cars.vat)}` },
                { k: "box4", title: "Box 4 · VAT reclaimed", value: d.boxes.box4, sub: "bank & card feed, as labelled" },
                { k: "box5", title: d.boxes.box5 != null && d.boxes.box5 < 0 ? "Box 5 · to reclaim" : "Box 5 · to pay", value: d.boxes.box5, sub: "Box 1 − Box 4" },
                { k: "box6", title: "Box 6 · net sales", value: d.boxes.box6, sub: `Ravi's method adds the car margin: ${gbp(d.boxes.box6WithMargin)}` },
              ].map((b) => {
                const was = filedBox(b.k);
                const diff = was != null && b.value != null ? Math.round((b.value - was) * 100) / 100 : null;
                return (
                  <Card key={b.k}><CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">{b.title}</div>
                    <div className="text-2xl font-semibold tabular-nums">{gbp(b.value)}</div>
                    <div className="text-xs text-muted-foreground">{b.sub}</div>
                    {was != null && <div className={`text-xs mt-1 ${diff ? "text-amber-700" : "text-emerald-700"}`}>filed {gbp(was)}{diff ? ` · app now ${diff > 0 ? "+" : ""}${gbp(diff)}` : " · matches"}</div>}
                  </CardContent></Card>
                );
              })}
            </div>

            {/* Month by month — the lines Ravi keys */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Workshop sales by month — issued invoices and credits, by issue date</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Month</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Standard-rated net</TableHead>
                    <TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Zero-rated net</TableHead><TableHead className="text-right">of which MOTs</TableHead>
                    <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Drafts</TableHead><TableHead className="text-right">Not in GA4</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.months.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{m.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.count}{m.credits ? <span className="text-muted-foreground"> − {m.credits} cr</span> : null}</TableCell>
                        <TableCell className="text-right tabular-nums">{gbp(m.stdNet)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{gbp(m.vat)}</TableCell>
                        <TableCell className="text-right tabular-nums">{gbp(m.zeroNet)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{m.motCount} · {gbp(m.motNet)}</TableCell>
                        <TableCell className="text-right tabular-nums">{gbp(m.gross)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${m.drafts ? "text-amber-700" : "text-muted-foreground"}`}>{m.drafts || "—"}</TableCell>
                        <TableCell className={`text-right tabular-nums ${m.notInGa4 ? "text-amber-700" : "text-muted-foreground"}`}>{m.notInGa4 || "—"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold bg-muted/40">
                      <TableCell>Quarter</TableCell>
                      <TableCell className="text-right tabular-nums">{d.totals.count}{d.totals.credits ? <span className="text-muted-foreground font-normal"> − {d.totals.credits} cr</span> : null}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(d.totals.stdNet)}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(d.totals.vat)}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(d.totals.zeroNet)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground font-normal">{d.totals.motCount} · {gbp(d.totals.motNet)}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(d.totals.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.drafts.length || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.notInGa4.length || "—"}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div className="text-sm text-muted-foreground mt-3">
                  Cars sold: {plural(d.cars.count, "car")} — {gbp(d.cars.sales)} at full price (zero-rated in Box 6), margin {gbp(d.cars.base)} → VAT {gbp(d.cars.vat)} (a sixth of the margin).
                </div>
              </CardContent>
            </Card>

            {/* What has moved since it was filed */}
            {filed && (
              <Card className={filed.drift.vatDelta || filed.drift.added.length || filed.drift.removed.length || filed.drift.changed.length ? "border-amber-300" : ""}>
                <CardHeader className="pb-2"><CardTitle className="text-base">Since it was filed on {ukDate(String(filed.filedAt))}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {filed.notes && <div className="text-sm text-muted-foreground whitespace-pre-wrap">{filed.notes}</div>}
                  {!filed.drift.added.length && !filed.drift.removed.length && !filed.drift.changed.length && !filed.drift.carsAdded.length && !filed.drift.carsRemoved.length && !filed.drift.carsChanged.length ? (
                    <div className="text-sm text-emerald-700">Nothing has moved. The quarter reads exactly as it did when it was filed.</div>
                  ) : (
                    <>
                      <div className="text-sm">Workshop VAT has moved by <span className={`font-semibold ${filed.drift.vatDelta ? "text-amber-700" : ""}`}>{filed.drift.vatDelta > 0 ? "+" : ""}{gbp(filed.drift.vatDelta)}</span> — an adjustment for the next return.</div>
                      {filed.drift.added.length > 0 && <DriftTable title="Added after filing" rows={filed.drift.added.map((x: any) => ({ id: x.id, docNo: x.docNo, date: x.date, who: x.customer, reg: x.registration, a: gbp(x.net), b: gbp(x.tax), note: `created ${ukDate(x.created)}` }))} cols={["Net", "VAT"]} />}
                      {filed.drift.removed.length > 0 && <DriftTable title="Gone since filing (deleted, voided or re-dated out)" rows={filed.drift.removed.map((x: any) => ({ id: x.id, docNo: x.docNo, date: x.month, who: "", reg: "", a: gbp(x.net), b: gbp(x.tax), note: "" }))} cols={["Net", "VAT"]} />}
                      {filed.drift.changed.length > 0 && <DriftTable title="Changed since filing" rows={filed.drift.changed.map((x: any) => ({ id: x.id, docNo: x.docNo, date: x.date, who: x.customer, reg: x.registration, a: `${gbp(x.was.tax)} → ${gbp(x.tax)}`, b: (x.vatDelta > 0 ? "+" : "") + gbp(x.vatDelta), note: x.month !== x.was.month ? `moved ${x.was.month} → ${x.month}` : "" }))} cols={["VAT was → now", "Change"]} />}
                      {(filed.drift.carsAdded.length > 0 || filed.drift.carsRemoved.length > 0 || filed.drift.carsChanged.length > 0) && (
                        <div className="text-sm">Cars: {filed.drift.carsAdded.map((c: any) => `${c.registration} added (${gbp(c.salePrice)})`).concat(filed.drift.carsRemoved.map((c: any) => `${c.registration} gone`), filed.drift.carsChanged.map((c: any) => `${c.registration} changed ${gbp(c.was.salePrice)} → ${gbp(c.salePrice)}`)).join(" · ")}</div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* The rules, and what breaks them */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Doesn't fit the rules — {plural(d.exceptions.length, "invoice")}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {d.exceptions.length === 0 ? <div className="text-sm text-emerald-700">Every invoice this quarter carries 20% on its taxable net and nothing on the MOT.</div> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Reg</TableHead><TableHead className="text-right">Net</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Should be</TableHead><TableHead>Why</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {d.exceptions.map((x) => (
                        <TableRow key={x.id}>
                          <TableCell><DocLink id={x.id} docNo={x.docNo} /> <span className="text-xs text-muted-foreground">{x.docType}</span></TableCell>
                          <TableCell className="whitespace-nowrap">{ukDate(x.date)}</TableCell>
                          <TableCell className="max-w-[12rem] truncate">{x.customer || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{x.registration || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{gbp(x.net)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{gbp(x.tax)}</TableCell>
                          <TableCell className="text-right tabular-nums">{gbp(x.expectedTax)}</TableCell>
                          <TableCell className="text-sm"><span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs mr-1">{kindLabel[x.kind]}</span>{x.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Not yet in the old system — {plural(d.notInGa4.length, "invoice")}</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground mb-2">Only matters while Ravi files from GA4's totals: these are issued here but GA4 has no filled copy, so they are missing from any figure taken from it.</div>
                  {d.notInGa4.length === 0 ? <div className="text-sm text-emerald-700">Everything issued this quarter has been written back.</div> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">VAT</TableHead><TableHead>GA4</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {d.notInGa4.map((x) => (
                          <TableRow key={x.id}>
                            <TableCell><DocLink id={x.id} docNo={x.docNo} /></TableCell>
                            <TableCell className="whitespace-nowrap">{ukDate(x.date)}</TableCell>
                            <TableCell className="max-w-[10rem] truncate">{x.customer || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{gbp(x.tax)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{x.ga4Number ? `${x.ga4Number} · ${x.poolStatus || "no pool entry"}` : "no number yet"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Drafts dated in this quarter — {d.drafts.length}</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground mb-2">A draft is not a sale and is not counted. Issue it, or delete it, before the quarter is filed.</div>
                  {d.drafts.length === 0 ? <div className="text-sm text-emerald-700">No drafts.</div> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Doc</TableHead><TableHead>Created</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Gross</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {d.drafts.map((x) => (
                          <TableRow key={x.id}>
                            <TableCell><DocLink id={x.id} docNo={x.docNo} /> <span className="text-xs text-muted-foreground">{x.docType}</span></TableCell>
                            <TableCell className="whitespace-nowrap">{ukDate(x.created)} <span className="text-xs text-muted-foreground">({x.ageDays}d)</span></TableCell>
                            <TableCell className="max-w-[10rem] truncate">{x.customer || "—"}{x.registration ? <span className="text-xs text-muted-foreground"> · {x.registration}</span> : null}</TableCell>
                            <TableCell className="text-right tabular-nums">{gbp(x.gross)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{x.source === "web" ? "web draft" : "GA4 draft"}{x.status ? ` · ${x.status}` : ""}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">How we record VAT</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <p><strong>MOT is always zero-rated.</strong> Net equals gross, VAT nil — an MOT carrying VAT is a fault, and it is listed above.</p>
                <p><strong>Everything else is 20%</strong> of the net, unless a line is explicitly zero-rated.</p>
                <p><strong>The tax point is the issue date in this app.</strong> An invoice written back to the old system weeks later keeps this date here; the old system files it a quarter late.</p>
                <p><strong>A draft is not a sale.</strong> Nothing counts until it is issued — so nothing should sit as a draft past month end.</p>
                <p><strong>Insurance jobs:</strong> the insurer's invoice carries no VAT; the customer's excess invoice carries the VAT for the whole repair. The job's VAT appears once, on the excess.</p>
                <p><strong>Cars are on the margin scheme:</strong> VAT is a sixth of the margin (sale less purchase, ignoring fees); the full sale price goes in Box 6 as zero-rated. A VAT-qualifying car is flagged and pays on the full price.</p>
                <p><strong>Filing:</strong> record each quarter here once Ravi has filed it, with his box figures. Anything that changes inside the period afterwards is listed under "Since it was filed" and goes on the next return as an adjustment.</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={recording} onOpenChange={setRecording}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record {quarterLabel(q.from, q.to)} as filed</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">Enter the figures as they went to HMRC (leave blank if you don't have them). The app's own figures at this moment are kept as a snapshot, so later changes inside the quarter can be tracked.</div>
          <div className="grid grid-cols-2 gap-3">
            {[["box1", "Box 1 · VAT on sales"], ["box4", "Box 4 · VAT reclaimed"], ["box6", "Box 6 · net sales"], ["box7", "Box 7 · net purchases"]].map(([k, label]) => (
              <label key={k} className="text-sm space-y-1"><span className="text-muted-foreground">{label}</span>
                <Input value={boxes[k] ?? ""} onChange={(e) => setBoxes({ ...boxes, [k]: e.target.value })} inputMode="decimal" placeholder="£" /></label>
            ))}
          </div>
          <label className="text-sm space-y-1"><span className="text-muted-foreground">Notes</span><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. filed by Ravi from GA4's monthly totals" /></label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecording(false)}>Cancel</Button>
            <Button onClick={submitRecord} disabled={record.isPending}>{record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record as filed"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function DriftTable({ title, rows, cols }: { title: string; rows: { id: number; docNo: string | null; date: string | null; who: string | null; reg: string | null; a: string; b: string; note: string }[]; cols: [string, string] }) {
  return (
    <div>
      <div className="text-sm font-medium mb-1">{title} — {rows.length}</div>
      <Table>
        <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">{cols[0]}</TableHead><TableHead className="text-right">{cols[1]}</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><DocLink id={r.id} docNo={r.docNo} /></TableCell>
              <TableCell className="whitespace-nowrap">{r.date && r.date.length === 7 ? r.date : ukDate(r.date)}</TableCell>
              <TableCell className="max-w-[12rem] truncate">{r.who || "—"}{r.reg ? <span className="text-xs text-muted-foreground"> · {r.reg}</span> : null}</TableCell>
              <TableCell className="text-right tabular-nums">{r.a}</TableCell>
              <TableCell className="text-right tabular-nums font-medium">{r.b}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.note}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
