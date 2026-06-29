import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";

// Routes are code-split: each page ships as its own chunk loaded on demand, so the first paint
// no longer downloads the entire app. Login/NotFound stay eager (entry + fallback).
const Home = lazy(() => import("./pages/Home"));
const MOTCheck = lazy(() => import("./pages/MOTCheck"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetails = lazy(() => import("./pages/CustomerDetails"));
const Documents = lazy(() => import("./pages/Documents"));
const DocumentDetails = lazy(() => import("./pages/DocumentDetails"));
const EmailSettings = lazy(() => import("./pages/EmailSettings"));
const Analytics = lazy(() => import("./pages/Analytics"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Reports = lazy(() => import("./pages/Reports"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const VehicleDetails = lazy(() => import("./pages/VehicleDetails"));
const Duplicates = lazy(() => import("./pages/Duplicates"));
const Database = lazy(() => import("./pages/Database"));
const DiagnoseMOT = lazy(() => import("./pages/DiagnoseMOT"));
const TestWhatsApp = lazy(() => import("./pages/TestWhatsApp"));
const LogsAndMessages = lazy(() => import("./pages/LogsAndMessages"));
const PhoneCleanup = lazy(() => import("./pages/PhoneCleanup"));
const ReminderArchive = lazy(() => import("./pages/ReminderArchive"));
const FollowUpActions = lazy(() => import("./pages/FollowUpActions"));
const Conversations = lazy(() => import("./pages/Conversations"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));
const GA4Scanner = lazy(() => import("./pages/GA4Scanner"));
const ReminderFollowUp = lazy(() => import("./pages/ReminderFollowUp"));
const UrgentFollowUps = lazy(() => import("./pages/UrgentFollowUps"));
const TechnicalHub = lazy(() => import("./pages/TechnicalHub"));
const TechnicalData = lazy(() => import("./pages/TechnicalData"));
const MobileJobSummary = lazy(() => import("./pages/MobileJobSummary"));
const Appointments = lazy(() => import("./pages/Appointments"));
const PricingIntelligence = lazy(() => import("./pages/PricingIntelligence"));
const RepairPricing = lazy(() => import("./pages/RepairPricing"));
const SalesStock = lazy(() => import("./pages/SalesStock"));
const WorkshopMOTCheck = lazy(() => import("./pages/WorkshopMOTCheck"));
const WorkshopJobSheet = lazy(() => import("./pages/WorkshopJobSheet"));
const WorkshopTechnicalData = lazy(() => import("./pages/WorkshopTechnicalData"));
const WorkshopTechnicalHub = lazy(() => import("./pages/WorkshopTechnicalHub"));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Switch>
      {/* 
        CRITICAL: The most specific routes (with parameters) MUST come first.
        We use a very distinct prefix /view-vehicle/ to avoid any clashing with /vehicles.
      */}
      <Route path="/view-vehicle/:registration" component={VehicleDetails} />
      <Route path="/v/:registration" component={VehicleDetails} />

      <Route path="/login" component={Login} />
      <Route path="/" component={Home} />
      <Route path="/vehicles" component={Vehicles} />
      <Route path="/customers/:id" component={CustomerDetails} />
      <Route path="/customers" component={Customers} />
      <Route path="/documents/:id" component={DocumentDetails} />
      <Route path="/documents" component={Documents} />
      <Route path="/email-settings" component={EmailSettings} />

      {/* Other routes */}
      <Route path="/analytics" component={Analytics} />
      <Route path="/reports" component={Reports} />
      <Route path="/search" component={SearchResults} />
      <Route path="/database" component={Database} />
      <Route path="/mot-check" component={MOTCheck} />
      <Route path="/diagnose-mot" component={DiagnoseMOT} />
      <Route path="/test-whatsapp" component={TestWhatsApp} />
      <Route path="/logs" component={LogsAndMessages} />
      <Route path="/phone-cleanup" component={PhoneCleanup} />
      <Route path="/archive" component={ReminderArchive} />
      <Route path="/follow-up" component={FollowUpActions} />
      <Route path="/reminders-sent" component={ReminderFollowUp} />
      <Route path="/urgent-follow-ups" component={UrgentFollowUps} />
      <Route path="/conversations" component={Conversations} />
      <Route path="/ga4-scan" component={GA4Scanner} />
      <Route path="/technical-hub" component={TechnicalHub} />
      <Route path="/technical-data" component={TechnicalData} />
      <Route path="/pricing-intelligence" component={PricingIntelligence} />
      <Route path="/repair-pricing" component={RepairPricing} />
      <Route path="/sales-stock" component={SalesStock} />
      <Route path="/duplicates" component={Duplicates} />
      <Route path="/system-status" component={SystemStatus} />
      <Route path="/mobile/job/:id" component={MobileJobSummary} />
      <Route path="/workshop" component={WorkshopMOTCheck} />
      <Route path="/workshop/job" component={WorkshopJobSheet} />
      <Route path="/workshop/technical-data" component={WorkshopTechnicalData} />
      <Route path="/workshop/technical-hub" component={WorkshopTechnicalHub} />

      <Route path="/appointments" component={Appointments} />

      {/* 404 Fallback */}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
