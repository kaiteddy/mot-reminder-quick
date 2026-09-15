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
async function omnipartFetch(method: string, url: string, headers: Record<string, string>, body?: string, retries = 1): Promise<any> {
  const res = await fetch(url, { method, headers, ...(body != null ? { body } : {}) });
  const text = await res.text();
  // ECP's WAF answers a tripped rate-limit with a tiny HTML 403 page. It's transient — a short
  // wait clears it — so retry once before surfacing the block, so one burst doesn't blank a row.
  if (text.trim().startsWith("<")) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 900));
      return omnipartFetch(method, url, headers, body, retries - 1);
    }
    throw new Error(`Euro Car Parts edge blocked the request (HTTP ${res.status}).`);
  }
  try { return JSON.parse(text); } catch { return text || null; }
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
  // The harvester may store the FULL cookie jar ("COOKIE_JAR:bearer=...; refresh_token=...; …") OR
  // just the raw bearer JWT. Normalise to a Cookie header carrying a bearer= cookie either way.
  // One-login mode: we ride the live browser session and never rotate the token; if the bearer has
  // expired, surface a clear "open Omnipart" message. Auth is cookie-only (an Authorization header
  // causes 403/500 on these endpoints).
  let val = String(rawToken).trim().replace(/^["']|["']$/g, "");
  if (val.startsWith("COOKIE_JAR:")) val = val.slice("COOKIE_JAR:".length).trim();
  const jwtMatch =
    val.match(/bearer=(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/) ||
    val.match(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (!jwtMatch) throw new Error("Omnipart session expired — open an Omnipart page in your browser to refresh it.");
  try {
    const p = JSON.parse(Buffer.from(jwtMatch[1].split(".")[1], "base64").toString());
    if (p.exp && p.exp < Date.now() / 1000) throw new Error("Omnipart session expired — open an Omnipart page in your browser to refresh it.");
  } catch (e: any) { if (String(e?.message || "").includes("expired")) throw e; }
  const cookieHeader = /bearer=/.test(val) ? val : `bearer=${jwtMatch[1]}`;
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Origin": "https://omnipart.eurocarparts.com",
    "Referer": referer,
    "Cookie": cookieHeader,
  };
}

// Guess the vehicle an eBay/Amazon item relates to, from its title — used to suggest a car/job to
// link when the order has no reg of its own. Prefers an explicit "fits/for <Make> <Model>".
const VEHICLE_MAKES = ["Mercedes-Benz", "Mercedes", "Land Rover", "Volkswagen", "Toyota", "Vauxhall",
  "Seat", "Ford", "BMW", "Audi", "VW", "Nissan", "Honda", "Kia", "Hyundai", "Peugeot", "Renault",
  "Citroen", "Skoda", "Mini", "Mazda", "Volvo", "Jaguar", "Fiat", "Suzuki", "Dacia"];
const MODEL_NOISE = /^(alloy|wheel|centre|center|cap|parts|genuine|new|front|rear|left|right|side|for|to|fits|the|oem|replacement|car|van|used|pair|set|x|kit|locking|bumper|steering|mirror|door|headlight|headlamp|light|bulb|sensor|carplay|android|radio|key|lock|nut|bolt|filter|brake|clutch|indicator|badge|emblem|cover|trim|grille|grill|fog)$/i;
function detectVehicle(title?: string | null): string | null {
  if (!title) return null;
  const t = title.replace(/\s+/g, " ");
  const makeAlt = VEHICLE_MAKES.map((m) => m.replace(/[- ]/g, "[- ]?")).join("|");
  // 1) explicit fitment "fits/for <Make> <Model>"
  let m = t.match(new RegExp(`\\b(?:fits|for)\\s+(${makeAlt})\\s+([A-Za-z][\\w-]{1,})`, "i"));
  // 2) otherwise first make + the next non-noise token
  if (!m) m = t.match(new RegExp(`\\b(${makeAlt})\\b\\s+([A-Za-z][\\w-]{1,})`, "i"));
  if (!m) return null;
  const make = m[1].replace(/\b\w/g, (c) => c.toUpperCase());
  let model = m[2];
  if (MODEL_NOISE.test(model)) return make;                 // make alone if the next word is noise
  model = model.replace(/\b\w/g, (c) => c.toUpperCase());
  return `${make} ${model}`;
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
            // The order-LIST response already carries every part (deliveries.*.lines, each with
            // product_name and price inline). So we read them straight off the list here — no
            // per-order follow-up call, which means nothing extra to be WAF-blocked and the parts
            // show instantly when a row expands.
            const parts: Array<{ code: string | null; name: string | null; quantity: number | null; status: string | null; lineCost: number | null; image: string | null }> = [];
            for (const v of Object.values(deliveries)) {
              if (v && typeof v === "object") {
                const dv = v as any;
                if (dv.delivery_status && !deliveryStatus) deliveryStatus = dv.delivery_status;
                if (dv.eta && !deliveryEta) deliveryEta = dv.eta;
                for (const ln of Object.values(dv.lines || {}) as any[]) {
                  parts.push({
                    code: ln.product_code || ln.sku || null,
                    name: ln.product_name || ln.name || null,
                    quantity: ln.quantity ?? ln.qty ?? null,
                    status: ln.product_line_delivery_status === true ? "Delivered"
                          : ln.product_line_delivery_status === false ? "Pending"
                          : (ln.status || null),
                    lineCost: ln.price?.total_cost ?? null,
                    image: ln.product_image || null,                 // ECP product photo (may 404 for some SKUs)
                  });
                }
              }
            }
            return {
              orderRef: o?.order_ref || ref,
              source: "ecp" as string,                                // ECP (Omnipart) vs eBay
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
              parts,                                                  // the actual parts on the order, from the list itself
              totalIncTax: o?.totals?.total_inc_tax ?? null,
              totalExcTax: o?.totals?.total_exc_tax ?? null,   // ELI's ex-VAT parts cost — for internal margin
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

        // Pull in eBay parts orders (captured from order emails) and merge them onto the same board.
        // They carry their own auto-category (from the item) and have no reg/job link.
        try {
          const { getEbayOrders } = await import("../db");
          const ebay = await getEbayOrders();
          const STAGE_AGE: Record<string, boolean> = { "Delivered": false };
          for (const e of ebay as any[]) {
            const price = e.price != null ? Number(e.price) : null;
            const delivered = String(e.status || "").toLowerCase().includes("deliver");
            (orders as any[]).push({
              orderRef: e.orderRef,
              source: e.supplier || "ebay",                         // 'ebay' | 'amazon' | …
              reg: null,
              make: null, model: null, year: null, vin: null,
              vehicleText: e.fitsVehicle || null,                    // eBay-detected fitment, if any
              seller: e.seller || null,
              orderDate: e.orderDate || null,
              status: e.status || null,
              deliveryStatus: e.status || null,
              eta: e.eta || null,
              tracking: e.tracking || null,
              courier: e.courier || null,
              numberOfItems: e.quantity ?? 1,
              parts: [{ code: e.itemId || null, name: e.title || "eBay item", quantity: e.quantity ?? 1,
                        status: e.status || null, lineCost: price, image: e.image || null, usage: null }],
              totalIncTax: price,
              totalExcTax: null,                                    // eBay price as shown; VAT split unknown
              dbOrderId: null,
              branchId: null,
              ageHours: e.orderDate ? Math.max(0, Math.round((Date.now() - new Date(e.orderDate).getTime()) / 3600000)) : null,
              needsAttention: false,                                // eBay has no same-day SLA to chase
              jobSheet: null,
              ebayAutoCategory: e.autoCategory || "general",        // consumed by the meta-merge below
            });
          }
        } catch (e: any) {
          console.error("eBay merge error:", e?.message);
        }

        // Merge the garage's own facts: whether each part was fitted/returned/spare, and the
        // Car-job vs General-workshop category. Category is auto (eBay: from the item; ECP: a job
        // matched or the ref looks like a plate = car; otherwise general) unless manually overridden.
        try {
          const { getOmnipartOrderMeta, getJobSheetsByIds } = await import("../db");
          const meta = await getOmnipartOrderMeta(orders.map((o) => o.orderRef));
          // Resolve any manual order→job links in one query.
          const linkedIds = Array.from(meta.values()).map((m) => m.jobSheetId).filter((n): n is number => !!n);
          const linkedJobs = linkedIds.length ? await getJobSheetsByIds(linkedIds) : [];
          const jobById = new Map(linkedJobs.map((j) => [j.id, j]));
          const looksLikeReg = (s: string | null) => {
            const k = (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            return k.length >= 5 && k.length <= 8 && /[0-9]/.test(k) && /[A-Z]/.test(k);
          };
          for (const o of orders as any[]) {
            const m = meta.get(o.orderRef);
            o.hidden = !!m?.hidden;                                 // garage-supply / non-parts, hidden from the board
            // A manual job link wins over the reg/date auto-match (and is the only link eBay can have).
            if (m?.jobSheetId && jobById.has(m.jobSheetId)) {
              const j = jobById.get(m.jobSheetId)!;
              o.jobSheet = { id: j.id, docNo: j.docNo, ga4Number: j.ga4Number, docType: j.docType, date: j.dateIssued || j.dateCreated || null };
              o.jobSheetLinked = true;                              // manually linked (vs auto-matched)
              if (!o.reg && j.registration) o.reg = j.registration; // show the linked car's reg in the Reg column
            }
            // For eBay/Amazon orders with no reg, guess the vehicle from the item so the Reg column
            // shows the associated car and we can suggest a job to link.
            if ((o.source === "ebay" || o.source === "amazon") && !o.reg) {
              o.suggestedVehicle = detectVehicle(o.parts?.[0]?.name || o.vehicleText);
            }
            const autoCategory = o.ebayAutoCategory
              ? o.ebayAutoCategory
              : ((o.jobSheet || looksLikeReg(o.reg)) ? "car" : "general");
            o.autoCategory = autoCategory;
            o.categoryOverride = m?.category ?? null;               // what the user pinned (null = auto)
            o.category = m?.category ?? autoCategory;                // effective category used for filtering
            const states = m?.partStates || {};
            for (const p of o.parts as any[]) p.usage = (p.code && states[p.code]) || null;
          }
        } catch (e: any) {
          console.error("Omnipart meta-merge error:", e?.message);
        }

        // Final ordering across both sources, newest first (needs-chasing already handled client-side).
        (orders as any[]).sort((a, b) => String(b.orderDate || "").localeCompare(String(a.orderDate || "")));

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

  // Mark a part fitted / returned / spare (usage=null clears it). Local garage state, no ECP call.
  setPartUsage: protectedProcedure
    .input(z.object({
      orderRef: z.string(),
      code: z.string(),
      usage: z.enum(["fitted", "returned", "spare"]).nullable(),
    }))
    .mutation(async ({ input }) => {
      const { setOmnipartPartState } = await import("../db");
      await setOmnipartPartState(input.orderRef, input.code, input.usage);
      return { ok: true };
    }),

  // Pin an order as a Car job or a General/workshop order (null = fall back to the auto guess).
  setOrderCategory: protectedProcedure
    .input(z.object({
      orderRef: z.string(),
      category: z.enum(["car", "general"]).nullable(),
    }))
    .mutation(async ({ input }) => {
      const { setOmnipartCategory } = await import("../db");
      await setOmnipartCategory(input.orderRef, input.category);
      return { ok: true };
    }),

  // Parts sell (ex VAT) per job — sum of the Part line items' net — for the cost/margin report.
  jobPartsSell: protectedProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .query(async ({ input }) => {
      if (!input.ids.length) return {} as Record<number, number>;
      const { getDb } = await import("../db");
      const { serviceLineItems } = await import("../../drizzle/schema");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return {};
      const rows = await db.select({
        documentId: serviceLineItems.documentId,
        net: sql<number>`coalesce(sum(case when ${serviceLineItems.itemType} = 'Part' then ${serviceLineItems.subNet} else 0 end), 0)`,
      }).from(serviceLineItems)
        .where(sql`${serviceLineItems.documentId} in (${sql.join(input.ids.map((n) => sql`${n}`), sql`, `)})`)
        .groupBy(serviceLineItems.documentId);
      const out: Record<number, number> = {};
      for (const r of rows) out[r.documentId] = Number(r.net) || 0;
      return out;
    }),

  // Reg-first linking, step 1: registrations (that have job cards) matching a reg / make / model.
  searchRegs: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ input }) => {
      const { searchRegistrations } = await import("../db");
      const rows = await searchRegistrations(input.q);
      return rows.map((r: any) => ({
        registration: r.registration,
        vehicle: [r.make, r.model].filter(Boolean).join(" "),
        jobs: Number(r.jobs) || 0,
      }));
    }),

  // Reg-first linking, step 2: the job cards for a chosen registration.
  jobsForReg: protectedProcedure
    .input(z.object({ reg: z.string() }))
    .query(async ({ input }) => {
      const { jobsForReg } = await import("../db");
      const rows = await jobsForReg(input.reg);
      return rows.map((j: any) => ({
        id: j.id, docNo: j.docNo, ga4Number: j.ga4Number, registration: j.registration,
        docType: j.docType, customerName: j.customerName, description: j.description,
        date: j.dateIssued || j.dateCreated || null,
      }));
    }),

  // Search job sheets to attach an order to (by reg, doc/GA4 number, or customer).
  searchJobSheets: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ input }) => {
      const { searchJobSheets } = await import("../db");
      const rows = await searchJobSheets(input.q);
      return rows.map((j: any) => ({
        id: j.id, docNo: j.docNo, ga4Number: j.ga4Number, registration: j.registration,
        docType: j.docType, customerName: j.customerName,
        date: j.dateIssued || j.dateCreated || null,
      }));
    }),

  // Manually link an order to a job sheet (jobSheetId=null unlinks). The board then shows the job
  // and the job's internal margin can include this order's cost.
  setOrderJobSheet: protectedProcedure
    .input(z.object({ orderRef: z.string(), jobSheetId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const { setOmnipartJobSheet } = await import("../db");
      await setOmnipartJobSheet(input.orderRef, input.jobSheetId);
      return { ok: true };
    }),

  // Hide / unhide an order (garage supplies, non-parts buys that shouldn't be on the board).
  setOrderHidden: protectedProcedure
    .input(z.object({ orderRef: z.string(), hidden: z.boolean() }))
    .mutation(async ({ input }) => {
      const { setOmnipartHidden } = await import("../db");
      await setOmnipartHidden(input.orderRef, input.hidden);
      return { ok: true };
    }),

  // Recommend jobs to link an order to, from a guessed vehicle (make/model) or a free query.
  suggestJobs: protectedProcedure
    .input(z.object({ vehicle: z.string() }))
    .query(async ({ input }) => {
      const { suggestJobsByVehicle } = await import("../db");
      const rows = await suggestJobsByVehicle(input.vehicle, 8);
      return rows.map((j: any) => ({
        id: j.id, docNo: j.docNo, ga4Number: j.ga4Number, registration: j.registration,
        customerName: j.customerName, vehicle: [j.make, j.model].filter(Boolean).join(" "),
        date: j.dateIssued || j.dateCreated || null,
      }));
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
        // The endpoint reliably accepts {ref} alone. Including orderId, or branchId as a NUMBER,
        // returns 422 — so we send just the ref.
        const body = JSON.stringify({ ref: input.ref });
        const raw = await omnipartFetch("POST", "https://api.omnipart.eurocarparts.com/account/wismo-order", headers, body);
        const o = raw && typeof raw === "object" && !Array.isArray(raw) ? Object.values(raw)[0] : null;
        if (!o || typeof o !== "object") return { parts: [], deliveryStatus: null, eta: null, orderStatus: null };
        const oo = o as any;
        const parts: Array<{ code: string | null; name: string | null; brand: string | null; quantity: number | null; status: string | null; unitCost: number | null; lineCost: number | null }> = [];
        let deliveryStatus: string | null = null, eta: string | null = null;
        for (const dv of Object.values(oo.deliveries || {}) as any[]) {
          if (dv && typeof dv === "object") {
            if (dv.delivery_status && !deliveryStatus) deliveryStatus = dv.delivery_status;
            if (dv.eta && !eta) eta = dv.eta;
            for (const ln of Object.values(dv.lines || {}) as any[]) {
              // The delivery line already carries the friendly name AND the cost — no extra lookup
              // needed. (The old per-SKU storefront-search fan-out both slowed the expand and, being
              // one API hit per part, was the burst most likely to trip ECP's WAF and blank the row.)
              const lineStatus =
                ln.product_line_delivery_status === true ? "Delivered"
                : ln.product_line_delivery_status === false ? "Pending"
                : (ln.status || ln.line_status || null);
              parts.push({
                code: ln.product_code || ln.sku || null,
                name: ln.product_name || ln.name || null,
                brand: null,
                quantity: ln.quantity ?? ln.qty ?? null,
                status: lineStatus,
                unitCost: ln.price?.unit_cost ?? null,
                lineCost: ln.price?.total_cost ?? null,
              });
            }
          }
        }
        // Fallback name lookup ONLY for the rare line missing an inline product_name — kept tiny so
        // it never becomes a burst again.
        const unnamed = parts.filter((p) => !p.name && p.code).slice(0, 3);
        await Promise.all(unnamed.map(async (p) => {
          try {
            const s = await omnipartFetch("GET", `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${encodeURIComponent(p.code!)}`, headers);
            const raw2 = s?.products || s?.["hydra:member"] || s?.searchResults?.products || [];
            const arr = Array.isArray(raw2) ? raw2 : Object.values(raw2 || {});
            const first: any = arr[0];
            if (first) p.name = first.name || first.updatedProductName || null;
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
        return Array.isArray(data) ? data : [];
      } catch (error: any) {
        const message = error.message || "Failed to fetch digital return reasons";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // The items on a given order that are eligible for a digital return.
  getReturnableItems: protectedProcedure
    .input(z.object({ orderId: z.string(), token: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const headers = await omnipartHeaders(input.token, "https://omnipart.eurocarparts.com/account/order-tracking");
        const url = `https://api.omnipart.eurocarparts.com/orders/${encodeURIComponent(input.orderId)}/digital-return-products`;
        const data = await omnipartFetch("GET", url, headers);
        if (data && (data["@type"] === "hydra:Error" || data.detail)) {
            throw new Error(data.detail || "No returnable items for this order.");
        }
        return data;
      } catch (error: any) {
        const message = error.message || "Failed to fetch returnable items";
        throw new TRPCError({ code: message.toLowerCase().includes("not found") ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // WRITE — submits a digital return, creating a credit request at Euro Car Parts.
  // GATING: call this ONLY from an explicit user action (a confirm button). Never call it on load,
  // in a loop, or as a side effect. The body shape mirrors the Omnipart UI (per-line sku/qty/reason);
  // confirm it against one real button-press before treating returns as fire-and-forget.
  submitDigitalReturn: protectedProcedure
    .input(z.object({
      orderId: z.string(),
      items: z.array(z.object({
        sku: z.string(),
        quantity: z.number(),
        returnLineId: z.string(),
        returnReason: z.string(),
        additionalInfo: z.string().optional(),
      })).min(1),
      token: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const headers = await omnipartHeaders(input.token, "https://omnipart.eurocarparts.com/account/order-tracking");
        const body = JSON.stringify({ order_id: input.orderId, items: input.items });
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
