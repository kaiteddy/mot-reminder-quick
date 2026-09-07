import { useRef, useState } from "react";
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
import { ChevronLeft, ChevronRight, Loader2, Printer, Lock, Unlock, CheckCircle2, AlertTriangle } from "lucide-react";

/** Pounds and pence, with a proper minus. */
const gbp = (n: number | null | undefined) =>
  n == null ? "—" : (n < 0 ? "−" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => (n > 0 ? "+" : "") + gbp(n);
const ukDate = (iso: string | null | undefined) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** ELI's VAT quarters end January, April, July and October. */
function quarterContaining(d: Date) {
  const m = d.getMonth();
  const starts = [1, 4, 7, 10]; // Feb, May, Aug, Nov
  let start = starts.filter((s) => s <= m).pop();
  let y = d.getFullYear();
  if (start === undefined) { start = 10; y -= 1; } // January belongs to the quarter that began in November
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: iso(new Date(y, start, 1)), to: iso(new Date(y, start + 3, 0)) };
}
const shiftQuarter = (from: string, n: number) => quarterContaining(new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + 3 * n, 15));
const quarterLabel = (from: string, to: string) => {
  const a = new Date(from + "T12:00:00"), b = new Date(to + "T12:00:00");
  return `${a.toLocaleDateString("en-GB", { month: "long" })} – ${b.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
};

const DocLink = ({ id, docNo }: { id: number; docNo: string | null }) => (
  <Link href={`/documents/${id}`} className="font-medium text-primary hover:underline whitespace-nowrap">{docNo || `#${id}`}</Link>
);

/** One problem group: a heading that says what's wrong in a sentence, then the invoices. */
function Problem({ title, count, hint, open, children }: { title: string; count: number; hint: string; open?: boolean; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <details open={open} className="group rounded-lg border bg-card">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-3">
        <span className="inline-flex h-6 min-w-6 px-1.5 items-center justify-center rounded-full bg-amber-100 text-amber-900 text-sm font-semibold">{count}</span>
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground hidden md:inline">— {hint}</span>
        <span className="ml-auto text-xs text-muted-foreground group-open:hidden">show</span>
        <span className="ml-auto text-xs text-muted-foreground hidden group-open:inline">hide</span>
      </summary>
      <div className="px-4 pb-3 md:hidden text-sm text-muted-foreground">{hint}</div>
      <div className="px-2 pb-2 overflow-x-auto">{children}</div>
    </details>
  );
}

