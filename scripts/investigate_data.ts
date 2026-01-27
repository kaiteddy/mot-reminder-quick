import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers, reminders } from "../drizzle/schema";
import { eq, sql, inArray } from "drizzle-orm";

async function investigateMissingData() {
    const db = await getDb();
    if (!db) return;

    const missingRegs = ["EK05TWV", "FL61UWO", "KY61VHC", "LA71FSK", "YL67KWE"];
    const foundWithIssue = ["AV02CXS", "AV04ZSU", "BX63VVO", "HJ08YLT", "LJ59KUR", "LL59ZGG", "LT08KWN", "M777", "RN04BYX", "S625KLO"];

    console.log("--- Checking for Normalized Matches for Missing Regs ---");
    for (const reg of missingRegs) {
        const normalized = reg.replace(/\s/g, '').toUpperCase();
        const matches = await db.select()
            .from(vehicles)
            .where(sql`REPLACE(${vehicles.registration}, ' ', '') = ${normalized}`);

        if (matches.length > 0) {
            console.log(`Found match for ${reg}: ${matches[0].registration}`);
        } else {
            console.log(`Still no match for ${reg}`);
        }
    }

    console.log("\n--- Checking Reminders Table for Historical Contact Info ---");
    const allQueryRegs = [...missingRegs, ...foundWithIssue];
    const historicalData = await db.select({
        registration: reminders.registration,
        phone: reminders.customerPhone,
        name: reminders.customerName
    })
        .from(reminders)
        .where(inArray(reminders.registration, allQueryRegs));

    console.log(`${historicalData.length} records found in reminders table.`);
    historicalData.forEach(r => {
        if (r.phone || r.name) {
            console.log(`[Historical] ${r.registration}: ${r.name} - ${r.phone}`);
        }
    });

    console.log("\n--- Checking for Duplicate Customers by Name ---");
    const customerNames = [
        "Mr Richard Daneo", "Cash Sale", "Mr Jonathon Hausman",
        "Mr Jonathon Baradara", "Diccon Green", "Mr S Lodhi",
        "Miss Ting Cheung", "Dr Brafman", "Mr Arron Krishan-Buck"
    ];

    for (const name of customerNames) {
        const matches = await db.select()
            .from(customers)
            .where(sql`LOWER(${customers.name}) = LOWER(${name})`);

        if (matches.length > 1) {
            console.log(`Potential duplicates for ${name}: ${matches.length} records.`);
            matches.forEach(m => {
                console.log(`  ID: ${m.id}, Phone: ${m.phone || 'null'}`);
            });
        } else if (matches.length === 1 && !matches[0].phone) {
            console.log(`Only one record for ${name}, and it has no phone number.`);
        }
    }
}

investigateMissingData().catch(console.error);
