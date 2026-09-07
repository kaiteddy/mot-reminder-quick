import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME } from "../../shared/const";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // Development bypass for UI verification
  if (process.env.NODE_ENV === "development") {
    const cookieHeader = opts.req.headers.cookie;
    if (cookieHeader?.includes("manus_session=mock_dev_session")) {
      user = {
        id: 0,
        openId: "mock_dev_user",
        name: "Developer",
        email: "dev@example.com",
        // Admin, so the owner-only pages (Conversations, settings, reports) can be verified too.
        role: "admin",
        loginMethod: "mock",
        lastSignedIn: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User;
    }
  }

  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
      // A session cookie that won't verify — nearly always one signed with a previous
      // JWT_SECRET — otherwise sits in the browser failing every request for a year, and the
      // login screen just bounces back with nothing to show for it. Drop it here so the next
      // sign-in starts from a clean slate instead of needing the site data cleared by hand.
      if (opts.req.headers.cookie?.includes(`${COOKIE_NAME}=`)) {
        try { opts.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(opts.req)); } catch { /* headers already sent */ }
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
