-- A car logged from a supplier's purchase invoice records which invoice it came from.
--
-- Needed so the "Vehicle-stock purchases" list can show a purchase that has been invoiced but not
-- yet paid out of the bank. Those rows are identified by this column rather than by sniffing the
-- notes text — a human typing "invoice" in a note must never turn their car into a pending payment.
ALTER TABLE "carDeals" ADD COLUMN IF NOT EXISTS "purchaseInvoiceRef" varchar(40);
