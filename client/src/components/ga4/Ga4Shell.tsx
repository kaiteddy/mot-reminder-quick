import { useLocation } from "wouter";
import { Home, Wrench, Receipt, FileSpreadsheet, Users, Car, LayoutGrid } from "lucide-react";

// GA4 Classic — a chrome that reproduces the real Garage Assistant GA4 desktop app's
// navigation (see memory: ga4-system-map), so a long-time GA4 user finds everything in
// the same place. Everything underneath (data, forms, saving) is the same modern app —
// this is a skin, not a rebuild.

type NavItem = { label: string; icon: any; href: string; mod: string; match: (loc: string, search: string) => boolean };

const NAV: NavItem[] = [
  { label: "Home", icon: Home, href: "/classic", mod: "ga4-mod-home", match: (loc) => loc === "/classic" },
  { label: "Job Sheets", icon: Wrench, href: "/classic/documents?docType=JS", mod: "ga4-mod-jobsheets", match: (loc, s) => loc === "/classic/documents" && s.includes("JS") },
  { label: "Invoices", icon: Receipt, href: "/classic/documents?docType=SI", mod: "ga4-mod-invoices", match: (loc, s) => loc === "/classic/documents" && s.includes("SI") },
  { label: "Estimates", icon: FileSpreadsheet, href: "/classic/documents?docType=ES", mod: "ga4-mod-estimates", match: (loc, s) => loc === "/classic/documents" && s.includes("ES") },
  { label: "Customers", icon: Users, href: "/classic/customers", mod: "ga4-mod-customers", match: (loc) => loc.startsWith("/classic/customers") },
  { label: "Vehicles", icon: Car, href: "/classic/vehicles", mod: "ga4-mod-vehicles", match: (loc) => loc.startsWith("/classic/vehicles") || loc.startsWith("/classic/view-vehicle") },
];

export default function Ga4Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const [path, qs] = href.split("?");
    setLocation(qs ? `${path}?${qs}` : path);
  };

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
          <button
            type="button"
            onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }}
            className="hover:underline"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* top nav — colour-coded modules, matching the real GA4 nav bar */}
      <div className="flex items-stretch border-b" style={{ background: "#e4e1da", borderColor: "#a8a8a8" }}>
        {NAV.map((item) => {
          const active = item.match(location, search);
          return (
            <a
              key={item.label}
              href={item.href}
              onClick={go(item.href)}
              className={`${item.mod} flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 text-[11px] font-medium border-r select-none`}
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
