import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { TRPCError } from "@trpc/server";

/**
 * GSF Car Parts trade orders.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT THE MAGENTO API ───────────────────────────────────
 * GSF send NO order email at all -- measured across both mailboxes over 90 days, nothing arrives.
 * So unlike eBay and Amazon, which reach the board through the mail pipeline, an API is the only
 * route to these orders.
 *
 * There are TWO GSF sites and they have SEPARATE account stores:
 *   - gsfcarparts.com        consumer storefront, Magento, API at mcprod.gsfcarparts.com/graphql
 *   - trade.gsfcarparts.com  the TRADE portal -- where our account is
 *
 * An earlier version of this file targeted the Magento API, whose schema was verified field by
 * field without credentials. It was still wrong: the trade login is refused there. One sign-in
 * attempt settled it, and everything below was rebuilt against the trade portal instead.
 *
 * ── HOW THIS WAS ESTABLISHED ─────────────────────────────────────────────────────────────
 * The trade portal cannot be read from outside: every path returns 500 without a session, and the
 * only code it serves a stranger is framework chunks. So it was captured from a browser -- log in,
 * open order history -- exactly as Omnipart was.
 *
 * Everything below comes from that capture. The endpoints, the login form fields, the request body
 * and the response shape were all observed, not guessed.
 *
 * ── AUTH ─────────────────────────────────────────────────────────────────────────────────
 * NextAuth with a credentials provider, so a plain username and password sign-in -- which makes
 * this self-renewing, unlike the Omnipart jar that has to be harvested from a live browser.
 * The session is a COOKIE, not a bearer token, so the jar is carried between calls.
 *
 * Two steps, in order, because NextAuth rejects a credentials post without a matching CSRF pair:
 *   1. GET  /api/auth/csrf                  -> csrfToken, and the cookie that must accompany it
 *   2. POST /api/auth/callback/credentials  -> form-encoded, sets the session cookie
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

const BASE = "https://trade.gsfcarparts.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** name=value pairs, newest write wins. NextAuth sets several and expects them all back. */
type Jar = Map<string, string>;

function absorb(jar: Jar, response: Response): void {
  // getSetCookie keeps multiple Set-Cookie headers separate; a plain get() would join them and
  // make a cookie value containing a comma unparseable.
  const raw = (response.headers as any).getSetCookie?.() ?? [];
  for (const line of raw) {
    const pair = String(line).split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

const cookieHeader = (jar: Jar) =>
  Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");

/** Cached across calls: signing in on every request would be slow and rude. */
let session: { jar: Jar; expiresAt: number } | null = null;

/**
 * Sign in and return a cookie jar.
 *
 * NEVER log the password or the jar. A NextAuth session cookie is a bearer credential in all but
 * name -- anyone holding it is logged in as this account until it expires.
 */
async function signIn(): Promise<Jar> {
  if (session && session.expiresAt > Date.now()) return session.jar;

  if (!ENV.gsfUsername || !ENV.gsfPassword) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "GSF is not set up: add GSF_USERNAME and GSF_PASSWORD to the environment.",
    });
  }

  const jar: Jar = new Map();

  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  absorb(jar, csrfResponse);
  const csrfToken = (await csrfResponse.json().catch(() => ({} as any)))?.csrfToken;
  if (!csrfToken) throw new Error("GSF did not issue a CSRF token");

  const form = new URLSearchParams({
    redirect: "false",
    email: ENV.gsfUsername,
    password: ENV.gsfPassword,
    csrfToken,
    callbackUrl: `${BASE}/signin`,
    json: "true",
  });

  const loginResponse = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": UA,
      Origin: BASE,
      Referer: `${BASE}/signin`,
      Cookie: cookieHeader(jar),
    },
    body: form.toString(),
  });
  absorb(jar, loginResponse);

  // NextAuth answers 200 with a url either way; a failure sends you back to /signin with ?error=.
  const body = await loginResponse.json().catch(() => ({} as any));
  if (typeof body?.url === "string" && /[?&]error=/.test(body.url)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "GSF rejected the sign-in." });
  }

  const hasSession = Array.from(jar.keys()).some((k) => /session-token/i.test(k));
  if (!hasSession) throw new TRPCError({ code: "UNAUTHORIZED", message: "GSF issued no session." });

  // Well inside NextAuth's default 30-day cookie, and short enough that a revoked account stops
  // working quickly rather than being trusted for weeks.
  session = { jar, expiresAt: Date.now() + 30 * 60 * 1000 };
  return jar;
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const jar = await signIn();
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      Referer: BASE,
      Cookie: cookieHeader(jar),
      ...(init.headers ?? {}),
    },
  });
  absorb(jar, response);

  if (response.status === 401 || response.status === 403) {
    session = null;                       // force a fresh sign-in next time
    throw new TRPCError({ code: "UNAUTHORIZED", message: "GSF session rejected." });
  }
  if (!response.ok) throw new Error(`GSF ${path} returned ${response.status}`);
  return response.json();
}

