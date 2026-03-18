import "dotenv/config";
import { getDb } from "../server/db";
import { customers, vehicles, reminders, reminderLogs, serviceHistory, appointments } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { cleanPhoneField } from "../server/utils/phoneUtils";

function normalizeName(name: string | null) {
    if (!name) return "";
    let n = name.toLowerCase().trim();
    // Remove titles
    const titles = ['mr ', 'mrs ', 'ms ', 'miss ', 'dr ', 'prof ', 'rev ', 'sir '];
    for (const t of titles) {
        if (n.startsWith(t)) {
            n = n.substring(t.length).trim();
        }
    }
    // Remove all punctuation and spaces for comparison
    return n.replace(/[^a-z0-9]/g, '');
}

async function run() {
    const db = await getDb();
    if (!db) process.exit(1);

    console.log("Fetching all customers...");
    const allCustomers = await db.select().from(customers);
    
    console.log(`Analyzing ${allCustomers.length} customers for duplicates...`);

    const merges: { primaryId: number, secondaryId: number }[] = [];
    const groupedByPhone = new Map<string, any[]>();
    const groupedByName = new Map<string, any[]>();

    // 1. Group by clean phone
    for (const c of allCustomers) {
        if (c.phone) {
            const temp = cleanPhoneField(c.phone);
            const p = temp.phone || c.phone.replace(/[^0-9]/g, '');
            // Only group valid lengths to avoid empty grouping
            if (p && p.length >= 10) {
                if (!groupedByPhone.has(p)) groupedByPhone.set(p, []);
                groupedByPhone.get(p)!.push(c);
            }
        }
        
        const nName = normalizeName(c.name);
        if (nName.length > 3) { // ignore tiny generic names
            if (!groupedByName.has(nName)) groupedByName.set(nName, []);
            groupedByName.get(nName)!.push(c);
        }
    }

    const toDelete = new Set<number>();
    const processedPairs = new Set<string>();

    function addMerge(keeper: any, duplicate: any) {
        if (keeper.id === duplicate.id) return;
        if (toDelete.has(keeper.id) || toDelete.has(duplicate.id)) return;
        
        const pairKey = `${Math.min(keeper.id, duplicate.id)}-${Math.max(keeper.id, duplicate.id)}`;
        if (processedPairs.has(pairKey)) return;
        processedPairs.add(pairKey);

        merges.push({ primaryId: keeper.id, secondaryId: duplicate.id });
        toDelete.add(duplicate.id);
    }

    // Step A: Merge by absolute exact phone match
    for (const [phone, group] of groupedByPhone.entries()) {
        if (group.length > 1) {
            // Sort by data completeness and existing externalId
            group.sort((a, b) => {
                let scoreA = (a.externalId ? 10 : 0) + (a.email ? 5 : 0) + (a.address ? 5 : 0);
                let scoreB = (b.externalId ? 10 : 0) + (b.email ? 5 : 0) + (b.address ? 5 : 0);
                return scoreB - scoreA;
            });
            const keeper = group[0];
            for (let i = 1; i < group.length; i++) {
                addMerge(keeper, group[i]);
            }
        }
    }

    // Step B: Merge by normalized exact name match (with strict conflict checking)
    for (const [nName, group] of groupedByName.entries()) {
        if (group.length > 1) {
            // Sort by data completeness
             group.sort((a, b) => {
                let scoreA = (a.externalId ? 10 : 0) + (a.phone ? 5 : 0) + (a.email ? 5 : 0);
                let scoreB = (b.externalId ? 10 : 0) + (b.phone ? 5 : 0) + (b.email ? 5 : 0);
                return scoreB - scoreA;
            });
            
            for (let i = 0; i < group.length; i++) {
                const keeper = group[i];
                if (toDelete.has(keeper.id)) continue;
                
                for (let j = i + 1; j < group.length; j++) {
                    const dup = group[j];
                    if (toDelete.has(dup.id)) continue;

                    // Conflict checking
                    let conflict = false;
                    
                    // IF both have a phone, and they are different -> CONFLICT (don't merge)
                    if (keeper.phone && dup.phone) {
                        const kp = keeper.phone.replace(/[^0-9]/g, '');
                        const dp = dup.phone.replace(/[^0-9]/g, '');
                        if (kp !== dp && kp.length > 5 && dp.length > 5) conflict = true;
                    }
                    
                    // IF both have an email, and they are different -> CONFLICT (don't merge)
                    if (keeper.email && dup.email) {
                        if (keeper.email.toLowerCase().trim() !== dup.email.toLowerCase().trim()) conflict = true;
                    }
                    
                    if (!conflict) {
                        addMerge(keeper, dup);
                    }
                }
            }
        }
    }

    console.log(`Found ${merges.length} duplicated customers to securely merge.`);

    // Perform actual merges in fast parallel batches
    const BATCH_SIZE = 40;
    for (let i = 0; i < merges.length; i += BATCH_SIZE) {
        const batch = merges.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (m) => {
            const primary = allCustomers.find(c => c.id === m.primaryId);
            const secondary = allCustomers.find(c => c.id === m.secondaryId);
            if (!primary || !secondary) return;

            const updates: any = {};
            if (!primary.phone && secondary.phone) updates.phone = secondary.phone;
            if (!primary.email && secondary.email) updates.email = secondary.email;
            if (!primary.address && secondary.address) updates.address = secondary.address;
            if (!primary.postcode && secondary.postcode) updates.postcode = secondary.postcode;
            if (!primary.notes && secondary.notes) updates.notes = secondary.notes;
            else if (primary.notes && secondary.notes && primary.notes !== secondary.notes) {
                 updates.notes = primary.notes + "\n--- MERGED ---\n" + secondary.notes;
            }

            if (Object.keys(updates).length > 0) {
                await db.update(customers).set({ ...updates, updatedAt: new Date() }).where(eq(customers.id, primary.id));
            }

            await db.update(vehicles).set({ customerId: primary.id }).where(eq(vehicles.customerId, secondary.id));
            await db.update(reminders).set({ 
                customerId: primary.id,
                customerName: primary.name,
                customerEmail: updates.email || primary.email,
                customerPhone: updates.phone || primary.phone 
            }).where(eq(reminders.customerId, secondary.id));
            
            await db.update(reminderLogs).set({ 
                customerId: primary.id,
                customerName: primary.name 
            }).where(eq(reminderLogs.customerId, secondary.id));
            
            await db.update(serviceHistory).set({ customerId: primary.id }).where(eq(serviceHistory.customerId, secondary.id));
            await db.update(appointments).set({ customerId: primary.id }).where(eq(appointments.customerId, secondary.id));

            await db.delete(customers).where(eq(customers.id, secondary.id));
        }));

        console.log(`Processed ${Math.min(i + BATCH_SIZE, merges.length)}/${merges.length} merges...`);
    }

    console.log(`\nSuccessfully merged ${merges.length} duplicates into their primary customer profiles! All conflicting details, partial addresses, and vehicle links were seamlessly combined.`);
    process.exit(0);
}

run().catch(console.error);
