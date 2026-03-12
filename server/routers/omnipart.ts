import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import axios from "axios";

export const omnipartRouter = router({
  // Lookup Vehicle by VRM to get Omnipart's internal vehicleId
  lookupVrm: publicProcedure
    .input(z.object({
      vrm: z.string(),
      token: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        const cleanToken = input.token.replace(/^"|"$/g, '').trim();
        const res = await axios.post(
          "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
          { vrm: input.vrm, saveToCache: true },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${cleanToken}`,
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/json, text/plain, */*",
              "Origin": "https://omnipart.eurocarparts.com",
              "Referer": "https://omnipart.eurocarparts.com/"
            }
          }
        );
        return res.data; // Includes vehicleId, make, model, etc.
      } catch (error: any) {
        console.error("Omnipart VRM Error:", error.response?.data || error.message);
        throw new Error("Failed to look up VRM on Omnipart.");
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
        
        const cleanToken = input.token.replace(/^"|"$/g, '').trim();
        const apiHeaders = {
            "Authorization": `Bearer ${cleanToken}`,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://omnipart.eurocarparts.com",
            "Referer": "https://omnipart.eurocarparts.com/"
        };

        if (!input.skus && input.vehicleId && input.categorySlug) {
          const categoryRes = await axios.get(
            `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${input.vehicleId}?category=${input.categorySlug}`,
            { headers: apiHeaders }
          );
          // Assuming the category endpoint returns an array of SKUs or product objects
          // We extract up to 5 SKUs for demo
          skusToLookup = (categoryRes.data.products || categoryRes.data || []).map((p: any) => p.sku || p).slice(0, 5);
        }

        if (skusToLookup.length === 0) {
          return { products: [] };
        }

        // Step 2: Get detailed pricing and stock for the SKUs
        const queryParams = skusToLookup.map(s => `skus[]=${s}`).join('&');
        const priceRes = await axios.get(
          `https://api.omnipart.eurocarparts.com/products/product-information?${queryParams}`,
          { headers: apiHeaders }
        );

        return { products: priceRes.data };
      } catch (error: any) {
        console.error("Omnipart Parts Error:", error.response?.data || error.message);
        throw new Error("Failed to search for parts on Omnipart.");
      }
    })
});
