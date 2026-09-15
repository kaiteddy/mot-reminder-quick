import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as cp from "child_process";
import { promisify } from "util";

const exec = promisify(cp.exec);

async function crawlWithCurl(method: string, url: string, headers: Record<string, string>, bodyStr: string | null = null) {
    let cmd = `curl -s -X ${method} '${url}'`;
    for (const [k, v] of Object.entries(headers)) {
        cmd += ` -H '${k}: ${v.replace(/'/g, "")}'`;
    }
    if (bodyStr) {
        cmd += ` --data '${bodyStr.replace(/'/g, "")}'`;
    }
    
    // Add insecure just in case
    cmd += " -k";

    try {
        const { stdout, stderr } = await exec(cmd);
        if (stdout.trim().startsWith("<html")) {
             throw new Error("WAF Blocked Request: " + stdout.substring(0, 100));
        }
        return JSON.parse(stdout);
    } catch (e: any) {
        throw new Error("Curl wrapper failed: " + e.message);
    }
}

// Native-fetch call to the Omnipart API for the WISMO / order-tracking / returns endpoints.
// Replaces the shell-exec curl (crawlWithCurl) for these: no command-line length limit, no shell
// quoting, no intermittent HTTP/2 curl exit failures. fetch reaches these endpoints fine (same as
// the token refresher). Throws on an HTML/edge block; returns parsed JSON (or raw text) otherwise.
async function omnipartFetch(method: string, url: string, headers: Record<string, string>, body?: string): Promise<any> {
  const res = await fetch(url, { method, headers, ...(body != null ? { body } : {}) });
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error(`Euro Car Parts edge blocked the request (HTTP ${res.status}).`);
  try { return JSON.parse(text); } catch { return text || null; }
}

