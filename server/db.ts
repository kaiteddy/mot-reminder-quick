import { eq, or, inArray, and, sql, desc, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users, InsertReminder, InsertCustomer, InsertReminderLog } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      if (process.env.DATABASE_URL.includes('tidbcloud.com')) {
        const pool = mysql.createPool({
          uri: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: true },
        });
        // @ts-ignore
        _db = drizzle(pool);
      } else {
        _db = drizzle(process.env.DATABASE_URL);
      }
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Reminder queries
export async function getAllReminders() {
  const db = await getDb();
  if (!db) return [];

  const { reminders } = await import("../drizzle/schema");
  return db.select().from(reminders).orderBy(reminders.dueDate);
}

export async function createReminder(data: InsertReminder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { reminders } = await import("../drizzle/schema");
  const result = await db.insert(reminders).values(data);
  return result;
}

export async function updateReminder(id: number, data: Partial<InsertReminder>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { reminders } = await import("../drizzle/schema");
  await db.update(reminders).set(data).where(eq(reminders.id, id));
}

export async function deleteReminder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { reminders } = await import("../drizzle/schema");
  await db.delete(reminders).where(eq(reminders.id, id));
}

// Reminder Logs
// Reminder Logs
export async function createReminderLog(data: InsertReminderLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { reminderLogs } = await import("../drizzle/schema");

  // Sanitize data to ensure undefined values are treated as null where appropriate
  const sanitizedData = { ...data };

  // Explicitly set nullable fields to null if they are undefined
  if (sanitizedData.vehicleId === undefined) sanitizedData.vehicleId = null;
  if (sanitizedData.customerId === undefined) sanitizedData.customerId = null;
  if (sanitizedData.reminderId === undefined) sanitizedData.reminderId = null;
  if (sanitizedData.messageSid === undefined) sanitizedData.messageSid = null;

  const result = await db.insert(reminderLogs).values(sanitizedData);
  return result;
}

export async function getAllReminderLogs() {
  const db = await getDb();
  if (!db) return [];

  const { reminderLogs, customers, vehicles } = await import("../drizzle/schema");
  const { desc, eq } = await import("drizzle-orm");

  return db
    .select({
      id: reminderLogs.id,
      sentAt: reminderLogs.sentAt,
      messageType: reminderLogs.messageType,
      status: reminderLogs.status,
      recipient: reminderLogs.recipient,
      messageContent: reminderLogs.messageContent,
      customerName: customers.name,
      vehicleRegistration: vehicles.registration,
      error: reminderLogs.errorMessage,
    })
    .from(reminderLogs)
    .leftJoin(customers, eq(reminderLogs.customerId, customers.id))
    .leftJoin(vehicles, eq(reminderLogs.vehicleId, vehicles.id))
    .orderBy(desc(reminderLogs.sentAt));
}

export async function getReminderLogsByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];

  const { reminderLogs } = await import("../drizzle/schema");
  const { desc, eq } = await import("drizzle-orm");

  return db
    .select()
    .from(reminderLogs)
    .where(eq(reminderLogs.customerId, customerId))
    .orderBy(desc(reminderLogs.sentAt));
}

// Inbound Customer Messages
export async function createCustomerMessage(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { customerMessages } = await import("../drizzle/schema");
  // Remove fields that might not exist in the schema if passed in data
  const { isOptOut, customerName, vehicleRegistration, ...insertData } = data;

  const result = await db.insert(customerMessages).values(insertData);
  return result;
}

export async function getAllCustomerMessages() {
  const db = await getDb();
  if (!db) return [];

  const { customerMessages, customers } = await import("../drizzle/schema");
  const { desc, eq } = await import("drizzle-orm");

  return db
    .select({
      id: customerMessages.id,
      receivedAt: customerMessages.receivedAt,
      messageBody: customerMessages.messageBody,
      fromNumber: customerMessages.fromNumber,
      read: customerMessages.read,
      // isOptOut: customerMessages.isOptOut, // removed as column doesn't exist
      customerName: customers.name,
      customerId: customerMessages.customerId,
    })
    .from(customerMessages)
    .leftJoin(customers, eq(customerMessages.customerId, customers.id))
    .orderBy(desc(customerMessages.receivedAt));
}

