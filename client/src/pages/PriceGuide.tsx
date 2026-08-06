import { useState, Fragment } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { ManufacturerLogo } from "@/components/ManufacturerLogo";
import { Loader2, Search, Info, Printer, ChevronRight, ChevronDown } from "lucide-react";

/**
 * "How much is a small service for a GLC?" — answered from our own invoices instead of guessed.
 *
 * Every figure is what a customer actually paid, VAT included, so it can be read out over the
 * phone as-is. The median is shown rather than the average because one unusually big job drags
 * an average around; the quartile range beside it is the honest answer to "it depends on the
 * car", and the job count says how much weight the figure carries.
 */
const money = (n: any) => `£${Number(n || 0).toLocaleString("en-GB")}`;

const SIZE_HINT: Record<string, string> = {
  Small: "under 1400cc — Aygo, Fiesta, Picanto",
  Medium: "1400–1999cc — Focus, Golf, C-Class",
  Large: "2000cc and up — Kuga, Sorento, GLC",
};

const SIZE_TONE: Record<string, string> = {
  Small: "bg-sky-50 text-sky-700 border-sky-200",
  Medium: "bg-amber-50 text-amber-700 border-amber-200",
  Large: "bg-rose-50 text-rose-700 border-rose-200",
};

/** Engine size is the proxy for how big a car is, and it's what actually moves the price of a
 * service — oil capacity and filter cost both track it. Shown so an Aygo and a RAV4 are never
 * read off the same line. */
