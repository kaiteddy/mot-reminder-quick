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
    CREATE TABLE IF NOT EXISTS autodataRequests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      endpoint VARCHAR(255) NOT NULL,
      status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending' NOT NULL,
      resultData JSON,
      errorMessage TEXT,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      completedAt TIMESTAMP NULL
    )
  `);

    console.log("autodataRequests table created.");
    process.exit(0);
}

run();