export async function getCustomerMessagesByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];

  const { customerMessages } = await import("../drizzle/schema");
  const { desc, eq } = await import("drizzle-orm");

  return db
    .select()
    .from(customerMessages)
    .where(eq(customerMessages.customerId, customerId))
    .orderBy(desc(customerMessages.receivedAt));
}

export async function markMessageAsRead(id: number) {
  const db = await getDb();
  if (!db) return;

  const { customerMessages } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  await db.update(customerMessages).set({ read: 1 }).where(eq(customerMessages.id, id));
}

export async function getUnreadMessageCount() {
  const db = await getDb();
  if (!db) return 0;

  const { customerMessages } = await import("../drizzle/schema");
  const { eq, sql } = await import("drizzle-orm");

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(customerMessages)
    .where(eq(customerMessages.read, 0));

  return result?.count || 0;
}

export async function markAllMessagesAsRead() {
  const db = await getDb();
  if (!db) return;

  const { customerMessages } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  await db.update(customerMessages).set({ read: 1 }).where(eq(customerMessages.read, 0));
}

// Customer queries
export async function createCustomer(data: InsertCustomer) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { customers } = await import("../drizzle/schema");
  const [result] = await db.insert(customers).values(data);
  return result.insertId;
}

export async function updateCustomer(id: number, data: Partial<InsertCustomer>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { customers } = await import("../drizzle/schema");
  await db.update(customers).set(data).where(eq(customers.id, id));
}

