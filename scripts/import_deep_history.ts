import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import { getDb } from '../server/db';
import {
    customers, vehicles, serviceHistory, serviceLineItems
} from '../drizzle/schema';
import "dotenv/config";
import { sql } from 'drizzle-orm';

const EXPORT_DIR = "/Users/service/Desktop/Data Exports";

function loadCsv(filename: string) {
    const filePath = path.join(EXPORT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return [];
    }
    const buffer = fs.readFileSync(filePath);
    const content = iconv.decode(buffer, 'win1252');
    return parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true
    });
}

function isValidDate(dateStr: string) {
    if (!dateStr || isNaN(Date.parse(dateStr))) return false;
    const d = new Date(dateStr);
    const year = d.getFullYear();
    return year > 1900 && year < 2100;
}

function toDecimal(val: any) {
    if (val === undefined || val === null || val === '') return "0.00";
    const str = String(val);
    const cleaned = str.replace(/[^0-9.\-]/g, "");
    const parsed = parseFloat(cleaned);
    if (isNaN(parsed) || !isFinite(parsed)) return "0.00";
    return parsed.toFixed(2);
}

function safeInt(val: any) {
    if (val === undefined || val === null || val === '') return null;
    const cleaned = String(val).replace(/[^0-9.\-]/g, "");
    const parsed = parseInt(cleaned);
    return isNaN(parsed) ? null : parsed;
}

const BATCH_SIZE = 100;

async function runDeepImport() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    console.log("--- STARTING CORRECTED DEEP IMPORT ---");

    // Pre-cache maps
    console.log("Caching lookup tables...");
    const customerList = await db.select({ id: customers.id, externalId: customers.externalId }).from(customers);
    const customerIdMap = new Map(customerList.map(c => [c.externalId, c.id]));

    const vehicleList = await db.select({ id: vehicles.id, externalId: vehicles.externalId }).from(vehicles);
    const vehicleIdMap = new Map(vehicleList.map(v => [v.externalId, v.id]));

    // 1. IMPORT DOCUMENTS
    console.log("\nLoading Documents...");
    const rawDocs = loadCsv("Documents.csv");
    console.log(`Processing ${rawDocs.length} documents...`);

    for (let i = 0; i < rawDocs.length; i += BATCH_SIZE) {
        const batch = rawDocs.slice(i, i + BATCH_SIZE).map((raw: any) => {
            const customerId = customerIdMap.get(raw._ID_Customer);
            const vehicleId = vehicleIdMap.get(raw._ID_Vehicle);

            // Map the correct columns found from head analysis
            return {
                externalId: raw._ID,
                customerId: customerId || null,
                vehicleId: vehicleId || null,
                docType: raw.docType || null,
                docNo: raw.docNumber_Invoice || raw.docNumber_Estimate || raw.docNumber_Jobsheet || null,
                dateCreated: isValidDate(raw.docDate_Created) ? new Date(raw.docDate_Created) : null,
                dateIssued: isValidDate(raw.docDate_Issued) ? new Date(raw.docDate_Issued) : null,
                datePaid: isValidDate(raw.docDate_Paid) ? new Date(raw.docDate_Paid) : null,
                totalNet: toDecimal(raw.us_TotalNET),
                totalTax: toDecimal(raw.us_TotalTAX),
                totalGross: toDecimal(raw.us_TotalGROSS),
                mileage: safeInt(raw.vehMileage) || safeInt(raw.Mileage)
            };
        });

        await db.insert(serviceHistory).values(batch).onDuplicateKeyUpdate({
            set: {
                docNo: sql`VALUES(docNo)`,
                dateCreated: sql`VALUES(dateCreated)`,
                totalNet: sql`VALUES(totalNet)`,
                totalTax: sql`VALUES(totalTax)`,
                totalGross: sql`VALUES(totalGross)`,
                mileage: sql`VALUES(mileage)`
            }
        });
        if (i % 1000 === 0) console.log(`  Imported ${i}/${rawDocs.length} documents...`);
    }

    // 2. IMPORT LINE ITEMS
    console.log("\nLoading Line Items...");
    const rawItems = loadCsv("LineItems.csv");
    console.log(`Processing ${rawItems.length} line items...`);

    const updatedDocList = await db.select({ id: serviceHistory.id, externalId: serviceHistory.externalId }).from(serviceHistory);
    const docIdMap = new Map(updatedDocList.map(d => [d.externalId, d.id]));

    for (let i = 0; i < rawItems.length; i += BATCH_SIZE) {
        const batch = rawItems.slice(i, i + BATCH_SIZE)
            .map((raw: any) => {
                const documentId = docIdMap.get(raw._ID_Document);
                if (!documentId) return null;
                return {
                    externalId: raw._ID,
                    documentId: documentId,
                    description: raw.itemDescription || "No Description",
                    quantity: toDecimal(raw.itemQuantity),
                    unitPrice: toDecimal(raw.itemUnitPrice),
                    subNet: toDecimal(raw.itemSub_Net),
                    itemType: raw.itemType || null
                };
            })
            .filter(item => item !== null);

        if (batch.length > 0) {
            await db.insert(serviceLineItems).values(batch as any).onDuplicateKeyUpdate({
                set: {
                    description: sql`VALUES(description)`,
                    quantity: sql`VALUES(quantity)`,
                    unitPrice: sql`VALUES(unitPrice)`,
                    subNet: sql`VALUES(subNet)`,
                    itemType: sql`VALUES(itemType)`
                }
            });
        }
        if (i % 5000 === 0) console.log(`  Imported ${i}/${rawItems.length} line items...`);
    }

    console.log("\n--- RE-IMPORT COMPLETE ---");
    process.exit(0);
}

runDeepImport();
