import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles } from "../drizzle/schema";
import { eq, or, like } from "drizzle-orm";
import { getVehicleDetails } from "../server/dvlaApi";

async function fixTypos() {
    const db = await getDb();
    if (!db) return;

    const allVehicles = await db.select().from(vehicles);
    console.log(`Checking ${allVehicles.length} vehicles for 0/O typos...`);

    for (const v of allVehicles) {
        if (!v.motExpiryDate) {
            // If no MOT date, maybe it's a 0/O typo?
            // Check current UK format: AA00 AAA
            // If we have AOO (letters where numbers should be) or 00 (numbers where letters should be)

            const reg = v.registration.toUpperCase().replace(/\s+/g, "");

            // If reg starts with 2 letters, then 2 numbers...
            // e.g. EO66 BZR -> EO is O (letter), but 66 is numbers. Correct.
            // E066 BZR -> E0 is 0 (number), but 2nd char should be letter? No, 1st two are letters.

            // Let's just try to swap 0 <-> O if the current one returns 404
            const hasZero = v.registration.includes('0');
            const hasO = v.registration.includes('O');

            if (hasZero || hasO) {
                const variants = [];
                if (hasZero) variants.push(v.registration.replace(/0/g, 'O'));
                if (hasO) variants.push(v.registration.replace(/O/g, '0'));

                for (const variant of variants) {
                    console.log(`Trying variant [${variant}] for [${v.registration}]...`);
                    const details = await getVehicleDetails(variant);
                    if (details && details.motExpiryDate) {
                        console.log(`  SUCCESS! Found MOT for [${variant}]. Updating...`);
                        await db.update(vehicles).set({
                            registration: variant,
                            motExpiryDate: new Date(details.motExpiryDate),
                            make: details.make || undefined,
                            model: details.model || undefined,
                            taxStatus: details.taxStatus
                        }).where(eq(vehicles.id, v.id));
                        break;
                    }
                }
            }
        }
    }
}

fixTypos().catch(console.error);
