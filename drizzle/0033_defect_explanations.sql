-- Plain-English MOT defect explanation cache: one row per distinct DVSA defect wording +
-- severity. Additive only; applied manually to Neon (mirrors the Drizzle def in
-- drizzle/schema.ts).
--
-- DVSA reason-for-rejection texts are standardized, so the same advisory recurs across
-- thousands of tests — the first "Explain" click on a given wording costs one AI call,
-- every later click on any vehicle is a cache hit.

CREATE TABLE IF NOT EXISTS "defectExplanations" (
  "id" serial PRIMARY KEY,
  "defectKey" varchar(64) NOT NULL UNIQUE,
  "defectText" text NOT NULL,
  "defectType" varchar(20),
  "explanation" jsonb NOT NULL,
  "aiModel" varchar(60),
  "createdAt" timestamp NOT NULL DEFAULT now()
);
