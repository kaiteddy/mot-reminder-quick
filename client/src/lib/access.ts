/**
 * What a staff login is allowed to reach.
 *
 * An ALLOWLIST, not a blocklist, and deliberately so: a page added later is admin-only until
 * someone adds it here. The other way round, every new page would be visible to the whole
 * workshop the day it ships, and the one that finally mattered would be a financial one.
 *
 * This is the single source for both the sidebar (entries staff can't use aren't drawn) and the
 * route guard (typing the URL is refused too). They must not drift apart — a hidden link that
 * still loads the page isn't access control, it's decoration.
 *
 * The real boundary is on the server: every procedure behind an admin page is an adminProcedure,
 * so a staff session is refused even if it reaches the endpoint directly. This file is what makes
 * the app coherent to look at; it is not what makes it safe.
 */
const STAFF_PATHS = [
  "/",                    // Live Jobs
  "/documents",           // and /documents/:id
  "/mot-check",
  "/mot-reminders",
  "/ga4-scan",
  "/repair-pricing",
  "/parts-price-list",
  "/price-guide",
  "/appointments",        // Calendar
  "/technical-hub",
  "/technical-data",
  "/customers",           // and /customers/:id
  "/vehicles",
  "/view-vehicle",        // a vehicle opened from a job
  "/v",                   // short link to the same
  "/search",
  "/workshop",            // Workshop Mode: scan, job sheet, technical screens
  "/mobile",              // the mobile job summary
  "/login",
];

/** Can a staff (non-admin) login open this path? */
export function canStaffSee(path: string): boolean {
  const clean = (path.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return STAFF_PATHS.some((p) => (p === "/" ? clean === "/" : clean === p || clean.startsWith(p + "/")));
}

/** Everything an admin can see; staff get the allowlist above. */
export function canSee(path: string, role: string | null | undefined): boolean {
  return role === "admin" || canStaffSee(path);
}