export async function getCustomerByExternalId(externalId: string) {
  const db = await getDb();
  if (!db) return undefined;

  const { customers } = await import("../drizzle/schema");
  const result = await db.select().from(customers).where(eq(customers.externalId, externalId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCustomerById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const { customers } = await import("../drizzle/schema");
  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Vehicle queries
export async function createVehicle(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { vehicles } = await import("../drizzle/schema");
  const result = await db.insert(vehicles).values(data);
  return result;
}

export async function getVehicleByExternalId(externalId: string) {
  const db = await getDb();
  if (!db) return undefined;

  const { vehicles } = await import("../drizzle/schema");
  const result = await db.select().from(vehicles).where(eq(vehicles.externalId, externalId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Get all customers
export async function getAllCustomers() {
  const db = await getDb();
  if (!db) return [];

  const { customers } = await import("../drizzle/schema");
  return db.select().from(customers).orderBy(customers.name);
}

// Get all vehicles
export async function getAllVehicles() {
  const db = await getDb();
  if (!db) return [];

  const { vehicles } = await import("../drizzle/schema");
  return db.select().from(vehicles).orderBy(vehicles.registration);
}

// Get vehicles by customer ID
export async function getVehiclesByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];

  const { vehicles } = await import("../drizzle/schema");
  return db.select().from(vehicles).where(eq(vehicles.customerId, customerId));
}

// Get reminders by customer ID
export async function getRemindersByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];

  const { reminders } = await import("../drizzle/schema");
  return db.select().from(reminders).where(eq(reminders.customerId, customerId));
}

// Get reminders by vehicle ID
export async function getRemindersByVehicleId(vehicleId: number) {
  const db = await getDb();
  if (!db) return [];

  const { reminders } = await import("../drizzle/schema");
  return db.select().from(reminders).where(eq(reminders.vehicleId, vehicleId));
}

// Get vehicle by registration
export async function getVehicleByRegistration(registration: string) {
  const db = await getDb();
  if (!db) return undefined;

  const { vehicles } = await import("../drizzle/schema");
  const result = await db.select().from(vehicles).where(eq(vehicles.registration, registration.toUpperCase())).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Smart customer matching (phone, email, or name)
export async function findCustomerBySmartMatch(phone: string | null, email: string | null, name: string | null) {
  const db = await getDb();
  if (!db) return undefined;

  const { customers } = await import("../drizzle/schema");
  // const { sql: rawSql, or, and, eq } = await import("drizzle-orm"); // Replaced by static import


  const conditions = [];

  // Phone match (highest priority)
  if (phone && phone.length >= 10) {
    // Exact match
    conditions.push(eq(customers.phone, phone));

    // Normalized match (if phone starts with +44, try 0, and vice versa)
    let altPhone = phone;
    if (phone.startsWith('+44')) {
      altPhone = '0' + phone.substring(3);
      conditions.push(eq(customers.phone, altPhone));
    } else if (phone.startsWith('0')) {
      altPhone = '+44' + phone.substring(1);
      conditions.push(eq(customers.phone, altPhone));
    }
  }

  // Email match (second priority)
  if (email && email.includes('@') && !email.includes('placeholder')) {
    conditions.push(eq(customers.email, email));
  }

  // Name match (lowest priority)
  if (name && name.trim().length > 0) {
    conditions.push(sql`LOWER(${customers.name}) = LOWER(${name})`);
  }

  if (conditions.length === 0) return undefined;

  const result = await db.select().from(customers).where(or(...conditions)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function findCustomerByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;

  const { customers } = await import("../drizzle/schema");


  // Basic normalization
  const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');

  // Format variations
  let formats = [normalizedPhone];

  // Handle UK numbers specifically (+44 vs 0)
  if (normalizedPhone.startsWith('+44')) {
    formats.push('0' + normalizedPhone.substring(3));
  } else if (normalizedPhone.startsWith('0')) {
    formats.push('+44' + normalizedPhone.substring(1));
  }

  // Build OR condition for all formats
  const conditions = formats.map(p => eq(customers.phone, p));

  const result = await db.select().from(customers).where(or(...conditions)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}



/**
 * Mark customer as opted-out from receiving messages
 */
export async function setCustomerOptOut(customerId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot opt out customer: database not available");
    return;
  }

  const { customers } = await import("../drizzle/schema");
  await db.update(customers)
    .set({
      optedOut: 1,
      optedOutAt: new Date()
    })
    .where(eq(customers.id, customerId));
}

/**
 * Mark customer as opted-in to receive messages (reverse opt-out)
 */
export async function setCustomerOptIn(customerId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot opt in customer: database not available");
    return;
  }

  const { customers } = await import("../drizzle/schema");
  await db.update(customers)
    .set({
      optedOut: 0,
      optedOutAt: null
    })
    .where(eq(customers.id, customerId));
}

// Get vehicles with customers for auto-generating reminders
export async function getVehiclesWithCustomersForReminders() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get vehicles: database not available");
    return [];
  }

  try {
    const { vehicles, customers } = await import("../drizzle/schema");


    const result = await db
      .select({
        vehicleId: vehicles.id,
        registration: vehicles.registration,
        make: vehicles.make,
        model: vehicles.model,
        motExpiryDate: vehicles.motExpiryDate,
        customerId: vehicles.customerId,
        customerName: customers.name,
        customerEmail: customers.email,
        customerPhone: customers.phone,
        customerOptedOut: customers.optedOut,
        taxStatus: vehicles.taxStatus,
        taxDueDate: vehicles.taxDueDate,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(sql`${vehicles.motExpiryDate} IS NOT NULL`);

    return result;
  } catch (error) {
    console.error("[Database] Failed to get vehicles with customers:", error);
    return [];
  }
}

// function for the Database page - gets ALL vehicles, even without MOT or customer
export async function getAllVehiclesWithCustomers() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get vehicles: database not available");
    return [];
  }

  try {
    const { vehicles, customers, reminderLogs } = await import("../drizzle/schema");
    const { eq, desc, sql } = await import("drizzle-orm");

    // Get max sent date for each vehicle
    // We use a subquery approach or just join and group if needed, 
    // but for simplicity/performance in this specific view, we might try a direct join or separate query.
    // Let's stick to a basic left join for now as shown in the original intent.

    // NOTE: If we want lastReminderSent, we need to join reminderLogs.
    // For now, let's just get the basic vehicle+customer data as that's what the UI primarily needs.

    // Get max sent date for each vehicle
    // We use a simple approach: Get all vehicles, then get the latest log for each in a separate step or subquery.
    // Drizzle subqueries can be tricky with complex types, so we'll fetch logs separately and merge in code for reliability.

    const allVehicles = await db
      .select({
        id: vehicles.id,
        registration: vehicles.registration,
        make: vehicles.make,
        model: vehicles.model,
        motExpiryDate: vehicles.motExpiryDate,
        dateOfRegistration: vehicles.dateOfRegistration,
        customerId: vehicles.customerId,
        customerName: customers.name,

        customerEmail: customers.email,
        customerPhone: customers.phone,
        customerOptedOut: customers.optedOut,
        taxStatus: vehicles.taxStatus,
        taxDueDate: vehicles.taxDueDate,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .orderBy(desc(vehicles.id));

    // Get latest reminder logs - we need a more complex query to get status for the max date
    // Effectively we want: SELECT vehicleId, sentAt, status FROM reminderLogs WHERE (vehicleId, sentAt) IN (SELECT vehicleId, MAX(sentAt) FROM reminderLogs GROUP BY vehicleId)

    // For simplicity with Drizzle/MySQL without complex joins, we can fetch all latest logs by sorting or just fetch them all and map (if dataset small)
    // Or simpler: GROUP BY vehicle_id and get MAX(sentAt), but we can't easily get the corresponding status without a join or window function.
    // Given Drizzle ORM constraints, let's try a window function approach or two queries.
    // Actually, simply fetching all logs for these vehicles order by sentAt desc and taking the first one in JS memory is safest/easiest if not huge scale.
    // Let's optimize: Fetch simple max date first as before, but knowing we need status might require a join.

    // Better approach:
    const logs = await db
      .select({
        vehicleId: reminderLogs.vehicleId,
        sentAt: reminderLogs.sentAt,
        status: reminderLogs.status,
      })
      .from(reminderLogs)
      .where(sql`${reminderLogs.vehicleId} IS NOT NULL`)
      .orderBy(desc(reminderLogs.sentAt));

    // In-memory dedupe to get latest per vehicle (efficient enough for <10k records usually, otherwise need SQL optimize)
    const logMap = new Map();
    for (const log of logs) {
      if (!logMap.has(log.vehicleId)) {
        logMap.set(log.vehicleId, { sentAt: log.sentAt, status: log.status });
      }
    }

    return allVehicles.map(v => {
      const log = v.id ? logMap.get(v.id) : null;
      return {
        ...v,
        lastReminderSent: log ? log.sentAt : null,
        lastReminderStatus: log ? log.status : null,
      };
    });
  } catch (error) {
    console.error("[Database] Failed to get all vehicles with customers:", error);
    return [];
  }
}

export async function updateVehicleMOTExpiryDate(registration: string, motExpiryDate: Date) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update vehicle: database not available");
    return;
  }

  try {
    const { vehicles } = await import("../drizzle/schema");
    const normalized = registration.toUpperCase().replace(/ /g, '');
    await db.update(vehicles)
      .set({ motExpiryDate })
      .where(sql`UPPER(REPLACE(${vehicles.registration}, ' ', '')) = ${normalized}`);
  } catch (error) {
    console.error("[Database] Failed to update vehicle MOT expiry date:", error);
    throw error;
  }
}

export async function resetReminderState(vehicleId: number) {
  const db = await getDb();
  if (!db) return;

  const { reminders } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  await db.delete(reminders).where(eq(reminders.vehicleId, vehicleId));
}

export async function deleteVehicle(vehicleId: number) {
  const db = await getDb();
  if (!db) return;

  const { vehicles, reminders } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  // Delete associated reminders first
  await db.delete(reminders).where(eq(reminders.vehicleId, vehicleId));

  // Then delete the vehicle
  await db.delete(vehicles).where(eq(vehicles.id, vehicleId));
}

export async function getCustomerWithVehiclesByPhone(phone: string) {
  const db = await getDb();
  if (!db) return null;

  const { customers, vehicles } = await import("../drizzle/schema");

  // Get customer by phone
  const customerResult = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  if (customerResult.length === 0) return null;

  const customer = customerResult[0];

  // Get all vehicles for this customer
  const customerVehicles = await db.select().from(vehicles).where(eq(vehicles.customerId, customer.id));

  return {
    customer,
    vehicles: customerVehicles,
  };
}

export async function getCustomersWithVehiclesByPhones(phones: string[]) {
  const db = await getDb();
  if (!db || phones.length === 0) return [];

  const { customers, vehicles } = await import("../drizzle/schema");

  // Get all customers by phone numbers using inArray
  const allCustomers = await db.select().from(customers).where(inArray(customers.phone, phones));

  if (allCustomers.length === 0) return [];

  // Get all vehicles for these customers using inArray
  const customerIds = allCustomers.map(c => c.id);
  const allVehicles = await db.select().from(vehicles).where(inArray(vehicles.customerId, customerIds));

  // Group vehicles by customer ID
  const vehiclesByCustomerId = allVehicles.reduce((acc, vehicle) => {
    if (!vehicle.customerId) return acc;
    if (!acc[vehicle.customerId]) acc[vehicle.customerId] = [];
    acc[vehicle.customerId].push(vehicle);
    return acc;
  }, {} as Record<number, typeof allVehicles>);

  return allCustomers.map(customer => ({
    phone: customer.phone,
    customer,
    vehicles: vehiclesByCustomerId[customer.id] || [],
  }));
}

export async function updateReminderLogStatus(messageSid: string, status: string, timestamp: Date, errorMessage?: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update reminder log status: database not available");
    return;
  }

  const { reminderLogs } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const updateData: any = {
    status,
  };

  if (status === 'delivered') {
    updateData.deliveredAt = timestamp;
  } else if (status === 'read') {
    updateData.readAt = timestamp;
  } else if (status === 'failed' || status === 'undelivered') {
    updateData.failedAt = timestamp;
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }
  }

  await db.update(reminderLogs)
    .set(updateData)
    .where(eq(reminderLogs.messageSid, messageSid));
}

