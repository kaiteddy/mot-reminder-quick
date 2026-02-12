import "dotenv/config";
import express, { Express } from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./serve-static";
import { handleTwilioWebhook, handleTwilioStatusCallback, handleWebhookTest } from "../webhooks/twilio";
import { fileURLToPath } from 'url';

export const app = express();
export const server = createServer(app);

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
