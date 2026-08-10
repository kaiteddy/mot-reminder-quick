-- The sales invoice asks for an engine number, and until now it could only come from the garage's
-- own vehicle record — so a stock car with no workshop history had nowhere to put one. The paid
-- UKVD lookup returns it for any reg, so the stock row gets its own column.
ALTER TABLE "salesStock" ADD COLUMN IF NOT EXISTS "engineNo" varchar(50);