export interface GsfOrder {
  supplier: "gsf";
  orderRef: string | null;
  /** What we typed at order time. The ONLY candidate for matching an order to a job. */
  purchaseOrderNumber: string | null;
  orderDate: string | null;
  status: string | null;
  netTotal: number | null;
  grossTotal: number | null;
  account: string | null;
  deliveryUpdates: Array<{ status: string | null; at: string | null; comments: string | null }>;
  parts: Array<{
    code: string | null;
    name: string | null;
    quantity: number | null;
    unitCost: number | null;
    invoice: string | null;
    /** GSF's own credit reference for this line — what has already been sent back. */
    credit: string | null;
  }>;
}

export const gsfRouter = router({
  /**
   * Prove the account works and report what it can see.
   *
   * Run this before trusting anything else. It is the only way to find out whether the credentials
   * are right, since nothing about the trade portal can be checked without signing in.
   */
  probe: protectedProcedure.query(async () => {
    const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
    try {
      await signIn();
      steps.push({ step: "sign in", ok: true, detail: "session cookie issued" });
    } catch (error: any) {
      return { ok: false, steps: [{ step: "sign in", ok: false, detail: String(error?.message ?? "failed") }] };
    }

    try {
      const s = await call("/api/auth/session");
      const c = s?.user?.customer;
      steps.push({
        step: "who are we",
        ok: true,
        detail: c?.accountNo ? `account ${c.accountNo}${c.branchId ? `, branch ${c.branchId}` : ""}` : "session readable",
      });
    } catch (error: any) {
      steps.push({ step: "who are we", ok: false, detail: String(error?.message ?? "failed") });
    }

    try {
      const orders = await recentOrders(90, 5);
      const withRef = orders.filter((o) => o.purchaseOrderNumber).length;
      steps.push({ step: "recent orders", ok: true, detail: `${orders.length} in 90 days` });
      steps.push({
        step: "can they match to a job",
        ok: true,
        // The whole question for GSF: does anyone type the registration at order time?
        detail: withRef
          ? `${withRef} of ${orders.length} carry a purchase-order reference`
          : "none carry a purchase-order reference — these will need attaching by hand",
      });
    } catch (error: any) {
      steps.push({ step: "recent orders", ok: false, detail: String(error?.message ?? "failed") });
    }

    return { ok: steps.every((s) => s.ok), steps };
  }),

  /** Orders from the last `days` days, newest first. */
  getOrders: protectedProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).default(30),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const orders = await recentOrders(input.days, input.limit);
      return { count: orders.length, orders };
    }),
});

/**
 * `POST /orders/api/recent` — the trade portal's order history.
 *
 * The date window is required; the portal's own UI sends one week. `includeDetailedJourney` is what
 * fills `deliveryUpdates`, which is the per-step delivery history rather than just a status.
 */
export async function recentOrders(days: number, limit: number): Promise<GsfOrder[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const data = await call("/orders/api/recent", {
    method: "POST",
    body: JSON.stringify({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      limit,
      includeDetailedJourney: true,
    }),
  });

  const rows: any[] = Array.isArray(data?.customerOrders) ? data.customerOrders : [];

  return rows.map(mapGsfOrder);
}

/**
 * One raw order from `/orders/api/recent` into our shape.
 *
 * Exported so it can be tested against the captured response without a login -- which matters,
 * because signing in needs live credentials and the mapping is where the mistakes live.
 */
export function mapGsfOrder(o: any): GsfOrder {
  return {
    supplier: "gsf" as const,
    orderRef: o?.documentNumber ?? null,
    purchaseOrderNumber: o?.purchaseOrderNumber ?? null,
    orderDate: o?.orderedAt ?? null,
    status: o?.deliveryStatus ?? null,
    // orderTotal against orderTotalVat: the first is the goods value, the second the VAT on it,
    // so gross is the sum rather than either one. Reading orderTotal as gross would understate
    // every cost by the VAT and overstate every margin by the same.
    netTotal: typeof o?.orderTotal === "number" ? o.orderTotal : null,
    grossTotal:
      typeof o?.orderTotal === "number" && typeof o?.orderTotalVat === "number"
        ? Math.round((o.orderTotal + o.orderTotalVat) * 100) / 100
        : null,
    account: o?.account ?? null,
    deliveryUpdates: (o?.deliveryUpdates ?? []).map((d: any) => ({
      status: d?.status ?? null,
      at: d?.createdAt ?? null,
      comments: d?.comments ?? null,
    })),
    parts: (o?.lines ?? []).map((l: any) => ({
      code: l?.sku ?? null,
      name: l?.description ?? null,
      quantity: typeof l?.quantity === "number" ? l.quantity : null,
      unitCost: typeof l?.price === "number" ? l.price : null,
      invoice: l?.invoice ?? null,
      credit: l?.credit ?? null,
    })),
  };
}