function SizeBadge({ size, cc }: { size?: string | null; cc?: number }) {
  if (!size) return null;
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SIZE_TONE[size] || ""}`}
      title={cc ? `Average ${cc}cc across these jobs` : undefined}>
      {size}
    </span>
  );
}

function Cell({ stat }: { stat: any }) {
  if (!stat) return <td className="px-2 py-2 text-center text-slate-300">—</td>;
  // Under five jobs is a hint, not a price — a Kuga priced off two jobs came out cheaper than a
  // Fiesta, which is nonsense you'd only spot if the sample size is impossible to miss.
  const thin = stat.n < 5;
  return (
    <td className="px-2 py-2 text-center whitespace-nowrap">
      <div className={`font-semibold ${thin ? "text-slate-500" : "text-slate-900"}`}>{money(stat.median)}</div>
      <div className="text-[10px] text-slate-400">
        {stat.low === stat.high ? `${stat.n} job${stat.n === 1 ? "" : "s"}` : `${money(stat.low)}–${money(stat.high)} · ${stat.n}`}
      </div>
      {stat.labour != null && stat.parts != null && (
        <div className="text-[10px] text-slate-400">{money(stat.labour)} lab + {money(stat.parts)} parts</div>
      )}
    </td>
  );
}

/** The whole point of the page, in one box: type the reg, get the price.
 *
 * Everything below it is reference material. This is what gets used with a customer on the
 * phone, so it does the thinking — works out the car's size band and reads back the few numbers
 * that get asked for, big enough to read at a glance. */
function QuickQuote({ years }: { years: number }) {
  const [reg, setReg] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { data, isFetching } = trpc.priceGuide.forRegistration.useQuery(
    { registration: submitted, years },
    { enabled: submitted.length >= 2, staleTime: 60_000 }
  );

  const HEADLINE = ["interimService", "fullService", "brakeFluid", "frontPads", "frontDiscs"];
  const found = (data as any)?.found;
  const v = (data as any)?.vehicle;
  const prices = (data as any)?.prices || {};
  const labels: Record<string, string> = Object.fromEntries(((data as any)?.categories || []).map((c: any) => [c.key, c.label]));

  return (
    <div className="rounded-xl border-2 border-violet-200 bg-violet-50/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-semibold text-slate-700">What's it for?</label>
        <form onSubmit={(e) => { e.preventDefault(); setSubmitted(reg.trim().toUpperCase()); }} className="flex gap-2">
          <input
            value={reg}
            onChange={(e) => setReg(e.target.value.toUpperCase())}
            placeholder="Enter a registration"
            className="w-44 rounded-md border-2 border-slate-300 bg-yellow-300 px-3 py-1.5 font-mono text-[16px] font-bold tracking-wider text-black placeholder:font-sans placeholder:text-[13px] placeholder:font-normal placeholder:text-black/50 outline-none focus:border-violet-500"
          />
          <button type="submit" className="rounded-md bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800">
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Price it"}
          </button>
        </form>
        {submitted && !isFetching && found === false && (
          <span className="text-sm text-slate-500">Couldn't find {submitted} — use the size rows below.</span>
        )}
      </div>

      {found && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{v?.make} {v?.model}</span>
            <SizeBadge size={(data as any)?.band} cc={v?.engineCC} />
            {v?.engineCC ? <span className="text-slate-500">{v.engineCC}cc</span> : null}
            {(data as any)?.source === "dvla" && <span className="text-[11px] text-slate-400">(not one of ours — looked up at DVLA)</span>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {/* MOT is a fixed charge, so it's stated rather than averaged. */}
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">MOT</div>
              <div className="text-[22px] font-bold leading-tight">£50</div>
              <div className="text-[10px] text-slate-400">fixed price</div>
            </div>
            {HEADLINE.map((k) => {
              const st = prices[k];
              return (
                <div key={k} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate" title={labels[k]}>{labels[k]}</div>
                  <div className={`text-[22px] font-bold leading-tight ${st ? "" : "text-slate-300"}`}>{st ? money(st.median) : "—"}</div>
                  {/* Labour is a rate we set; parts are whatever the car takes. Splitting them is
                      how the job gets quoted, and shows which half is moving the price. */}
                  <div className="text-[10px] text-slate-400">
                    {st ? `labour ${money(st.labour)} + parts ${money(st.parts)}` : "no jobs like it yet"}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500">
            Typical for a <strong>{String((data as any)?.band || "").toLowerCase()}</strong> car, VAT included — labour plus the parts that car takes. MOT is on top.
          </p>
        </>
      )}
    </div>
  );
}

export default function PriceGuide() {
  const [years, setYears] = useState(3);
  const [filter, setFilter] = useState("");
  const [openMakes, setOpenMakes] = useState<Record<string, boolean>>({});
  const [showTable, setShowTable] = useState(false);
  const { data, isLoading } = trpc.priceGuide.get.useQuery({ years }, { staleTime: 5 * 60_000 });

  const cats: any[] = (data as any)?.categories || [];
  const makes: any[] = (data as any)?.makes || [];
  const all: any = (data as any)?.all || {};
  const sizes: any[] = (data as any)?.sizes || [];
  const f = filter.trim().toLowerCase();
  const shown = f ? makes.filter((m) => m.make.toLowerCase().includes(f)) : makes;

  return (
    <DashboardLayout>
      <div className="space-y-4 print:space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Price Guide</h1>
            <p className="text-sm text-slate-500">
              What we actually charged, per manufacturer — taken from our own invoices, VAT included.
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a make…"
                className="border rounded-md pl-8 pr-2 py-1.5 text-sm outline-none focus:border-violet-500" />
            </div>
            <select value={years} onChange={(e) => setYears(Number(e.target.value))}
              className="border rounded-md px-2 py-1.5 text-sm">
              <option value={2}>Last 2 years</option>
              <option value={3}>Last 3 years</option>
              <option value={5}>Last 5 years</option>
            </select>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 border rounded-md px-2.5 py-1.5 text-sm hover:bg-slate-50">
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>

        <QuickQuote years={years} />

        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-500 py-12 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Working out prices from your invoices…</div>
        ) : (
          <>
            <button type="button" onClick={() => setShowTable((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:underline print:hidden">
              {showTable ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {showTable ? "Hide the full breakdown" : "Show the full breakdown by make and model"}
            </button>

            <div className={`rounded-xl border border-slate-200 bg-white overflow-x-auto ${showTable ? "" : "hidden print:block"}`}>
              <table className="w-full text-[13px] min-w-[900px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                    <th className="text-left font-semibold px-3 py-2 w-[180px]">Make</th>
                    {cats.map((c) => (
                      <th key={c.key} className="font-semibold px-2 py-2 text-center">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* The house figure first — the one to quote when the make has too little history. */}
                  <tr className="bg-violet-50/50">
                    <td className="px-3 py-2 font-semibold">All makes</td>
                    {cats.map((c) => <Cell key={c.key} stat={all[c.key]} />)}
                  </tr>
                  {/* By size, pooled across every make: an individual model rarely has enough
                      jobs to be trustworthy, but the size band always does — and size is what
                      really moves a service price. These are the figures to quote from. */}
                  {(sizes as any[]).map((b) => (
                    <tr key={b.band} className="bg-slate-50/80">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 pl-1">
                          <SizeBadge size={b.band} />
                          <span className="text-[12px] text-slate-600">{SIZE_HINT[b.band]}</span>
                        </div>
                      </td>
                      {cats.map((c) => <Cell key={c.key} stat={b.cats[c.key]} />)}
                    </tr>
                  ))}
                  {shown.map((m) => {
                    const open = !!openMakes[m.make];
                    const models: any[] = m.models || [];
                    return (
                      <Fragment key={m.make}>
                        <tr className={`hover:bg-slate-50 ${models.length ? "cursor-pointer" : ""}`}
                          onClick={() => models.length && setOpenMakes((o) => ({ ...o, [m.make]: !o[m.make] }))}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {models.length
                                ? (open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />)
                                : <span className="w-3.5 shrink-0" />}
                              <ManufacturerLogo make={m.make} size="sm" />
                              <span className="font-medium truncate">{m.make}</span>
                              {m.size
                                ? <SizeBadge size={m.size} cc={m.cc} />
                                : m.ccRange && m.ccRange.min !== m.ccRange.max
                                  ? <span className="text-[10px] text-slate-400 whitespace-nowrap">{m.ccRange.min}–{m.ccRange.max}cc</span>
                                  : null}
                              {models.length > 0 && !open && (
                                <span className="text-[10px] text-slate-400 whitespace-nowrap">{models.length} model{models.length === 1 ? "" : "s"}</span>
                              )}
                            </div>
                          </td>
                          {cats.map((c) => <Cell key={c.key} stat={m.cats[c.key]} />)}
                        </tr>
                        {open && models.map((md: any) => (
                          <tr key={`${m.make}-${md.model}`} className="bg-slate-50/60">
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2 pl-8">
                                <span className="text-[12px] text-slate-700 truncate">{md.model}</span>
                                <SizeBadge size={md.size} cc={md.cc} />
                                {md.cc ? <span className="text-[10px] text-slate-400">{md.cc}cc</span> : null}
                              </div>
                            </td>
                            {cats.map((c) => <Cell key={c.key} stat={md.cats[c.key]} />)}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {showTable && !shown.length && <p className="text-sm text-slate-500 text-center py-6">No makes match “{filter}”.</p>}

            <div className={`flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600 ${showTable ? "" : "hidden print:flex"}`}>
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
              <div className="space-y-1">
                <p>
                  <strong>The big figure is the middle price</strong> — half of those jobs came in under it, half over.
                  The smaller line is the usual spread and how many jobs it's based on. A make with only one or two jobs
                  is greyed out: treat it as a hint, not a price.
                </p>
                <p>
                  <strong>Quote from the size rows.</strong> A make is not a size — Ford runs from a 999cc B-Max to a
                  2331cc Kuga — so the size bands, pooled across every make, are the reliable figures. Click a make to
                  see its models underneath; those are useful for a sanity check but many rest on only a handful of jobs,
                  and anything under five is greyed out.
                </p>
                <p>
                  <strong>MOT is quoted separately</strong> and stripped out of every figure here, so you can add it on top.
                  Jobs where other work was done at the same time are excluded entirely, so a service priced here is a
                  service and nothing else.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
