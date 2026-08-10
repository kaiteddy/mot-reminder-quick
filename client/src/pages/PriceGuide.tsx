import { useState, Fragment } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { ManufacturerLogo } from "@/components/ManufacturerLogo";
import { Loader2, Search, Info, Printer, ChevronRight, ChevronDown } from "lucide-react";
import { schemeForMake, SERVICE_DIFFERENCE } from "@/lib/serviceSchemes";

/**
 * "How much is a small service for a GLC?" — answered from our own invoices instead of guessed.
 *
 * Every figure is what a customer actually paid, VAT included, so it can be read out over the
 * phone as-is. The median is shown rather than the average because one unusually big job drags
 * an average around; the quartile range beside it is the honest answer to "it depends on the
 * car", and the job count says how much weight the figure carries.
 */
const money = (n: any) => `£${Number(n || 0).toLocaleString("en-GB")}`;
/** Every figure derived from invoices is stored VAT-inclusive (that's what the customer paid).
 * Ex-VAT is what gets typed onto a job sheet, so both are needed — the toggle switches the
 * derived figures, and the headline quote shows both at once since that's the one being read
 * out loud. */
const exVat = (n: any) => Number(n || 0) / 1.2;
const fmt = (n: any, mode: "inc" | "ex") => `£${Math.round(mode === "ex" ? exVat(n) : Number(n || 0)).toLocaleString("en-GB")}`;

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

function Cell({ stat, vat }: { stat: any; vat: "inc" | "ex" }) {
  if (!stat) return <td className="px-2 py-2 text-center text-slate-300">—</td>;
  // Under five jobs is a hint, not a price — a Kuga priced off two jobs came out cheaper than a
  // Fiesta, which is nonsense you'd only spot if the sample size is impossible to miss.
  const thin = stat.n < 5;
  return (
    <td className="px-2 py-2 text-center whitespace-nowrap">
      <div className={`font-semibold ${thin ? "text-slate-500" : "text-slate-900"}`}>{fmt(stat.median, vat)}</div>
      <div className="text-[10px] text-slate-400">
        {stat.low === stat.high ? `${stat.n} job${stat.n === 1 ? "" : "s"}` : `${fmt(stat.low, vat)}–${fmt(stat.high, vat)} · ${stat.n}`}
      </div>
      {stat.labour != null && stat.parts != null && (
        <div className="text-[10px] text-slate-400">{fmt(stat.labour, vat)} lab + {fmt(stat.parts, vat)} parts</div>
      )}
    </td>
  );
}

/** The whole point of the page, in one box: type the reg, get the price.
 *
 * Everything below it is reference material. This is what gets used with a customer on the
 * phone, so it does the thinking — works out the car's size band and reads back the few numbers
 * that get asked for, big enough to read at a glance. */
