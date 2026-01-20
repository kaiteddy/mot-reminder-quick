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
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path={"/"} component={Home} />
      <Route path="/mot-check" component={MOTCheck} />
      <Route path="/import" component={Import} />
      <Route path="/customers" component={Customers} />
      <Route path="/customers/:id" component={CustomerDetails} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/vehicles/:registration" component={VehicleDetails} />
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
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
      // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
