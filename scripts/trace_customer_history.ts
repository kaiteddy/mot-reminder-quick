import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const EXPORT_DIR = "/Users/service/Desktop/Data Exports";

function loadCsv(filename: string) {
    const filePath = path.join(EXPORT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
    });
}

function traceCustomer(customerId: string) {
    console.log(`\n=== TRACING CUSTOMER: ${customerId} ===`);

    const customers = loadCsv("Customers.csv");
    const customer = customers.find((c: any) => c._ID === customerId);

    if (!customer) {
        console.log("Customer not found.");
        return;
    }

    console.log(`Name: ${customer.nameForename} ${customer.nameSurname}`);
    console.log(`Company: ${customer.nameCompany}`);
    console.log(`Email: ${customer.contactEmail}`);
    console.log(`Phone: ${customer.contactMobile} / ${customer.contactTelephone}`);

    // Find Vehicles
    const vehicles = loadCsv("Vehicles.csv");
    const customerVehicles = vehicles.filter((v: any) => v._ID_Customer === customerId);
    console.log(`\n--- VEHICLES (${customerVehicles.length} found) ---`);
    customerVehicles.forEach((v: any) => {
        console.log(`- ${v.Registration}: ${v.Make} ${v.Model} (VIN: ${v.VIN})`);
    });

    // Find Documents
    const documents = loadCsv("Documents.csv");
    const customerDocs = documents.filter((d: any) => d._ID_Customer === customerId);
    console.log(`\n--- DOCUMENT HISTORY (${customerDocs.length} found) ---`);

    // Sort docs by date if possible
    customerDocs.sort((a: any, b: any) => {
        const dateA = new Date(a.docDate_Created).getTime();
        const dateB = new Date(b.docDate_Created).getTime();
        return dateB - dateA; // Latest first
    });

    const lineItems = loadCsv("LineItems.csv");

    customerDocs.forEach((d: any) => {
        console.log(`\n[${d.docType || 'DOC'}] #${d.docNo} - Date: ${d.docDate_Created}`);
        console.log(`Vehicle ID: ${d._ID_Vehicle}`);

        const items = lineItems.filter((li: any) => li._ID_Document === d._ID);
        if (items.length > 0) {
            console.log("  Items:");
            items.forEach((li: any) => {
                console.log(`    - ${li.itemDescription} (${li.itemQuantity} x £${li.itemUnitPrice})`);
            });
        } else {
            console.log("  No line items found.");
        }
    });
}

// Example usage with the ID found earlier
const targetId = "OOTOSBT1OQQERJUZ6NA5";
traceCustomer(targetId);
