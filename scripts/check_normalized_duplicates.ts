import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";

async function checkNormalizedDuplicates() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        return;
    }

    const allVehicles = await db.select().from(vehicles);

    const map = new Map<string, any[]>();
    allVehicles.forEach(v => {
        const norm = v.registration.toUpperCase().replace(/\s/g, '');
        if (!map.has(norm)) map.set(norm, []);
        map.get(norm)!.push(v);
    });

    console.log(`Checking duplicates for ${allVehicles.length} vehicles...`);
    let found = 0;
    for (const [norm, list] of map.entries()) {
        if (list.length > 1) {
            found++;
            console.log(`- NormReg: ${norm}, Count: ${list.length}`);
            list.forEach(v => {
                console.log(`  Reg: [${v.registration}], ID: ${v.id}, MOT: ${v.motExpiryDate}`);
            });
        }
    }

    if (found === 0) {
        console.log("No normalized duplicates found.");
    }
}

checkNormalizedDuplicates().catch(console.error);
