import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import "dotenv/config";
import { ENV } from '../server/_core/env';

async function main() {
    const pool = mysql.createPool({
        uri: ENV.databaseUrl!,
        ssl: { rejectUnauthorized: true },
    });

    try {
        await pool.query("ALTER TABLE vehicles ADD motBookedDate timestamp;");
        console.log("Migration applied successfully: Added motBookedDate");
    } catch (err: any) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log("Column motBookedDate already exists");
        } else {
            console.error("Migration failed:", err);
        }
    }

    // There's a failed migration in drizzle, let's fix it by adding the migration to drizzle's migration table so it stops trying
    // We can just query `insert into __drizzle_migrations (id, hash, created_at) values (...)` maybe?
    // Actually, drizzle-kit migrate keeps track. 
    // Let's just fix the specific schema issue it complained about: `serviceHistory ADD description text;`
    // The error was: Duplicate column name 'description'. Drizzle is trying to run an old migration.

    await pool.end();
}

main();
