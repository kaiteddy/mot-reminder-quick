import { publicProcedure, router } from "../_core/trpc";
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

export const omnipartRouter = router({
  // Lookup Vehicle by VRM to get Omnipart's internal vehicleId
  lookupVrm: publicProcedure
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
        console.error("Omnipart VRM Error:", error.message);
        throw new Error(message);
      }
    }),

  // Get matching parts based on vehicleId and search query / category
  getPartsInfo: publicProcedure
    .input(z.object({
      vehicleId: z.string().optional(),
      categorySlug: z.string().optional(),
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

        if (!input.skus && input.vehicleId && input.categorySlug) {
          const keywords = encodeURIComponent(input.categorySlug.replace(/-/g, ' '));
          const categoryResData = await crawlWithCurl(
            "GET",
             `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${keywords}&vehicleId=${input.vehicleId}`,
             apiHeaders
          );
          // Assuming the category endpoint returns an array of SKUs or product objects
          skusToLookup = (categoryResData.products || categoryResData || []).map((p: any) => p.sku || p).slice(0, 5);
        }

        if (skusToLookup.length === 0) {
          return { products: [] };
        }

        // Step 2: Get detailed pricing and stock for the SKUs
        const queryParams = skusToLookup.map((s: string) => `skus[]=${s}`).join('&');
        const priceResData = await crawlWithCurl(
          "GET",
          `https://api.omnipart.eurocarparts.com/products/product-information?${queryParams}`,
          apiHeaders
        );

        return { products: priceResData };
      } catch (error: any) {
        const message = error.message || "Failed to search for parts on Omnipart";
        console.error("Omnipart Parts Error:", error.message);
        throw new Error(message);
      }
    })
});
