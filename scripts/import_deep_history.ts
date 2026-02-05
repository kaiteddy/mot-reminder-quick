import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import { getDb } from '../server/db';
import {
    customers, vehicles, serviceHistory, serviceLineItems
} from '../drizzle/schema';
import "dotenv/config";

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
    if (!val || typeof val !== 'string') return "0.00";
    const cleaned = val.replace(/[^0-9.\-]/g, "");
    if (!cleaned || isNaN(parseFloat(cleaned))) return "0.00";
    return parseFloat(cleaned).toFixed(2);
}

const BATCH_SIZE = 100;

async function runDeepImport() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    console.log("--- STARTING FAST DEEP IMPORT ---");

    // 1. IMPORT CUSTOMERS
    console.log("\nLoading Customers...");
    const rawCustomers = loadCsv("Customers.csv");
    console.log(`Processing ${rawCustomers.length} customers in batches...`);

    for (let i = 0; i < rawCustomers.length; i += BATCH_SIZE) {
        const batch = rawCustomers.slice(i, i + BATCH_SIZE).map((raw: any) => {
            const phone = (raw.contactMobile || raw.contactTelephone || "").replace(/\s/g, "");
            return {
                name: `${raw.nameTitle || ""} ${raw.nameForename || ""} ${raw.nameSurname || ""}`.trim() || raw.nameCompany || "Unknown",
                email: raw.contactEmail || null,
                phone: phone || null,
                externalId: raw._ID,
                address: `${raw.addressHouseNo || ""} ${raw.addressRoad || ""}, ${raw.addressLocality || ""}, ${raw.addressTown || ""}`.trim(),
                postcode: raw.addressPostCode || null,
                notes: raw.Notes || null
            };
        });

        await db.insert(customers).values(batch).onDuplicateKeyUpdate({
            set: {
                name: sql`VALUES(name)`,
                email: sql`VALUES(email)`,
                phone: sql`VALUES(phone)`,
                address: sql`VALUES(address)`,
                postcode: sql`VALUES(postcode)`
            }
        });
        if (i % 1000 === 0) console.log(`  Imported ${i}/${rawCustomers.length} customers...`);
    }

    // 2. IMPORT VEHICLES
    console.log("\nLoading Vehicles...");
    const rawVehicles = loadCsv("Vehicles.csv");
    console.log(`Processing ${rawVehicles.length} vehicles in batches...`);

    const customerList = await db.select({ id: customers.id, externalId: customers.externalId }).from(customers);
    const customerIdMap = new Map(customerList.map(c => [c.externalId, c.id]));

    for (let i = 0; i < rawVehicles.length; i += BATCH_SIZE) {
        const batch = rawVehicles.slice(i, i + BATCH_SIZE)
            .filter((raw: any) => !!raw.Registration)
            .map((raw: any) => {
                const normalizedReg = raw.Registration.toUpperCase().replace(/\s/g, "");
                const customerId = customerIdMap.get(raw._ID_Customer);
                return {
                    registration: normalizedReg.substring(0, 20),
                    make: (raw.Make || "").substring(0, 100),
                    model: (raw.Model || "").substring(0, 100),
                    customerId: customerId || null,
                    externalId: raw._ID,
                    vin: (raw.VIN || "").substring(0, 50),
                    colour: (raw.Colour || "").substring(0, 50),
                    fuelType: (raw.FuelType || "").substring(0, 50),
                    engineCC: raw.EngineCC ? parseInt(raw.EngineCC) : null,
                    dateOfRegistration: isValidDate(raw.DateofReg) ? new Date(raw.DateofReg) : null,
                    notes: raw.Notes || null
                };
            });

        if (batch.length > 0) {
            await db.insert(vehicles).values(batch).onDuplicateKeyUpdate({
                set: {
                    make: sql`VALUES(make)`,
                    model: sql`VALUES(model)`,
                    customerId: sql`VALUES(customerId)`,
                    vin: sql`VALUES(vin)`,
                    colour: sql`VALUES(colour)`
                }
            });
        }
        if (i % 1000 === 0) console.log(`  Imported ${i}/${rawVehicles.length} vehicles...`);
    }

    // 3. IMPORT DOCUMENTS
    console.log("\nLoading Documents...");
    const rawDocs = loadCsv("Documents.csv");
    console.log(`Processing ${rawDocs.length} documents in batches...`);

    const vehicleList = await db.select({ id: vehicles.id, externalId: vehicles.externalId }).from(vehicles);
    const vehicleIdMap = new Map(vehicleList.map(v => [v.externalId, v.id]));

    for (let i = 0; i < rawDocs.length; i += BATCH_SIZE) {
        const batch = rawDocs.slice(i, i + BATCH_SIZE).map((raw: any) => {
            const customerId = customerIdMap.get(raw._ID_Customer);
            const vehicleId = vehicleIdMap.get(raw._ID_Vehicle);
            return {
                externalId: raw._ID,
                customerId: customerId || null,
                vehicleId: vehicleId || null,
                docType: raw.docType ? raw.docType.substring(0, 20) : null,
                docNo: raw.docNo ? raw.docNo.substring(0, 50) : null,
                dateCreated: isValidDate(raw.docDate_Created) ? new Date(raw.docDate_Created) : null,
                dateIssued: isValidDate(raw.docDate_Issued) ? new Date(raw.docDate_Issued) : null,
                datePaid: isValidDate(raw.docDate_Paid) ? new Date(raw.docDate_Paid) : null,
                totalNet: toDecimal(raw.totalSub_Net),
                totalTax: toDecimal(raw.totalSub_Tax),
                totalGross: toDecimal(raw.totalSub_Gross),
                mileage: raw.Mileage ? parseInt(raw.Mileage) : null
            };
        });

        await db.insert(serviceHistory).values(batch).onDuplicateKeyUpdate({
            set: {
                totalNet: sql`VALUES(totalNet)`,
                totalGross: sql`VALUES(totalGross)`
            }
        });
        if (i % 1000 === 0) console.log(`  Imported ${i}/${rawDocs.length} documents...`);
    }

    // 4. IMPORT LINE ITEMS
    console.log("\nLoading Line Items...");
    const rawItems = loadCsv("LineItems.csv");
    console.log(`Processing ${rawItems.length} line items in batches (this may take a while)...`);

    const docList = await db.select({ id: serviceHistory.id, externalId: serviceHistory.externalId }).from(serviceHistory);
    const docIdMap = new Map(docList.map(d => [d.externalId, d.id]));

    for (let i = 0; i < rawItems.length; i += BATCH_SIZE) {
        const batch = rawItems.slice(i, i + BATCH_SIZE)
            .map((raw: any) => {
                const documentId = docIdMap.get(raw._ID_Document);
                if (!documentId) return null;
                return {
                    externalId: raw._ID,
                    documentId: documentId,
                    description: raw.itemDescription || null,
                    quantity: toDecimal(raw.itemQuantity),
                    unitPrice: toDecimal(raw.itemUnitPrice),
                    subNet: toDecimal(raw.itemSub_Net),
                    itemType: raw.itemType ? raw.itemType.substring(0, 50) : null
                };
            })
            .filter(item => item !== null);

        if (batch.length > 0) {
            await db.insert(serviceLineItems).values(batch).onDuplicateKeyUpdate({
                set: {
                    description: sql`VALUES(description)`,
                    subNet: sql`VALUES(subNet)`
                }
            });
        }
        if (i % 5000 === 0) console.log(`  Imported ${i}/${rawItems.length} line items...`);
    }

    console.log("\n--- DEEP IMPORT COMPLETE ---");
    process.exit(0);
}

import { sql } from 'drizzle-orm';
runDeepImport();
