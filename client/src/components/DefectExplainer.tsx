import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles, Loader2, Copy, Check, Wrench, AlertTriangle, Car, ClipboardList, MessageSquareText } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Shared "Explain this defect" button + popover, used everywhere MOT defects/advisories are
 * listed (MOT check pages, the vehicle's MOT history tab, the job sheet's MOT Advisories tab).
 *
 * Fetches a structured plain-English explanation from ai.explainDefect: what the part does,
 * what the tester found, how it affects the car, what needs doing, an honest urgency, and a
 * ready-to-send customer paragraph. Server-side cache means a given DVSA wording is generated
 * once ever — repeat opens are instant.
 */

const URGENCY: Record<string, { label: string; cls: string }> = {
  monitor: { label: "Keep an eye on it", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  plan: { label: "Plan the repair", cls: "bg-sky-100 text-sky-800 border-sky-200" },
  soon: { label: "Book in soon", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  urgent: { label: "Urgent — safety", cls: "bg-red-100 text-red-800 border-red-200" },
};

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
        <Icon className="w-3 h-3" /> {title}
      </h5>
      <p className="text-[13px] leading-snug text-slate-700">{children}</p>
    </div>
  );
}

export function DefectExplainButton({ defectText, defectType, isDangerous }: {
  defectText: string;
  defectType?: string;
  isDangerous?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const explain = trpc.ai.explainDefect.useMutation();

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && !explain.data && !explain.isPending) {
      explain.mutate({ defect: defectText, type: isDangerous ? "DANGEROUS" : defectType });
    }
  };

  const d: any = explain.data;
  const urgency = d ? URGENCY[d.urgency] || URGENCY.plan : null;

  const copyScript = async () => {
    if (!d?.customerScript) return;
    try {
      await navigator.clipboard.writeText(d.customerScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Copied — ready to paste into a message to the customer");
    } catch {
      toast.error("Couldn't copy — select the text and copy it manually");
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`ml-auto shrink-0 flex items-center justify-center p-1.5 rounded-full transition-colors opacity-70 hover:opacity-100 ${isDangerous ? "hover:bg-red-700 text-white" : "hover:bg-black/5 text-slate-500 hover:text-slate-800"}`}
          title="Explain this in plain English"
        >
          <Sparkles className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,400px)] p-0 z-[100]" align="end">
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-3 text-sm">
          {explain.isPending ? (
            <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
              <p className="text-xs">Translating to plain English…</p>
            </div>
          ) : explain.isError ? (
            <div className="py-2 space-y-2">
              <p className="text-destructive text-xs">Couldn't get an explanation.</p>
              <button type="button" onClick={() => explain.mutate({ defect: defectText, type: isDangerous ? "DANGEROUS" : defectType })}
                className="text-xs text-violet-700 hover:underline">Try again</button>
            </div>
          ) : d ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-[15px] leading-tight">{d.partName}</h4>
                {urgency && (
                  <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${urgency.cls}`}>{urgency.label}</span>
                )}
              </div>
              {d.urgencyNote && <p className="text-[12px] text-slate-500 italic -mt-1.5">{d.urgencyNote}</p>}

              <div className="space-y-2.5 border-t pt-2.5">
                <Section icon={Car} title="What this part does">{d.whatItDoes}</Section>
                <Section icon={AlertTriangle} title="What the tester found">{d.whatsWrong}</Section>
                <Section icon={ClipboardList} title="How it affects the car">{d.effectOnCar}</Section>
                <Section icon={Wrench} title="What needs doing">{d.whatNeedsDoing}</Section>
              </div>

              <div className="border rounded-md bg-violet-50/60 border-violet-200 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <h5 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                    <MessageSquareText className="w-3 h-3" /> Tell the customer
                  </h5>
                  <button type="button" onClick={copyScript}
                    className="flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900">
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="text-[13px] leading-snug text-slate-800">{d.customerScript}</p>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-xs py-2">Loading…</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
