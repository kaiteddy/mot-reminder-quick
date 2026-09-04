-- The website (CarDealer5) is not the whole stock list: cars in prep, trade cars and
-- part-exchanges are in stock and deliberately not advertised. So the website sync never deletes
-- anything — it stamps the cars it found and leaves the rest alone, and this column is how the
-- forecourt view can then show which cars aren't being advertised, and since when.
-- Additive; applied manually to Neon (mirrors the Drizzle def in drizzle/schema.ts).
ALTER TABLE "salesStock" ADD COLUMN IF NOT EXISTS "lastSeenOnline" timestamp;
