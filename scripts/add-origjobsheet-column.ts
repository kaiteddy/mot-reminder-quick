/**
 * Idempotently add serviceHistory.origJobSheetNo to the live (Neon) DB.
 *   npx tsx scripts/add-origjobsheet-column.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`ALTER TABLE "serviceHistory" ADD COLUMN IF NOT EXISTS "origJobSheetNo" integer`);
  const check: any = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'serviceHistory' AND column_name = 'origJobSheetNo'`);
  console.log("origJobSheetNo present:", ((check.rows || check) as any[]).length > 0);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
