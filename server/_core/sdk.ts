import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { ForbiddenError } from "../../shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret) {
      // The old default key is public (in this repo's history). Refuse it in production;
      // only fall back to it for local development.
      if (ENV.isProduction) throw new Error("JWT_SECRET is not set in production");
      return new TextEncoder().encode("default-dev-secret-change-me-in-prod");
    }
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a user openId
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId || "local-app",
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      return {
        openId: openId as string,
        appId: appId as string,
        name: name as string,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user: any = null;
    try {
      user = await db.getUserByOpenId(sessionUserId);
    } catch (e) {
      console.warn("[Auth] Database error during authentication:", e);
    }

    if (!user) {
      // Create the account on first login. Two of them exist, both password-only: 'admin' is
      // the owner's full view, 'staff' is the workshop view. The role here is what every
      // adminProcedure downstream actually tests — the hidden sidebar entries are only
      // cosmetic, so this is the line that really separates the two.
      const KNOWN: Record<string, { name: string; email: string; role: "user" | "admin" }> = {
        admin: { name: "Administrator", email: "admin@example.com", role: "admin" },
        staff: { name: "Workshop Staff", email: "staff@example.com", role: "user" },
      };
      const known = KNOWN[session.openId];
      if (known) {
        try {
          await db.upsertUser({
            openId: session.openId,
            name: known.name,
            email: known.email,
            loginMethod: 'password',
            role: known.role,
            lastSignedIn: signedInAt,
          });
          user = await db.getUserByOpenId(session.openId);
        } catch (e) {
          console.error(`Failed to create ${session.openId} user in DB, using fallback`, e);
        }

        // Fallback if the DB is totally unavailable. Note this keeps the SAME role — a staff
        // session must never be promoted to admin just because the database blinked.
        if (!user) {
          user = {
            id: -1,
            openId: session.openId,
            name: `${known.name} (Recovery Mode)`,
            email: known.email,
            role: known.role,
            lastSignedIn: signedInAt,
          };
        }
      }
    }

    if (!user) {
      throw ForbiddenError("User not found");
    }

    return user as User;
  }
}

export const sdk = new SDKServer();