function QuickQuote({ years, vat }: { years: number; vat: "inc" | "ex" }) {
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

          {/* Our banded labour price comes first: it's the figure to quote, decided rather than
              derived. The history below it says what these jobs have actually come to. */}
          {(data as any)?.ourLabour && (
            <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Interim service — quote this</div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-0.5">
                <span className="text-[28px] font-bold leading-none text-emerald-900">{money((data as any).ourLabour.labour)}</span>
                <span className="text-sm text-emerald-800">
                  + VAT = <strong>{money(Math.round(Number((data as any).ourLabour.labour) * 1.2))}</strong> labour, plus parts
                </span>
                <span className="text-[11px] text-emerald-700">({(data as any).ourLabour.label} · {v?.engineCC}cc)</span>
              </div>
              {prices.interimService?.parts != null && (
                <div className="text-[11px] text-emerald-800/80 mt-1">
                  Parts on a car this size have typically run {money(Math.round(exVat(prices.interimService.parts)))} + VAT — so around{" "}
                  <strong>{money(Math.round(Number((data as any).ourLabour.labour) + exVat(prices.interimService.parts)))}</strong> + VAT
                  {" "}(<strong>{money(Math.round(Number((data as any).ourLabour.labour) * 1.2 + prices.interimService.parts))}</strong> inc VAT) all in, MOT on top.
                </div>
              )}
            </div>
          )}

          {/* The three things people ask to compare, side by side with what each one buys. The
              "what's the difference?" question follows "how much?" every single time, so the
              answer is on the page rather than in someone's head. */}
          {(data as any)?.options && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {((data as any).options as any[]).map((o) => (
                <div key={o.key} className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col">
                  <div className="text-[12px] font-semibold text-slate-700">{o.name}</div>
                  <div className="text-[26px] font-bold leading-tight mt-0.5">{o.price != null ? money(o.price) : "—"}</div>
                  {o.priceExVat != null && o.key !== "mot" && (
                    <div className="text-[11px] text-slate-500">{money(o.priceExVat)} + VAT</div>
                  )}
                  {o.note && <div className="text-[10px] text-slate-400 mt-0.5">{o.note}</div>}
                  <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                    {o.includes.map((line: string) => (
                      <li key={line} className="flex gap-1.5"><span className="text-emerald-600">✓</span><span>{line}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* What actually differs, beyond the price — and in the manufacturer's own words where
              they use one, because a Mercedes owner asks whether theirs is an A or a B. */}
          <details className="rounded-lg border border-slate-200 bg-white p-3" open>
            <summary className="cursor-pointer text-[12px] font-semibold text-slate-700">
              What's the difference between them?
            </summary>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
              <div>
                <div className="font-semibold text-slate-600 mb-1">Both services include</div>
                <ul className="space-y-0.5 text-slate-600">
                  {SERVICE_DIFFERENCE.same.map((l) => <li key={l} className="flex gap-1.5"><span className="text-emerald-600">✓</span><span>{l}</span></li>)}
                </ul>
              </div>
              <div>
                <div className="font-semibold text-slate-600 mb-1">Only on the full service</div>
                <ul className="space-y-0.5 text-slate-600">
                  {SERVICE_DIFFERENCE.onlyFull.map((l) => <li key={l} className="flex gap-1.5"><span className="text-violet-600">+</span><span>{l}</span></li>)}
                </ul>
                <div className="mt-1.5 text-[10px] text-slate-400">That's the whole difference — and the {money(((data as any).combos || []).find((c: any) => c.isDiff)?.price || 0)} between them.</div>
              </div>
              <div>
                <div className="font-semibold text-slate-600 mb-1">Neither — charged separately</div>
                <ul className="space-y-0.5 text-slate-500">
                  {SERVICE_DIFFERENCE.notIncluded.map((l) => <li key={l} className="flex gap-1.5"><span className="text-slate-300">–</span><span>{l}</span></li>)}
                </ul>
              </div>
            </div>

            {(() => {
              const sc = schemeForMake(v?.make);
              if (!sc) return null;
              return (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5">
                  <div className="text-[11px] font-semibold text-amber-900">
                    {v?.make} calls it: {sc.scheme}
                  </div>
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-amber-900/90">
                    <div>
                      <span className="font-semibold">{sc.minor.name}</span>{" "}
                      <span className="text-amber-700">= {sc.minor.maps}</span>
                      <div className="text-amber-800/80">{sc.minor.detail}</div>
                    </div>
                    <div>
                      <span className="font-semibold">{sc.major.name}</span>{" "}
                      <span className="text-amber-700">= {sc.major.maps}</span>
                      <div className="text-amber-800/80">{sc.major.detail}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-amber-800">{sc.note}</div>
                  <div className="mt-1 text-[10px] text-amber-700/70">
                    General guidance for the make — the exact schedule for this car comes from its technical data.
                  </div>
                </div>
              );
            })()}
          </details>

          {(data as any)?.combos?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {((data as any).combos as any[]).map((c) => (
                <div key={c.name} className={`rounded-lg border px-3 py-2 ${c.isDiff ? "border-slate-300 bg-slate-50" : "border-violet-200 bg-violet-50"}`}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{c.name}</div>
                  <div className="text-[18px] font-bold leading-tight">{c.isDiff ? `+${money(c.price)}` : money(c.price)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {/* MOT is a fixed charge, so it's stated rather than averaged. */}
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">MOT</div>
              <div className="text-[22px] font-bold leading-tight">£50</div>
              <div className="text-[11px] font-medium text-slate-500">no VAT on MOT</div>
              <div className="text-[10px] text-slate-400">fixed price</div>
            </div>
            {HEADLINE.map((k) => {
              const st = prices[k];
              return (
                <div key={k} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate" title={labels[k]}>{labels[k]}</div>
                  {/* Both figures, always: the retail price is what's quoted to the customer, the
                      ex-VAT one is what goes on the job sheet. Needing to switch between them
                      mid-call is exactly the friction this page exists to remove. */}
                  <div className={`text-[22px] font-bold leading-tight ${st ? "" : "text-slate-300"}`}>{st ? money(st.median) : "—"}</div>
                  {st ? (
                    <>
                      <div className="text-[11px] font-medium text-slate-500">{money(Math.round(exVat(st.median)))} + VAT</div>
                      <div className="text-[10px] text-slate-400">labour {money(Math.round(exVat(st.labour)))} + parts {money(Math.round(exVat(st.parts)))}</div>
                    </>
                  ) : (
                    <div className="text-[10px] text-slate-400">no jobs like it yet</div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500">
            Typical for a <strong>{String((data as any)?.band || "").toLowerCase()}</strong> car, {vat === "inc" ? "VAT included" : "excluding VAT"} — labour plus the parts that car takes. MOT is on top.
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
  const [vat, setVat] = useState<"inc" | "ex">("inc");
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
              What we actually charged, per manufacturer — taken from our own invoices. Showing {vat === "inc" ? "prices including VAT" : "prices excluding VAT"}.
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a make…"
                className="border rounded-md pl-8 pr-2 py-1.5 text-sm outline-none focus:border-violet-500" />
            </div>
            <div className="inline-flex rounded-md border overflow-hidden text-sm">
              {(["inc", "ex"] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => setVat(mode)}
                  className={`px-2.5 py-1.5 ${vat === mode ? "bg-violet-700 text-white" : "bg-white hover:bg-slate-50"}`}>
                  {mode === "inc" ? "Inc VAT" : "Ex VAT"}
                </button>
              ))}
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

        <QuickQuote years={years} vat={vat} />

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
                    {cats.map((c) => <Cell key={c.key} stat={all[c.key]} vat={vat} />)}
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
                      {cats.map((c) => <Cell key={c.key} stat={b.cats[c.key]} vat={vat} />)}
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
                          {cats.map((c) => <Cell key={c.key} stat={m.cats[c.key]} vat={vat} />)}
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
                            {cats.map((c) => <Cell key={c.key} stat={md.cats[c.key]} vat={vat} />)}
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
