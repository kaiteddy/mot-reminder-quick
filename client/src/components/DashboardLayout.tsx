import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { APP_LOGO, APP_TITLE, getLoginRoute } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Users,
  Archive,
  AlertCircle,
  MessageSquare,
  Database as DatabaseIcon,
  Car,
  UserCheck,
  Search,
  FileText,
  FileSpreadsheet,
  Mail,
  Settings,
  ShieldCheck,
  Smartphone,
  BarChart,
  ScanLine,
  History,
  Calendar as CalendarIcon,
  Wrench,
  Brain,
  PoundSterling,
  Tag,
  GitMerge,
  ShieldAlert,
  Package
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { UnreadMessageBadge } from "./UnreadMessageBadge";
import UniversalSearch from "./UniversalSearch";
import QuickMOTCheck from "./QuickMOTCheck";
import Ga4SyncButton from "./Ga4SyncButton";

const menuGroups = [
  { section: "Workshop", items: [
    { icon: FileText, label: "Live Jobs", path: "/documents" },
    { icon: Search, label: "MOT Check", path: "/mot-check" },
    { icon: LayoutDashboard, label: "MOT Reminders", path: "/" },
    { icon: ScanLine, label: "GA4 Scanner", path: "/ga4-scan" },
    { icon: PoundSterling, label: "Repair Pricing", path: "/repair-pricing" },
    { icon: Package, label: "Parts Price List", path: "/parts-price-list" },
    { icon: CalendarIcon, label: "Calendar", path: "/appointments" },
    { icon: ShieldCheck, label: "Technical Hub", path: "/technical-hub" },
    { icon: Wrench, label: "Technical Data", path: "/technical-data" },
  ] },
  { section: "Reminders & Messaging", items: [
    { icon: MessageSquare, label: "Conversations", path: "/conversations" },
    { icon: ShieldAlert, label: "Urgent Follow Ups", path: "/urgent-follow-ups" },
    { icon: History, label: "Sent Reminders", path: "/reminders-sent" },
    { icon: FileText, label: "Logs & Messages", path: "/logs" },
    { icon: Smartphone, label: "Test WhatsApp", path: "/test-whatsapp" },
  ] },
  { section: "Customers & Vehicles", items: [
    { icon: Users, label: "Customers", path: "/customers" },
    { icon: Car, label: "Vehicles", path: "/vehicles" },
    { icon: GitMerge, label: "Duplicates", path: "/duplicates" },
  ] },
  { section: "Sales", items: [
    { icon: Tag, label: "Sales Stock", path: "/sales-stock" },
    { icon: Brain, label: "Pricing AI", path: "/pricing-intelligence" },
  ] },
  { section: "Insights", items: [
    { icon: BarChart, label: "Analytics", path: "/analytics" },
    { icon: FileText, label: "Reports", path: "/reports" },
    { icon: FileSpreadsheet, label: "Accounts Export", path: "/accounts-export" },
  ] },
  { section: "Finance", items: [
    { icon: PoundSterling, label: "Profit & Cashbook", path: "/reconciliation" },
  ] },
  { section: "System", items: [
    { icon: ShieldCheck, label: "System Status", path: "/system-status" },
    { icon: Mail, label: "Email Settings", path: "/email-settings" },
  ] },
];
const menuItems = menuGroups.flatMap((g) => g.items); // flat list for active-item / page-title lookup

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    // Redirect to login if not authenticated
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    return null;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
}) {
  const [location, setLocation] = useLocation();
  // Flip to the touch-friendly workshop view — carry the registration when we're on a vehicle page.
  const workshopHref = (() => { const m = location.match(/^\/(?:view-vehicle|v)\/([^/]+)/); return m ? `/workshop?reg=${encodeURIComponent(decodeURIComponent(m[1]))}` : "/workshop"; })();
  const { isMobile, state: sidebarState } = useSidebar();
  const isCollapsed = sidebarState === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find((item: any) => item.path === location) || menuItems[0];
  const isMobileView = useIsMobile();

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.min(Math.max(e.clientX, MIN_WIDTH), MAX_WIDTH);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <div className="flex min-h-screen w-full bg-background overflow-hidden">
      <Sidebar collapsible="icon" className="border-r border-border/50 shadow-sm transition-all duration-300">
        <SidebarHeader className="h-16 flex items-center px-4 border-b border-border/40 mb-2">
          {isCollapsed ? (
            <div className="flex items-center justify-center w-full">
              <img
                src={APP_LOGO}
                alt={APP_TITLE}
                className="h-8 w-8 object-contain"
              />
            </div>
          ) : (
            <div className="flex items-center w-full animate-in fade-in slide-in-from-left-4 duration-300">
              <img
                src={APP_LOGO}
                alt={APP_TITLE}
                className="h-11 w-auto max-w-full object-contain"
              />
            </div>
          )}
        </SidebarHeader>

        <SidebarContent className="px-2">
          {menuGroups.map((group) => (
            <div key={group.section} className="mb-1">
              {!isCollapsed && group.section && (
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {group.section}
                </div>
              )}
              <SidebarMenu>
                {group.items.map((item: any) => {
                  const isActive = location === item.path;
                  return (
                    <SidebarMenuItem key={item.path} className="mb-0.5">
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.label}
                        className={`
                          transition-all hover:scale-[1.02] active:scale-95
                          ${isActive ? 'bg-primary/10 text-primary font-semibold shadow-sm' : 'hover:bg-accent/50'}
                        `}
                      >
                        <a
                          href={item.path}
                          className="flex items-center gap-3 px-3 py-2 w-full"
                        >
                          <item.icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                          <span className={`${isCollapsed ? 'hidden' : 'block'} transition-opacity`}>{item.label}</span>
                          {item.path === "/conversations" && !isCollapsed && (
                            <div className="ml-auto">
                              <UnreadMessageBadge />
                            </div>
                          )}
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </div>
          ))}
        </SidebarContent>

        <SidebarFooter className="p-4 border-t border-border/40 bg-accent/5 mt-auto">
          {!isCollapsed && (
            <div className="mb-4">
              <div className="flex items-center gap-3 p-3 bg-white/50 dark:bg-slate-800/50 rounded-xl border border-border/40 shadow-sm">
                <Avatar className="h-10 w-10 border-2 border-primary/20 shadow-sm">
                  <AvatarFallback className="bg-primary/5 text-primary text-xs font-bold uppercase">
                    US
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="text-sm font-bold truncate">User Account</span>
                  <span className="text-[10px] text-muted-foreground truncate uppercase tracking-widest font-semibold flex items-center gap-1">
                    <UserCheck className="h-2 w-2" /> Verified
                  </span>
                </div>
              </div>
            </div>
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    className={`
                      w-full transition-all active:scale-95
                      ${isCollapsed ? 'justify-center p-0' : 'justify-start gap-3 p-3'}
                      hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 group
                    `}
                  >
                    <LogOut className={`h-5 w-5 shrink-0 text-muted-foreground group-hover:text-red-500`} />
                    <span className={`${isCollapsed ? 'hidden' : 'block'}`}>Sign Out</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1">
                  <DropdownMenuItem
                    className="flex items-center gap-2 p-3 text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer rounded-lg"
                    onClick={async () => {
                      await fetch("/api/auth/logout", { method: "POST" });
                      window.location.reload();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="font-semibold">Confirm Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {!isMobileView && (
        <div
          onMouseDown={() => setIsResizing(true)}
          className={`
            w-1 cursor-col-resize hover:bg-primary/30 transition-colors
            ${isResizing ? "bg-primary/50" : "bg-transparent"}
          `}
        />
      )}

      <SidebarInset className="flex flex-col flex-1 overflow-hidden relative">
        <header className="h-16 flex items-center justify-between px-6 bg-background/80 backdrop-blur-md border-b border-border/40 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger className="h-9 w-9 hover:bg-accent/50 transition-colors" />
            <div className="h-4 w-[1px] bg-border/60 mx-1 hidden sm:block" />
            <div className="flex flex-col">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 leading-tight">
                Current View
              </span>
              <h2 className="text-sm font-bold text-foreground">
                {activeMenuItem.label}
              </h2>
            </div>
          </div>

          {/* Global search — available on every page */}
          <div className="flex-1 max-w-xl mx-4 hidden sm:block">
            <UniversalSearch placeholder="Search any customer, vehicle, reg, make/model, phone…" />
          </div>

          <div className="flex items-center gap-4">
            <Ga4SyncButton />
            <button type="button" onClick={() => setLocation(workshopHref)} title="Flip to the workshop (mechanic) view"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-amber-300 bg-amber-50 text-[13px] font-medium text-amber-800 hover:bg-amber-100 transition-colors">
              <Wrench className="w-4 h-4" /> <span className="hidden lg:inline">Workshop</span>
            </button>
            <QuickMOTCheck />
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs font-bold text-foreground leading-tight">Welcome back</span>
              <span className="text-[10px] text-muted-foreground/70 font-medium">System Administrator</span>
            </div>
            <Avatar className="h-9 w-9 border-2 border-accent transition-transform hover:scale-105 cursor-pointer">
              <AvatarFallback className="bg-accent text-accent-foreground text-xs font-bold">AD</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10 scroll-smooth">
          <div className="max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </main>
      </SidebarInset>
    </div>
  );
}
