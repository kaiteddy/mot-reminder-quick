import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import axios from "axios";

export const omnipartRouter = router({
  // Helper to login and get Bearer token for Omnipart
  loginOmnipart: publicProcedure
    .input(z.object({
      recaptchaToken: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        // 1. Send recaptcha verification (requires frontend token)
        const recaptchaRes = await axios.post(
          "https://omnipart.eurocarparts.com/api/recaptcha",
          { token: input.recaptchaToken },
          { headers: { "Content-Type": "application/json" } }
        );

        if (!recaptchaRes.data.success) {
          throw new Error("ReCaptcha validation failed on Omnipart backend.");
        }

        // 2. Perform authentication login
        const loginRes = await axios.post(
          "https://api.omnipart.eurocarparts.com/auth",
          {
            email: process.env.OMNIPART_EMAIL || "eli@elimotors.co.uk",
            password: process.env.OMNIPART_PASSWORD || "Rutstein8029"
          },
          { headers: { "Content-Type": "application/json" } }
        );

        return {
          success: true,
          token: loginRes.data.token,
          refreshToken: loginRes.data.refresh_token
        };

      } catch (error: any) {
        console.error("Omnipart Login Error:", error.response?.data || error.message);
        throw new Error("Failed to authenticate with Omnipart. Ensure ReCaptcha token is valid.");
      }
    }),

  // Lookup Vehicle by VRM to get Omnipart's internal vehicleId
  lookupVrm: publicProcedure
    .input(z.object({
      vrm: z.string(),
      token: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        const res = await axios.post(
          "https://api.omnipart.eurocarparts.com/storefront/vehicle-search/vrm",
          { vrm: input.vrm, saveToCache: true },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${input.token}`
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
        
        if (!input.skus && input.vehicleId && input.categorySlug) {
          const categoryRes = await axios.get(
            `https://api.omnipart.eurocarparts.com/storefront/vehicle-specific-products/${input.vehicleId}?category=${input.categorySlug}`,
            {
              headers: { "Authorization": `Bearer ${input.token}` }
            }
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
          {
            headers: { "Authorization": `Bearer ${input.token}` }
          }
        );

        return { products: priceRes.data };
      } catch (error: any) {
        console.error("Omnipart Parts Error:", error.response?.data || error.message);
        throw new Error("Failed to search for parts on Omnipart.");
      }
    })
});
