import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
await c.query(`CREATE TABLE IF NOT EXISTS addressLookups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  postcode VARCHAR(12),
  results INT,
  source VARCHAR(40),
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX address_lookups_created_at_idx (createdAt)
)`);
const [n]: any = await c.query("SELECT COUNT(*) n FROM addressLookups");
console.log("addressLookups ready, rows:", n[0].n);
await c.end();
