import { useLocation } from "wouter";

/**
 * Pages like Documents/DocumentDetails/Customers/Vehicles are shared between the modern
 * app (/documents, /customers, …) and the "GA4 Classic" skin (/classic/documents, …).
 * Internal navigation (row clicks, "Back", tab switches) needs to stay within whichever
 * one the user is currently in — this returns the right prefix to build those links with.
 */
export function useClassicBase(): string {
  const [location] = useLocation();
  return location.startsWith("/classic") ? "/classic" : "";
}
