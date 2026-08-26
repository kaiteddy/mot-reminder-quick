-- A stock car the paid UKVD lookup can't complete (trade plates, private plates, odd regs)
-- fails the "is it complete?" guard forever, so every stocklist Refresh re-billed it at 14p.
-- Stamp the first BILLED attempt and never pay automatically again — the same never-re-pay
-- rule as vehicles.swsLastUpdated. A forced refresh (forceUkvd) can still re-run it.
-- Additive; applied manually to Neon (mirrors the Drizzle def in drizzle/schema.ts).
ALTER TABLE "salesStock" ADD COLUMN IF NOT EXISTS "ukvdChecked" timestamp;
