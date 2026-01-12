import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import type { Express, Request, Response } from "express";
import { sdk } from "./sdk";

export function registerAuthRoutes(app: Express) {
  // Simple Password Login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

    if (password !== adminPassword) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    try {
      // Create session for 'admin' user
      const sessionToken = await sdk.createSessionToken("admin", {
        name: "Administrator",
        expiresInMs: ONE_YEAR_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ONE_YEAR_MS
      });

      res.json({ success: true, user: { name: "Administrator", role: "admin" } });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ success: true });
  });
}
