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
            // Step 1: Query the storefront for the category
            // Based on HAR, they load all products for the vehicle using this endpoint
            const url = `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${input.vehicleId}?`;
            const baseResData = await crawlWithCurl("GET", url, apiHeaders);
            
            // The structure is nested: hydra:member[0].products[baseSku][subSku]
            const productGroups = baseResData['hydra:member']?.[0]?.products || {};
            let baseProducts: any[] = [];
            
            // To properly filter by category, we should ideally check the category, but for now 
            // since the user only queried for 'brake pads' we might just take the first N products 
            // from the result. A better way is to do the search first to get SKUs, OR just parse the base products.
            // Wait, the search endpoint DID work earlier, but let's just make sure we get the full product details.
            
            // Actually, querying the search endpoint to get the specific SKUs for the category is safer:
            const keywords = encodeURIComponent(input.categorySlug.replace(/-/g, ' '));
            const categoryResData = await crawlWithCurl(
                "GET",
                 `https://api.omnipart.eurocarparts.com/storefront/search?keywords=${keywords}&vehicleId=${input.vehicleId}`,
                 apiHeaders
            );
            
            const searchProducts = categoryResData.products || [];
            if (searchProducts.length === 0) {
                return { products: [] };
            }
            // Use search endpoint to find the matched products, but get full details from the 
            // vehicle-specific-products endpoint to get brands etc.
            
            // Collect all sub-SKUs from the vehicle-specific endpoint
            for (const baseSku in productGroups) {
                for (const subSku in productGroups[baseSku]) {
                    baseProducts.push(productGroups[baseSku][subSku]);
                }
            }

            skusToLookup = searchProducts.map((p: any) => p.sku || p).slice(0, 15);
            
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
                const baseInfo = baseProducts.find((p: any) => p.sku === sku) || searchProducts.find((p: any) => p.sku === sku) || {};
                const pricingInfo = detailedPricing.find((p: any) => p.sku === sku) || {};
                
                return {
                    sku,
                    name: baseInfo.name || "Unknown Part",
                    brandName: baseInfo.brand?.name || baseInfo.brandName || "Unknown Brand",
                    netPrice: pricingInfo.price?.excTax ? pricingInfo.price.excTax / 100 : 0,
                    rrp: pricingInfo.wasPrice?.excTax ? pricingInfo.wasPrice.excTax / 100 : 0,
                    branchStock: pricingInfo.stock?.reduce((acc: number, val: any) => acc + (val.stock || 0), 0) || 0
                };
            }).filter((p: any) => p.netPrice > 0);

            return { products: finalProducts };
        }

        return { products: priceResData };
      } catch (error: any) {
        const message = error.message || "Failed to search for parts on Omnipart";
        console.error("Omnipart Parts Error:", error.message);
        throw new Error(message);
      }
    })
});
