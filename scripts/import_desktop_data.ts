import "dotenv/config";
import fs from "fs";
import path from "path";
import {
    parseCSV,
    buildCustomerName,
    getPhoneNumber,
    getCustomerEmail,
    buildAddress,
    parseGA4Date,
    isReminderActioned,
    getReminderActionedInfo,
    mapReminderType,
    type GA4Customer,
    type GA4Vehicle,
    type GA4Reminder,
    type GA4ReminderTemplate
} from "../server/services/csv-import";
import { cleanPhoneField } from "../server/utils/phoneUtils";
import {
    getDb,
    createCustomer,
    findCustomerBySmartMatch,
    updateCustomer,
    getCustomerByExternalId,
    createVehicle,
    findVehicleByRegistration,
    updateVehicle,
    createReminder,
    getVehicleByExternalId,
    getAllReminderLogs
} from "../server/db";

const EXPORT_DIR = "/Users/service/Desktop/Data Exports";

async function runImport() {
    const db = await getDb();
    if (!db) {
        console.error("Database not available");
        process.exit(1);
    }

    console.log("Starting comprehensive import from Desktop/Data Exports...");

    // 1. Import Customers
    console.log("\n--- Importing Customers ---");
    const customersPath = path.join(EXPORT_DIR, "Customers.csv");
    if (fs.existsSync(customersPath)) {
        const buffer = fs.readFileSync(customersPath);
        const customers = parseCSV<GA4Customer>(buffer);
        console.log(`Found ${customers.length} customers in CSV`);

        let imported = 0;
        let updated = 0;
        let skipped = 0;

        let count = 0;
        for (const ga4Customer of customers) {
            count++;
            if (count % 500 === 0) console.log(`Processed ${count}/${customers.length} customers...`);
            try {
                const name = buildCustomerName(ga4Customer);
                const phone = getPhoneNumber(ga4Customer);
                const email = getCustomerEmail(ga4Customer);

                const existing = await findCustomerBySmartMatch(phone, email, name);

                const customerData = {
                    name,
                    email,
                    phone,
                    externalId: ga4Customer._ID || null,
                    address: buildAddress(ga4Customer),
                    postcode: ga4Customer.addressPostCode || null,
                    notes: ga4Customer.Notes || null,
                };

                if (existing) {
                    const updates: any = {};
                    if (name && (!existing.name || existing.name.length < name.length || existing.name.toLowerCase().includes('customer'))) {
                        updates.name = name;
                    }
                    if (phone && (!existing.phone || existing.phone.length < phone.length)) {
                        updates.phone = phone;
                    }
                    if (email && email.includes('@') && (!existing.email || existing.email.length < email.length)) {
                        updates.email = email;
                    }
                    if (customerData.address && !existing.address) updates.address = customerData.address;
                    if (customerData.postcode && !existing.postcode) updates.postcode = customerData.postcode;
                    if (customerData.notes && !existing.notes) updates.notes = customerData.notes;
                    if (!existing.externalId && ga4Customer._ID) updates.externalId = ga4Customer._ID;

                    if (Object.keys(updates).length > 0) {
                        await updateCustomer(existing.id, updates);
                        updated++;
                    } else {
                        skipped++;
                    }
                } else {
                    await createCustomer(customerData);
                    imported++;
                }
            } catch (e: any) {
                console.error(`Error importing customer: ${e.message}`);
            }
        }
        console.log(`Customers: ${imported} imported, ${updated} updated, ${skipped} skipped`);
    } else {
        console.warn("Customers.csv not found");
    }

    // 2. Import Vehicles
    console.log("\n--- Importing Vehicles ---");
    const vehiclesPath = path.join(EXPORT_DIR, "Vehicles.csv");
    if (fs.existsSync(vehiclesPath)) {
        const buffer = fs.readFileSync(vehiclesPath);
        const vehicles = parseCSV<GA4Vehicle>(buffer);
        console.log(`Found ${vehicles.length} vehicles in CSV`);

        let imported = 0;
        let updated = 0;
        let skipped = 0;
        let smartLinked = 0;

        let count = 0;
        for (const ga4Vehicle of vehicles) {
            count++;
            if (count % 500 === 0) console.log(`Processed ${count}/${vehicles.length} vehicles...`);
            try {
                const registration = ga4Vehicle.Registration?.toUpperCase().replace(/\s/g, '');
                if (!registration) {
                    skipped++;
                    continue;
                }

                const existing = await findVehicleByRegistration(registration);

                let customerId = null;
                const ga4CustomerId = ga4Vehicle._ID_Customer || ga4Vehicle["ID Customer"];
                if (ga4CustomerId) {
                    const customer = await getCustomerByExternalId(ga4CustomerId);
                    if (customer) customerId = customer.id;
                }

                if (!customerId) {
                    const forename = ga4Vehicle.Forename || ga4Vehicle["Owner Forename"];
                    const surname = ga4Vehicle.Surname || ga4Vehicle["Owner Surname"];
                    const name = [forename, surname].filter(Boolean).join(' ');
                    const rawPhone = ga4Vehicle.Mobile || ga4Vehicle.Telephone || ga4Vehicle["Owner Mobile"] || ga4Vehicle["Owner Telephone"];
                    const { phone } = cleanPhoneField(rawPhone);
                    const email = ga4Vehicle.Email || ga4Vehicle["Owner Email"];

                    if (phone || email || (name && name.length > 2)) {
                        const customer = await findCustomerBySmartMatch(phone, email || null, name || null);
                        if (customer) customerId = customer.id;
                    }
                }

                const engineCCVal = ga4Vehicle.EngineCC || ga4Vehicle["Engine CC"];
                const vin = ga4Vehicle.VIN || ga4Vehicle["VIN "];
                const vehicleId = ga4Vehicle._ID || ga4Vehicle["ID Vehicle"];

                const vehicleData: any = {
                    registration,
                    make: ga4Vehicle.Make || null,
                    model: ga4Vehicle.Model || null,
                    colour: ga4Vehicle.Colour || null,
                    fuelType: ga4Vehicle.FuelType || null,
                    vin: vin || null,
                    engineCC: engineCCVal ? parseInt(engineCCVal) : null,
                    notes: ga4Vehicle.Notes || null,
                    externalId: vehicleId,
                    customerId,
                };

                const dateOfReg = ga4Vehicle.DateofReg || ga4Vehicle["Date of Manufacture"];
                if (dateOfReg) {
                    const motDate = parseGA4Date(dateOfReg);
                    if (motDate) vehicleData.dateOfRegistration = motDate;
                }

                if (ga4Vehicle.MOTExpiry) {
                    const motDate = parseGA4Date(ga4Vehicle.MOTExpiry);
                    if (motDate) vehicleData.motExpiryDate = motDate;
                }

                if (existing) {
                    const updates: any = {};
                    if (vehicleData.make && (!existing.make || existing.make.length < vehicleData.make.length)) updates.make = vehicleData.make;
                    if (vehicleData.model && (!existing.model || existing.model.length < vehicleData.model.length)) updates.model = vehicleData.model;
                    if (vehicleData.colour && !existing.colour) updates.colour = vehicleData.colour;
                    if (vehicleData.fuelType && !existing.fuelType) updates.fuelType = vehicleData.fuelType;
                    if (vehicleData.vin && !existing.vin) updates.vin = vehicleData.vin;
                    if (vehicleData.engineCC && !existing.engineCC) updates.engineCC = vehicleData.engineCC;
                    if (vehicleData.dateOfRegistration && !existing.dateOfRegistration) updates.dateOfRegistration = vehicleData.dateOfRegistration;
                    if (vehicleData.motExpiryDate && !existing.motExpiryDate) updates.motExpiryDate = vehicleData.motExpiryDate;
                    if (!existing.externalId) updates.externalId = vehicleId;
                    if (!existing.customerId && customerId) {
                        updates.customerId = customerId;
                        smartLinked++;
                    }

                    if (Object.keys(updates).length > 0) {
                        await updateVehicle(existing.id, updates);
                        updated++;
                    } else {
                        skipped++;
                    }
                } else {
                    await createVehicle(vehicleData);
                    imported++;
                    if (customerId) smartLinked++;
                }
            } catch (e: any) {
                console.error(`Error importing vehicle ${ga4Vehicle.Registration}: ${e.message}`);
            }
        }
        console.log(`Vehicles: ${imported} imported, ${updated} updated, ${skipped} skipped, ${smartLinked} smart-linked`);
    } else {
        console.warn("Vehicles.csv not found");
    }

    // 3. Import Reminders
    console.log("\n--- Importing Reminders ---");
    const remindersPath = path.join(EXPORT_DIR, "Reminders.csv");
    const templatesPath = path.join(EXPORT_DIR, "Reminder_Templates.csv");

    if (fs.existsSync(remindersPath) && fs.existsSync(templatesPath)) {
        const remindersBuffer = fs.readFileSync(remindersPath);
        const templatesBuffer = fs.readFileSync(templatesPath);

        const reminders = parseCSV<GA4Reminder>(remindersBuffer);
        const templates = parseCSV<GA4ReminderTemplate>(templatesBuffer);
        console.log(`Found ${reminders.length} reminders in CSV`);

        let imported = 0;
        let skipped = 0;

        for (const ga4Reminder of reminders) {
            try {
                const vehicle = await getVehicleByExternalId(ga4Reminder._ID_Vehicle);
                if (!vehicle) {
                    skipped++;
                    continue;
                }

                const dueDate = parseGA4Date(ga4Reminder.DueDate);
                if (!dueDate) {
                    skipped++;
                    continue;
                }

                const actioned = isReminderActioned(ga4Reminder);
                const actionedInfo = getReminderActionedInfo(ga4Reminder);

                const reminderData = {
                    type: mapReminderType(ga4Reminder._ID_Template, templates),
                    dueDate,
                    vehicleId: vehicle.id,
                    customerId: vehicle.customerId,
                    registration: vehicle.registration,
                    customer: null,
                    phone: null,
                    email: null,
                    vehicle: `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || null,
                    motExpiryDate: vehicle.motExpiryDate,
                    status: (actioned ? 'sent' : 'pending') as 'sent' | 'pending',
                    sentMethod: actionedInfo.method,
                    sentDate: actionedInfo.date,
                    externalId: ga4Reminder._ID,
                };

                await createReminder(reminderData);
                imported++;
            } catch (e: any) {
                skipped++;
            }
        }
        console.log(`Reminders: ${imported} imported, ${skipped} skipped`);
    } else {
        console.warn("Reminders.csv or Reminder_Templates.csv not found");
    }

    console.log("\nImport Complete!");
    process.exit(0);
}

runImport().catch(e => {
    console.error(e);
    process.exit(1);
});
