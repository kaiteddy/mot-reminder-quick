import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { CalendarClock, Loader2, ShieldCheck, Gauge } from "lucide-react";
import { RegPlate } from "./RegPlate";

const fmt = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

// Quick MOT/tax check from the header — type a reg, get the dates instantly without leaving the page.
export default function QuickMOTCheck() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [reg, setReg] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lookup = trpc.reminders.lookupMOT.useMutation();
  const data: any = lookup.data;

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  const check = () => { const r = reg.trim(); if (r.length >= 2) lookup.mutate({ registration: r }); };

  const days = data?.motExpiryDate ? Math.ceil((new Date(data.motExpiryDate).getTime() - Date.now()) / 86400000) : null;
  const motTone = days == null ? "border-slate-200 bg-slate-50 text-slate-700"
    : days < 0 ? "border-red-200 bg-red-50 text-red-700"
    : days <= 30 ? "border-amber-200 bg-amber-50 text-amber-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const taxed = /taxed/i.test(data?.taxStatus || "") && !/untaxed|sorn/i.test(data?.taxStatus || "");
  const lastTest = data?.motTests?.[0];

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors">
        <CalendarClock className="w-4 h-4 text-violet-600" /> <span className="hidden lg:inline">MOT Check</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] rounded-xl border border-slate-200 bg-white shadow-xl z-50 p-3">
          <div className="flex items-center gap-2">
            <input ref={inputRef} value={reg}
              onChange={(e) => setReg(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") check(); }}
              placeholder="Enter registration…"
              className="flex-1 h-9 px-2.5 rounded-lg border border-slate-300 font-mono font-semibold tracking-wide uppercase text-[14px] outline-none focus:border-violet-500" />
            <button type="button" onClick={check} disabled={lookup.isPending || reg.trim().length < 2}
              className="h-9 px-3 rounded-lg bg-violet-600 text-white text-[13px] font-medium hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1">
              {lookup.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
            </button>
          </div>

          {lookup.isError && <p className="text-[12px] text-red-600 mt-2">Couldn't find that registration. Check it and try again.</p>}

          {data && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <RegPlate reg={data.registration} />
                <span className="text-[12px] text-slate-600 truncate">{[data.make, data.model].filter(Boolean).join(" ")}</span>
              </div>
              <div className={`rounded-lg border p-2.5 ${motTone}`}>
                <div className="text-[10px] uppercase font-semibold tracking-wide opacity-80 flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> MOT Expiry</div>
                <div className="text-[18px] font-bold leading-tight">{data.motExpiryDate ? fmt(data.motExpiryDate) : "No MOT on record"}</div>
                {days != null && <div className="text-[11px] font-medium">{days < 0 ? `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago` : `${days} day${days === 1 ? "" : "s"} left`}</div>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className={`rounded-lg border p-2.5 ${taxed ? "border-emerald-200 bg-emerald-50" : data?.taxStatus ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Tax</div>
                  <div className="text-[13px] font-semibold text-slate-800">{data.taxStatus || "—"}</div>
                  {data.taxDueDate && <div className="text-[10.5px] text-slate-500">Due {fmt(data.taxDueDate)}</div>}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 flex items-center gap-1"><Gauge className="w-3.5 h-3.5" /> Last MOT</div>
                  <div className="text-[13px] font-semibold text-slate-800">{lastTest ? fmt(lastTest.completedDate) : "—"}</div>
                  {lastTest && <div className="text-[10.5px] text-slate-500">{lastTest.testResult}{lastTest.odometerValue ? ` · ${Number(lastTest.odometerValue).toLocaleString("en-GB")} mi` : ""}</div>}
                </div>
              </div>
              <button type="button" onClick={() => { setOpen(false); setLocation(`/mot-check?reg=${encodeURIComponent(data.registration)}`); }}
                className="w-full text-[12px] text-violet-700 hover:underline pt-0.5">Open full MOT check →</button>
            </div>
          )}

          {!data && !lookup.isPending && !lookup.isError && (
            <p className="text-[11px] text-muted-foreground mt-2">Type a reg and press Enter — see MOT expiry, tax &amp; last test without leaving the page.</p>
          )}
        </div>
      )}
    </div>
  );
}
