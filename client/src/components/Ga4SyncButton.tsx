import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

function agoFromSecs(secs?: number | null): string {
  if (secs == null) return "—";
  if (secs < 90) return "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// "Sync GA4" — force a pull from GA4 on demand. The web app can't reach the local GA4 VM,
// so this drops a request in the DB; a local watcher (launchd) runs the sync and writes back status.
export default function Ga4SyncButton() {
  const utils = trpc.useUtils();
  const status = trpc.ga4.syncStatus.useQuery(undefined, {
    refetchInterval: (query: any) => {
      const st = query?.state?.data?.status;
      return st === "running" || st === "requested" ? 4000 : 90000;
    },
  });
  const req = trpc.ga4.requestSync.useMutation({
    onSuccess: () => {
      utils.ga4.syncStatus.invalidate();
      toast.success("Sync requested — pulling the latest from GA4 (about a minute)…");
    },
    onError: (e) => toast.error(e.message),
  });

  const s: any = status.data || {};
  const busy = s.status === "running" || s.status === "requested" || req.isPending;
  const ago = agoFromSecs(s.lastInsertSecs);
  const title = busy
    ? "GA4 sync in progress…"
    : `Latest GA4 document synced ${ago}${s.total ? ` · ${s.total.toLocaleString()} docs` : ""}. Click to force a sync now.`;

  return (
    <button
      type="button"
      onClick={() => req.mutate()}
      disabled={busy}
      title={title}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin text-blue-600" : "text-muted-foreground"}`} />
      <span className="hidden md:inline">{busy ? "Syncing…" : "Sync GA4"}</span>
      <span className="hidden xl:inline text-[11px] text-muted-foreground/70">· {ago}</span>
    </button>
  );
}
