import { useState } from "react";
import { useLocation } from "wouter";
import {
  Home, CalendarDays, FileSpreadsheet, ClipboardList, FileText, CarFront,
  Coins, Archive, Users, Warehouse, AlarmClock, LayoutGrid, Search, History, Wrench,
} from "lucide-react";
import { toast } from "sonner";

// GA4 Classic — a chrome that reproduces the real Garage Assistant GA4 desktop app's
// navigation (dark charcoal nav/toolbars, white icon tiles, colour-coded panel headers),
// so a long-time GA4 user finds everything in the same place. Sampled directly off the
// live Home screen. Everything underneath (data, forms, saving) is the same modern app —
// this is a skin, not a rebuild.

type NavItem = {
  label: string; icon: any; iconColor: string; mod: string;
  href?: string; match?: (loc: string, search: string) => boolean; soon?: boolean;
};

// Order + icon colours match the real top nav left-to-right exactly.
const NAV: NavItem[] = [
  { label: "Home", icon: Home, iconColor: "#2563eb", mod: "ga4-mod-home", href: "/classic", match: (loc) => loc === "/classic" },
  { label: "Calendar", icon: CalendarDays, iconColor: "#dc2626", mod: "ga4-mod-calendar", soon: true },
  { label: "Estimates", icon: FileSpreadsheet, iconColor: "#0d9488", mod: "ga4-mod-estimates", href: "/classic/documents?docType=ES", match: (loc, s) => loc === "/classic/documents" && s.includes("ES") },
  { label: "Job Sheets", icon: ClipboardList, iconColor: "#7c3aed", mod: "ga4-mod-jobsheets", href: "/classic/documents?docType=JS", match: (loc, s) => loc === "/classic/documents" && s.includes("JS") },
  { label: "Invoices", icon: FileText, iconColor: "#2563eb", mod: "ga4-mod-invoices", href: "/classic/documents?docType=SI", match: (loc, s) => loc === "/classic/documents" && s.includes("SI") },
  { label: "Veh Sales", icon: CarFront, iconColor: "#dc2626", mod: "ga4-mod-vehsales", soon: true },
  { label: "Unpaid", icon: Coins, iconColor: "#ca8a04", mod: "ga4-mod-unpaid", soon: true },
  { label: "Archives", icon: Archive, iconColor: "#2563eb", mod: "ga4-mod-archives", href: "/classic/documents?docType=all", match: (loc, s) => loc === "/classic/documents" && s.includes("all") },
  { label: "Customers", icon: Users, iconColor: "#db2777", mod: "ga4-mod-customers", href: "/classic/customers", match: (loc) => loc.startsWith("/classic/customers") },
  { label: "Vehicles", icon: CarFront, iconColor: "#2563eb", mod: "ga4-mod-vehicles", href: "/classic/vehicles", match: (loc) => loc.startsWith("/classic/vehicles") || loc.startsWith("/classic/view-vehicle") },
  { label: "Stock", icon: Warehouse, iconColor: "#c2410c", mod: "ga4-mod-stock", soon: true },
  { label: "Reminders", icon: AlarmClock, iconColor: "#2563eb", mod: "ga4-mod-reminders", soon: true, badge: "59" } as any,
];

// White rounded "app icon" tile matching GA4's icon style, instead of a bare line icon.
function IconTile({ icon: Icon, color, badge }: { icon: any; color: string; badge?: string }) {
  return (
    <span className="relative inline-flex items-center justify-center w-[26px] h-[26px] rounded-[6px] bg-white shadow-sm">
      <Icon className="w-4 h-4" style={{ color }} />
      {badge && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-slate-300 text-slate-800 text-[9px] font-bold flex items-center justify-center leading-none">
          {badge}
        </span>
      )}
    </span>
  );
}

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

      {/* top nav — dark charcoal bar, white icon tiles, matching the real GA4 nav exactly */}
      <div className="flex items-stretch overflow-x-auto" style={{ background: "#4b4a47" }}>
        {NAV.map((item: any) => {
          const active = !!item.match?.(location, urlSearch);
          return (
            <a
              key={item.label}
              href={item.href || "#"}
              onClick={item.soon ? soon(item.label) : go(item.href!)}
              title={item.soon ? `${item.label} (not in Classic view yet)` : item.label}
              className={`flex flex-col items-center justify-center gap-1 px-3 py-2 text-[11px] font-medium select-none shrink-0 ${item.soon ? "opacity-70" : ""}`}
              style={{ background: active ? "rgba(255,255,255,0.12)" : "transparent", color: "#fff" }}
            >
              <IconTile icon={item.icon} color={item.iconColor} badge={item.badge} />
              {item.label}
            </a>
          );
        })}
      </div>

      {/* quick-search sub-toolbar, matching the real GA4 sub-nav row */}
      <div className="flex items-center gap-2.5 px-3 py-1.5" style={{ background: "#3f3e3b" }}>
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Quick Search"
            className="h-[22px] w-52 rounded-sm border border-white/10 bg-[#2f2e2c] pl-2 pr-6 text-[11.5px] text-white placeholder:text-white/40 placeholder:italic outline-none focus:border-white/40"
          />
          <Search className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/50" />
        </div>
        <button type="button" onClick={soon("Advanced Search")} className="h-[22px] px-2.5 rounded-sm border border-white/10 bg-[#57554f] text-white text-[11px] hover:bg-[#605e57]">Advanced</button>
        <button type="button" onClick={soon("History")} className="h-[22px] px-2.5 rounded-sm border border-white/10 bg-[#57554f] text-white text-[11px] hover:bg-[#605e57] inline-flex items-center gap-1"><History className="w-3 h-3" />History</button>
        <button type="button" onClick={soon("Technical Data")} className="h-[22px] px-2.5 rounded-sm border border-white/10 bg-[#57554f] text-white text-[11px] hover:bg-[#605e57] inline-flex items-center gap-1"><Wrench className="w-3 h-3" />Technical Data</button>
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
