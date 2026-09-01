import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import type { Express, Request, Response } from "express";
import { sdk } from "./sdk";

export function registerAuthRoutes(app: Express) {
  // Simple Password Login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
    // The workshop's own password. Same login box, a smaller view of the app: no purchase
    // costs, no margins, no takings. Unset means no staff login exists at all, which is the
    // right default — an accidentally-blank env var must never become a valid password.
    const staffPassword = process.env.STAFF_PASSWORD || "";

    // Admin is checked first so that setting STAFF_PASSWORD equal to ADMIN_PASSWORD by mistake
    // gives the owner their full view rather than silently demoting them.
    const openId =
      password === adminPassword ? "admin"
      : staffPassword && password === staffPassword ? "staff"
      : null;

    if (!openId) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    try {
      const isAdmin = openId === "admin";
      const sessionToken = await sdk.createSessionToken(openId, {
        name: isAdmin ? "Administrator" : "Workshop Staff",
        expiresInMs: ONE_YEAR_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ONE_YEAR_MS
      });

      res.json({
        success: true,
        user: isAdmin
          ? { name: "Administrator", role: "admin" }
          : { name: "Workshop Staff", role: "user" },
      });
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
