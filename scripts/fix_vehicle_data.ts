import "dotenv/config";
import { getDb } from "../server/db";
import { vehicles, customers, reminders } from "../drizzle/schema";
import { eq, or, sql, isNull, and, isNotNull } from "drizzle-orm";

async function fixVehicleData() {
    const db = await getDb();
    if (!db) return;

    console.log("--- Normalizing and Deduplicating Vehicle Registrations ---");
    const allVehicles = await db.select().from(vehicles);
    const groups = new Map<string, any[]>();

    for (const v of allVehicles) {
        const normalized = v.registration.replace(/\s/g, '').toUpperCase();
        if (!groups.has(normalized)) {
            groups.set(normalized, []);
        }
        groups.get(normalized)!.push(v);
    }

    let normalizedCount = 0;
    let mergedCount = 0;

    for (const [normalized, group] of groups.entries()) {
        // Sort group to pick the "best" record as master
        group.sort((a, b) => {
            // Priority 1: Already normalized
            const aNorm = a.registration === normalized;
            const bNorm = b.registration === normalized;
            if (aNorm && !bNorm) return -1;
            if (!aNorm && bNorm) return 1;

            // Priority 2: Has customerId
            if (a.customerId && !b.customerId) return -1;
            if (!a.customerId && b.customerId) return 1;

            // Priority 3: Has MOT date
            if (a.motExpiryDate && !b.motExpiryDate) return -1;
            if (!a.motExpiryDate && b.motExpiryDate) return 1;

            return a.id - b.id;
        });

        const master = group[0];
        const duplicates = group.slice(1);

        // Merge duplicates into master FIRST to free up the unique constraint
        for (const dup of duplicates) {
            console.log(`Merging ${dup.id} (${dup.registration}) into master ${master.id} (${master.registration})...`);

            // Move customer/MOT if master is missing them
            if (!master.customerId && dup.customerId) {
                await db.update(vehicles).set({ customerId: dup.customerId }).where(eq(vehicles.id, master.id));
                master.customerId = dup.customerId;
            }
            if (!master.motExpiryDate && dup.motExpiryDate) {
                await db.update(vehicles).set({ motExpiryDate: dup.motExpiryDate }).where(eq(vehicles.id, master.id));
                master.motExpiryDate = dup.motExpiryDate;
            }

            // Re-link reminders
            await db.update(reminders).set({ vehicleId: master.id }).where(eq(reminders.vehicleId, dup.id));

            // Delete the duplicate
            await db.delete(vehicles).where(eq(vehicles.id, dup.id));
            mergedCount++;
        }

        // NOW normalize master if needed
        if (master.registration !== normalized) {
            await db.update(vehicles).set({ registration: normalized }).where(eq(vehicles.id, master.id));
            normalizedCount++;
        }
    }
    console.log(`Normalized ${normalizedCount} registrations. Merged ${mergedCount} duplicates.`);

    console.log("\n--- Recovering Missing Phone Numbers from Duplicate Customers ---");
    const customersWithNoPhone = await db.select().from(customers).where(isNull(customers.phone));

    let recoveredCount = 0;
    for (const c of customersWithNoPhone) {
        if (!c.name) continue;

        const matches = await db.select()
            .from(customers)
            .where(and(
                sql`LOWER(${customers.name}) = LOWER(${c.name})`,
                isNotNull(customers.phone)
            ))
            .limit(1);

        if (matches.length > 0) {
            const richerCustomer = matches[0];
            console.log(`Found phone for ${c.name}: ${richerCustomer.phone}`);

            await db.update(vehicles)
                .set({ customerId: richerCustomer.id })
                .where(eq(vehicles.customerId, c.id));

            recoveredCount++;
        }
    }
    console.log(`Recovered phones for ${recoveredCount} customers by re-linking.`);

    console.log("\n--- Reporting Remaining Missing Data ---");
    const stillMissing = await db.select({
        registration: vehicles.registration,
        customerName: customers.name,
        vehicleId: vehicles.id
    })
        .from(vehicles)
        .leftJoin(customers, eq(vehicles.customerId, customers.id))
        .where(or(
            isNull(vehicles.customerId),
            isNull(customers.phone)
        ));

    console.log(JSON.stringify(stillMissing, null, 2));
}

fixVehicleData().catch(console.error);
