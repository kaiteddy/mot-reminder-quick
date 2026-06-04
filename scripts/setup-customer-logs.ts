import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
await c.query(`CREATE TABLE IF NOT EXISTS customerLogs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customerId INT,
  vehicleId INT,
  documentId INT,
  type ENUM('note','email','sms','call','letter','system') NOT NULL DEFAULT 'note',
  direction ENUM('in','out','internal') NOT NULL DEFAULT 'out',
  subject VARCHAR(255),
  body TEXT,
  createdBy VARCHAR(100),
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX customer_logs_customer_id_idx (customerId),
  INDEX customer_logs_vehicle_id_idx (vehicleId),
  INDEX customer_logs_created_at_idx (createdAt)
)`);
const [cnt]: any = await c.query("SELECT COUNT(*) n FROM customerLogs");
console.log("customerLogs ready, rows:", cnt[0].n);
await c.end();