// Self-heal the session on read: if the jar's bearer is expired or within 5 min of expiry, renew it
// server-side via /token/refresh (which rotates the refresh_token) and persist the fresh jar. This
// keeps the tracker working the moment it's opened, even if the scheduled refresh lapsed (e.g. the
// Mac slept). Non-fatal — on any failure it returns the jar unchanged and the caller surfaces the error.
async function refreshJarIfStale(jar: string): Promise<string> {
  const bm = jar.match(/bearer=(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  let minsLeft = -1;
  if (bm) { try { const p = JSON.parse(Buffer.from(bm[1].split(".")[1], "base64").toString()); minsLeft = (p.exp - Date.now() / 1000) / 60; } catch { /* unparseable → treat as stale */ } }
  if (minsLeft > 5) return jar;
  const rt = jar.match(/refresh_token=([0-9a-fA-F]+)/);
  if (!rt) return jar;
  try {
    const data = await omnipartFetch(
      "POST",
      "https://api.omnipart.eurocarparts.com/token/refresh",
      {
        "Content-Type": "application/json", "Accept": "application/json",
        "Origin": "https://omnipart.eurocarparts.com", "Referer": "https://omnipart.eurocarparts.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": jar,
      },
      JSON.stringify({ refresh_token: rt[1] })
    );
    if (data && data.token && data.refresh_token) {
      let newJar = /bearer=/.test(jar) ? jar.replace(/bearer=[^;]*/, `bearer=${data.token}`) : `${jar}; bearer=${data.token}`;
      newJar = newJar.replace(/refresh_token=[^;]*/, `refresh_token=${data.refresh_token}`);
      const { saveAppSetting } = await import("../db");
      await saveAppSetting("omnipart_jwt_token", "COOKIE_JAR:" + newJar);
      return newJar;
    }
  } catch { /* fall through — return stale jar */ }
  return jar;
}

// Resolve Omnipart request headers from a raw token or the stored jar. Auth is cookie-based: the
// bearer= cookie inside the harvested COOKIE_JAR is what the API validates (Authorization is a
// best-effort extra). Used by the order-tracking + digital-returns procedures below.
async function omnipartHeaders(inputToken?: string, referer = "https://omnipart.eurocarparts.com/"): Promise<Record<string, string>> {
  let rawToken = inputToken || "auto";
  if (!rawToken || rawToken === "auto") {
    const { getAppSetting } = await import("../db");
    const dbToken = await getAppSetting('omnipart_jwt_token');
    if (!dbToken) throw new Error("No automatic token found in database. Please configure manually.");
    rawToken = dbToken as string;
  }
  let clean = rawToken;
  let authHeader = "";
  let cookieHeader = "";
  if (clean.startsWith("COOKIE_JAR:")) {
    cookieHeader = clean.substring(11).trim();
    cookieHeader = await refreshJarIfStale(cookieHeader);   // renew on demand if the bearer has lapsed
    const match = cookieHeader.match(/bearer=(eyJ[^;]+)/i);
    if (match) authHeader = `Bearer ${match[1]}`;
  } else {
    clean = clean.replace(/^["']|["']$/g, '').trim().replace(/[\n\r]| /g, '');
    const lc = clean.toLowerCase();
    if (lc.startsWith("authorization:bearer")) clean = clean.substring(20);
    else if (lc.startsWith("bearer")) clean = clean.substring(6);
    if (clean.startsWith("ey")) { authHeader = `Bearer ${clean}`; cookieHeader = `bearer=${clean}`; }
  }
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Origin": "https://omnipart.eurocarparts.com",
    "Referer": referer,
  };
  // Cookie-only auth: the WISMO/returns endpoints validate the bearer= cookie; adding an
  // Authorization header has caused 403/500 responses, so we deliberately omit it here.
  void authHeader;
  if (cookieHeader) h["Cookie"] = cookieHeader;
  return h;
}

/**
 * API Platform collections arrive as `{ "hydra:member": [...] }`, not as a bare array.
 *
 * `Array.isArray(envelope)` is false, so a plain isArray check silently yields an empty list —
 * which is what made the return-reasons dropdown always empty, and therefore made a return
 * impossible to submit at all. Accept either shape and never return a non-list.
 */
function hydraMembers(data: any): any[] {
  if (Array.isArray(data)) return data;
  const members = data?.["hydra:member"] ?? data?.member;
  return Array.isArray(members) ? members : [];
}

export const omnipartRouter = router({
  // Lookup Vehicle by VRM to get Omnipart's internal vehicleId
  lookupVrm: protectedProcedure
    .input(z.object({
      vrm: z.string(),
      token: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        let rawToken = input.token;
        if (!rawToken || rawToken === "auto") {
            const { getAppSetting } = await import("../db");
            const dbToken = await getAppSetting('omnipart_jwt_token');
            if (!dbToken) throw new Error("No automatic token found in database. Please configure manually.");
            rawToken = dbToken as string;
        }

        let clean = rawToken;
        let authHeader = "";
        let cookieHeader = "";

        if (clean.startsWith("COOKIE_JAR:")) {
            cookieHeader = clean.substring(11).trim();
            // Try to extract the JWT just in case they still accept it in the Authorization header too
            let match = cookieHeader.match(/bearer=(eyJ[^;]+)/i);
            if (match) {
                authHeader = `Bearer ${match[1]}`;
            }
        } else {
            clean = clean.replace(/^["']|["']$/g, '').trim();
            clean = clean.replace(/[\n\r]| /g, ''); // Remove all spaces and newlines
            
            const lowerClean = clean.toLowerCase();
            if (lowerClean.startsWith("authorization:bearer")) {
                clean = clean.substring(20);
            } else if (lowerClean.startsWith("bearer")) {
                clean = clean.substring(6);
            }
            
            if (clean.endsWith('...')) {
                throw new Error("Token is incomplete! You accidentally copied the abbreviation '...'. Please click the network property to expand it completely before copying the eyJ... string.");
            }
            if (!clean.startsWith('ey')) {
                throw new Error("Invalid token format! A valid token must start with 'ey'.");
            }
            authHeader = `Bearer ${clean}`;
        }

        const apiHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Origin": "https://omnipart.eurocarparts.com",
          "Referer": "https://omnipart.eurocarparts.com/"
        };

        if (authHeader) apiHeaders["Authorization"] = authHeader;
        if (cookieHeader) apiHeaders["Cookie"] = cookieHeader;

        const resData = await crawlWithCurl(
          "POST",
          "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
          apiHeaders,
          JSON.stringify({ vrm: input.vrm, saveToCache: false })
        );

        if (resData["@type"] === "hydra:Error" || resData["hydra:description"]) {
            throw new Error(resData["hydra:description"] || "Euro Car Parts rejected this vehicle search.");
        }
        if (resData.message) {
            throw new Error(`Euro Car Parts API: ${resData.message}`);
        }

        if (!resData || !resData.searchResults) {
            console.error("Raw ECP Response:", JSON.stringify(resData).substring(0, 500));
            throw new Error("No vehicle details returned. ECP API may have blocked the request.");
        }

        const details = resData.searchResults.vehicleDetails || [];

        const findVal = (arr: any[], name: string) => arr.find(x => x.Name === name)?.Value || null;

        return {
            vehicleId: findVal(details, "VehicleId"),
            make: findVal(details, "Make"),
            model: findVal(details, "Model"),
            engineCode: findVal(details, "EngineCode"),
            bhp: findVal(details, "BHP"),
            fuel: findVal(details, "Fuel") || findVal(details, "FuelType"),
            year: findVal(details, "VehicleYear") || findVal(details, "Year")
        };
      } catch (error: any) {
        const message = error.message || "Failed to look up VRM on Omnipart";
        console.error("Omnipart VRM Error:", message);
        
        if (message.toLowerCase().includes("token") || message.toLowerCase().includes("auth") || message.toLowerCase().includes("expired")) {
            throw new TRPCError({ code: "UNAUTHORIZED", message });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // Get matching parts based on vehicleId and search query / category
  getPartsInfo: protectedProcedure
    .input(z.object({
      vehicleId: z.string().optional(),
      vrm: z.string().optional(),
      categorySlug: z.string().optional(),
      isCustomSearch: z.boolean().optional(),
      skus: z.array(z.string()).optional(),
      token: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        // Step 1: Find SKUs for the vehicle if they only provided a category
        let skusToLookup = input.skus || [];

        let rawToken = input.token;
        if (!rawToken || rawToken === "auto") {
            const { getAppSetting } = await import("../db");
            const dbToken = await getAppSetting('omnipart_jwt_token');
            if (!dbToken) throw new Error("No automatic token found in database. Please configure manually.");
            rawToken = dbToken as string;
        }

        let clean = rawToken;
        let authHeader = "";
        let cookieHeader = "";

        if (clean.startsWith("COOKIE_JAR:")) {
            cookieHeader = clean.substring(11).trim();
            let match = cookieHeader.match(/bearer=(eyJ[^;]+)/i);
            if (match) authHeader = `Bearer ${match[1]}`;
        } else {
            clean = clean.replace(/^["']|["']$/g, '').trim();
            clean = clean.replace(/[\n\r]| /g, '');
            
            const lowerClean = clean.toLowerCase();
            if (lowerClean.startsWith("authorization:bearer")) {
                clean = clean.substring(20);
            } else if (lowerClean.startsWith("bearer")) {
                clean = clean.substring(6);
            }
            if (clean.endsWith('...')) {
                throw new Error("Token is incomplete! You accidentally copied the abbreviation '...'. Please click the network property to expand it completely before copying the eyJ... string.");
            }
            if (!clean.startsWith('ey')) {
                throw new Error("Invalid token format! A valid token must start with 'ey'.");
            }
            authHeader = `Bearer ${clean}`;
        }

        const apiHeaders: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://omnipart.eurocarparts.com",
            "Referer": "https://omnipart.eurocarparts.com/"
        };
        if (authHeader) apiHeaders["Authorization"] = authHeader;
        if (cookieHeader) apiHeaders["Cookie"] = cookieHeader;

        if (!input.skus && input.categorySlug) {
            // STEP 1: Set the session context if VRM was provided
            if (input.vrm) {
                await crawlWithCurl(
                    "POST",
                    "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
                    apiHeaders,
                    JSON.stringify({ vrm: input.vrm, saveToCache: false })
                );
            } else if (input.vehicleId) {
                await crawlWithCurl(
                    "POST",
                    "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vehicle-id",
                    apiHeaders,
                    JSON.stringify({ vehicleId: parseInt(input.vehicleId), saveToCache: false })
                );
            }

            let baseProducts: any[] = [];

            if (input.isCustomSearch) {
                // Free text search mapped to vehicle
                const urlKeywords = encodeURIComponent(input.categorySlug || "");
                const searchUrl = `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${urlKeywords}&vehicleId=${input.vehicleId || ""}`;
                const searchData = await crawlWithCurl("GET", searchUrl, apiHeaders);
                baseProducts = searchData.products || [];
            } else {
                // STEP 2: Lookup the precise category ID via slug
                const catUrl = `https://api.omnipart.eurocarparts.com/storefront/categories/${input.categorySlug}`;
                const catData = await crawlWithCurl("GET", catUrl, apiHeaders);
                
                // Extract trailing ID, e.g. "/categories/196" -> "196"
                let categoryId = "";
                const rawId = catData['@id'] || catData.id;
                if (rawId && typeof rawId === 'string') {
                    const parts = rawId.split('/');
                    categoryId = parts[parts.length - 1];
                }

                if (!categoryId) {
                    console.warn("Could not determine category ID for", input.categorySlug);
                    return { products: [] };
                }

                // STEP 3: Fetch purely vehicle-specific products for that category using session
                const specUrl = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${categoryId}?`;
                const baseResData = await crawlWithCurl("GET", specUrl, apiHeaders);
                
                // The structure is nested: hydra:member[0].products[baseSku][subSku]
                const productGroups = baseResData['hydra:member']?.[0]?.products || {};
                
                for (const baseSku in productGroups) {
                    for (const subSku in productGroups[baseSku]) {
                        baseProducts.push(productGroups[baseSku][subSku]);
                    }
                }
            }

            // Process the first 20 mapped items
            skusToLookup = baseProducts.map((p: any) => p.sku || p).slice(0, 20);
            
            if (skusToLookup.length === 0) {
                return { products: [] };
            }

            // Step 2: Get detailed pricing for these SKUs
            const queryParams = skusToLookup.map((s: string) => `skus[]=${s}`).join('&');
            let priceResData;
            try {
                priceResData = await crawlWithCurl(
                    "GET",
                    `https://api.omnipart.eurocarparts.com/products/product-information?${queryParams}`,
                    apiHeaders
                );
            } catch(e) {
                console.error("Failed to fetch product-information, but continuing...", e);
                priceResData = { 'hydra:member': [] };
            }
            
            const detailedPricing = priceResData['hydra:member'] || (Array.isArray(priceResData) ? priceResData : []);

            // Step 3: Mix the base product info with the detailed pricing
            const finalProducts = skusToLookup.map((sku: string) => {
                const baseInfo = baseProducts.find((p: any) => p.sku === sku) || {};
                const pricingInfo = detailedPricing.find((p: any) => p.sku === sku) || {};
                
                return {
                    sku,
                    name: baseInfo.name || "Unknown Part",
                    brandName: baseInfo.brand?.name || baseInfo.brandName || "Unknown Brand",
                    imageUrl: baseInfo.image || null,
                    brandImageUrl: baseInfo.brand?.image || null,
                    netPrice: pricingInfo.price?.excTax ? pricingInfo.price.excTax / 100 : 0,
                    rrp: pricingInfo.wasPrice?.excTax ? pricingInfo.wasPrice.excTax / 100 : 0,
                    branchStock: pricingInfo.stock?.reduce((acc: number, val: any) => acc + (val.stock || 0), 0) || 0
                };
            }).filter((p: any) => p.netPrice > 0);

            return { products: finalProducts };
        }

        return { products: [] };
      } catch (error: any) {
        const message = error.message || "Failed to search for parts on Omnipart";
        console.error("Omnipart Parts Error:", message);

        if (message.toLowerCase().includes("token") || message.toLowerCase().includes("auth") || message.toLowerCase().includes("expired")) {
            throw new TRPCError({ code: "UNAUTHORIZED", message });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // Live ECP order tracking (WISMO — "Where Is My Order"). Returns each recent order with its
  // delivery status and the reg it was ordered against, so orders can be matched to a vehicle/job.
  // Endpoint: POST /account/wismo-order-list, body "{}", cookie-jar auth (see omnipart-invoices notes).
  getOrderTracking: protectedProcedure
    .input(z.object({ token: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        let rawToken = input?.token || "auto";
        if (!rawToken || rawToken === "auto") {
            const { getAppSetting } = await import("../db");
            const dbToken = await getAppSetting('omnipart_jwt_token');
            if (!dbToken) throw new Error("No automatic token found in database. Please configure manually.");
            rawToken = dbToken as string;
        }

        let clean = rawToken;
        let authHeader = "";
        let cookieHeader = "";
        if (clean.startsWith("COOKIE_JAR:")) {
            cookieHeader = clean.substring(11).trim();
            const match = cookieHeader.match(/bearer=(eyJ[^;]+)/i);
            if (match) authHeader = `Bearer ${match[1]}`;
        } else {
            clean = clean.replace(/^["']|["']$/g, '').trim().replace(/[\n\r]| /g, '');
            const lc = clean.toLowerCase();
            if (lc.startsWith("authorization:bearer")) clean = clean.substring(20);
            else if (lc.startsWith("bearer")) clean = clean.substring(6);
            if (clean.startsWith("ey")) { authHeader = `Bearer ${clean}`; cookieHeader = `bearer=${clean}`; }
        }

        const apiHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Origin": "https://omnipart.eurocarparts.com",
          "Referer": "https://omnipart.eurocarparts.com/account/order-tracking",
        };
        if (authHeader) apiHeaders["Authorization"] = authHeader;
        if (cookieHeader) apiHeaders["Cookie"] = cookieHeader;

        // Empty body returns the recent set; sending limit/page as ints triggers a 422.
        const raw = await omnipartFetch(
          "POST",
          "https://api.omnipart.eurocarparts.com/account/wismo-order-list",
          apiHeaders,
          "{}"
        );

        if (raw && (raw["@type"] === "hydra:Error" || raw.detail)) {
            throw new Error(raw.detail || raw["hydra:description"] || "Euro Car Parts rejected the order-tracking request.");
        }

        // Response is an object keyed by order_ref (plus a "next_page" key) — normalise to an array.
        const orders = Object.entries(raw || {})
          .filter(([k]) => k !== "next_page")
          .map(([ref, o]: [string, any]) => {
            const vd = o?.vehicle_details || {};
            const deliveries = o?.deliveries || {};
            let deliveryStatus: string | null = null;
            let deliveryEta: string | null = null;
            for (const v of Object.values(deliveries)) {
              if (v && typeof v === "object") {
                if ((v as any).delivery_status && !deliveryStatus) deliveryStatus = (v as any).delivery_status;
                if ((v as any).eta && !deliveryEta) deliveryEta = (v as any).eta;
              }
            }
            return {
              orderRef: o?.order_ref || ref,
              reg: o?.customer_order_ref || vd.vrm || null,           // the join key to a vehicle/job
              make: vd.make || null,
              model: vd.model || null,
              year: vd.year || null,
              vin: vd.vin || null,
              orderDate: o?.order_date || null,
              status: o?.order_status || null,                        // e.g. "Preparing your order" | "Delivered"
              deliveryStatus,
              eta: o?.eta ?? deliveryEta ?? null,
              numberOfItems: o?.number_of_items ?? null,
              totalIncTax: o?.totals?.total_inc_tax ?? null,
              dbOrderId: o?.db_order_id || null,
              branchId: o?.branch_id ?? null,
              // How long ago it was ordered, and whether it needs chasing — flagged once it hasn't
              // been delivered by the evening (18:00) of the day it was ordered, so a same-day order
              // that never arrived surfaces instead of going unnoticed.
              ageHours: o?.order_date ? Math.max(0, Math.round((Date.now() - new Date(o.order_date).getTime()) / 3600000)) : null,
              needsAttention: (() => {
                const delivered = String(o?.order_status || "").toLowerCase().includes("deliver");
                if (delivered || !o?.order_date) return false;
                const od = new Date(o.order_date);
                const endOfOrderDay = new Date(od.getFullYear(), od.getMonth(), od.getDate(), 18, 0, 0).getTime();
                return Date.now() > endOfOrderDay;
              })(),
              // filled in below by the reg+date job match (null if no job sheet found)
              jobSheet: null as null | { id: number; docNo: string | null; ga4Number: string | null; docType: string | null; date: Date | string | null },
            };
          })
          .sort((a, b) => String(b.orderDate || "").localeCompare(String(a.orderDate || "")));

        // Match each order to the job it was ordered against. The reg is the clean join (the order's
        // customer_order_ref == serviceHistory.registration); the order DATE picks the specific job
        // among that vehicle's several — the one open when the parts were ordered.
        try {
          const regs = Array.from(new Set(orders.map((o) => o.reg).filter(Boolean))) as string[];
          if (regs.length) {
            const { getJobSheetsByRegs } = await import("../db");
            const jobs = await getJobSheetsByRegs(regs);
            const norm = (r: string | null) => (r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            const byReg = new Map<string, typeof jobs>();
            for (const j of jobs) {
              const k = norm(j.registration);
              if (!byReg.has(k)) byReg.set(k, []);
              byReg.get(k)!.push(j);
            }
            const refTime = (j: typeof jobs[number]) => {
              const d = j.dateCreated || j.dateIssued;
              return d ? new Date(d).getTime() : 0;
            };
            for (const o of orders) {
              const list = byReg.get(norm(o.reg)) || [];
              if (!list.length) { o.jobSheet = null; continue; }
              const od = o.orderDate ? new Date(o.orderDate).getTime() : null;
              let best: (typeof jobs)[number] | null = null;
              if (od != null) {
                const before = list.filter((j) => refTime(j) <= od).sort((a, b) => refTime(b) - refTime(a));
                best = before[0] || list.slice().sort((a, b) => Math.abs(refTime(a) - od) - Math.abs(refTime(b) - od))[0];
              } else {
                best = list.slice().sort((a, b) => refTime(b) - refTime(a))[0];
              }
              o.jobSheet = best
                ? { id: best.id, docNo: best.docNo, ga4Number: best.ga4Number, docType: best.docType, date: best.dateIssued || best.dateCreated || null }
                : null;
            }
          }
        } catch (e: any) {
          // non-fatal: order tracking still returns even if job matching fails
          console.error("Omnipart job-match error:", e?.message);
        }

        return { count: orders.length, orders };
      } catch (error: any) {
        const message = error.message || "Failed to fetch Omnipart order tracking";
        console.error("Omnipart Order Tracking Error:", message);
        if (message.toLowerCase().includes("token") || message.toLowerCase().includes("auth") || message.toLowerCase().includes("expired") || message.toLowerCase().includes("jwt")) {
            throw new TRPCError({ code: "UNAUTHORIZED", message });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // Per-order detail: the parts on an order + its delivery stage. Called when a row is expanded.
  // The WISMO detail endpoint can be flaky, so this returns an empty parts list rather than erroring.
  getOrderDetail: protectedProcedure
    .input(z.object({
      ref: z.string(),
      orderId: z.number().nullable().optional(),
      branchId: z.number().nullable().optional(),
      token: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const headers = await omnipartHeaders(input.token, "https://omnipart.eurocarparts.com/account/order-tracking");
        // The endpoint accepts {ref} (optionally {ref, branchId}); including orderId makes it 422.
        const body = JSON.stringify({ ref: input.ref, ...(input.branchId != null ? { branchId: input.branchId } : {}) });
        const raw = await omnipartFetch("POST", "https://api.omnipart.eurocarparts.com/account/wismo-order", headers, body);
        const o = raw && typeof raw === "object" && !Array.isArray(raw) ? Object.values(raw)[0] : null;
        if (!o || typeof o !== "object") return { parts: [], deliveryStatus: null, eta: null, orderStatus: null };
        const oo = o as any;
        const parts: Array<{ code: string | null; name: string | null; brand: string | null; quantity: number | null; status: string | null }> = [];
        let deliveryStatus: string | null = null, eta: string | null = null;
        for (const dv of Object.values(oo.deliveries || {}) as any[]) {
          if (dv && typeof dv === "object") {
            if (dv.delivery_status && !deliveryStatus) deliveryStatus = dv.delivery_status;
            if (dv.eta && !eta) eta = dv.eta;
            for (const ln of Object.values(dv.lines || {}) as any[]) {
              parts.push({
                code: ln.product_code || ln.sku || null,
                name: null,
                brand: null,
                quantity: ln.quantity ?? ln.qty ?? null,
                status: ln.status || ln.line_status || null,
              });
            }
          }
        }
        // Resolve friendly product names for each SKU (the delivery line only carries the code).
        await Promise.all(parts.map(async (p) => {
          if (!p.code) return;
          try {
            const s = await omnipartFetch("GET", `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${encodeURIComponent(p.code)}`, headers);
            const raw2 = s?.products || s?.["hydra:member"] || s?.searchResults?.products || [];
            const arr = Array.isArray(raw2) ? raw2 : Object.values(raw2 || {});
            const first: any = arr[0];
            if (first) {
              p.name = first.name || first.updatedProductName || null;
              p.brand = (first.brand && typeof first.brand === "object" ? first.brand.name : first.brand) || null;
            }
          } catch { /* keep the bare code */ }
        }));
        return { parts, deliveryStatus, eta, orderStatus: oo.order_status || null };
      } catch (e: any) {
        // best-effort — surface an empty result rather than breaking the row
        return { parts: [], deliveryStatus: null, eta: null, orderStatus: null, error: e?.message || "unavailable" };
      }
    }),

  // ---- Digital returns: turn a bought-and-unused part into a credit request ----
  // Ported from the parallel v0dashboard build. READ endpoints (reasons, returnable items) are safe.
  // The SUBMIT endpoint creates a REAL credit request at ECP — it must only ever fire on an explicit
  // user button press, never automatically and never in a loop.

  // The list of allowed return reasons (Damaged, Incomplete, Incorrectly Labelled, ...).
  getDigitalReturnReasons: protectedProcedure
    .input(z.object({ token: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const headers = await omnipartHeaders(input?.token, "https://omnipart.eurocarparts.com/account/order-tracking");
        const data = await omnipartFetch("GET", "https://api.omnipart.eurocarparts.com/digital-return-reasons", headers);
        // API Platform answers with a hydra envelope, not a bare array. Array.isArray() on the
        // envelope is false, so the old code returned [] every time: no reason could be chosen,
        // and the dialog could never be submitted at all. Accept either shape.
        return hydraMembers(data);
      } catch (error: any) {
        const message = error.message || "Failed to fetch digital return reasons";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // The items on a given order that are eligible for a digital return.
  //
  // TAKES THE ORDER REF ('311-00005706664'), NOT the numeric db_order_id. The two returns calls
  // use DIFFERENT identifiers off the same order and passing the wrong one 404s — the parameter
  // is named orderRef so the mix-up cannot be made silently.
  getReturnableItems: protectedProcedure
    .input(z.object({ orderRef: z.string(), token: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const headers = await omnipartHeaders(input.token, "https://omnipart.eurocarparts.com/account/order-tracking");
        const url = `https://api.omnipart.eurocarparts.com/orders/${encodeURIComponent(input.orderRef)}/digital-return-products`;
        const data = await omnipartFetch("GET", url, headers);
        if (data && (data["@type"] === "hydra:Error" || data.detail)) {
            throw new Error(data.detail || "No returnable items for this order.");
        }
        return hydraMembers(data);
      } catch (error: any) {
        const message = error.message || "Failed to fetch returnable items";
        throw new TRPCError({ code: message.toLowerCase().includes("not found") ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // WRITE — submits a digital return, creating a credit request at Euro Car Parts.
  //
  // GATING: call this ONLY from an explicit user action (a confirm button). Never call it on load,
  // in a loop, or as a side effect.
  //
  // BODY SHAPE. Decoded from Omnipart's own client bundle, not guessed. The previous shape
  // ({ order_id, items: [{ sku, ... }] }) was wrong on every key and would have been rejected:
  //
  //   { lines: [{ product: "/products/123",
  //               reason: "/digital-return-reasons/4",
  //               unitPriceExcTax: 11.39, quantity: 1, additionalInformation: "" }],
  //     order: "/orders/98765" }
  //
  // Two details their code does deliberately:
  //   - `product` is the "/products/<digits>" substring of the returnable item's @id. NOT the sku.
  //   - when the chosen reason code is exactly "Surcharge", the price sent is the item's surcharge
  //     rather than its unitPrice.excTax.
  //
  // `dbOrderId` is the NUMERIC order id (db_order_id, already captured off the wismo list), NOT
  // the order ref that getReturnableItems above takes.
  //
  // STILL UNVERIFIED against a live submission. Transcribed from their builder, which beats a
  // guess, but watch one real return in the browser network tab before trusting it.
  submitDigitalReturn: protectedProcedure
    .input(z.object({
      dbOrderId: z.union([z.string(), z.number()]),
      lines: z.array(z.object({
        // "/products/123", taken from the returnable item's product["@id"].
        productIri: z.string().regex(/^\/products\/\d+$/, "product must be /products/<id>"),
        quantity: z.number().positive(),
        // The reason CODE; resolved to its IRI server-side so the client cannot send a stale one.
        reasonCode: z.string().min(1),
        unitPriceExcTax: z.number(),
        surcharge: z.number().optional(),
        additionalInfo: z.string().optional(),
      })).min(1),
      token: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const headers = await omnipartHeaders(input.token, "https://omnipart.eurocarparts.com/account/order-tracking");

        // Resolve reason codes to IRIs against the live list rather than trusting the client.
        const reasons = hydraMembers(
          await omnipartFetch("GET", "https://api.omnipart.eurocarparts.com/digital-return-reasons", headers)
        );
        const iriFor = (code: string) =>
          (reasons.find((r: any) => r?.code === code) as any)?.["@id"];

        const lines = input.lines.map((l) => {
          const reason = iriFor(l.reasonCode);
          if (!reason) throw new Error(`Unknown return reason: ${l.reasonCode}`);
          return {
            product: l.productIri,
            reason,
            unitPriceExcTax: l.reasonCode === "Surcharge" ? (l.surcharge ?? 0) : l.unitPriceExcTax,
            quantity: l.quantity,
            additionalInformation: l.additionalInfo || "",
          };
        });

        const body = JSON.stringify({ lines, order: `/orders/${input.dbOrderId}` });
        const data = await omnipartFetch("POST", "https://api.omnipart.eurocarparts.com/digital-returns", headers, body);
        if (data && (data["@type"] === "hydra:Error" || data.detail)) {
            throw new Error(data.detail || "Digital return was rejected by Euro Car Parts.");
        }
        return data;
      } catch (error: any) {
        const message = error.message || "Failed to submit digital return";
        console.error("Omnipart Digital Return Error:", message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    })
});
