import { eq, or, inArray, and, sql, desc, isNotNull, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import os from "os";
import path from "path";
import {
  InsertUser, users, InsertReminder, InsertCustomer, InsertReminderLog,
  reminders, reminderLogs, customers, customerMessages, vehicles,
  serviceHistory, serviceLineItems
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      if (ENV.databaseUrl.includes('tidbcloud.com')) {
        const pool = mysql.createPool({
          uri: ENV.databaseUrl,
          ssl: { rejectUnauthorized: true },
        });
        // @ts-ignore
        _db = drizzle(pool);
      } else {
        _db = drizzle(ENV.databaseUrl);
      }
    } catch (error: any) {
      const maskedUrl = ENV.databaseUrl ?
        ENV.databaseUrl.substring(0, 15) + "..." + ENV.databaseUrl.substring(ENV.databaseUrl.length - 10) :
        "NOT SET";
      console.error(`[Database] Failed to connect to ${maskedUrl}:`, error.message);
      _db = null;
    }
  } else if (!_db && !ENV.databaseUrl) {
    console.warn("[Database] DATABASE_URL is not set in environment variables");
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

export async function getAllReminders() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminders).orderBy(reminders.dueDate);
}

export async function createReminder(data: InsertReminder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(reminders).values(data);
  return result;
}

export async function updateReminder(id: number, data: Partial<InsertReminder>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reminders).set(data).where(eq(reminders.id, id));
}

export async function deleteReminder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(reminders).where(eq(reminders.id, id));
}

export async function createReminderLog(data: InsertReminderLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const sanitizedData = { ...data };
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

  return db
    .select({
      id: reminderLogs.id,
      vehicleId: reminderLogs.vehicleId,
      customerId: reminderLogs.customerId,
      sentAt: reminderLogs.sentAt,
      messageType: reminderLogs.messageType,
      status: reminderLogs.status,
      recipient: reminderLogs.recipient,
      messageContent: reminderLogs.messageContent,
      customerName: customers.name,
      vehicleRegistration: vehicles.registration,
      registration: reminderLogs.registration,
      dueDate: reminderLogs.dueDate,
      deliveredAt: reminderLogs.deliveredAt,
      readAt: reminderLogs.readAt,
      errorMessage: reminderLogs.errorMessage,
      error: reminderLogs.errorMessage,
      currentMOTExpiry: vehicles.motExpiryDate,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      taxStatus: vehicles.taxStatus,
    })
    .from(reminderLogs)
    .leftJoin(customers, eq(reminderLogs.customerId, customers.id))
    .leftJoin(vehicles, eq(reminderLogs.vehicleId, vehicles.id))
    .orderBy(desc(reminderLogs.sentAt));
}

export async function getReminderLogsByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(reminderLogs)
    .where(eq(reminderLogs.customerId, customerId))
    .orderBy(desc(reminderLogs.sentAt));
}

export async function createCustomerMessage(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { isOptOut, customerName, vehicleRegistration, ...insertData } = data;
  const result = await db.insert(customerMessages).values(insertData);
  return result;
}

export async function getAllCustomerMessages() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: customerMessages.id,
      receivedAt: customerMessages.receivedAt,
      messageBody: customerMessages.messageBody,
      fromNumber: customerMessages.fromNumber,
      read: customerMessages.read,
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

  return db
    .select()
    .from(customerMessages)
    .where(eq(customerMessages.customerId, customerId))
    .orderBy(desc(customerMessages.receivedAt));
}

export async function markMessageAsRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(customerMessages).set({ read: 1 }).where(eq(customerMessages.id, id));
}

export async function getUnreadMessageCount() {
  const db = await getDb();
  if (!db) return 0;

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(customerMessages)
    .where(eq(customerMessages.read, 0));

  return result?.count || 0;
}

export async function markAllMessagesAsRead() {
  const db = await getDb();
  if (!db) return;
  await db.update(customerMessages).set({ read: 1 }).where(eq(customerMessages.read, 0));
}

export async function createCustomer(data: InsertCustomer) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(customers).values(data);
  return result.insertId;
}

export async function updateCustomer(id: number, data: Partial<InsertCustomer>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customers).set(data).where(eq(customers.id, id));
}