export default function VatReturn() {
  const [q, setQ] = useState(() => quarterContaining(new Date()));
  const period = trpc.vat.period.useQuery({ from: q.from, to: q.to }, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const record = trpc.vat.recordFiling.useMutation({
    onSuccess: (r) => { toast.success(`Recorded as filed — ${plural(r.docs, "invoice")} and ${plural(r.cars, "car")} kept as the snapshot`); setRecording(false); utils.vat.period.invalidate(); utils.vat.filings.invalidate(); },
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
  const filedBox5 = filedBox("box1") != null && filedBox("box4") != null ? Math.round((filedBox("box1")! - filedBox("box4")!) * 100) / 100 : null;

  const groups = d ? {
    totals: d.exceptions.filter((x) => x.kind === "totals"),
    motVat: d.exceptions.filter((x) => x.kind === "motVat"),
    duplicate: d.exceptions.filter((x) => x.kind === "duplicate"),
    high: d.exceptions.filter((x) => x.kind === "high"),
    low: d.exceptions.filter((x) => x.kind === "low"),
    excess: d.exceptions.filter((x) => x.kind === "excess"),
  } : null;
  const toSort = d ? d.exceptions.length + d.drafts.length + d.notInGa4.length : 0;
  const moved = filed ? (filed.drift.added.length + filed.drift.removed.length + filed.drift.changed.length + filed.drift.carsAdded.length + filed.drift.carsRemoved.length + filed.drift.carsChanged.length) : 0;

  const problemTable = (rows: any[], cols: { head: string; cell: (x: any) => React.ReactNode; right?: boolean }[]) => (
    <Table>
      <TableHeader><TableRow>{cols.map((c) => <TableHead key={c.head} className={c.right ? "text-right" : ""}>{c.head}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((x) => <TableRow key={x.id}>{cols.map((c) => <TableCell key={c.head} className={(c.right ? "text-right tabular-nums " : "") + "py-2"}>{c.cell(x)}</TableCell>)}</TableRow>)}</TableBody>
    </Table>
  );
  const who = (x: any) => <span className="block max-w-[14rem] truncate">{x.customer || "—"}{x.registration ? <span className="text-xs text-muted-foreground"> · {x.registration}</span> : null}</span>;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-5xl" ref={printRef}>
        {/* Which quarter */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">VAT</h1>
          <div className="flex items-center gap-1 print:hidden">
            <Button variant="outline" size="icon" onClick={() => setQ(shiftQuarter(q.from, -1))} aria-label="Previous quarter"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => setQ(shiftQuarter(q.from, 1))} aria-label="Next quarter"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="text-xl">{quarterLabel(q.from, q.to)}</div>
          <div className="ml-auto flex gap-2 print:hidden">
            <Button variant="outline" onClick={() => print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
            {filed ? (
              <Button variant="outline" onClick={() => { if (confirm("Forget that this quarter was filed? The snapshot goes with it.")) unrecord.mutate({ id: filed.id }); }}><Unlock className="h-4 w-4 mr-1" /> Un-record</Button>
            ) : (
              <Button onClick={openRecord} disabled={!d}><Lock className="h-4 w-4 mr-1" /> Ravi has filed it</Button>
            )}
          </div>
        </div>

        {period.isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Adding up the quarter…</div>}
        {period.error && <div className="text-destructive">{period.error.message}</div>}

        {d && groups && (
          <>
            {/* The answer */}
            <Card className={filed ? "border-emerald-300" : ""}>
              <CardContent className="p-5 md:p-6">
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <div className="text-sm text-muted-foreground">{d.boxes.box5 != null && d.boxes.box5 < 0 ? "HMRC owes you" : "You owe HMRC"}</div>
                    <div className="text-4xl font-semibold tabular-nums">{gbp(d.boxes.box5 == null ? null : Math.abs(d.boxes.box5))}</div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    VAT you charged <span className="text-foreground font-medium tabular-nums">{gbp(d.boxes.box1)}</span>
                    {d.boxes.box4 != null ? <> − VAT you can claim back <span className="text-foreground font-medium tabular-nums">{gbp(d.boxes.box4)}</span></> : <> · purchases not loaded yet</>}
                  </div>
                </div>

                <div className="mt-4 text-sm">
                  {filed ? (
                    moved === 0 ? (
                      <div className="flex items-start gap-2 text-emerald-800"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /><span><strong>Ravi filed this on {ukDate(String(filed.filedAt))}.</strong> Nothing has changed since — the quarter reads exactly as it did then.</span></div>
                    ) : (
                      <div className="flex items-start gap-2 text-amber-800"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span><strong>Ravi filed this on {ukDate(String(filed.filedAt))}, and things have changed since:</strong> VAT has moved by <strong>{signed(filed.drift.vatDelta)}</strong>. That goes on the next return — details below.</span></div>
                    )
                  ) : toSort === 0 ? (
                    <div className="flex items-start gap-2 text-emerald-800"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /><span><strong>Clean.</strong> Nothing to sort — this can go to Ravi as it is.</span></div>
                  ) : (
                    <div className="flex items-start gap-2 text-amber-800"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span><strong>Before this goes to Ravi, sort {plural(toSort, "thing")}</strong> — they're listed under "Things to sort" below.</span></div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* The four boxes, as Ravi files them */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">The return, box by box</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-16">Box</TableHead><TableHead>What it is</TableHead><TableHead className="text-right">The app says</TableHead>
                    {filed && <><TableHead className="text-right">Ravi filed</TableHead><TableHead className="text-right">Difference</TableHead></>}
                  </TableRow></TableHeader>
                  <TableBody>
                    {[
                      { box: "1", what: "VAT on sales", sub: `workshop ${gbp(d.totals.vat)} + cars ${gbp(d.cars.vat)}`, app: d.boxes.box1, was: filedBox("box1") },
                      { box: "4", what: "VAT to claim back", sub: "from the bank and card feed, as labelled", app: d.boxes.box4, was: filedBox("box4") },
                      { box: "5", what: d.boxes.box5 != null && d.boxes.box5 < 0 ? "To reclaim" : "To pay", sub: "Box 1 − Box 4", app: d.boxes.box5, was: filedBox5 },
                      { box: "6", what: "Sales, before VAT", sub: `Ravi also adds the car margin, making ${gbp(d.boxes.box6WithMargin)}`, app: d.boxes.box6, was: filedBox("box6") },
                    ].map((r) => {
                      const diff = r.was != null && r.app != null ? Math.round((r.app - r.was) * 100) / 100 : null;
                      return (
                        <TableRow key={r.box}>
                          <TableCell className="text-muted-foreground">Box {r.box}</TableCell>
                          <TableCell><div className="font-medium">{r.what}</div><div className="text-xs text-muted-foreground">{r.sub}</div></TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{gbp(r.app)}</TableCell>
                          {filed && <>
                            <TableCell className="text-right tabular-nums">{gbp(r.was)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${diff ? "text-amber-700" : "text-emerald-700"}`}>{diff == null ? "—" : diff === 0 ? "same" : signed(diff)}</TableCell>
                          </>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Month by month — the lines Ravi keys */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Workshop sales, month by month</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Month</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Sales at 20%</TableHead>
                    <TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Zero-rated (MOTs)</TableHead><TableHead className="text-right">To sort</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {[...d.months, { ...d.totals, month: "total", label: "Quarter", drafts: d.drafts.length, notInGa4: d.notInGa4.length }].map((m: any) => {
                      const total = m.month === "total";
                      const sort = [m.drafts ? plural(m.drafts, "draft") : "", m.notInGa4 ? `${m.notInGa4} not in GA4` : ""].filter(Boolean).join(", ");
                      return (
                        <TableRow key={m.month} className={total ? "font-semibold bg-muted/40" : ""}>
                          <TableCell>{m.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.count}{m.credits ? <span className="text-muted-foreground font-normal"> − {m.credits} cr</span> : null}</TableCell>
                          <TableCell className="text-right tabular-nums">{gbp(m.stdNet)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{gbp(m.vat)}</TableCell>
                          <TableCell className="text-right tabular-nums">{gbp(m.zeroNet)} <span className="text-xs text-muted-foreground font-normal">({m.motCount} MOTs)</span></TableCell>
                          <TableCell className={`text-right ${sort ? "text-amber-700" : "text-muted-foreground"} font-normal text-sm`}>{sort || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="text-sm text-muted-foreground mt-3">
                  Cars: {plural(d.cars.count, "car")} sold for {gbp(d.cars.sales)}; the margin was {gbp(d.cars.base)}, so the VAT is {gbp(d.cars.vat)} (a sixth of the margin).
                </div>
              </CardContent>
            </Card>

            {/* What has moved since it was filed */}
            {filed && moved > 0 && (
              <Card className="border-amber-300">
                <CardHeader className="pb-2"><CardTitle className="text-base">Changed since Ravi filed it — for the next return</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {filed.drift.added.length > 0 && <Problem open title="Invoices added to this quarter after filing" count={filed.drift.added.length} hint="issued into a filed period — their VAT was never declared">
                    {problemTable(filed.drift.added, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "VAT", cell: (x) => gbp(x.tax), right: true }, { head: "Created", cell: (x) => shortDate(x.created) }])}
                  </Problem>}
                  {filed.drift.removed.length > 0 && <Problem open title="Invoices gone from this quarter since filing" count={filed.drift.removed.length} hint="deleted, voided or re-dated out — their VAT was declared">
                    {problemTable(filed.drift.removed, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Was in", cell: (x) => x.month }, { head: "VAT", cell: (x) => gbp(x.tax), right: true }])}
                  </Problem>}
                  {filed.drift.changed.length > 0 && <Problem open title="Invoices whose VAT changed after filing" count={filed.drift.changed.length} hint="the difference goes on the next return">
                    {problemTable(filed.drift.changed, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "VAT was", cell: (x) => gbp(x.was.tax), right: true }, { head: "VAT now", cell: (x) => gbp(x.tax), right: true }, { head: "Change", cell: (x) => <span className="font-medium">{signed(x.vatDelta)}</span>, right: true }])}
                  </Problem>}
                  {(filed.drift.carsAdded.length > 0 || filed.drift.carsRemoved.length > 0 || filed.drift.carsChanged.length > 0) && (
                    <div className="text-sm">Cars: {filed.drift.carsAdded.map((c: any) => `${c.registration} added (${gbp(c.salePrice)})`).concat(filed.drift.carsRemoved.map((c: any) => `${c.registration} gone`), filed.drift.carsChanged.map((c: any) => `${c.registration} changed ${gbp(c.was.salePrice)} → ${gbp(c.salePrice)}`)).join(" · ")}</div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Things to sort */}
            <div className="space-y-2">
              <h2 className="text-base font-semibold flex items-center gap-2">
                {toSort ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                Things to sort{toSort ? ` — ${toSort}` : ""}
              </h2>
              {toSort === 0 && <div className="text-sm text-emerald-700">Nothing. Every invoice fits the rules, nothing is sitting as a draft, and the old system has a copy of everything.</div>}

              <Problem open title="Totals don't add up" count={groups.totals.length} hint="gross should equal net + VAT; open the invoice and re-save it, or tell me which figure is right">
                {problemTable(groups.totals, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "Net", cell: (x) => gbp(x.net), right: true }, { head: "VAT", cell: (x) => gbp(x.tax), right: true }, { head: "Gross", cell: (x) => <span className="font-medium">{gbp(x.gross)}</span>, right: true }, { head: "Net + VAT", cell: (x) => gbp(x.net + x.tax), right: true }])}
              </Problem>
              <Problem open title="MOT charged with VAT" count={groups.motVat.length} hint="an MOT is always zero-rated; open the invoice and take the VAT off the MOT">
                {problemTable(groups.motVat, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "VAT charged", cell: (x) => gbp(x.tax), right: true }, { head: "Should be", cell: (x) => <span className="font-medium">{gbp(x.expectedTax)}</span>, right: true }])}
              </Problem>
              <Problem open title="Counted twice" count={groups.duplicate.length} hint="a web invoice and the old system's copy of it are both issued — one of them has to go">
                {problemTable(groups.duplicate, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "VAT", cell: (x) => gbp(x.tax), right: true }, { head: "Why", cell: (x) => <span className="text-sm">{x.reason}</span> }])}
              </Problem>
              <Problem open title="VAT is more than 20%" count={groups.high.length} hint="either an excess where you charged the whole repair's VAT on purpose, or a mistake">
                {problemTable(groups.high, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "Net", cell: (x) => gbp(x.net), right: true }, { head: "VAT charged", cell: (x) => gbp(x.tax), right: true }, { head: "20% would be", cell: (x) => gbp(x.expectedTax), right: true }])}
              </Problem>
              <Problem open title="VAT is less than 20%" count={groups.low.length} hint="something zero-rated on the invoice, or VAT under-charged">
                {problemTable(groups.low, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "Net", cell: (x) => gbp(x.net), right: true }, { head: "VAT charged", cell: (x) => gbp(x.tax), right: true }, { head: "20% would be", cell: (x) => gbp(x.expectedTax), right: true }])}
              </Problem>
              <Problem title="Insurance excess — check the VAT" count={groups.excess.length} hint="the repair's VAT should appear once: on the excess if the insurer's invoice has none, otherwise not here">
                {problemTable(groups.excess, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "Excess", cell: (x) => gbp(x.net), right: true }, { head: "VAT on it", cell: (x) => gbp(x.tax), right: true }])}
              </Problem>
              <Problem title="Not invoiced yet (drafts)" count={d.drafts.length} hint="a draft doesn't count — issue it or delete it before the quarter goes to Ravi">
                {problemTable(d.drafts, [{ head: "Doc", cell: (x) => <><DocLink id={x.id} docNo={x.docNo} /> <span className="text-xs text-muted-foreground">{x.docType}</span></> }, { head: "Created", cell: (x) => <>{shortDate(x.created)} <span className="text-xs text-muted-foreground">({x.ageDays}d ago)</span></> }, { head: "Customer", cell: who }, { head: "Amount", cell: (x) => gbp(x.gross), right: true }, { head: "Where", cell: (x) => <span className="text-xs text-muted-foreground">{x.source === "web" ? "web draft" : "old-system draft"}</span> }])}
              </Problem>
              <Problem title="Not in the old system yet" count={d.notInGa4.length} hint="only matters while Ravi files from GA4's figures: these are issued here but GA4 has no copy, so they're missing from anything taken from it">
                {problemTable(d.notInGa4, [{ head: "Invoice", cell: (x) => <DocLink id={x.id} docNo={x.docNo} /> }, { head: "Date", cell: (x) => shortDate(x.date) }, { head: "Customer", cell: who }, { head: "VAT", cell: (x) => gbp(x.tax), right: true }, { head: "GA4", cell: (x) => <span className="text-xs text-muted-foreground">{x.ga4Number ? `${x.ga4Number} · ${x.poolStatus || "not filled"}` : "no number yet"}</span> }])}
              </Problem>
            </div>

            {filed?.notes && (
              <details className="rounded-lg border bg-card">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Notes from when it was filed</summary>
                <div className="px-4 pb-4 text-sm text-muted-foreground whitespace-pre-wrap">{filed.notes}</div>
              </details>
            )}

            <details className="rounded-lg border bg-card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">How the VAT is worked out</summary>
              <div className="px-4 pb-4 text-sm space-y-1.5">
                <p><strong>MOTs have no VAT.</strong> Ever. One with VAT on it is a mistake and is listed above.</p>
                <p><strong>Everything else is 20%.</strong></p>
                <p><strong>The date that counts is the day the invoice was issued here</strong> — not the day the old system got its copy.</p>
                <p><strong>A draft isn't a sale.</strong> It's not counted until it's issued.</p>
                <p><strong>Insurance jobs:</strong> the insurer's invoice has no VAT; the customer's excess carries the VAT for the whole repair. Once.</p>
                <p><strong>Cars:</strong> VAT is a sixth of the margin (what you sold it for, less what you paid). The full sale price still goes in Box 6.</p>
                <p><strong>When Ravi has filed a quarter, press "Ravi has filed it"</strong> and type in his figures. From then on, anything that changes in that quarter shows up here for the next return.</p>
              </div>
            </details>
          </>
        )}
      </div>

      <Dialog open={recording} onOpenChange={setRecording}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ravi has filed {quarterLabel(q.from, q.to)}</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">Type in the figures as they went to HMRC (leave blank if you don't have them). The app keeps a snapshot of the quarter as it is right now, so anything that changes afterwards can be spotted.</div>
          <div className="grid grid-cols-2 gap-3">
            {[["box1", "Box 1 · VAT on sales"], ["box4", "Box 4 · VAT to claim back"], ["box6", "Box 6 · sales before VAT"], ["box7", "Box 7 · purchases before VAT"]].map(([k, label]) => (
              <label key={k} className="text-sm space-y-1"><span className="text-muted-foreground">{label}</span>
                <Input value={boxes[k] ?? ""} onChange={(e) => setBoxes({ ...boxes, [k]: e.target.value })} inputMode="decimal" placeholder="£" /></label>
            ))}
          </div>
          <label className="text-sm space-y-1"><span className="text-muted-foreground">Notes</span><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="anything worth remembering about this quarter" /></label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecording(false)}>Cancel</Button>
            <Button onClick={submitRecord} disabled={record.isPending}>{record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
