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
  Upload,
  Car,
  UserCheck,
  Search,
  FileText,
  Settings,
  ShieldCheck,
  Smartphone
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { UnreadMessageBadge } from "./UnreadMessageBadge";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Smartphone, label: "Test WhatsApp", path: "/test-whatsapp" },
  { icon: ShieldCheck, label: "System Status", path: "/system-status" },
  { icon: Search, label: "MOT Check", path: "/mot-check" },
  { icon: AlertCircle, label: "Follow-up Actions", path: "/follow-up" },
  { icon: Archive, label: "Reminder Archive", path: "/archive" },
  { icon: MessageSquare, label: "Conversations", path: "/conversations" },
  { icon: FileText, label: "Logs & Messages", path: "/logs" },
  { icon: Users, label: "Customers", path: "/customers" },
  { icon: Car, label: "Vehicles", path: "/vehicles" },
  { icon: Upload, label: "Import Data", path: "/import" },
  { icon: DatabaseIcon, label: "Database", path: "/database" },
];

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
  const [location] = useLocation();
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
                className="h-8 w-8 rounded-lg object-cover shadow-sm"
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 w-full animate-in fade-in slide-in-from-left-4 duration-300">
              <img
                src={APP_LOGO}
                alt={APP_TITLE}
                className="h-10 w-10 rounded-xl object-cover shadow-md"
              />
              <span className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/70">
                {APP_TITLE}
              </span>
            </div>
          )}
        </SidebarHeader>

        <SidebarContent className="px-2">
          <SidebarMenu>
            {menuItems.map((item: any) => {
              const isActive = location === item.path;
              return (
                <SidebarMenuItem key={item.path} className="mb-1">
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

          <div className="flex items-center gap-4">
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
