import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { isNull, inArray, sql, or, like } from "drizzle-orm";

async function checkSpecificNulls() {
    const db = await getDb();
    if (!db) return;

    const regs = ["MV63ANX", "LK04JKZ", "ET07XZW", "MW18 AFX", "AV06 BPE", "LJ59GWX", "R4 TEA*", "E066 BZR"];

    const results = await db.select().from(vehicles).where(
        or(
            inArray(vehicles.registration, regs),
            like(vehicles.registration, "%E066%"),
            like(vehicles.registration, "%R4%TEA%")
        )
    );

    console.log(`Found ${results.length} matching vehicles in total.`);
    results.forEach(v => {
        console.log(`ID: ${v.id}, Reg: [${v.registration}], MOT: ${v.motExpiryDate}`);
    });
}

checkSpecificNulls().catch(console.error);
