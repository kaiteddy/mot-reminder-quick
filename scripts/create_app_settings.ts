import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  const db = await getDb();
  if (!db) {
    console.error("No DB");
    process.exit(1);
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS \`appSettings\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`keyName\` varchar(100) NOT NULL,
      \`value\` json DEFAULT NULL,
      \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`appSettings_keyName_unique\` (\`keyName\`)
    );
  `);
  console.log("Created appSettings table if it didn't exist");
  process.exit(0);
}
run();
