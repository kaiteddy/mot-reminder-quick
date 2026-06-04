import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });

// 1) payments / receipts table
await c.query(`CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  documentId INT NOT NULL,
  customerId INT,
  method VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  paymentDate DATETIME,
  note VARCHAR(255),
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX payments_document_id_idx (documentId),
  INDEX payments_customer_id_idx (customerId)
)`);

// 2) policy-excess link columns on serviceHistory (idempotent — ignore "Duplicate column")
const cols: [string, string][] = [
  ["relatedDocId", "INT"],
  ["relatedDocNo", "VARCHAR(50)"],
  ["excessDiscount", "DECIMAL(10,2)"],
  ["custVatRegistered", "INT"],
];
for (const [name, type] of cols) {
  try { await c.query(`ALTER TABLE serviceHistory ADD COLUMN ${name} ${type}`); console.log("added", name); }
  catch (e: any) { if (/Duplicate column/i.test(e.message)) console.log("exists", name); else throw e; }
}

const [p]: any = await c.query("SELECT COUNT(*) n FROM payments");
console.log("payments ready, rows:", p[0].n);
await c.end();
