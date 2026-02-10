import "dotenv/config";
import mysql from "mysql2/promise";

async function migrate() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL not found");
        return;
    }

    console.log("Connecting to database to apply migration 0018...");
    const connection = await mysql.createConnection({
        uri: url,
        ssl: { rejectUnauthorized: true },
    });

    try {
        console.log("Adding 'description' column to 'serviceHistory'...");
        await connection.execute("ALTER TABLE `serviceHistory` ADD COLUMN IF NOT EXISTS `description` text;");
        console.log("SUCCESS: Database schema updated.");
    } catch (error: any) {
        if (error.message.includes("Duplicate column name")) {
            console.log("Column already exists, skipping.");
        } else {
            console.error("Migration failed:", error.message);
        }
    } finally {
        await connection.end();
    }
}

migrate();
