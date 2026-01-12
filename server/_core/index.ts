import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./serve-static";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

export const app = express();
export const server = createServer(app);

async function startServer() {
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  // Auth routes (login/logout)
  registerAuthRoutes(app);

  // Twilio webhook endpoints
  const { handleTwilioWebhook, handleTwilioStatusCallback, handleWebhookTest } = await import("../webhooks/twilio");
  app.post("/api/webhooks/twilio", handleTwilioWebhook);
  app.post("/api/webhooks/twilio/status", handleTwilioStatusCallback);
  // GET endpoints for testing
  app.get("/api/webhooks/twilio", handleWebhookTest);
  app.get("/api/webhooks/twilio/status", handleWebhookTest);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    // Dynamic import to avoid bundling Vite in production
    const { setupVite } = await import("./vite-dev");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

// Only start the server if this file is run directly
// Only start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.ts')) {
  startServer().catch(console.error);
} else {
  // Initialize routes even if not starting server (for Vercel)
  // Use top-level await to ensure routes are registered before export is used
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Auth routes (login/logout)
  registerAuthRoutes(app);

  try {
    const { handleTwilioWebhook, handleTwilioStatusCallback, handleWebhookTest } = await import("../webhooks/twilio");
    app.post("/api/webhooks/twilio", handleTwilioWebhook);
    app.post("/api/webhooks/twilio/status", handleTwilioStatusCallback);
    app.get("/api/webhooks/twilio", handleWebhookTest);
    app.get("/api/webhooks/twilio/status", handleWebhookTest);
  } catch (e) {
    console.warn("Failed to register Twilio webhooks", e);
  }

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
}
