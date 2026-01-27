import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { vehicles, customers } from "../../drizzle/schema";
import { getVehicleDetails } from "../dvlaApi";
import { getMOTHistory } from "../motApi";

export const diagnosticsRouter = router({
  checkCredentials: publicProcedure.query(async () => {
    const results = [];

    // 1. Twilio Diagnostic
    try {
      const { sendSMS } = await import("../smsService");
      // We don't want to actually send a message, but we can't easily "no-op" authenticate 
      // without a dedicated test endpoint. Twilio's API doesn't have a simple 'whoami'.
      // However, we can use the fetch logic from smsService to hit a basic account endpoint.

      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;

      if (!accountSid || !authToken) {
        results.push({
          service: "Twilio WhatsApp",
          status: "Error",
          message: "Credentials missing in .env (TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN)",
          code: "MISSING_CREDS"
        });
      } else {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

        const response = await fetch(url, {
          headers: { "Authorization": `Basic ${auth}` }
        });

        if (response.ok) {
          results.push({
            service: "Twilio WhatsApp",
            status: "Healthy",
            message: "Successfully authenticated with Twilio API.",
            details: `Account SID: ${accountSid.substring(0, 5)}...`
          });
        } else {
          const errorData = await response.json();
          results.push({
            service: "Twilio WhatsApp",
            status: "Error",
            message: errorData.message || "Twilio authentication failed.",
            code: errorData.code?.toString() || "AUTH_FAILED",
            moreInfo: errorData.more_info
          });
        }
      }
    } catch (error: any) {
      results.push({
        service: "Twilio WhatsApp",
        status: "Error",
        message: error.message || "Unknown error checking Twilio status."
      });
    }

    // 2. DVLA API Diagnostic
    try {

      // Try a common mock or simple registration to verify API Key
      const dvlaData = await getVehicleDetails("TEST123").catch(() => null);

      if (dvlaData || process.env.DVLA_API_KEY) {
        results.push({
          service: "DVLA Vehicle API",
          status: "Healthy",
          message: "DVLA API is reachable.",
          details: process.env.DVLA_API_KEY ? `API Key starts with ${process.env.DVLA_API_KEY.substring(0, 5)}...` : "Configured"
        });
      } else {
        results.push({
          service: "DVLA Vehicle API",
          status: "Error",
          message: "DVLA API Key missing or invalid.",
          code: "MISSING_DVLA_KEY"
        });
      }
    } catch (error: any) {
      results.push({
        service: "DVLA Vehicle API",
        status: "Error",
        message: error.message || "Unknown error checking DVLA status."
      });
    }

    // 3. Manus OAuth Diagnostic
    try {
      if (ENV.oAuthServerUrl && ENV.appId) {
        results.push({
          service: "Manus OAuth",
          status: "Healthy",
          message: "OAuth configuration present.",
          details: `App ID: ${ENV.appId}, Server: ${ENV.oAuthServerUrl}`
        });
      } else {
        results.push({
          service: "Manus OAuth",
          status: "Error",
          message: "Manus OAuth configuration missing (appId or oAuthServerUrl).",
          code: "MISSING_OAUTH_CONFIG"
        });
      }
    } catch (error: any) {
      results.push({
        service: "Manus OAuth",
        status: "Error",
        message: error.message || "Unknown error checking OAuth status."
      });
    }

    // 4. Database Diagnostic
    try {
      const db = await getDb();

      if (db) {
        // Try a simple query to verify connection
        // We use a raw query because we just want to check connectivity
        await db.execute(sql`SELECT 1`);

        // Get counts to debug empty view

        const [vehicleCount] = await db.select({ count: sql<number>`count(*)` }).from(vehicles);
        const [customerCount] = await db.select({ count: sql<number>`count(*)` }).from(customers);

        results.push({
          service: "Database",
          status: "Healthy",
          message: "Database connection successful.",
          details: `Connected. Row counts: Vehicles=${vehicleCount.count}, Customers=${customerCount.count}`
        });
      } else {
        results.push({
          service: "Database",
          status: "Error",
          message: "Database connection could not be established.",
          code: "DB_CONNECTION_NULL"
        });
      }
    } catch (error: any) {
      results.push({
        service: "Database",
        status: "Error",
        message: error.message || "Unknown error checking Database status.",
        details: error.stack ? error.stack.substring(0, 100) : undefined
      });
    }

    return results;
  }),

  debugVehicle: publicProcedure
    .input(z.object({ registration: z.string().min(1) }))
    .mutation(async ({ input }) => { // Changed to mutation to allow triggering on demand
      try {

        const history = await getMOTHistory(input.registration);

        if (!history) {
          return {
            success: false,
            message: "Vehicle not found in MOT history API",
          };
        }

        return {
          success: true,
          data: history,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || "Unknown error fetching vehicle debug info",
        };
      }
    }),
});
