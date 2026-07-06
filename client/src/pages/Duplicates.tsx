import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, GitMerge, Loader2, Phone, CheckCircle2, HelpCircle } from "lucide-react";
import { toast } from "sonner";

type Member = { id: number; name: string; acct?: string | null; docs: number; vehicles: number; cluster: number };
type Group = { phone: string; members: Member[]; suggestedIds: number[]; activity: number };

// One shared-phone group. Tick the records that are the SAME person (likely matches pre-ticked),
// then merge them — the one with the most history is kept. Untick anyone who's actually different.
function DupGroup({ group, onMerge, onDismiss, busy }: { group: Group; onMerge: (keep: number, others: number[]) => void; onDismiss: (phone: string) => void; busy: boolean }) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(group.suggestedIds));
  const toggle = (id: number) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const checkedMembers = group.members.filter((m) => checked.has(m.id)); // server-sorted by history desc
  const keep = checkedMembers[0];
  // Mirror the server guard: ticked records with DIFFERENT GA4 account numbers are distinct
  // accounts and must not be merged (the server rejects it too — this just blocks it earlier).
  const checkedAccts = Array.from(new Set(checkedMembers.map((m) => String(m.acct || "").trim().toUpperCase()).filter(Boolean)));
  const acctConflict = checkedAccts.length > 1;
  const canMerge = checked.size >= 2 && !!keep && !acctConflict;
  const hasSug = group.suggestedIds.length >= 2;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (!confirming) return; const t = setTimeout(() => setConfirming(false), 6000); return () => clearTimeout(t); }, [confirming]);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-sm text-slate-700"><Phone className="w-3.5 h-3.5 text-slate-400" />{group.phone}</span>
          {hasSug
            ? <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-800 gap-1"><CheckCircle2 className="w-3 h-3" />Likely the same person</Badge>
            : <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 gap-1"><HelpCircle className="w-3 h-3" />Possibly different people</Badge>}
        </div>
        <div className="space-y-0.5">
          {group.members.map((m) => {
            const on = checked.has(m.id);
            const isKeep = on && keep?.id === m.id;
            return (
              <label key={m.id} className={`flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer border ${on ? "bg-green-50 border-green-200" : "border-transparent hover:bg-slate-50"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(m.id)} className="accent-green-600 w-4 h-4 shrink-0" />
                <span className="font-medium text-sm truncate">{m.name}</span>
                {m.acct && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0" title="GA4 account number">{m.acct}</span>}
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">#{m.id} · {m.docs} job{m.docs === 1 ? "" : "s"} · {m.vehicles} vehicle{m.vehicles === 1 ? "" : "s"}</span>
                {isKeep && <Badge variant="secondary" className="ml-auto text-[10px] bg-green-600 text-white shrink-0">★ keep this one</Badge>}
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {!confirming ? (
            <Button size="sm" disabled={!canMerge || busy} onClick={() => setConfirming(true)}>
              <GitMerge className="w-3.5 h-3.5 mr-1" /> Merge {checked.size} selected
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={busy} className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => { setConfirming(false); onMerge(keep!.id, checkedMembers.slice(1).map((m) => m.id)); }}>
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <GitMerge className="w-3.5 h-3.5 mr-1" />}
                Confirm — merge into {keep!.name}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            </>
          )}
          {!confirming && acctConflict && <span className="text-[11px] text-red-600 font-medium">Different GA4 accounts ({checkedAccts.join(" ≠ ")}) — these are separate customers, can't merge</span>}
          {!confirming && canMerge && <span className="text-[11px] text-muted-foreground">keeps <b className="text-slate-700">{keep!.name}</b> · others moved across</span>}
          {!confirming && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(group.phone)} className="ml-auto text-muted-foreground">Not duplicates — hide</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Duplicates() {
  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.customers.duplicates.useQuery(undefined, { staleTime: 30_000, refetchOnMount: "always" });
  const [filter, setFilter] = useState<"likely" | "review" | "all">("likely");
  const refetch = () => utils.customers.duplicates.invalidate();
  const merge = trpc.customers.merge.useMutation({ onSuccess: (r: any) => { toast.success(`Merged into "${r.name}"`); refetch(); }, onError: (e: any) => toast.error(e.message || "Merge failed") });
  const dismiss = trpc.customers.dismissDuplicate.useMutation({ onSuccess: () => { toast.success("Hidden — marked as separate people"); refetch(); }, onError: (e: any) => toast.error(e.message || "Failed") });
  const busy = merge.isPending || dismiss.isPending;

  const all: Group[] = (groups as any) || [];
  const likely = all.filter((g) => g.suggestedIds.length >= 2);
  const review = all.filter((g) => g.suggestedIds.length < 2);
  const shown = filter === "all" ? all : filter === "likely" ? likely : review;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-4xl font-bold tracking-tight flex items-center gap-2"><Users className="w-8 h-8" /> Duplicate Customers</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl">These customers share a phone number. Some are the <b>same person</b> entered twice (often a misspelled name); others are <b>different people</b> on one line — a family or a business. <span className="text-green-700 font-medium">We've pre-ticked the records that look like a match.</span> Check the ticks are right, then <b>Merge</b> — or hit <b>Not duplicates</b> to hide a group.</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {([["likely", "✓ Likely matches", likely.length], ["review", "Needs a look", review.length], ["all", "All", all.length]] as const).map(([k, label, n]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k as any)}>{label} ({n})</Button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Scanning customers…</div>
        ) : shown.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground"><CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500/60" /><p className="font-medium">Nothing here to review 🎉</p><p className="text-sm">{filter === "likely" ? "No likely duplicates left — nice work." : "All clear in this view."}</p></CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {shown.map((g) => <DupGroup key={g.phone} group={g} busy={busy} onMerge={(keep, others) => merge.mutate({ primaryId: keep, secondaryIds: others })} onDismiss={(phone) => dismiss.mutate({ phone })} />)}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
