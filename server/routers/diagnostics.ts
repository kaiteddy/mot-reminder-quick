import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { vehicles, customers } from "../../drizzle/schema";
import { getVehicleDetails } from "../dvlaApi";
import { getMOTHistory } from "../motApi";

export const diagnosticsRouter = router({
  checkCredentials: adminProcedure.query(async () => {
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

  debugVehicle: adminProcedure
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
  costsSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const { ensureUkvdLookupLog } = await import("../ukvd");
    await ensureUkvdLookupLog();

    // Months are matched as "YYYY-MM" text worked out by the database. They used to be matched as
    // parsed dates, but date_trunc on a timestamp column comes back as zoneless text that Node
    // reads in the server's own time zone: on a clock set to British Summer Time "1 September"
    // became 31 August 23:00, matched neither month, and every row read £0.00.
    const months = (await db.execute(sql`SELECT to_char(now(), 'YYYY-MM') AS cur, to_char(now() - interval '1 month', 'YYYY-MM') AS prev`)) as any;
    const { cur, prev } = months.rows[0];
    const since = sql`date_trunc('month', now() - interval '1 month')::timestamp`;

    const two = async (q: any) => {
      const r: any = await db.execute(q);
      const by: Record<string, { n: number; spend: number }> = {};
      for (const row of r.rows) by[String(row.m)] = { n: Number(row.n) || 0, spend: Number(row.spend) || 0 };
      return { thisMonth: by[cur] || { n: 0, spend: 0 }, lastMonth: by[prev] || { n: 0, spend: 0 } };
    };

    // UKVD by BALANCE MOVEMENT between receipts: every billed answer carries the account balance
    // after it, so consecutive balances capture every charge. Drops are spend; rises are top-ups,
    // left out. Since 11/09/2026 every receipt is logged in "ukvdLookups" (server/ukvd.ts). Before
    // that only the latest receipt kept on each vehicle survives, used up to the first logged one.
    // Those old receipts carry no time of their own and are placed by swsLastUpdated, which moves
    // on later SWS fetches too, so a car can bring an old balance forward: LL14LDJ's £147.90 landed
    // between £35.66 and £34.82 on 24/08/2026 and read as a £112 top-up then £113 of spend, making
    // August £166.52 instead of £43.02. A receipt far from both neighbours while they sit close to
    // each other is out of place, and is dropped before the movement is summed.
    const ukvd = await two(sql`
      WITH logstart AS (
        SELECT COALESCE(MIN("createdAt"), 'infinity'::timestamp) s FROM "ukvdLookups" WHERE billed AND balance IS NOT NULL
      ), snaps AS (
        SELECT "createdAt" t, balance bal FROM "ukvdLookups"
         WHERE billed AND balance IS NOT NULL AND "createdAt" >= ${since} - interval '3 days'
        UNION ALL
        SELECT "swsLastUpdated", ("comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance')::numeric
          FROM vehicles
         WHERE "comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance' IS NOT NULL
           AND "swsLastUpdated" >= ${since} - interval '3 days'
           AND "swsLastUpdated" < (SELECT s FROM logstart)
      ), placed AS (
        SELECT t, bal, LAG(bal) OVER w AS prev, LEAD(bal) OVER w AS nxt FROM snaps WINDOW w AS (ORDER BY t)
      ), kept AS (
        SELECT t, bal FROM placed
         WHERE NOT (prev IS NOT NULL AND nxt IS NOT NULL
                    AND abs(prev - nxt) < 0.5 * LEAST(abs(bal - prev), abs(bal - nxt)))
      ), deltas AS (
        SELECT t, GREATEST(LAG(bal) OVER (ORDER BY t) - bal, 0) AS drop FROM kept
      )
      SELECT to_char(t, 'YYYY-MM') m, COUNT(*) FILTER (WHERE drop > 0) n, COALESCE(SUM(drop), 0) spend
        FROM deltas WHERE t >= ${since} GROUP BY 1`);
    const balRow: any = await db.execute(sql`
      SELECT COALESCE(
        (SELECT balance FROM "ukvdLookups" WHERE billed AND balance IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1),
        (SELECT ("comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance')::numeric
           FROM vehicles
          WHERE "comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance' IS NOT NULL
          ORDER BY "swsLastUpdated" DESC NULLS LAST LIMIT 1)) AS balance`);
    const ukvdBalance = balRow.rows[0]?.balance != null ? Number(balRow.rows[0].balance) : null;
    const savedRow: any = await db.execute(sql`
      SELECT COUNT(*) AS n FROM "ukvdLookups" WHERE saved AND "createdAt" >= date_trunc('month', now())::timestamp`);
    const ukvdSavedThisMonth = Number(savedRow.rows[0]?.n) || 0;

    // A day pass is 2.5 credits per car per day, whatever is fetched that day. Two things buy one:
    // the specs/oils/repair-times fetch (swsLastUpdated) and the workshop data (torque settings,
    // fuses, drawings: ctd.workshop.fetchedAt). The same car on the same day is one pass. Only
    // fetches that RETURNED data count - GA4's Technical Data screen states no charge when nothing
    // comes back, and swsLastUpdated is also stamped on empty "attempted" marks.
    const sws = await two(sql`
      SELECT to_char(d, 'YYYY-MM') m, COUNT(*) n, COUNT(*) * 0.40 spend FROM (
        SELECT id, date_trunc('day', "swsLastUpdated") d
          FROM vehicles
         WHERE "swsLastUpdated" >= ${since}
           AND ("comprehensiveTechnicalData"->'specs' IS NOT NULL OR "comprehensiveTechnicalData"->'lubricants' IS NOT NULL)
        UNION
        SELECT id, date_trunc('day', ("comprehensiveTechnicalData"->'workshop'->>'fetchedAt')::timestamptz AT TIME ZONE 'UTC')
          FROM vehicles
         WHERE "comprehensiveTechnicalData"->'workshop'->>'fetchedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      ) passes
      WHERE d >= ${since} GROUP BY 1`);

    const ga4 = await two(sql`
      SELECT to_char("filledAt", 'YYYY-MM') m, COUNT(*) n, COUNT(*) * 0.16 spend
      FROM "ga4NumberPool" WHERE "filledAt" >= ${since} GROUP BY 1`);

    const addr = await two(sql`
      SELECT to_char("createdAt", 'YYYY-MM') m, COUNT(*) n, COUNT(*) * 0.04 spend
      FROM "addressLookups" WHERE source = 'Ideal Postcodes' AND results > 0 AND "createdAt" >= ${since} GROUP BY 1`);

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

    return { ukvd: { ...ukvd, balance: ukvdBalance, savedThisMonth: ukvdSavedThisMonth }, sws, ga4, addr, twilio };
  }),
});
