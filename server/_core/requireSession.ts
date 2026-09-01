import type { Request, Response, NextFunction } from "express";
import { COOKIE_NAME } from "../../shared/const";
import { sdk } from "./sdk";

/**
 * Express-side equivalent of tRPC's protectedProcedure: verify the signed session cookie, or 401.
 *
 * The tRPC API is gated by protectedProcedure, but several plain express routes serve the same
 * data and were reachable by anyone on the internet. /api/customer-lookup/:reg was the worst of
 * them — it takes a registration plate, which is publicly visible on the car itself, and returned
 * the owner's name, home address, phone and email.
 *
 * Deliberately NOT applied to: /api/auth/* (you cannot hold a session before you log in), the
 * inbound webhooks (Twilio and friends have no cookie to send), or /api/cron/* (already gated on
 * CRON_SECRET, which is what Vercel Cron sends).
 */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  try {
    // Same development bypass the tRPC context already honours (server/_core/context.ts), so a
    // local UI check doesn't 401 on half its requests. NODE_ENV is "production" on Vercel.
    if (process.env.NODE_ENV === "development" && req.headers.cookie?.includes("manus_session=mock_dev_session")) {
      next();
      return;
    }

    const cookies = (req.headers.cookie || "").split(";");
    const raw = cookies
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
    const session = raw ? await sdk.verifySession(decodeURIComponent(raw)) : null;
    if (!session) {
      res.status(401).json({ success: false, error: "Not signed in" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ success: false, error: "Not signed in" });
  }
}
