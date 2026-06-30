-- Expenditure reconciliation (Profit & Cashbook) — additive tables.
-- Applied manually to Neon (additive only; no changes to existing tables).
-- Mirrors the Drizzle defs in drizzle/schema.ts.

CREATE TABLE IF NOT EXISTS "expenditureCategories" (
  "id" serial PRIMARY KEY,
  "name" varchar(80) NOT NULL UNIQUE,
  "section" varchar(20) NOT NULL,           -- receipts | cogs | cartrade | overheads | taxes | financing
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isContra" integer NOT NULL DEFAULT 0,    -- 1 = transfer/settlement, excluded from P&L
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "expenditure_categories_section_idx" ON "expenditureCategories" ("section");

CREATE TABLE IF NOT EXISTS "transactionLabels" (   -- cascade: counterparty -> category
  "id" serial PRIMARY KEY,
  "source" varchar(8) NOT NULL,
  "counterpartyKey" varchar(200) NOT NULL,
  "category" varchar(80) NOT NULL,
  "note" text,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_labels_source_key_idx" ON "transactionLabels" ("source","counterpartyKey");

CREATE TABLE IF NOT EXISTS "bankTransactions" (
  "id" serial PRIMARY KEY,
  "source" varchar(8) NOT NULL,             -- bank | card
  "txnDate" timestamp NOT NULL,
  "amount" numeric(12,2) NOT NULL,          -- signed: money out = negative
  "direction" varchar(4) NOT NULL,
  "counterparty" varchar(255),
  "counterpartyKey" varchar(200),
  "memo" text,
  "cardHolder" varchar(120),
  "bankCategoryHint" varchar(120),
  "subcategory" varchar(120),
  "categoryOverride" varchar(80),
  "dedupeKey" varchar(64) NOT NULL UNIQUE,
  "importBatch" varchar(40),
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bank_transactions_date_idx" ON "bankTransactions" ("txnDate");
CREATE INDEX IF NOT EXISTS "bank_transactions_source_idx" ON "bankTransactions" ("source");
CREATE INDEX IF NOT EXISTS "bank_transactions_counterparty_key_idx" ON "bankTransactions" ("counterpartyKey");

-- Phase 2: car-trading ledger
CREATE TABLE IF NOT EXISTS "carDeals" (
  "id" serial PRIMARY KEY,
  "registration" varchar(20),
  "description" varchar(160),
  "purchaseCost" numeric(12,2),
  "purchaseDate" timestamp,
  "salePrice" numeric(12,2),
  "saleDate" timestamp,
  "askingPrice" numeric(12,2),            -- forecourt reference price
  "reconditioningCost" numeric(12,2),
  "status" varchar(12) NOT NULL DEFAULT 'in_stock',  -- in_stock | sold
  "salesStockId" integer,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "car_deals_reg_idx" ON "carDeals" ("registration");
CREATE INDEX IF NOT EXISTS "car_deals_status_idx" ON "carDeals" ("status");

-- Associate a vehicle-stock purchase to a car deal
ALTER TABLE "bankTransactions" ADD COLUMN IF NOT EXISTS "carDealId" integer;
CREATE INDEX IF NOT EXISTS "bank_transactions_car_deal_idx" ON "bankTransactions" ("carDealId");

-- Seed in-stock cars from current forecourt (run once):
-- INSERT INTO "carDeals" ("registration","description","askingPrice","status","salesStockId")
-- SELECT "registration", trim(concat_ws(' ', NULLIF("year"::text,''), initcap("make"), initcap("model"))),
--        "price", 'in_stock', "id" FROM "salesStock";
