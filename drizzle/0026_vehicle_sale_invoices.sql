-- Used Car Sales Invoice — the pre-printed HMRC margin-scheme form (VAT (Cars) Order 1972
-- S.I. No. 1970) filled in when a stock car is sold.
-- Additive only; applied manually to Neon (mirrors the Drizzle def in drizzle/schema.ts).
--
-- Its own table on purpose: serviceHistory is a one-way mirror of GA4 and the sync would wipe
-- anything the web app wrote there. Column names match the form's `data-field` keys 1:1.
-- Every field is free text — this is a paper form, not a ledger, and nothing here feeds the
-- accounts export or the VAT return.

CREATE TABLE IF NOT EXISTS "vehicleSaleInvoices" (
  "id" serial PRIMARY KEY,
  "salesStockId" integer,
  "vehicleId" integer,
  "customerId" integer,

  -- transaction block (top right)
  "invoiceNumber" varchar(50),
  "transactionDate" varchar(30),
  "stockNumber" varchar(50),
  "dayBookFolio" varchar(50),
  "salesman" varchar(100),
  "purchaserStockNumber" varchar(50),
  "purchaserDayBookFolio" varchar(50),

  -- purchaser block (left)
  "purchaserName" varchar(255),
  "purchaserAddress" text,
  "purchaserTelephone" varchar(50),

  -- vehicle sold
  "grossPrice" varchar(30),
  "vehicleMake" varchar(100),
  "vehicleType" varchar(255),
  "registrationNumber" varchar(20),
  "chassisNumber" varchar(50),
  "engineNumber" varchar(50),
  "firstRegisteredUK" varchar(30),
  "lastOwnerDetails" text,
  "mileage" varchar(30),

  -- money down the right-hand side
  "lessLicenceValue" varchar(30),
  "partExchangeAllowance" varchar(30),
  "deposit" varchar(30),
  "balance" varchar(30),
  "settlementNotes" varchar(255),

  -- goods taken in part exchange
  "partExchangeMake" varchar(100),
  "partExchangeType" varchar(255),
  "partExchangeRegistration" varchar(20),
  "partExchangeChassis" varchar(50),
  "partExchangeEngine" varchar(50),
  "partExchangeFirstRegisteredUK" varchar(30),

  -- certificates
  "sellerCertificateDate" varchar(30),
  "sellerCertificateAddress" varchar(255),
  "buyerCertificateDate" varchar(30),
  "sellerSignature" text,
  "buyerSignature" text,

  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "vehicle_sale_invoices_sales_stock_idx" ON "vehicleSaleInvoices" ("salesStockId");
CREATE INDEX IF NOT EXISTS "vehicle_sale_invoices_reg_idx" ON "vehicleSaleInvoices" ("registrationNumber");
