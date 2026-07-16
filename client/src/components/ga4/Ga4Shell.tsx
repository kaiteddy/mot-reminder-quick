import { useState } from "react";
import { useLocation } from "wouter";
import { Search, History, Wrench, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import Ga4QuickSearchModal from "./Ga4QuickSearchModal";

// GA4 Classic — the real GA4 desktop chrome, ported from a purpose-built recreation
// that was verified pixel-for-pixel against a live screenshot (graphite gradients,
// beveled nav buttons, real toolbar icon art — see client/src/index.css's
// "Reference-locked shell chrome" block). This is a skin: everything underneath
// (data, forms, saving) is the same modern app.

const ICONS = {
  home: "/ga4-icons/icon-home-final.png",
  calendar: "/ga4-icons/icon-calendar-final.png",
  estimates: "/ga4-icons/icon-estimates-final.png",
  jobSheets: "/ga4-icons/icon-job-sheets-final.png",
  invoices: "/ga4-icons/icon-invoices-final.png",
  vehSales: "/ga4-icons/icon-veh-sales-final.png",
  unpaid: "/ga4-icons/icon-unpaid-final.png",
  archives: "/ga4-icons/icon-archives-final.png",
  customers: "/ga4-icons/icon-customers-final.png",
  vehicles: "/ga4-icons/icon-vehicles-final.png",
  stock: "/ga4-icons/icon-stock-final.png",
  reminders: "/ga4-icons/icon-reminders-final.png",
  admin: "/ga4-icons/icon-admin-final.png",
  signOut: "/ga4-icons/icon-sign-out-final.png",
} as const;

type NavItem = {
  label: string; icon: keyof typeof ICONS;
  href?: string; match?: (loc: string, search: string) => boolean; soon?: boolean;
};

// Order matches the real top nav left-to-right exactly.
const NAV: NavItem[] = [
  { label: "Home", icon: "home", href: "/classic", match: (loc) => loc === "/classic" },
  { label: "Calendar", icon: "calendar", soon: true },
  { label: "Estimates", icon: "estimates", href: "/classic/documents?docType=ES", match: (loc, s) => loc === "/classic/documents" && s.includes("ES") },
  { label: "Job Sheets", icon: "jobSheets", href: "/classic/documents?docType=JS", match: (loc, s) => loc === "/classic/documents" && s.includes("JS") },
  { label: "Invoices", icon: "invoices", href: "/classic/documents?docType=SI", match: (loc, s) => loc === "/classic/documents" && s.includes("SI") },
  { label: "Veh Sales", icon: "vehSales", soon: true },
  { label: "Unpaid", icon: "unpaid", soon: true },
  { label: "Archives", icon: "archives", href: "/classic/documents?docType=all", match: (loc, s) => loc === "/classic/documents" && s.includes("all") },
  { label: "Customers", icon: "customers", href: "/classic/customers", match: (loc) => loc.startsWith("/classic/customers") },
  { label: "Vehicles", icon: "vehicles", href: "/classic/vehicles", match: (loc) => loc.startsWith("/classic/vehicles") || loc.startsWith("/classic/view-vehicle") },
  { label: "Stock", icon: "stock", soon: true },
  { label: "Reminders", icon: "reminders", soon: true },
];

export default function Ga4Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const urlSearch = typeof window !== "undefined" ? window.location.search : "";

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const [path, qs] = href.split("?");
    setLocation(qs ? `${path}?${qs}` : path);
  };
  const soon = (label: string) => (e: React.MouseEvent) => { e.preventDefault(); toast.message(`${label} isn't available in Classic view yet — use Modern view.`); };
  // Real GA4's Quick Search opens a results window (grouped Documents/Vehicles/Customers
  // tables), not a page navigation — see Ga4QuickSearchModal.
  const runSearch = () => { if (search.trim().length >= 2) setQuickSearchOpen(true); };

  return (
    <div className="ga4-theme">
      <div className="app-shell">
        <header className="app-header">
          <nav className="main-toolbar" aria-label="Primary navigation">
            <div className="main-nav-items">
              {NAV.map((item) => {
                const active = !!item.match?.(location, urlSearch);
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`nav-button ${active ? "active" : ""} ${item.soon ? "soon" : ""}`}
                    onClick={item.soon ? soon(item.label) : go(item.href!)}
                    title={item.soon ? `${item.label} (not in Classic view yet)` : item.label}
                  >
                    <img src={ICONS[item.icon]} alt="" className="toolbar-icon-image" />
                    <span>{item.label}</span>
                    {item.label === "Reminders" && <b className="count-badge">0</b>}
                  </button>
                );
              })}
            </div>
            <div className="toolbar-spacer" />
            <button className="nav-button" type="button" onClick={soon("Admin")}>
              <img src={ICONS.admin} alt="" className="toolbar-icon-image" /><span>Admin</span>
            </button>
            <button
              className="nav-button"
              type="button"
              onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }}
            >
              <img src={ICONS.signOut} alt="" className="toolbar-icon-image" /><span>Sign Out</span>
            </button>
          </nav>

          <div className="quick-strip">
            <label className="quick-search">
              <span>Quick Search</span>
              <input
                aria-label="Quick Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
              <button type="button" aria-label="Search" onClick={runSearch}><Search size={14} /></button>
            </label>
            <button type="button" className="bevel-button" onClick={soon("Advanced Search")}><SlidersHorizontal size={13} /> Advanced</button>
            <button type="button" className="bevel-button" onClick={soon("History")}><History size={13} /> History</button>
            <button type="button" className="bevel-button" onClick={soon("Technical Data")}><Wrench size={13} /> Technical Data</button>
            <button type="button" className="bevel-button" onClick={go("/documents")}>Modern view</button>
            <span className="current-user">User: <strong>Admin</strong></span>
          </div>
        </header>

        <div className="app-scroll">{children}</div>
      </div>
      {quickSearchOpen && <Ga4QuickSearchModal query={search} onClose={() => setQuickSearchOpen(false)} />}
    </div>
  );
}