export async function bulkUpdateVehicleMOT(updates: Array<{
  id: number;
  motExpiryDate: Date | null;
  make?: string;
  model?: string;
  colour?: string;
  fuelType?: string;
  taxStatus?: string;
  taxDueDate?: Date | null;
}>) {
  const db = await getDb();
  if (!db) return;

  const { vehicles } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  for (const update of updates) {
    const updateData: any = {
      motExpiryDate: update.motExpiryDate,
      taxStatus: update.taxStatus,
      taxDueDate: update.taxDueDate,
    };
    if (update.make) updateData.make = update.make;
    if (update.model) updateData.model = update.model;
    if (update.colour) updateData.colour = update.colour;
    if (update.fuelType) updateData.fuelType = update.fuelType;

    await db.update(vehicles)
      .set(updateData)
      .where(eq(vehicles.id, update.id));
  }
}


// Add these to server/db.ts

export async function updateVehicle(id: number, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { vehicles } = await import("../drizzle/schema");
  await db.update(vehicles).set(data).where(eq(vehicles.id, id));
}

export async function findVehicleByRegistration(registration: string) {
  return getVehicleByRegistration(registration);
}

export async function findCustomerByName(name: string) {
  const db = await getDb();
  if (!db) return undefined;

  const { customers } = await import("../drizzle/schema");
  const result = await db.select().from(customers).where(eq(customers.name, name)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
