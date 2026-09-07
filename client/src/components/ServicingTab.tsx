import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Loader2, Wrench, AlertTriangle, Clock, Check, FileDown } from "lucide-react";
import { toast } from "sonner";

type Item = {
  key: string; label: string; group: string;
  everyMiles: number | null; everyMonths: number | null;
  times: number; lastDate: string | null; lastDocNo: string | null; lastMileage: number | null;
  prevDate: string | null; milesSince: number | null; monthsSince: number | null;
  status: "overdue" | "soon" | "ok" | "noRecord" | "never" | "unscheduled";
  kind?: string | null;
  why: string | null;
};

const ukDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : null);
const num = (n: number | null | undefined) => (n == null ? null : n.toLocaleString());

/** How long ago, in the words someone would actually use. */
function ago(months: number | null) {
  if (months == null) return null;
  if (months < 1) return "this month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const y = Math.floor(months / 12), m = months % 12;
  return `${y} year${y === 1 ? "" : "s"}${m ? ` ${m} month${m === 1 ? "" : "s"}` : ""} ago`;
}

/** The guide interval, said plainly. */
function every(i: Item) {
  const bits: string[] = [];
  if (i.everyMiles) bits.push(`${num(i.everyMiles)} miles`);
  if (i.everyMonths) bits.push(i.everyMonths % 12 === 0 ? `${i.everyMonths / 12} year${i.everyMonths === 12 ? "" : "s"}` : `${i.everyMonths} months`);
  return bits.length ? `every ${bits.join(" or ")}` : null;
}

/** One line per item: what it is, when it was last done, and why it is flagged. */
function Row({ i, mileage }: { i: Item; mileage: number | null }) {
  const last = i.lastDate
    ? `${ukDate(i.lastDate)}${i.lastMileage ? ` at ${num(i.lastMileage)} miles` : ""}`
    : null;
  const since = i.lastDate
    ? [ago(i.monthsSince), i.milesSince ? `${num(i.milesSince)} miles` : null].filter(Boolean).join(" · ")
    : null;
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-t border-slate-100 first:border-0">
      <div className="w-48 shrink-0 font-medium">
        {i.label}
        {i.kind && i.kind !== i.label ? <span className="ml-1.5 font-normal text-[11px] text-muted-foreground">{i.kind.toLowerCase()}</span> : null}
      </div>
      <div className="flex-1 min-w-0">
        {last ? (
          <span>Last done <b className="tabular-nums">{last}</b>{i.lastDocNo ? <span className="text-muted-foreground"> on job {i.lastDocNo}</span> : null}
            {since ? <span className="text-muted-foreground"> — {since}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Nothing on any job we've raised{mileage ? <> — this car is on <b className="tabular-nums text-slate-700">{num(mileage)} miles</b></> : null}
          </span>
        )}
      </div>
      <div className="w-52 shrink-0 text-right text-[12px] text-muted-foreground">
        {i.why ? <span className="font-medium text-slate-700">{i.why}</span> : null}
        {every(i) ? <span className="ml-2">{every(i)}</span> : null}
      </div>
    </div>
  );
}

function Section({ tone, icon, title, items, mileage }: {
  tone: string; icon: React.ReactNode; title: string; items: Item[]; mileage: number | null;
}) {
  if (!items.length) return null;
  return (
    <div className={`rounded border ${tone}`}>
      <div className="flex items-center gap-2 px-3 py-2 font-semibold text-[13px]">
        {icon}{title}<span className="font-normal opacity-70">({items.length})</span>
      </div>
      <div className="px-3 py-1 bg-white/70">
        {items.map((i) => <Row key={i.key} i={i} mileage={mileage} />)}
      </div>
    </div>
  );
}

/** When each serviceable item was last done on this car, and what has fallen due.
 *
 *  History lists the jobs. This answers the question asked at the counter — is anything owing on
 *  this car — including the one nothing else could: 65,000 miles on the clock and no spark plugs
 *  on any job we ever raised.
 */
