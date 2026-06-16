import { defineConfig } from "drizzle-kit";

// During migration we target Neon via DATABASE_URL_NEON; after cutover DATABASE_URL
// itself is the Neon URL, so prefer NEON when present and fall back to DATABASE_URL.
const connectionString = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/pg",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
