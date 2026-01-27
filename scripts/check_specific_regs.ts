import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

async function checkPhoneNumbers() {
    const db = await getDb();
    if (!db) return;

    const regs = [
        "AV02CXS", "AV04ZSU", "BX63VVO", "EK05TWV", "FL61UWO",
        "H8HRE", "HJ08YLT", "KY61VHC", "LA71FSK", "LD11KWK",
        "LJ59KUR", "LL59ZGG", "LT08KWN", "M777", "RN04BYX",
        "S625KLO", "YL67KWE"
    ];

    const results = await db.select({
        registration: vehicles.registration,
        customerName: customers.name,
        customerPhone: customers.phone,
        vehicleId: vehicles.id,
        customerId: vehicles.customerId
    })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(inArray(vehicles.registration, regs));

    console.log(JSON.stringify(results, null, 2));
}

checkPhoneNumbers().catch(console.error);
