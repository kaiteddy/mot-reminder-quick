import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The login gate for every routed page that isn't wrapped in DashboardLayout.
 *
 * Those pages — the workshop phone screens, the mobile job summary, a few admin tools — are
 * deliberately outside the desktop sidebar shell, and so were never behind DashboardLayout's
 * auth guard either. That stopped being cosmetic the moment the API behind them required a
 * session: without this they render a working-looking screen on which every button quietly
 * fails.
 *
 * Carries `next` for the same reason the dashboard does: a mechanic who opened a job sheet link
 * should land back on that job sheet after signing in, not on the home page.
 */
export function RequireLogin({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    if (window.location.pathname !== "/login") {
      const next = window.location.pathname + window.location.search;
      window.location.href = `/login?next=${encodeURIComponent(next)}`;
    }
    return null;
  }

  return <>{children}</>;
}
