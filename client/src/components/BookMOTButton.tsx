import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MOT_SLOTS, MOT_BAY_ID } from "@/lib/appointmentSlots";
import { CalendarPlus, Loader2, ChevronLeft, ChevronRight, User, Phone, Car, X, Check } from "lucide-react";

// Pull the customer + car we're booking for out of a searchForJob result.
type Picked = {
  vehicleId?: number;
  customerId?: number;
  registration: string;
  make: string;
  model: string;
  name: string;
  phone: string;
};

const HHMM = () => {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
};
const ymd = (d: Date) => `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
const prettyDate = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

// Book an MOT straight from the header: find the customer/car, see the day's free
// MOT-bay slots, and book them in — carrying their details — without leaving the page.
export default function BookMOTButton() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [date, setDate] = useState(() => ymd(new Date()));
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, []);

  // Fresh every open — clear the last search/selection and jump the cursor into the box.
  useEffect(() => {
    if (open) { setQuery(""); setPicked(null); setDate(ymd(new Date())); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  // Universal search — reg, name, phone, make/model, postcode — same source as the calendar's quick-book.
  const results = trpc.vehicles.searchForJob.useQuery(
    { query: query.trim() },
    { enabled: !picked && query.trim().length >= 2, staleTime: 30_000 }
  );

  // The day's MOT-bay appointments → which of the 7 hourly slots are already taken.
  const dayAppts = trpc.appointments.listByDate.useQuery({ date }, { enabled: open, staleTime: 10_000 });
  const bookedStarts = useMemo(() => {
    const set = new Set<string>();
    for (const a of dayAppts.data ?? []) {
      if (a.bayId === MOT_BAY_ID && a.status !== "cancelled" && a.startTime) set.add(a.startTime);
    }
    return set;
  }, [dayAppts.data]);

  const isToday = date === ymd(new Date());
  const nowHHMM = HHMM();

  const createMutation = trpc.appointments.create.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(`MOT booked — ${picked?.registration} at ${vars.startTime}, ${prettyDate(date)}`);
      utils.appointments.listByDate.invalidate({ date });
    },
    onError: (e) => toast.error(`Couldn't book: ${e.message}`),
  });

  const pick = (r: any) => setPicked({
    vehicleId: r.id,
    customerId: r.customerId ?? undefined,
    registration: String(r.registration || "").toUpperCase(),
    make: r.make || "",
    model: r.model || "",
    name: r.ownerName || "",
    phone: r.ownerPhone || "",
  });

  const book = (slot: typeof MOT_SLOTS[number]) => {
    if (!picked || createMutation.isPending) return;
    createMutation.mutate({
      registration: picked.registration,
      bayId: MOT_BAY_ID,
      appointmentDate: new Date(date).toISOString(),
      startTime: slot.start,
      endTime: slot.end,
      serviceType: "MOT",
      vehicleId: picked.vehicleId,
      customerId: picked.customerId,
      customerName: picked.name,
      customerPhone: picked.phone,
      vehicleMake: picked.make,
      vehicleModel: picked.model,
    });
  };

  const shiftDay = (delta: number) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setDate(ymd(d));
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} title="Book an MOT"
        className="inline-flex items-center gap-1.5 h-9 px-3 whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-50 text-[13px] font-medium text-emerald-800 hover:bg-emerald-100 transition-colors">
        <CalendarPlus className="w-4 h-4" /> <span className="hidden 2xl:inline">Book MOT</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] rounded-xl border border-slate-200 bg-white shadow-xl z-50 p-3">
          {/* Step 1 — who / which car */}
          {!picked ? (
            <>
              <input ref={inputRef} value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find by reg, name or phone…"
                className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-[14px] outline-none focus:border-emerald-500" />
              <div className="mt-2 max-h-[240px] overflow-y-auto">
                {query.trim().length < 2 && (
                  <p className="text-[12px] text-slate-400 px-1 py-2">Type a registration, customer name or phone number to find them.</p>
                )}
                {results.isFetching && query.trim().length >= 2 && (
                  <div className="flex items-center gap-2 text-[12px] text-slate-500 px-1 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…</div>
                )}
                {results.data?.length === 0 && !results.isFetching && (
                  <div className="px-1 py-2">
                    <p className="text-[12px] text-slate-500">No match. </p>
                    <button type="button" onClick={() => { setOpen(false); setLocation("/appointments"); }}
                      className="text-[12px] font-medium text-emerald-700 hover:underline">Open the calendar to add a new customer →</button>
                  </div>
                )}
                {results.data?.map((r: any) => (
                  <button type="button" key={r.id} onClick={() => pick(r)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors flex items-center gap-2">
                    <span className="font-mono font-semibold text-[13px] bg-yellow-300 text-black rounded px-1.5 py-0.5">{r.registration}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-slate-800 truncate">{r.ownerName || "—"}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{[r.make, r.model].filter(Boolean).join(" ") || "Vehicle"}{r.ownerPhone ? ` · ${r.ownerPhone}` : ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Selected customer/car */}
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2">
                <span className="font-mono font-semibold text-[13px] bg-yellow-300 text-black rounded px-1.5 py-0.5 mt-0.5">{picked.registration}</span>
                <div className="flex-1 min-w-0 text-[12px]">
                  <div className="flex items-center gap-1 font-medium text-slate-800 truncate"><User className="w-3 h-3 text-slate-400" />{picked.name || "No name on file"}</div>
                  <div className="flex items-center gap-1 text-slate-500 truncate"><Car className="w-3 h-3 text-slate-400" />{[picked.make, picked.model].filter(Boolean).join(" ") || "—"}</div>
                  {picked.phone && <div className="flex items-center gap-1 text-slate-500 truncate"><Phone className="w-3 h-3 text-slate-400" />{picked.phone}</div>}
                </div>
                <button type="button" onClick={() => { setPicked(null); setTimeout(() => inputRef.current?.focus(), 30); }}
                  title="Choose someone else" className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
              </div>

              {/* Date picker */}
              <div className="flex items-center justify-between mt-3">
                <button type="button" onClick={() => shiftDay(-1)} className="h-8 w-8 grid place-items-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"><ChevronLeft className="w-4 h-4" /></button>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-800">{prettyDate(date)}</span>
                  <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
                    className="h-8 px-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 outline-none focus:border-emerald-500" />
                </div>
                <button type="button" onClick={() => shiftDay(1)} className="h-8 w-8 grid place-items-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"><ChevronRight className="w-4 h-4" /></button>
              </div>

              {/* Slot grid */}
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Available MOT slots</span>
                  {dayAppts.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {MOT_SLOTS.map((slot) => {
                    const taken = bookedStarts.has(slot.start);
                    const past = isToday && slot.start < nowHHMM;
                    const disabled = taken || past || createMutation.isPending;
                    return (
                      <button type="button" key={slot.id} disabled={disabled} onClick={() => book(slot)}
                        className={
                          "h-9 rounded-lg border text-[12px] font-medium transition-colors inline-flex items-center justify-center gap-1 " +
                          (taken
                            ? "border-slate-200 bg-slate-100 text-slate-400 line-through cursor-not-allowed"
                            : past
                              ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                              : "border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-600 hover:text-white hover:border-emerald-600")
                        }
                        title={taken ? "Already booked" : past ? "In the past" : `Book ${slot.label}`}>
                        {createMutation.isPending && createMutation.variables?.startTime === slot.start
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <>{slot.start}{taken && <Check className="w-3 h-3" />}</>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Booking into the MOT Bay · one hour each. </p>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="mt-3 pt-2 border-t border-slate-100 flex justify-end">
            <button type="button" onClick={() => { setOpen(false); setLocation("/appointments"); }}
              className="text-[12px] font-medium text-slate-500 hover:text-slate-800">Open full calendar →</button>
          </div>
        </div>
      )}
    </div>
  );
}
