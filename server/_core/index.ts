import "dotenv/config";
import express, { Express } from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./serve-static";
import { handleTwilioWebhook, handleTwilioStatusCallback, handleWebhookTest } from "../webhooks/twilio";
import { saveAppSetting } from "../db";
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { ENV } from "./env";
import { autodataRouter } from "../routes/autodata";

export const app = express();
export const server = createServer(app);

function isAuthorizedDroneRequest(req: express.Request) {
  const configuredSecret = ENV.autodataDroneSecret.trim();
  if (!configuredSecret) {
    return false;
  }

  const providedSecret = req.header("x-autodata-drone-secret")?.trim();
  return providedSecret === configuredSecret;
}

// Shared setup function
function setupApp(app: Express) {
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Auth routes (login/logout)
  registerAuthRoutes(app);

  // Twilio webhook endpoints
  try {
    app.post("/api/webhooks/twilio", handleTwilioWebhook);
    app.post("/api/webhooks/twilio/status", handleTwilioStatusCallback);
    // GET endpoints for testing
    app.get("/api/webhooks/twilio", handleWebhookTest);
    app.get("/api/webhooks/twilio/status", handleWebhookTest);

    // Read harvested tokens for debugging
    app.get("/api/webhooks/autodata", async (req, res) => {
      try {
        const { getAppSetting } = await import("../db");
        const tokens = await getAppSetting('autodata_tokens');
        res.json({ success: true, tokens });
      } catch (err: any) {
        res.json({ success: false, error: err.message });
      }
    });

    // Autodata Extension Harvester endpoint
    app.post("/api/webhooks/autodata", async (req, res) => {
      // Allow CORS for the extension
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      console.log("\n[AUTODATA HARVESTER] Received new session tokens:");
      console.log(JSON.stringify(req.body, null, 2));

      // Save to database permanently
      try {
        await saveAppSetting('autodata_tokens', req.body);
        console.log("[AUTODATA HARVESTER] Saved tokens to appSettings database table.");
      } catch (err: any) {
        console.error("[AUTODATA HARVESTER] Database save failed:", err.message);
      }

      // Optional: Save to a file so server can read it locally
      try {
        if (process.env.NODE_ENV === "development") {
          fs.writeFileSync(path.join(process.cwd(), 'server', 'autodata_session.json'), JSON.stringify(req.body, null, 2));
        }
      } catch (e: any) {
        console.warn("Could not write session file (expected in Vercel):", e.message);
      }

      res.json({ success: true, received: true });
    });

    // Handle OPTIONS preflight for Autodata
    app.options("/api/webhooks/autodata", (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.status(200).end();
    });

    // Browser Drone Poll Endpoint
    app.get("/api/webhooks/autodata/poll", async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Autodata-Drone-Secret');

      if (!ENV.autodataDroneSecret.trim()) {
        return res.status(503).json({ success: false, error: "Browser Drone is not configured" });
      }

      if (!isAuthorizedDroneRequest(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      try {
        const dbOptions = await import("../db");
        const db = await dbOptions.getDb();
        if (!db) return res.json({ success: false, error: "No DB" });

        const { autodataRequests } = await import("../../drizzle/schema");
        const { eq, asc } = await import("drizzle-orm");

        // Find oldest pending request
        const pending = await db.select()
          .from(autodataRequests)
          .where(eq(autodataRequests.status, "pending"))
          .orderBy(asc(autodataRequests.createdAt))
          .limit(1);

        if (pending.length > 0) {
          // Mark as processing
          await db.update(autodataRequests)
            .set({ status: "processing" })
            .where(eq(autodataRequests.id, pending[0].id));
          return res.json({ success: true, job: pending[0] });
        }
        res.json({ success: true, job: null });
      } catch (err: any) {
        res.json({ success: false, error: err.message });
      }
    });

    app.options("/api/webhooks/autodata/poll", (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Autodata-Drone-Secret');
      res.status(200).end();
    });

    // Browser Drone Result Endpoint
    app.post("/api/webhooks/autodata/result", async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Autodata-Drone-Secret');

      if (!ENV.autodataDroneSecret.trim()) {
        return res.status(503).json({ success: false, error: "Browser Drone is not configured" });
      }

      if (!isAuthorizedDroneRequest(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      try {
        const { id, resultData, errorMessage } = req.body;
        if (!id) return res.json({ success: false, error: "Missing job ID" });

        const dbOptions = await import("../db");
        const db = await dbOptions.getDb();
        if (!db) return res.json({ success: false, error: "No DB" });

        const { autodataRequests } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        await db.update(autodataRequests)
          .set({
            status: errorMessage ? "failed" : "completed",
            resultData: resultData,
            errorMessage: errorMessage || null,
            completedAt: new Date()
          })
          .where(eq(autodataRequests.id, id));

        res.json({ success: true });
      } catch (err: any) {
        res.json({ success: false, error: err.message });
      }
    });

    app.options("/api/webhooks/autodata/result", (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Autodata-Drone-Secret');
      res.status(200).end();
    });
  } catch (e) {
    console.warn("Failed to register Twilio webhooks", e);
  }

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
}

// Initial setup
setupApp(app);

async function startServer(port: number, attempt = 0) {
  if (attempt > 10) {
    console.error("Could not find an available port after 10 attempts.");
    process.exit(1);
  }

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    // Dynamic import to avoid bundling Vite in production
    const { setupVite } = await import("./vite-dev");
    // Vite needs to attach to the server instance
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      server.close();
      startServer(port + 1, attempt + 1);
    } else {
      console.error("Server error:", e);
    }
  });
}

// Only start the server if this file is run directly
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  const preferredPort = parseInt(process.env.PORT || "3000");
  startServer(preferredPort).catch(console.error);
}
