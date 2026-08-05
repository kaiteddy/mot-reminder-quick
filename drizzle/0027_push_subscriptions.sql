-- Web-push subscriptions: one row per phone that installed the app and allowed notifications.
-- Additive only; applied manually to Neon (mirrors the Drizzle def in drizzle/schema.ts).
--
-- endpoint is unique because the push service issues one per device+install; re-subscribing on
-- the same device returns the same endpoint, so upserts on it keep the table clean.

CREATE TABLE IF NOT EXISTS "pushSubscriptions" (
  "id" serial PRIMARY KEY,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "label" varchar(120),
  "userAgent" text,
  "lastNotifiedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
