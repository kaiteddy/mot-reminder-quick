import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, GitMerge, Loader2, Phone } from "lucide-react";
import { toast } from "sonner";

type Member = { id: number; name: string; docs: number; vehicles: number };
type Group = { phone: string; category: "mixed" | "business" | "same-name"; members: Member[]; activity: number };

const CAT: Record<string, { label: string; cls: string }> = {
  mixed: { label: "Different surnames", cls: "bg-amber-100 text-amber-800" },
  business: { label: "Business / catch-all", cls: "bg-blue-100 text-blue-800" },
  "same-name": { label: "Same surname", cls: "bg-green-100 text-green-800" },
};

// One shared-phone group: pick which record to keep, then merge the rest in or mark not-duplicates.
function DupGroup({ group, onMerge, onDismiss, busy }: { group: Group; onMerge: (p: number, s: number[]) => void; onDismiss: (phone: string) => void; busy: boolean }) {
  const [primaryId, setPrimaryId] = useState(group.members[0].id);
  const keep = group.members.find((m) => m.id === primaryId)!;
  const secondaries = group.members.filter((m) => m.id !== primaryId).map((m) => m.id);
  const cat = CAT[group.category] || CAT.mixed;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-sm text-slate-700"><Phone className="w-3.5 h-3.5 text-slate-400" />{group.phone}</span>
          <Badge variant="secondary" className={`text-[10px] ${cat.cls}`}>{cat.label}</Badge>
        </div>
        <div className="space-y-0.5">
          {group.members.map((m) => (
            <label key={m.id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${primaryId === m.id ? "bg-green-50" : "hover:bg-slate-50"}`}>
              <input type="radio" name={`keep-${group.phone}`} checked={primaryId === m.id} onChange={() => setPrimaryId(m.id)} className="accent-green-600" />
              <span className="font-medium text-sm">{m.name}</span>
              <span className="text-[11px] text-muted-foreground">#{m.id} · {m.docs} doc{m.docs === 1 ? "" : "s"} · {m.vehicles} vehicle{m.vehicles === 1 ? "" : "s"}</span>
              {primaryId === m.id && <Badge variant="secondary" className="ml-auto text-[10px] bg-green-100 text-green-800">keep</Badge>}
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" disabled={busy} onClick={() => { if (window.confirm(`Merge ${secondaries.length} record${secondaries.length === 1 ? "" : "s"} into "${keep.name}"? All their jobs, vehicles and history move across.`)) onMerge(primaryId, secondaries); }}>
            <GitMerge className="w-3.5 h-3.5 mr-1" /> Merge into {keep.name}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDismiss(group.phone)}>Not duplicates</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Duplicates() {
  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.customers.duplicates.useQuery(undefined, { staleTime: 30_000, refetchOnMount: "always" });
  const [filter, setFilter] = useState<"all" | "mixed" | "business">("all");
  const refetch = () => utils.customers.duplicates.invalidate();
  const merge = trpc.customers.merge.useMutation({ onSuccess: (r: any) => { toast.success(`Merged into "${r.name}"`); refetch(); }, onError: (e: any) => toast.error(e.message || "Merge failed") });
  const dismiss = trpc.customers.dismissDuplicate.useMutation({ onSuccess: () => { toast.success("Marked as not duplicates"); refetch(); }, onError: (e: any) => toast.error(e.message || "Failed") });
  const busy = merge.isPending || dismiss.isPending;

  const all: Group[] = (groups as any) || [];
  const counts = { all: all.length, mixed: all.filter((g) => g.category !== "business").length, business: all.filter((g) => g.category === "business").length };
  const shown = all.filter((g) => filter === "all" || (filter === "business" ? g.category === "business" : g.category !== "business"));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight flex items-center gap-2"><Users className="w-8 h-8" /> Duplicate Customers</h1>
          <p className="text-muted-foreground mt-2">Customer records that share a phone number. Pick the record to <b>keep</b>, then merge the rest in — or mark them as separate people. The obvious same-surname duplicates were already merged automatically.</p>
        </div>

        <div className="flex gap-2">
          {([["all", "All"], ["mixed", "Needs review"], ["business", "Business / catch-all"]] as const).map(([k, label]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{label} ({counts[k]})</Button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Scanning…</div>
        ) : shown.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground"><Users className="w-12 h-12 mx-auto mb-3 opacity-40" /><p className="font-medium">No duplicates to review 🎉</p><p className="text-sm">Everything in this view is resolved.</p></CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {shown.map((g) => <DupGroup key={g.phone} group={g} busy={busy} onMerge={(p, s) => merge.mutate({ primaryId: p, secondaryIds: s })} onDismiss={(phone) => dismiss.mutate({ phone })} />)}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
