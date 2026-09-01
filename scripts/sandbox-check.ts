import { config } from "dotenv";
config();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
process.env.DATABASE_URL_NEON = process.env.TEST_DATABASE_URL!;
async function main() {
  const { getDb } = await import("/Users/service/mot-reminder-quick-wt-main/server/db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  const r: any = (await db!.execute(sql`SELECT count(*) AS total, count(*) FILTER (WHERE "messageSid" LIKE 'test-sid-%') AS test_rows FROM "customerMessages"`)).rows[0];
  console.log(`SANDBOX: ${r.total} rows, ${r.test_rows} test fixtures`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
