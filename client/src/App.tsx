import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import MOTCheck from "./pages/MOTCheck";
import Import from "./pages/Import";
import Customers from "./pages/Customers";
import CustomerDetails from "./pages/CustomerDetails";
import Analytics from "./pages/Analytics";
import Vehicles from "./pages/Vehicles";
import VehicleDetails from "./pages/VehicleDetails";
import Database from "./pages/Database";
import DiagnoseMOT from "./pages/DiagnoseMOT";
import TestWhatsApp from "./pages/TestWhatsApp";
import LogsAndMessages from "./pages/LogsAndMessages";
import PhoneCleanup from "./pages/PhoneCleanup";
import ReminderArchive from "./pages/ReminderArchive";
import FollowUpActions from "./pages/FollowUpActions";
import Conversations from "./pages/Conversations";
import SystemStatus from "./pages/SystemStatus";

import GA4Scanner from "./pages/GA4Scanner";
import Login from "./pages/Login";

function Router() {
  return (
    <Switch>
      {/* 
          IMPORTANT: Specific routes with parameters MUST come before general list routes 
          e.g. /vehicles/:registration MUST come before /vehicles
      */}
      <Route path="/v/:registration" component={VehicleDetails} />
      <Route path="/vehicles/:registration" component={VehicleDetails} />

      <Route path="/login" component={Login} />
      <Route path="/" component={Home} />
      <Route path="/mot-check" component={MOTCheck} />
      <Route path="/import" component={Import} />

      <Route path="/customers/:id" component={CustomerDetails} />
      <Route path="/customers" component={Customers} />

      <Route path="/analytics" component={Analytics} />
      <Route path="/vehicles" component={Vehicles} />
      <Route path="/database" component={Database} />
      <Route path="/diagnose-mot" component={DiagnoseMOT} />
      <Route path="/test-whatsapp" component={TestWhatsApp} />
      <Route path="/logs" component={LogsAndMessages} />
      <Route path="/phone-cleanup" component={PhoneCleanup} />
      <Route path="/archive" component={ReminderArchive} />
      <Route path="/follow-up" component={FollowUpActions} />
      <Route path="/conversations" component={Conversations} />
      <Route path="/ga4-scan" component={GA4Scanner} />
      <Route path="/system-status" component={SystemStatus} />

      <Route path="/404" component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
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