export async function getCustomerByExternalId(externalId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(customers).where(eq(customers.externalId, externalId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCustomerById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createVehicle(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(vehicles).values(data);
  return result;
}

export async function getVehicleByExternalId(externalId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(vehicles).where(eq(vehicles.externalId, externalId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllCustomers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customers).orderBy(customers.name);
}

export async function getAllVehicles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vehicles).orderBy(vehicles.registration);
}

export async function getVehiclesByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vehicles).where(eq(vehicles.customerId, customerId));
}

export async function getRemindersByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminders).where(eq(reminders.customerId, customerId));
}

export async function getRemindersByVehicleId(vehicleId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminders).where(eq(reminders.vehicleId, vehicleId));
}

export async function getVehicleByRegistration(registration: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(vehicles).where(eq(vehicles.registration, registration.toUpperCase())).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function searchVehiclesByRegistration(query: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const normalized = query.replace(/\s/g, "").toUpperCase();
  return db.select()
    .from(vehicles)
    .where(like(vehicles.registration, `${normalized}%`))
    .limit(limit);
}

export async function findCustomerBySmartMatch(phone: string | null, email: string | null, name: string | null) {
  const db = await getDb();
  if (!db) return undefined;

  const conditions = [];

  if (phone && phone.length >= 10) {
    conditions.push(eq(customers.phone, phone));
    let altPhone = phone;
    if (phone.startsWith('+44')) {
      altPhone = '0' + phone.substring(3);
      conditions.push(eq(customers.phone, altPhone));
    } else if (phone.startsWith('0')) {
      altPhone = '+44' + phone.substring(1);
      conditions.push(eq(customers.phone, altPhone));
    }
  }

  if (email && email.includes('@') && !email.includes('placeholder')) {
    conditions.push(eq(customers.email, email));
  }

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

  const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
  let formats = [normalizedPhone];

  if (normalizedPhone.startsWith('+44')) {
    formats.push('0' + normalizedPhone.substring(3));
  } else if (normalizedPhone.startsWith('0')) {
    formats.push('+44' + normalizedPhone.substring(1));
  }

  const conditions = formats.map(p => eq(customers.phone, p));
  const result = await db.select().from(customers).where(or(...conditions)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function setCustomerOptOut(customerId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(customers)
    .set({ optedOut: 1, optedOutAt: new Date() })
    .where(eq(customers.id, customerId));
}

export async function setCustomerOptIn(customerId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(customers)
    .set({ optedOut: 0, optedOutAt: null })
    .where(eq(customers.id, customerId));
}

export async function getVehiclesWithCustomersForReminders() {
  const db = await getDb();
  if (!db) return [];

  try {
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
        lastChecked: vehicles.lastChecked,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(isNotNull(vehicles.motExpiryDate));

    return result;
  } catch (error) {
    console.error("[Database] Failed to get vehicles with customers:", error);
    return [];
  }
}

export async function getAllVehiclesWithCustomers() {
  const db = await getDb();
  if (!db) return [];

  try {
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
        vin: vehicles.vin,
        engineCC: vehicles.engineCC,
        engineNo: vehicles.engineNo,
        engineCode: vehicles.engineCode,
        colour: vehicles.colour,
        fuelType: vehicles.fuelType,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .orderBy(desc(vehicles.id));

    const logs = await db
      .select({
        vehicleId: reminderLogs.vehicleId,
        sentAt: reminderLogs.sentAt,
        status: reminderLogs.status,
      })
      .from(reminderLogs)
      .where(isNotNull(reminderLogs.vehicleId))
      .orderBy(desc(reminderLogs.sentAt));

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
  if (!db) return;

  try {
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
  await db.delete(reminders).where(eq(reminders.vehicleId, vehicleId));
}

export async function deleteVehicle(vehicleId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(reminders).where(eq(reminders.vehicleId, vehicleId));
  await db.delete(vehicles).where(eq(vehicles.id, vehicleId));
}

export async function deleteVehiclesByIds(vehicleIds: number[]) {
  const db = await getDb();
  if (!db || vehicleIds.length === 0) return;

  const BATCH_SIZE = 500;
  for (let i = 0; i < vehicleIds.length; i += BATCH_SIZE) {
    const batch = vehicleIds.slice(i, i + BATCH_SIZE);
    await db.delete(reminders).where(inArray(reminders.vehicleId, batch));
    await db.delete(vehicles).where(inArray(vehicles.id, batch));
  }
}

export async function getVehiclesWithReminderHistory(vehicleIds: number[]) {
  const db = await getDb();
  if (!db || vehicleIds.length === 0) return [];

  const BATCH_SIZE = 500;
  const idsWithHistory = new Set<number>();

  for (let i = 0; i < vehicleIds.length; i += BATCH_SIZE) {
    const batch = vehicleIds.slice(i, i + BATCH_SIZE);
    const results = await db
      .select({ vehicleId: reminderLogs.vehicleId })
      .from(reminderLogs)
      .where(inArray(reminderLogs.vehicleId, batch))
      .groupBy(reminderLogs.vehicleId);

    results.forEach(r => {
      if (r.vehicleId !== null) idsWithHistory.add(r.vehicleId);
    });
  }

  return Array.from(idsWithHistory);
}

export async function getCustomerWithVehiclesByPhone(phone: string) {
  const db = await getDb();
  if (!db) return null;

  const customerResult = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  if (customerResult.length === 0) return null;

  const customer = customerResult[0];
  const customerVehicles = await db.select().from(vehicles).where(eq(vehicles.customerId, customer.id));

  return { customer, vehicles: customerVehicles };
}

export async function getCustomersWithVehiclesByPhones(phones: string[]) {
  const db = await getDb();
  if (!db || phones.length === 0) return [];

  const allCustomers = await db.select().from(customers).where(inArray(customers.phone, phones));
  if (allCustomers.length === 0) return [];

  const customerIds = allCustomers.map(c => c.id);
  const allVehicles = await db.select().from(vehicles).where(inArray(vehicles.customerId, customerIds));

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
  if (!db) return;

  const updateData: any = { status };
  if (status === 'delivered') {
    updateData.deliveredAt = timestamp;
  } else if (status === 'read') {
    updateData.readAt = timestamp;
  } else if (status === 'failed' || status === 'undelivered') {
    updateData.failedAt = timestamp;
    if (errorMessage) updateData.errorMessage = errorMessage;
  }

  await db.update(reminderLogs).set(updateData).where(eq(reminderLogs.messageSid, messageSid));
}

export async function bulkUpdateVehicleMOT(updates: Array<{
  id: number;
  motExpiryDate?: Date | null;
  make?: string;
  model?: string;
  colour?: string;
  fuelType?: string;
  taxStatus?: string;
  taxDueDate?: Date | null;
  lastChecked?: Date | null;
}>) {
  const db = await getDb();
  if (!db) return;

  for (const update of updates) {
    const updateData: any = {};
    if (Object.prototype.hasOwnProperty.call(update, 'motExpiryDate')) updateData.motExpiryDate = update.motExpiryDate;
    if (Object.prototype.hasOwnProperty.call(update, 'taxStatus')) updateData.taxStatus = update.taxStatus;
    if (Object.prototype.hasOwnProperty.call(update, 'taxDueDate')) updateData.taxDueDate = update.taxDueDate;
    if (Object.prototype.hasOwnProperty.call(update, 'lastChecked')) updateData.lastChecked = update.lastChecked;
    if (update.make) updateData.make = update.make;
    if (update.model) updateData.model = update.model;
    if (update.colour) updateData.colour = update.colour;
    if (update.fuelType) updateData.fuelType = update.fuelType;

    if (Object.keys(updateData).length > 0) {
      await db.update(vehicles).set(updateData).where(eq(vehicles.id, update.id));
    }
  }
}

export async function updateVehicle(id: number, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(vehicles).set(data).where(eq(vehicles.id, id));
}

export async function saveTechnicalData(registration: string, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(vehicles)
    .set({
      comprehensiveTechnicalData: data,
      swsLastUpdated: new Date()
    })
    .where(eq(vehicles.registration, registration));
}

export async function getLatestVehicleMileage(vehicleId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ mileage: serviceHistory.mileage })
    .from(serviceHistory)
    .where(eq(serviceHistory.vehicleId, vehicleId))
    .orderBy(desc(serviceHistory.dateCreated))
    .limit(1);
  return result.length > 0 ? result[0].mileage : 0;
}

export async function findVehicleByRegistration(registration: string) {
  return getVehicleByRegistration(registration);
}

export async function findCustomerByName(name: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(customers).where(eq(customers.name, name)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getServiceHistoryByVehicleId(vehicleId: number) {
  const db = await getDb();
  if (!db) return [];

  // We join with line items to get a main description and a fallback total
  return db.select({
    id: serviceHistory.id,
    externalId: serviceHistory.externalId,
    customerId: serviceHistory.customerId,
    vehicleId: serviceHistory.vehicleId,
    docType: serviceHistory.docType,
    docNo: serviceHistory.docNo,
    dateCreated: serviceHistory.dateCreated,
    dateIssued: serviceHistory.dateIssued,
    datePaid: serviceHistory.datePaid,
    totalNet: serviceHistory.totalNet,
    totalTax: serviceHistory.totalTax,
    totalGross: sql<string>`COALESCE(NULLIF(CAST(${serviceHistory.totalGross} AS DECIMAL(10,2)), 0), SUM(${serviceLineItems.subNet}))`,
    mileage: serviceHistory.mileage,
    createdAt: serviceHistory.createdAt,
    description: serviceHistory.description,
    mainDescription: sql<string>`COALESCE(${serviceHistory.description}, MIN(${serviceLineItems.description}))`,
  })
    .from(serviceHistory)
    .leftJoin(serviceLineItems, eq(serviceHistory.id, serviceLineItems.documentId))
    .where(eq(serviceHistory.vehicleId, vehicleId))
    .groupBy(serviceHistory.id)
    .orderBy(desc(serviceHistory.dateCreated));
}

export async function getServiceHistoryByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: serviceHistory.id,
    externalId: serviceHistory.externalId,
    customerId: serviceHistory.customerId,
    vehicleId: serviceHistory.vehicleId,
    docType: serviceHistory.docType,
    docNo: serviceHistory.docNo,
    dateCreated: serviceHistory.dateCreated,
    dateIssued: serviceHistory.dateIssued,
    datePaid: serviceHistory.datePaid,
    totalNet: serviceHistory.totalNet,
    totalTax: serviceHistory.totalTax,
    totalGross: sql<string>`COALESCE(NULLIF(CAST(${serviceHistory.totalGross} AS DECIMAL(10,2)), 0), SUM(${serviceLineItems.subNet}))`,
    mileage: serviceHistory.mileage,
    createdAt: serviceHistory.createdAt,
    description: serviceHistory.description,
    mainDescription: sql<string>`COALESCE(${serviceHistory.description}, MIN(${serviceLineItems.description}))`,
  })
    .from(serviceHistory)
    .leftJoin(serviceLineItems, eq(serviceHistory.id, serviceLineItems.documentId))
    .where(eq(serviceHistory.customerId, customerId))
    .groupBy(serviceHistory.id)
    .orderBy(desc(serviceHistory.dateCreated));
}

export async function getServiceLineItemsByDocumentId(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(serviceLineItems)
    .where(eq(serviceLineItems.documentId, documentId))
    .orderBy(serviceLineItems.id);
}

export async function getServiceDocumentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(serviceHistory).where(eq(serviceHistory.id, id));
  return result.length > 0 ? result[0] : undefined;
}

export async function createServiceDocument(doc: any, items: any[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { nanoid } = await import("nanoid");

  return await db.transaction(async (tx) => {
    const docToInsert = {
      ...doc,
      externalId: doc.externalId || `NEW-${nanoid()}`,
    };

    const [result] = await tx.insert(serviceHistory).values(docToInsert);
    const documentId = result.insertId;

    if (items.length > 0) {
      const itemsToInsert = items.map(item => ({
        ...item,
        documentId,
        externalId: item.externalId || `ITEM-${nanoid()}`,
      }));
      await tx.insert(serviceLineItems).values(itemsToInsert);
    }

    return { id: documentId };
  });
}

export async function getRichPDF(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const doc = await getServiceDocumentById(documentId);
  if (!doc) throw new Error("Document not found");

  const customer = await getCustomerById(doc.customerId as number);
  const vehicle = await db.select().from(vehicles).where(eq(vehicles.id, doc.vehicleId as number)).limit(1).then(r => r[0]);
  const items = await getServiceLineItemsByDocumentId(documentId);

  const { spawnSync } = await import("child_process");

  const templateData: any = {
    company: {
      name: 'ELI MOTORS LIMITED',
      address_line1: '49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP',
      phone: '020 8203 6449, Sales 07950 250970',
      website: 'www.elimotors.co.uk',
      vat: '330 9339 65',
    },
    customer: {
      name: customer?.name || 'Unknown Client',
      address_lines: (customer?.address || '').split(',').map(s => s.trim()),
      mobile: customer?.phone || '',
    },
    vehicle: {
      reg: vehicle?.registration || '',
      make: vehicle?.make || '',
      model: vehicle?.model || '',
      chassis: vehicle?.vin || '',
      mileage: (doc.mileage || 0).toString(),
      engine_no: vehicle?.engineNo || '',
      engine_code: vehicle?.engineCode || '',
      engine_cc: vehicle?.engineCC || 0,
      date_reg: vehicle?.dateOfRegistration ? new Date(vehicle.dateOfRegistration).toLocaleDateString('en-GB') : '',
      colour: vehicle?.colour || '',
    },
    totals: {
      labour: items.filter(i => i.itemType === 'Labour').reduce((acc, i) => acc + Number(i.subNet), 0),
      parts: items.filter(i => i.itemType === 'Part').reduce((acc, i) => acc + Number(i.subNet), 0),
      subtotal: Number(doc.totalNet),
      vat_rate: 20,
      vat: Number(doc.totalTax),
      total: Number(doc.totalGross),
    }
  };

  let type: 'invoice' | 'estimate' | 'jobsheet' = 'invoice';
  if (doc.docType === 'ES') {
    type = 'estimate';
    templateData.estimate = {
      number: doc.docNo,
      date: doc.dateCreated ? new Date(doc.dateCreated).toLocaleDateString('en-GB') : '',
      account_no: '',
      valid_to: '',
    };
  } else if (doc.docType === 'SI') {
    type = 'invoice';
    templateData.invoice = {
      number: doc.docNo,
      invoice_date: doc.dateCreated ? new Date(doc.dateCreated).toLocaleDateString('en-GB') : '',
      account_no: '',
      date_of_work: doc.dateCreated ? new Date(doc.dateCreated).toLocaleDateString('en-GB') : '',
    };
  } else {
    type = 'jobsheet';
    templateData.doc = {
      reference: doc.docNo,
      account_no: '',
      receive_date: doc.dateCreated ? new Date(doc.dateCreated).toLocaleDateString('en-GB') : '',
      due_date: '',
    };
  }

  templateData.work_title = doc.description;
  templateData.labour = items.filter(i => i.itemType === 'Labour').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    unit: Number(i.unitPrice),
    subtotal: Number(i.subNet),
  }));
  templateData.parts = items.filter(i => i.itemType === 'Part').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    unit: Number(i.unitPrice),
    subtotal: Number(i.subNet),
  }));

  const outputFile = `/tmp/${doc.docNo}_${Date.now()}.pdf`;
  const inputJson = JSON.stringify({
    type,
    data: templateData,
    outputFile
  });

  const result = spawnSync('python3', [
    path.join(process.cwd(), 'scripts/generate_pdf.py')
  ], {
    input: inputJson,
    encoding: 'utf-8',
    shell: true
  });

  if (result.error) throw new Error(`Script execution failed: ${result.error.message}`);

  try {
    const output = JSON.parse(result.stdout);
    if (output.error) throw new Error(output.error);

    const pdfContent = await import("fs").then(fs => fs.readFileSync(output.path));
    const base64Content = pdfContent.toString('base64');
    return {
      content: base64Content,
      filename: `${doc.docNo || 'Document'}.pdf`
    };
  } catch (e: any) {
    throw new Error(`PDF generation failed: ${e.message}. STDOUT: ${result.stdout}. STDERR: ${result.stderr}`);
  }
}
