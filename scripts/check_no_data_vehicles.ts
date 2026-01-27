import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq, or, inArray, sql } from "drizzle-orm";

async function checkVehicles() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    const regs = [
        "MW18AFX",
        "LK04JKZ",
        "AV06BPE",
        "MV63ANX",
        "ET07XZW",
        "LJ59GWX",
        "R4TEA",
        "E066BZR"
    ];

    console.log("Checking normalized registrations:", regs);

    const normalized = sql`UPPER(REPLACE(${vehicles.registration}, ' ', ''))`;

    const results = await db.select().from(vehicles).where(
        inArray(normalized, regs)
    );

    console.log(`Found ${results.length} vehicles:`);
    results.forEach(v => {
        console.log(`- Reg: [${v.registration}], Make: ${v.make}, Model: ${v.model}, MOT Expiry: ${v.motExpiryDate}, Tax Status: ${v.taxStatus}`);
    });
}

checkVehicles().catch(console.error);
