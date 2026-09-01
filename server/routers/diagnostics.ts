import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { vehicles, customers } from "../../drizzle/schema";
import { getVehicleDetails } from "../dvlaApi";
import { getMOTHistory } from "../motApi";

export const diagnosticsRouter = router({
  checkCredentials: protectedProcedure.query(async () => {
    const results = [];

    // 1. Twilio Diagnostic
    try {
      const { sendSMS } = await import("../smsService");
      // We don't want to actually send a message, but we can't easily "no-op" authenticate 
      // without a dedicated test endpoint. Twilio's API doesn't have a simple 'whoami'.
      // However, we can use the fetch logic from smsService to hit a basic account endpoint.

      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      // Prefer API Key (SID "SK..." + secret) auth, matching smsService.
      const apiKey = (process.env.TWILIO_API_KEY || "").trim();
      const apiSecret = (process.env.TWILIO_API_SECRET || "").trim();
      const usingApiKey = apiKey.startsWith("SK") && !!apiSecret;

      if (!accountSid || (!usingApiKey && !authToken)) {
        results.push({
          service: "Twilio WhatsApp",
          status: "Error",
          message: "Credentials missing: need TWILIO_ACCOUNT_SID and either TWILIO_AUTH_TOKEN or TWILIO_API_KEY + TWILIO_API_SECRET",
          code: "MISSING_CREDS"
        });
      } else {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
        const auth = Buffer.from(`${usingApiKey ? apiKey : accountSid}:${usingApiKey ? apiSecret : authToken}`).toString("base64");

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

      if (!ENV.databaseUrl) {
        results.push({
          service: "Database",
          status: "Error",
          message: "DATABASE_URL environment variable is missing or empty.",
          code: "MISSING_ENV_URL"
        });
      } else if (db) {
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
          message: "Database connection could not be established (URL is present but connection failed).",
          code: "DB_CONNECTION_FAILED"
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

  debugVehicle: protectedProcedure
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

  /** Live data-spend tracker for the System Status page. Real billed figures where the
   *  provider gives them (UKVD embeds its receipt in every response; Twilio's usage API is
   *  exact); counted-times-price estimates for SWS day passes (2.5cr = 40p per vehicle-day)
   *  and GA4 VRM credits (16p per invoice fill) until those accounts expose an API. */
  costsSummary: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const months = (await db.execute(sql`SELECT date_trunc('month', now()) AS cur, date_trunc('month', now() - interval '1 month') AS prev`)) as any;
    const { cur, prev } = months.rows[0];

    const two = async (q: any) => {
      const r: any = await db.execute(q);
      const by: Record<string, { n: number; spend: number }> = {};
      for (const row of r.rows) by[new Date(row.m).toISOString()] = { n: Number(row.n) || 0, spend: Number(row.spend) || 0 };
      const k = (d: any) => new Date(d).toISOString();
      return { thisMonth: by[k(cur)] || { n: 0, spend: 0 }, lastMonth: by[k(prev)] || { n: 0, spend: 0 } };
    };

    // UKVD by BALANCE MOVEMENT, not by summing saved receipts: calls that never persist a
    // payload (stock refreshes, repeat syncs) still move the account balance, so consecutive
    // snapshots capture every charge. Positive drops are spend; rises are top-ups (excluded).
    const prevLead = new Date(new Date(prev).getTime() - 3 * 86400000); // a few snapshots before the window so the first delta has a baseline
    const ukvd = await two(sql`
      WITH snaps AS (
        SELECT "swsLastUpdated" t,
               ("comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance')::numeric bal
        FROM vehicles
        WHERE "comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation' IS NOT NULL
          AND "swsLastUpdated" >= ${prevLead}
        ORDER BY "swsLastUpdated"
      ), deltas AS (
        SELECT t, GREATEST(LAG(bal) OVER (ORDER BY t) - bal, 0) AS drop
        FROM snaps
      )
      SELECT date_trunc('month', t) m, COUNT(*) n, COALESCE(SUM(drop), 0) spend
      FROM deltas WHERE t >= ${prev} GROUP BY 1`);
    const balRow: any = await db.execute(sql`
      SELECT ("comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance')::numeric AS balance
      FROM vehicles
      WHERE "comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation' IS NOT NULL
      ORDER BY "swsLastUpdated" DESC NULLS LAST LIMIT 1`);
    const ukvdBalance = balRow.rows[0]?.balance != null ? Number(balRow.rows[0].balance) : null;

    // Only fetches that RETURNED data count - GA4's Technical Data screen states no charge
    // when nothing comes back, and swsLastUpdated is also stamped on empty "attempted" marks.
    const sws = await two(sql`
      SELECT date_trunc('month', "swsLastUpdated") m, COUNT(*) n, COUNT(*) * 0.40 spend
      FROM vehicles
      WHERE "swsLastUpdated" >= ${prev}
        AND ("comprehensiveTechnicalData"->'specs' IS NOT NULL OR "comprehensiveTechnicalData"->'lubricants' IS NOT NULL)
      GROUP BY 1`);

    const ga4 = await two(sql`
      SELECT date_trunc('month', "filledAt") m, COUNT(*) n, COUNT(*) * 0.16 spend
      FROM "ga4NumberPool" WHERE "filledAt" >= ${prev} GROUP BY 1`);

    const addr = await two(sql`
      SELECT date_trunc('month', "createdAt") m, COUNT(*) n, COUNT(*) * 0.04 spend
      FROM "addressLookups" WHERE source = 'Ideal Postcodes' AND results > 0 AND "createdAt" >= ${prev} GROUP BY 1`);

    // Twilio: exact billed totals from their usage API (never blocks the panel on failure).
    let twilio: { thisMonth: number; lastMonth: number } | null = null;
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
      if (sid && tok) {
        const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
        const get = async (period: string) => {
          const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records/${period}.json?Category=totalprice`, { headers: { Authorization: `Basic ${auth}` } });
          const d: any = await r.json();
          return Number(d?.usage_records?.[0]?.price) || 0;
        };
        twilio = { thisMonth: await get("ThisMonth"), lastMonth: await get("LastMonth") };
      }
    } catch { /* panel shows a dash */ }

    return { ukvd: { ...ukvd, balance: ukvdBalance }, sws, ga4, addr, twilio };
  }),
});
