import { useState } from "react";
import { useLocation } from "wouter";
import { Home, CalendarDays, FileSpreadsheet, ClipboardList, FileText, Car, Users, CarFront, Boxes, Bell, ShieldQuestion, LayoutGrid, Search } from "lucide-react";
import { toast } from "sonner";

// GA4 Classic — a chrome that reproduces the real Garage Assistant GA4 desktop app's
// navigation (see memory: ga4-system-map + a live screenshot of the real Home screen),
// so a long-time GA4 user finds everything in the same place. Everything underneath
// (data, forms, saving) is the same modern app — this is a skin, not a rebuild.

type NavItem = {
  label: string; icon: any; mod: string;
  href?: string; match?: (loc: string, search: string) => boolean; soon?: boolean;
};

// Order matches the real top nav left-to-right exactly.
const NAV: NavItem[] = [
  { label: "Home", icon: Home, mod: "ga4-mod-home", href: "/classic", match: (loc) => loc === "/classic" },
  { label: "Calendar", icon: CalendarDays, mod: "ga4-mod-calendar", soon: true },
  { label: "Estimates", icon: FileSpreadsheet, mod: "ga4-mod-estimates", href: "/classic/documents?docType=ES", match: (loc, s) => loc === "/classic/documents" && s.includes("ES") },
  { label: "Job Sheets", icon: ClipboardList, mod: "ga4-mod-jobsheets", href: "/classic/documents?docType=JS", match: (loc, s) => loc === "/classic/documents" && s.includes("JS") },
  { label: "Invoices", icon: FileText, mod: "ga4-mod-invoices", href: "/classic/documents?docType=SI", match: (loc, s) => loc === "/classic/documents" && s.includes("SI") },
  { label: "Veh Sales", icon: Car, mod: "ga4-mod-vehsales", soon: true },
  { label: "Unpaid", icon: FileText, mod: "ga4-mod-unpaid", soon: true },
  { label: "Archives", icon: Boxes, mod: "ga4-mod-archives", href: "/classic/documents?docType=all", match: (loc, s) => loc === "/classic/documents" && s.includes("all") },
  { label: "Customers", icon: Users, mod: "ga4-mod-customers", href: "/classic/customers", match: (loc) => loc.startsWith("/classic/customers") },
  { label: "Vehicles", icon: CarFront, mod: "ga4-mod-vehicles", href: "/classic/vehicles", match: (loc) => loc.startsWith("/classic/vehicles") || loc.startsWith("/classic/view-vehicle") },
  { label: "Stock", icon: Boxes, mod: "ga4-mod-stock", soon: true },
  { label: "Reminders", icon: Bell, mod: "ga4-mod-reminders", soon: true },
];

export default function Ga4Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const urlSearch = typeof window !== "undefined" ? window.location.search : "";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const [path, qs] = href.split("?");
    setLocation(qs ? `${path}?${qs}` : path);
  };
  const soon = (label: string) => (e: React.MouseEvent) => { e.preventDefault(); toast.message(`${label} isn't available in Classic view yet — use Modern view.`); };
  const runSearch = () => { if (search.trim()) setLocation(`/classic/documents?docType=all&search=${encodeURIComponent(search.trim())}`); };

  return (
    <div className="ga4-theme min-h-screen flex flex-col" style={{ background: "var(--background)" }}>
      {/* title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 text-white" style={{ background: "#2b2f36" }}>
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 opacity-80" />
          <span className="text-[13px] font-semibold tracking-tight">Garage Assistant GA4</span>
          <span className="text-[11px] opacity-50">— ELI Motors Limited</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] opacity-80">
          <button type="button" onClick={go("/documents")} className="hover:underline">Modern view</button>
          <span className="opacity-40">|</span>
          <button type="button" onClick={soon("Admin")} className="hover:underline">Admin</button>
          <span className="opacity-40">|</span>
          <button
            type="button"
            onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }}
            className="hover:underline"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* top nav — colour-coded modules, matching the real GA4 nav bar order exactly */}
      <div className="flex items-stretch border-b overflow-x-auto" style={{ background: "#e4e1da", borderColor: "#a8a8a8" }}>
        {NAV.map((item) => {
          const active = !!item.match?.(location, urlSearch);
          return (
            <a
              key={item.label}
              href={item.href || "#"}
              onClick={item.soon ? soon(item.label) : go(item.href!)}
              title={item.soon ? `${item.label} (not in Classic view yet)` : item.label}
              className={`${item.mod} flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] font-medium border-r select-none shrink-0 ${item.soon ? "opacity-60" : ""}`}
              style={{
                borderColor: "#c3c0b8",
                color: active ? "#fff" : "#2b2b2b",
                background: active ? "var(--ga4-accent)" : "transparent",
              }}
            >
              <item.icon className="w-4 h-4" style={{ color: active ? "#fff" : "var(--ga4-accent)" }} />
              {item.label}
            </a>
          );
        })}
      </div>

      {/* quick-search sub-toolbar, matching the real GA4 sub-nav row */}
      <div className="flex items-center gap-4 px-3 py-1 border-b text-[11.5px]" style={{ background: "#f2f0ea", borderColor: "#c3c0b8" }}>
        <div className="flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Quick Search"
            className="h-[20px] w-48 border border-slate-400 bg-white px-1.5 text-[11.5px] outline-none focus:border-blue-500"
          />
        </div>
        <button type="button" onClick={soon("Advanced Search")} className="text-slate-700 hover:underline">Advanced</button>
        <button type="button" onClick={soon("History")} className="text-slate-700 hover:underline">History</button>
        <button type="button" onClick={soon("Technical Data")} className="text-slate-700 hover:underline">Technical Data</button>
      </div>

      {/* content */}
      <div className="flex-1 overflow-y-auto">{children}</div>

      {/* status bar */}
      <div className="flex items-center justify-between px-3 py-1 text-[11px]" style={{ background: "#dedad2", borderTop: "1px solid #b7b2a6", color: "#4a4a4a" }}>
        <span>Browse</span>
        <span>{dateStr} · {timeStr}</span>
      </div>
    </div>
  );
}
