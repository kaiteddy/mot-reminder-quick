import "dotenv/config";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { getDb } from "../server/db";
import { vehicles, customers, serviceHistory } from "../drizzle/schema";

const EXPORT_DIR = "/tmp/ga4_export_data";

function parseCSV(buffer: Buffer) {
    return parse(buffer, { columns: true, skip_empty_lines: true, bom: true, relax_quotes: true, trim: true });
}

function parseGA4DateTime(dateStr: string) {
    if (!dateStr || dateStr.trim() === '') return null;
    try {
        const parts = dateStr.split(' ');
        const dateParts = parts[0].split('/');
        
        if (dateParts.length === 3) {
            let year = parseInt(dateParts[2], 10);
            if (year < 100) year += 2000;
            if (year < 1900 || year > 2100) return null;
            
            const timeParts = parts.length > 1 ? parts[1].split(':') : ['0', '0', '0'];
            const hours = parseInt(timeParts[0] || '0', 10);
            const mins = parseInt(timeParts[1] || '0', 10);
            const secs = parseInt(timeParts[2] || '0', 10);
            
            return new Date(year, parseInt(dateParts[1], 10) - 1, parseInt(dateParts[0], 10), hours, mins, secs);
        }
    } catch(e) {}
    return null;
}

async function run() {
    const db = await getDb();
    if (!db) process.exit(1);

    console.log("Reading GA4 Documents CSV...");
    const rawData = fs.readFileSync(path.join(EXPORT_DIR, "Documents.csv"));
    const docsData = parseCSV(rawData);

    const existingDocs = await db.select().from(serviceHistory);
    const existingExtIds = new Set(existingDocs.filter(d => d.externalId).map(d => d.externalId));
    
    // Map existing vehicles and customers
    console.log("Loading mapping data...");
    const existingVehicles = await db.select({ id: vehicles.id, externalId: vehicles.externalId }).from(vehicles);
    const vMap = new Map();
    for(const v of existingVehicles) if (v.externalId) vMap.set(v.externalId, v.id);

    const existingCust = await db.select({ id: customers.id, externalId: customers.externalId }).from(customers);
    const cMap = new Map();
    for(const c of existingCust) if (c.externalId) cMap.set(c.externalId, c.id);

    const newDocs = [];
    let skipped = 0;

    for (const d of (docsData as any[])) {
        if (!d._ID || existingExtIds.has(d._ID)) {
            skipped++;
            continue; // Skip if already exists or no ID
        }

        let totalNet = parseFloat(d.TotalNet);
        if (isNaN(totalNet)) totalNet = 0;
        
        let totalTax = parseFloat(d.TotalTax);
        if (isNaN(totalTax)) totalTax = 0;
        
        let totalGross = parseFloat(d.TotalGross);
        if (isNaN(totalGross)) totalGross = 0;
        
        let mileage = parseInt(d.Mileage, 10);
        if (isNaN(mileage)) mileage = 0;

        let vId = null;
        if (d._ID_Vehicle && vMap.has(d._ID_Vehicle)) vId = vMap.get(d._ID_Vehicle);
        
        let cId = null;
        if (d._ID_Customer && cMap.has(d._ID_Customer)) cId = cMap.get(d._ID_Customer);

        if (d._Type === 'CO' || d._Type === 'QU' || d._Type === 'PR') {
            // These are irrelevant documents or quotes, we largely want SI (Sales Invoice), SR (Sales Receipt)
            // But let's import it to match the historical dataset.
        }

        newDocs.push({
            externalId: d._ID,
            docType: d._Type || 'SI',
            docNo: d.Number || null,
            customerId: cId,
            vehicleId: vId,
            dateCreated: parseGA4DateTime(d.DateCreated),
            dateIssued: parseGA4DateTime(d.DateIssued),
            datePaid: parseGA4DateTime(d.DatePaid),
            totalNet: String(totalNet),
            totalTax: String(totalTax),
            totalGross: String(totalGross),
            mileage: mileage || null,
            description: d.Notes || null
        });
        existingExtIds.add(d._ID);
    }

    console.log(`Found ${newDocs.length} new documents. Skipped existing: ${skipped}`);
    
    if (newDocs.length > 0) {
        console.log(`Inserting ${newDocs.length} documents into database in batches...`);
        let count = 0;
        for (let i = 0; i < newDocs.length; i += 500) {
            count++;
            try {
               await db.insert(serviceHistory).values(newDocs.slice(i, i + 500));
            } catch(e) { console.error(`Batch ${count} error:`, e.message); }
        }
    }
    
    console.log("Documents updated.");
    process.exit(0);
}

run().catch(console.error);
