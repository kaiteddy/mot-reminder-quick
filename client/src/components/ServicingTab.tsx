import { trpc } from "@/lib/trpc";
import { Loader2, Wrench } from "lucide-react";

const GROUPS = ["Service", "Fluids", "Filters", "Wear", "Other"] as const;
const ukDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : null);

/** When each serviceable item was last done on this car.
 *
 *  The History tab answers "what did we invoice"; this answers "when was the brake fluid last
 *  changed", which otherwise meant opening jobs from three years back one at a time. Everything
 *  here is read out of jobs already on the car — nothing new is recorded.
 */
export default function ServicingTab({ vehicleId, registration }: { vehicleId?: number; registration?: string }) {
  const { data, isLoading } = trpc.serviceHistory.serviceRecord.useQuery(
    { vehicleId, registration }, { enabled: !!(vehicleId || registration) });

  if (isLoading) return <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Reading this car's jobs…</div>;
  const items: any[] = (data as any)?.items ?? [];
  const done = items.filter((i) => i.times > 0);
  const never = items.filter((i) => i.times === 0);
  const mileage = (data as any)?.latestMileage as number | null;

  if (!done.length) return (
    <div className="py-10 text-center text-muted-foreground text-[13px]">
      <Wrench className="w-6 h-6 mx-auto mb-2 opacity-40" />
      Nothing on this car's jobs names a service item yet.
    </div>
  );

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex items-baseline justify-between">
        <p className="text-muted-foreground">
          Taken from every job on this car — when each item was last done, and how far it has run since.
        </p>
        {mileage ? <span className="text-muted-foreground">last recorded mileage <b className="text-slate-800 tabular-nums">{mileage.toLocaleString()}</b></span> : null}
      </div>

      {GROUPS.map((g) => {
        const rows = done.filter((i) => i.group === g);
        if (!rows.length) return null;
        return (
          <div key={g}>
            <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{g}</div>
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="font-normal pb-1 pr-2">Item</th>
                  <th className="font-normal pb-1 pr-2">Last done</th>
                  <th className="font-normal pb-1 pr-2">Job</th>
                  <th className="font-normal pb-1 pr-2 text-right">At mileage</th>
                  <th className="font-normal pb-1 pr-2 text-right">Miles since</th>
                  <th className="font-normal pb-1 pr-4 text-right">Times</th>
                  <th className="font-normal pb-1">Before that</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.key} className="border-t border-slate-100">
                    <td className="py-1 pr-2 font-medium">{i.label}</td>
                    <td className="py-1 pr-2 tabular-nums">{ukDate(i.lastDate)}</td>
                    <td className="py-1 pr-2 text-muted-foreground tabular-nums">{i.lastDocNo || "—"}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{i.lastMileage ? i.lastMileage.toLocaleString() : "—"}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{i.milesSince ? i.milesSince.toLocaleString() : "—"}</td>
                    <td className="py-1 pr-4 text-right tabular-nums text-muted-foreground">{i.times}</td>
                    <td className="py-1 text-muted-foreground tabular-nums">{ukDate(i.prevDate) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {never.length > 0 && (
        <p className="text-[12px] text-muted-foreground pt-1 border-t border-slate-100">
          <span className="font-medium">Never recorded on this car:</span> {never.map((i) => i.label).join(", ")}.
          {" "}That means no job here names it — not necessarily that it hasn't been done.
        </p>
      )}
    </div>
  );
}
