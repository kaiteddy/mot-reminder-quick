import "dotenv/config";
import { getDb } from "../server/db";
import { customers, vehicles, reminderLogs, reminders } from "../drizzle/schema";
import { like, eq, or, inArray } from "drizzle-orm";

async function run() {
    const db = await getDb();
    if (!db) {
        console.error("Failed to connect to database");
        process.exit(1);
    }

    console.log("Searching for Tazmin Miah...");
    
    // Find customer by name
    const foundCustomers = await db.select().from(customers)
        .where(
            or(
                like(customers.name, "%Tazmin Miah%"),
                like(customers.name, "%Tazmin%Miah%")
            )
        );
        
    if (foundCustomers.length === 0) {
        console.log("No customer found matching 'Tazmin Miah'.");
    } else {
        console.log(`Found ${foundCustomers.length} matching customers.`);
        
        for (const customer of foundCustomers) {
            console.log(`Processing customer: ID ${customer.id}, Name: ${customer.name}`);
            
            // Find their vehicles
            const customerVehicles = await db.select().from(vehicles)
                .where(eq(vehicles.customerId, customer.id));
                
            console.log(`- Found ${customerVehicles.length} vehicles.`);
            
            if (customerVehicles.length > 0) {
                const vehicleIds = customerVehicles.map(v => v.id);
                
                // Delete reminder logs for these vehicles
                const logsDeleted = await db.delete(reminderLogs)
                    .where(inArray(reminderLogs.vehicleId, vehicleIds));
                console.log(`- Deleted reminder logs for vehicles.`);
                
                // Delete reminders for these vehicles or customer
                const remsDeleted = await db.delete(reminders)
                    .where(
                        or(
                            inArray(reminders.vehicleId, vehicleIds),
                            // Also check customer email/phone just in case
                            eq(reminders.customerName, customer.name)
                        )
                    );
                console.log(`- Deleted outstanding reminders for vehicles.`);

                // Delete the vehicles themselves
                await db.delete(vehicles)
                    .where(inArray(vehicles.id, vehicleIds));
                console.log(`- Deleted ${customerVehicles.length} vehicles.`);
            }
            
            // Delete reminder logs directly linked to customer (if any)
            await db.delete(reminderLogs).where(eq(reminderLogs.customerId, customer.id));
            
            // Delete reminders directly linked to customer name
            await db.delete(reminders).where(eq(reminders.customerName, customer.name));
            
            // Finally delete the customer
            await db.delete(customers)
                .where(eq(customers.id, customer.id));
            console.log(`- Deleted customer: ${customer.name}`);
        }
    }
    
    // As a secondary check, search for any remaining reminders or logs mentioning this name even without a customer link
    console.log("Performing cleanup sweep on reminders table...");
    const orphanedReminders = await db.delete(reminders)
        .where(like(reminders.customerName, "%Tazmin Miah%"));
        
    const orphanedLogs = await db.delete(reminderLogs)
        .where(like(reminderLogs.customerName, "%Tazmin Miah%"));
        
    console.log("Cleanup sweep completed.");
    console.log("Done.");
    process.exit(0);
}

run().catch(console.error);
