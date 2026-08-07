-- The pre-printed form has no email line for the customer — only for ELI as seller. Emails are how
-- the V5C paperwork and the copy invoice get sent now, so the purchaser gets one too, written on
-- the spare half of the postcode line.
ALTER TABLE "vehicleSaleInvoices" ADD COLUMN IF NOT EXISTS "purchaserEmail" varchar(255);
