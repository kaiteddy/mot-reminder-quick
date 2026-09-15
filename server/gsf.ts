// GSF Car Parts — trade portal client (trade.gsfcarparts.com). Server-side login with the trade
// account credentials (GSF_USERNAME / GSF_PASSWORD env vars — NEVER committed), then pulls recent
// orders with their lines and a PO reference we can match to a job by reg, mirroring the ECP feed.
//
// Auth is NextAuth credentials: GET /api/auth/csrf → POST /api/auth/callback/credentials → a
// session-token cookie. The session cookie is cached in appSettings and reused for ~25 min; the
// order list is cached 60 s (shared across loads) with a re-login on 401/HTML. The password is read
// from the environment, never logged, and scrubbed from any error text.

import { getAppSetting, setAppSetting } from "./db";

const BASE = "https://trade.gsfcarparts.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SESSION_KEY = "gsf_session";
const ORDERS_KEY = "gsf_orders_cache";

function absorb(jar: Map<string, string>, res: Response) {
  for (const line of (res.headers as any).getSetCookie?.() ?? []) {
    const pair = String(line).split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = (jar: Map<string, string>) => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");

// Credentials come from the DB (set once via the webhook — works for local AND production with no
// Vercel/env step), falling back to GSF_USERNAME / GSF_PASSWORD env vars if you prefer those.
let _credCache: { username?: string; password?: string } | null = null;
async function gsfCreds(): Promise<{ username?: string; password?: string }> {
  if (process.env.GSF_USERNAME && process.env.GSF_PASSWORD) {
    return { username: process.env.GSF_USERNAME, password: process.env.GSF_PASSWORD };
  }
  if (_credCache) return _credCache;
  const c = (await getAppSetting("gsf_credentials").catch(() => null)) as { username?: string; password?: string } | null;
  _credCache = c || {};
  return _credCache;
}
export function _clearGsfCredCache() { _credCache = null; }

function scrubber(pw?: string, em?: string) {
  return (s: string) => {
    let out = String(s);
    if (pw) out = out.split(pw).join("<password>");
    if (em) out = out.split(em).join("<account>");
    return out.slice(0, 200);
  };
}

// Fresh sign-in → returns the cookie header for the session, and caches it.
async function gsfLogin(): Promise<string> {
  const { username: email, password } = await gsfCreds();
  const scrub = scrubber(password, email);
  if (!email || !password) throw new Error("GSF credentials not configured — save them once via /api/webhooks/gsf-credentials.");
  const jar = new Map<string, string>();
  try {
    // 1) CSRF
    const r1 = await fetch(`${BASE}/api/auth/csrf`, { headers: { Accept: "application/json", "User-Agent": UA } });
    absorb(jar, r1);
    const csrfToken = (await r1.json())?.csrfToken;
    if (!csrfToken) throw new Error("no CSRF token");
    // 2) sign in
    const body = new URLSearchParams({ redirect: "false", email, password, csrfToken, callbackUrl: `${BASE}/signin`, json: "true" });
    const r2 = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST", redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
        "User-Agent": UA, Origin: BASE, Referer: `${BASE}/signin`, Cookie: cookieHeader(jar),
      },
      body: body.toString(),
    });
    absorb(jar, r2);
    const out = await r2.json().catch(() => ({} as any));
    if (typeof out?.url === "string" && /[?&]error=/.test(out.url)) throw new Error("portal rejected the login");
    if (!Array.from(jar.keys()).some((k) => /session-token/i.test(k))) throw new Error("no session cookie issued");
    const cookie = cookieHeader(jar);
    await setAppSetting(SESSION_KEY, { at: Date.now(), cookie }).catch(() => {});
    return cookie;
  } catch (e: any) {
    throw new Error(`GSF sign-in failed: ${scrub(e?.message || String(e))}`);
  }
}

// A usable session cookie — reuse the cached one for ~25 min, else log in.
async function gsfCookie(force = false): Promise<string> {
  if (!force) {
    const c = (await getAppSetting(SESSION_KEY).catch(() => null)) as { at?: number; cookie?: string } | null;
    if (c?.cookie && c.at && Date.now() - c.at < 25 * 60 * 1000) return c.cookie;
  }
  return gsfLogin();
}

/** Confirm the stored credentials work (a real sign-in). Used by the setup webhook. */
export async function gsfSelfTest(): Promise<{ ok: boolean; error?: string }> {
  try {
    await gsfLogin();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}

/** Recent GSF orders (raw customerOrders). Cached 60 s; re-logs in on an expired session. */
export async function gsfGetOrders(days = 90): Promise<any[]> {
  const creds = await gsfCreds();
  if (!creds.username || !creds.password) return [];             // GSF not set up — quietly contribute nothing
  const cached = (await getAppSetting(ORDERS_KEY).catch(() => null)) as { at?: number; orders?: any[] } | null;
  if (cached?.orders && cached.at && Date.now() - cached.at < 60_000) return cached.orders;

  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  const body = JSON.stringify({ startDate: start.toISOString(), endDate: end.toISOString(), limit: 50, includeDetailedJourney: true });
  const call = (cookie: string) => fetch(`${BASE}/orders/api/recent`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA, Referer: BASE, Cookie: cookie },
    body,
  });
  try {
    let cookie = await gsfCookie();
    let r = await call(cookie);
    if (r.status === 401 || r.status === 403 || (r.headers.get("content-type") || "").includes("text/html")) {
      cookie = await gsfLogin();                                  // session lapsed → sign in again
      r = await call(cookie);
    }
    if (!r.ok) throw new Error(`orders returned ${r.status}`);
    const data = await r.json();
    const orders = Array.isArray(data?.customerOrders) ? data.customerOrders : [];
    await setAppSetting(ORDERS_KEY, { at: Date.now(), orders }).catch(() => {});
    return orders;
  } catch (e: any) {
    if (cached?.orders) return cached.orders;                     // stale-fallback, like ECP
    console.error("[gsf] order fetch failed:", scrubber(creds.password, creds.username)(e?.message || String(e)));
    return [];                                                    // never break the board over GSF
  }
}
