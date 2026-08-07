-- The same pre-printed pad is used both ways round: to sell a car, and to buy one off a customer.
--
-- On a purchase the "Name & Address of last Owner or Keeper" block doesn't apply — the person
-- signing IS the last keeper — so it gets struck out and marked PURCHASE by hand. Recording which
-- kind of document this is lets the form do that itself.
ALTER TABLE "vehicleSaleInvoices" ADD COLUMN IF NOT EXISTS "docKind" varchar(10) NOT NULL DEFAULT 'sale';