export default function ServicingTab({ vehicleId, registration, excludeDocumentId }: { vehicleId?: number; registration?: string; excludeDocumentId?: number }) {
  const { data, isLoading } = trpc.serviceHistory.serviceRecord.useQuery(
    { vehicleId, registration, excludeDocumentId }, { enabled: !!(vehicleId || registration) });

  // Built on the server rather than printed from the browser: Safari will not shrink text far
  // enough to fit a list this dense, which is the same wall the sales summary hit this morning.
  const utils = trpc.useUtils();
  const [saving, setSaving] = useState(false);
  const savePdf = async () => {
    setSaving(true);
    try {
      const res: any = await utils.serviceHistory.serviceRecordPDF.fetch({ vehicleId, registration, excludeDocumentId });
      const bin = atob(res.content);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = res.filename || "Service record.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't build the PDF");
    } finally { setSaving(false); }
  };

  if (isLoading) return <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Reading this car's jobs…</div>;

  const items: Item[] = ((data as any)?.items ?? []) as Item[];
  const d: any = data ?? {};
  // What the car is on today, carried forward from the last reading anyone took at the rate this
  // customer actually drives — not the last figure that happened to get written on a job.
  const mileage = (d.estimatedMileage ?? d.latestMileage ?? null) as number | null;
  const rate = (d.milesPerYear ?? null) as number | null;
  const projected = d.estimatedMileage != null && d.latestMileage != null && d.estimatedMileage > d.latestMileage;
  const by = (s: Item["status"]) => items.filter((i) => i.status === s);
  const overdue = by("overdue"), noRecord = by("noRecord"), soon = by("soon"), ok = by("ok");
  const never = by("never"), wear = by("unscheduled").filter((i) => i.times > 0);

  if (!items.some((i) => i.times > 0) && !overdue.length && !noRecord.length) return (
    <div className="py-10 text-center text-muted-foreground text-[13px]">
      <Wrench className="w-6 h-6 mx-auto mb-2 opacity-40" />
      Nothing on this car's jobs names a service item yet.
    </div>
  );

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-muted-foreground">
          Read off this car's own invoices and its MOT readings — job sheets and estimates don't
          count as done. Intervals are a general guide; the manufacturer's schedule wins.
        </p>
        <span className="shrink-0 flex items-baseline gap-3">
        {mileage ? (
          <span className="text-right text-muted-foreground">
            on {projected ? "about " : ""}<b className="text-slate-800 tabular-nums">{num(mileage)}</b> miles
            {rate ? <span className="block text-[11px]">{num(rate)} a year · last read {num(d.latestMileage)} on {ukDate(d.lastReadOn)}{d.lastReadFrom === "MOT" ? " at MOT" : ""}</span> : null}
          </span>
        ) : null}
        <button type="button" onClick={savePdf} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
        </button>
        </span>
      </div>

      <Section tone="border-red-300 bg-red-50" icon={<AlertTriangle className="w-4 h-4 text-red-600" />}
        title="Overdue" items={overdue} mileage={mileage} />
      <Section tone="border-orange-300 bg-orange-50" icon={<AlertTriangle className="w-4 h-4 text-orange-600" />}
        title={`Never done here${mileage ? ` — and this car is on ${projected ? "about " : ""}${num(mileage)} miles` : ""}`}
        items={noRecord} mileage={mileage} />
      <Section tone="border-amber-300 bg-amber-50" icon={<Clock className="w-4 h-4 text-amber-600" />}
        title="Due soon" items={soon} mileage={mileage} />
      <Section tone="border-slate-200 bg-slate-50" icon={<Check className="w-4 h-4 text-green-600" />}
        title="Up to date" items={ok} mileage={mileage} />

      {wear.length > 0 && (
        <div className="rounded border border-slate-200 bg-slate-50">
          <div className="px-3 py-2 font-semibold text-[13px]">
            Replaced when worn <span className="font-normal text-muted-foreground">— no set interval</span>
          </div>
          <div className="px-3 py-1 bg-white/70">
            {wear.map((i) => <Row key={i.key} i={i} mileage={mileage} />)}
          </div>
        </div>
      )}

      {never.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          <span className="font-medium">Not recorded, not yet due:</span> {never.map((i) => i.label).join(", ")}.
          {" "}No job here names them — which isn't the same as them never having been done.
        </p>
      )}
    </div>
  );
}
