import "dotenv/config";
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import { getDb } from '../server/db';
import {
    customers, vehicles, serviceHistory, serviceLineItems
} from '../drizzle/schema';
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

function parseUKDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;
    // Remove quotes if present
    const clean = dateStr.replace(/"/g, '').trim();
    if (clean === '') return null;

    // Handle DD/MM/YYYY HH:MM:SS or just DD/MM/YYYY
    const parts = clean.split(' ')[0].split('/');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
        const date = new Date(year, month, day);
        if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
            return date;
        }
    }

    // Fallback to standard parse if it doesn't match DD/MM/YYYY
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1900) return parsed;

    return null;
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

    // 0. LOAD EXTRAS (for job descriptions)
    console.log("Loading Document Extras...");
    const rawExtras = loadCsv("Document_Extras.csv");
    const extrasMap = new Map(rawExtras.map((e: any) => [e._ID, e["Labour Description"] || e.docNotes || ""]));
    console.log(`Cached ${extrasMap.size} extra descriptions.`);

    // 1. IMPORT DOCUMENTS
    console.log("\nLoading Documents...");
    const rawDocs = loadCsv("Documents.csv");
    console.log(`Processing ${rawDocs.length} documents...`);

    for (let i = 0; i < rawDocs.length; i += BATCH_SIZE) {
        const batch = rawDocs.slice(i, i + BATCH_SIZE).map((raw: any) => {
            const customerId = customerIdMap.get(raw._ID_Customer);
            const vehicleId = vehicleIdMap.get(raw._ID_Vehicle);

            return {
                externalId: raw._ID,
                customerId: customerId || null,
                vehicleId: vehicleId || null,
                docType: raw.docType || null,
                docNo: raw.docNumber_Invoice || raw.docNumber_Estimate || raw.docNumber_Jobsheet || null,
                dateCreated: parseUKDate(raw.docDate_Created),
                dateIssued: parseUKDate(raw.docDate_Issued),
                datePaid: parseUKDate(raw.docDate_Paid),
                totalNet: toDecimal(raw.us_TotalNET),
                totalTax: toDecimal(raw.us_TotalTAX),
                totalGross: toDecimal(raw.us_TotalGROSS),
                mileage: safeInt(raw.vehMileage) || safeInt(raw.Mileage),
                description: extrasMap.get(raw._ID) || null
            };
        });

        await db.insert(serviceHistory).values(batch).onDuplicateKeyUpdate({
            set: {
                docNo: sql`VALUES(docNo)`,
                dateCreated: sql`VALUES(dateCreated)`,
                dateIssued: sql`VALUES(dateIssued)`,
                datePaid: sql`VALUES(datePaid)`,
                totalNet: sql`VALUES(totalNet)`,
                totalTax: sql`VALUES(totalTax)`,
                totalGross: sql`VALUES(totalGross)`,
                mileage: sql`VALUES(mileage)`,
                description: sql`VALUES(description)`
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
