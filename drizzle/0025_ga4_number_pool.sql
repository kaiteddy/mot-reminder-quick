-- GA4 number pool: reserved real GA4 invoice numbers handed out instantly on web-Issue.
-- Additive only; applied manually to Neon (mirrors the Drizzle def in drizzle/schema.ts).
--
-- Each row is a real GA4 number backed by a pre-created blank GA4 draft. On Issue the webapp
-- atomically pops the lowest 'available' row (FOR UPDATE SKIP LOCKED) and prints it; the Mac
-- worker fills+issues the matching GA4 draft in the background. See the pool-model design.

CREATE TABLE IF NOT EXISTS "ga4NumberPool" (
  "id" serial PRIMARY KEY,
  "ga4Number" varchar(50) NOT NULL UNIQUE,
  "ga4DraftExternalId" varchar(255),
  "status" varchar(12) NOT NULL DEFAULT 'available',   -- available | claimed | filled | failed | dead
  "claimedByDocId" integer,
  "claimedAt" timestamp,
  "filledAt" timestamp,
  "attempts" integer NOT NULL DEFAULT 0,
  "note" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ga4_number_pool_status_idx" ON "ga4NumberPool" ("status");
CREATE INDEX IF NOT EXISTS "ga4_number_pool_claimed_doc_idx" ON "ga4NumberPool" ("claimedByDocId");
