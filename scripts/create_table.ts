import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
    const db = await getDb();
    if (!db) {
        console.error("No db");
        process.exit(1);
    }

    try {
        const query = sql`
      CREATE TABLE IF NOT EXISTS appointments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vehicleId INT,
        customerId INT,
        registration VARCHAR(20),
        bayId VARCHAR(50) NOT NULL,
        appointmentDate DATETIME NOT NULL,
        startTime VARCHAR(10),
        endTime VARCHAR(10),
        status VARCHAR(20) DEFAULT 'scheduled' NOT NULL,
        notes TEXT,
        orderIndex INT DEFAULT 0 NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        INDEX appointments_date_idx (appointmentDate),
        INDEX appointments_bay_idx (bayId)
      );
    `;
        await db.execute(query);
        console.log("Table created");
    } catch (e) {
        console.error("Creation failed", e);
    }
    process.exit(0);
}

run();
