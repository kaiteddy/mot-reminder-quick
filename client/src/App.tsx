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
import Vehicles from "./pages/Vehicles";
import Database from "./pages/Database";
import DiagnoseMOT from "./pages/DiagnoseMOT";
import TestWhatsApp from "./pages/TestWhatsApp";
import LogsAndMessages from "./pages/LogsAndMessages";
import PhoneCleanup from "./pages/PhoneCleanup";
import ReminderArchive from "./pages/ReminderArchive";
import FollowUpActions from "./pages/FollowUpActions";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path="/mot-check" component={MOTCheck} />
      <Route path="/import" component={Import} />
      <Route path="/customers" component={Customers} />
      <Route path="/vehicles" component={Vehicles} />
      <Route path="/database" component={Database} />
      <Route path="/diagnose-mot" component={DiagnoseMOT} />
      <Route path="/test-whatsapp" component={TestWhatsApp} />
      <Route path="/logs" component={LogsAndMessages} />
      <Route path="/phone-cleanup" component={PhoneCleanup} />
      <Route path="/archive" component={ReminderArchive} />
      <Route path="/follow-up" component={FollowUpActions} />
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
