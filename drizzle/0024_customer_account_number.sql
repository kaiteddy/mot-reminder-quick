-- Layer A: GA4 account number as a customer-level identity key.
-- Additive only; applied manually to Neon (mirrors the Drizzle def in drizzle/schema.ts,
-- same pattern as the ga4Number / expenditure-reconciliation adds). No existing column touched.
--
-- Why: the sync links & de-duplicates customers purely by GA4 GUID + manual phone/name merges,
-- discarding GA4's AccountNumber. That let two different accounts sharing a phone (SHA019, ROS013)
-- get merged and mis-attached invoices. Surfacing the account number makes it usable as the key.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "accountNumber" varchar(50);
CREATE INDEX IF NOT EXISTS "customers_account_number_idx" ON "customers" ("accountNumber");
