import { eq, or, inArray, and, sql, desc, isNotNull, like, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import os from "os";
import fs from "fs";
import path from "path";
import {
  users, customers, vehicles, reminders, reminderLogs,
  customerMessages, serviceHistory, serviceLineItems, appointments, appSettings, autodataRequests,
  descriptionPresets, customerLogs, payments,
  InsertUser, InsertReminder, InsertCustomer, InsertReminderLog, InsertCustomerLog, InsertPayment
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
      motBookedDate: vehicles.motBookedDate,
      bookingRequested: vehicles.bookingRequested,
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
  const cleanReg = registration.toUpperCase().replace(/\s/g, "");
  const result = await db.select().from(vehicles).where(eq(vehicles.registration, cleanReg)).limit(1);
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
        motBookedDate: vehicles.motBookedDate,
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
        lastChecked: vehicles.lastChecked,
      })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .orderBy(desc(vehicles.id));

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const logs = await db
      .select({
        vehicleId: reminderLogs.vehicleId,
        sentAt: reminderLogs.sentAt,
        status: reminderLogs.status,
      })
      .from(reminderLogs)
      .where(and(isNotNull(reminderLogs.vehicleId), gte(reminderLogs.sentAt, oneYearAgo)))
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

  const existing = await db.select().from(vehicles).where(eq(vehicles.registration, registration)).limit(1);

  const make = data?.ukvd?.make || data?.specs?.make || (data?.specs?.fullName ? data?.specs?.fullName.split(' ')[0] : null) || "Unknown";
  const model = data?.ukvd?.model || data?.specs?.model || (data?.specs?.fullName ? data?.specs?.fullName.split(' ').slice(1).join(' ') : null) || "Unknown";
  const fuelType = data?.ukvd?.fuelType || data?.specs?.fuelType || null;
  const colour = data?.ukvd?.colour || data?.specs?.colour || null;
  const engineCC = data?.ukvd?.engineSize || data?.specs?.engineSize || null;
  const vin = data?.ukvd?.vin || data?.specs?.vin || data?.raw?.vinNumber || null;
  const engineCode = data?.specs?.engineCode || data?.raw?.engineCode || null;

  if (existing.length > 0) {
    const v = existing[0];
    await db.update(vehicles)
      .set({
        make: v.make && v.make !== "Unknown" ? v.make : make,
        model: v.model && v.model !== "Unknown" ? v.model : model,
        fuelType: v.fuelType || fuelType,
        colour: v.colour || colour,
        engineCC: v.engineCC || engineCC,
        vin: v.vin || vin,
        engineCode: v.engineCode || engineCode,
        comprehensiveTechnicalData: data,
        swsLastUpdated: new Date()
      })
      .where(eq(vehicles.registration, registration));
  } else {
    await db.insert(vehicles).values({
      registration,
      make: make,
      model: model,
      fuelType: fuelType,
      colour: colour,
      engineCC: engineCC,
      vin: vin,
      engineCode: engineCode,
      comprehensiveTechnicalData: data,
      swsLastUpdated: new Date()
    });
  }
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
  const rawDocs = await db.select({
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

  // Deduplicate by docType and docNo
  const seen = new Set<string>();
  const deduplicated = [];
  for (const doc of rawDocs) {
    if (doc.docNo) {
      const key = `${doc.docType}-${doc.docNo}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(doc);
      }
    } else {
      deduplicated.push(doc);
    }
  }
  return deduplicated;
}

export async function getDetailedServiceHistoryByVehicleId(vehicleId: number) {
  const docs = await getServiceHistoryByVehicleId(vehicleId);
  const docsWithItems = await Promise.all(docs.map(async (doc) => {
    const items = await getServiceLineItemsByDocumentId(doc.id);
    return { ...doc, items };
  }));
  return docsWithItems;
}

export async function getServiceHistoryByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rawDocs = await db.select({
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

  // Deduplicate by docType and docNo
  const seen = new Set<string>();
  const deduplicated = [];
  for (const doc of rawDocs) {
    if (doc.docNo) {
      const key = `${doc.docType}-${doc.docNo}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(doc);
      }
    } else {
      deduplicated.push(doc);
    }
  }
  return deduplicated;
}

export async function getServiceLineItemsByDocumentId(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(serviceLineItems)
    .where(eq(serviceLineItems.documentId, documentId))
    .orderBy(serviceLineItems.id);
}

/** Paginated/filterable list of GA4 documents (job sheets / invoices / estimates). */
export async function getDocuments(opts: { search?: string; docType?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  const conds: any[] = [];
  if (opts.docType && opts.docType !== "all") conds.push(eq(serviceHistory.docType, opts.docType));
  if (opts.search && opts.search.trim()) {
    const s = `%${opts.search.trim()}%`;
    conds.push(or(like(serviceHistory.docNo, s), like(serviceHistory.registration, s), like(customers.name, s)));
  }
  const where = conds.length ? and(...conds) : undefined;
  return db.select({
    id: serviceHistory.id,
    docType: serviceHistory.docType,
    docNo: serviceHistory.docNo,
    dateIssued: serviceHistory.dateIssued,
    dateCreated: serviceHistory.dateCreated,
    registration: serviceHistory.registration,
    totalGross: serviceHistory.totalGross,
    balance: serviceHistory.balance,
    docStatus: serviceHistory.docStatus,
    customerId: serviceHistory.customerId,
    customerName: customers.name,
    vehicleId: serviceHistory.vehicleId,
    make: vehicles.make,
    model: vehicles.model,
  })
    .from(serviceHistory)
    .leftJoin(customers, eq(serviceHistory.customerId, customers.id))
    .leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
    .where(where as any)
    .orderBy(desc(serviceHistory.dateCreated))
    .limit(limit)
    .offset(offset);
}

/** Document counts by type for the list header. */
export async function getDocumentStats() {
  const db = await getDb();
  if (!db) return { total: 0, byType: [] as { docType: string | null; n: number }[] };
  const rows = await db.select({
    docType: serviceHistory.docType,
    n: sql<number>`COUNT(*)`,
  }).from(serviceHistory).groupBy(serviceHistory.docType);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  return { total, byType: rows.map(r => ({ docType: r.docType, n: Number(r.n) })) };
}

/** Full document detail: header + customer + vehicle + line items. */
export async function getDocumentDetail(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(serviceHistory).where(eq(serviceHistory.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return null;
  let customer = null, vehicle = null, history: any[] = [];
  if (doc.customerId) customer = (await db.select().from(customers).where(eq(customers.id, doc.customerId)).limit(1))[0] ?? null;
  if (doc.vehicleId) {
    vehicle = (await db.select().from(vehicles).where(eq(vehicles.id, doc.vehicleId)).limit(1))[0] ?? null;
    history = (await getServiceHistoryByVehicleId(doc.vehicleId)).filter((h) => h.id !== id);
  }
  const lineItems = await getServiceLineItemsByDocumentId(id);
  let accBalance = 0, custLastInvoiced: any = null, vehLastInvoiced: any = null;
  if (doc.customerId) {
    const r = await db.select({
      bal: sql<number>`COALESCE(SUM(${serviceHistory.balance}),0)`,
      last: sql<any>`MAX(CASE WHEN ${serviceHistory.docType}='SI' THEN ${serviceHistory.dateIssued} END)`,
    }).from(serviceHistory).where(eq(serviceHistory.customerId, doc.customerId));
    accBalance = Number(r[0]?.bal) || 0;
    custLastInvoiced = r[0]?.last ?? null;
  }
  if (doc.vehicleId) {
    const r = await db.select({ last: sql<any>`MAX(CASE WHEN ${serviceHistory.docType}='SI' THEN ${serviceHistory.dateIssued} END)` })
      .from(serviceHistory).where(eq(serviceHistory.vehicleId, doc.vehicleId));
    vehLastInvoiced = r[0]?.last ?? null;
  }
  const docPayments = await db.select().from(payments).where(eq(payments.documentId, id)).orderBy(desc(payments.paymentDate));
  let relatedDoc: any = null;
  if (doc.relatedDocId) relatedDoc = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, doc.relatedDocId)).limit(1))[0] ?? null;
  return { doc, customer, vehicle, lineItems, history, accBalance, custLastInvoiced, vehLastInvoiced, payments: docPayments, relatedDoc };
}

/** All parts ever fitted to a vehicle (across every document), with the price charged. */
export async function getVehiclePartsHistory(vehicleId: number, limit = 400) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: serviceLineItems.id,
    docId: serviceHistory.id,
    docNo: serviceHistory.docNo,
    docType: serviceHistory.docType,
    dateCreated: serviceHistory.dateCreated,
    dateIssued: serviceHistory.dateIssued,
    mileage: serviceHistory.mileage,
    description: serviceLineItems.description,
    partNumber: serviceLineItems.partNumber,
    quantity: serviceLineItems.quantity,
    unitPrice: serviceLineItems.unitPrice,
    subNet: serviceLineItems.subNet,
  })
    .from(serviceLineItems)
    .innerJoin(serviceHistory, eq(serviceLineItems.documentId, serviceHistory.id))
    .where(and(eq(serviceHistory.vehicleId, vehicleId), eq(serviceLineItems.itemType, "Part")))
    .orderBy(desc(serviceHistory.dateCreated))
    .limit(limit);
}

const normReg = (r?: string) => (r || "").toUpperCase().replace(/\s+/g, "");

/** Reg lookup for the job sheet form: DB first, then DVLA (like GA4's VRM lookup). */
export async function lookupVehicleForReg(registration: string) {
  const db = await getDb();
  const reg = normReg(registration);
  if (!reg) return { found: false, source: "none", vehicle: null, customer: null };
  if (db) {
    const v: any = (await db.select().from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1))[0];
    if (v) {
      const cust = v.customerId ? (await db.select().from(customers).where(eq(customers.id, v.customerId)).limit(1))[0] ?? null : null;
      // A known vehicle won't have the SWS-derived fields filled in (derivative, A/C charge,
      // oil spec) — they're only fetched for brand-new regs. Supplement from SWS+DVLA when the
      // derivative is missing, then cache the derivative back so we don't refetch next time.
      if (!v.derivative) {
        try {
          const { fetchRichVehicleData } = await import("./sws");
          const sws: any = await fetchRichVehicleData(reg, true);
          const deriv = sws?.specs?.name || sws?.specs?.fullName || null;
          if (deriv) {
            v.derivative = deriv;
            await db.update(vehicles).set({ derivative: deriv }).where(eq(vehicles.id, v.id));
          }
          const oil = (sws?.lubricants || []).find((l: any) => /engine oil/i.test(l?.description || ""));
          if (oil || sws?.aircon) {
            v.technical = { oilSpec: oil?.specification || null, oilCapacity: oil?.capacity || null, airconType: sws?.aircon?.type || null, airconCapacity: sws?.aircon?.quantity ?? sws?.aircon?.capacity ?? null };
          }
        } catch { /* SWS unavailable — keep stored record */ }
        try {
          const { getVehicleDetails } = await import("./dvlaApi");
          const d: any = await getVehicleDetails(reg);
          if (d) { v.motExpiryDate = v.motExpiryDate ?? d.motExpiryDate ?? null; v.taxStatus = d.taxStatus ?? null; v.taxDueDate = d.taxDueDate ?? null; }
        } catch { /* DVLA unavailable */ }
      }
      return { found: true, source: "database", vehicle: v, customer: cust };
    }
  }
  // Not in our DB — do a live VRM lookup like GA4: SWS (rich: make/model/colour/
  // fuel/engine/VIN, via its UKVD merge) supplemented by DVLA (MOT/year).
  const v: any = { registration: reg };
  const sources: string[] = [];
  try {
    const { fetchRichVehicleData } = await import("./sws");
    const sws: any = await fetchRichVehicleData(reg, true);
    const u = sws?.ukvd || {};
    if (u.make || u.model || u.colour || u.fuelType || u.engineSize || u.vin) {
      v.make = u.make ?? null; v.model = u.model ?? null; v.colour = u.colour ?? null;
      v.fuelType = u.fuelType ?? null; v.engineCC = u.engineSize ?? null; v.vin = u.vin ?? null;
      v.derivative = sws?.specs?.name || sws?.specs?.fullName || null;
      sources.push("sws");
    }
    const oil = (sws?.lubricants || []).find((l: any) => /engine oil/i.test(l?.description || ""));
    if (oil || sws?.aircon) {
      v.technical = { oilSpec: oil?.specification || null, oilCapacity: oil?.capacity || null, airconType: sws?.aircon?.type || null, airconCapacity: sws?.aircon?.quantity ?? sws?.aircon?.capacity ?? null };
    }
  } catch (e) { /* SWS/UKVD unavailable */ }
  try {
    const { getVehicleDetails } = await import("./dvlaApi");
    const d = await getVehicleDetails(reg);
    if (d) {
      v.make = v.make ?? d.make ?? null; v.model = v.model ?? d.model ?? null; v.colour = v.colour ?? d.colour ?? null;
      v.fuelType = v.fuelType ?? d.fuelType ?? null; v.engineCC = v.engineCC ?? d.engineCapacity ?? null;
      v.motExpiryDate = d.motExpiryDate ?? null;
      v.taxStatus = (d as any).taxStatus ?? null;
      v.taxDueDate = (d as any).taxDueDate ?? null;
      if (d.yearOfManufacture) v.dateOfRegistration = new Date(d.yearOfManufacture, 0, 1);
      sources.push("dvla");
    }
  } catch (e) { /* DVLA unavailable */ }

  return { found: false, source: sources.join("+") || "none", customer: null, vehicle: v };
}

/** Next sequential document number for a given GA4 doc type. */
export async function getNextDocNo(docType: string) {
  const db = await getDb();
  if (!db) return "1";
  const r = await db.select({ m: sql<number>`MAX(CAST(${serviceHistory.docNo} AS UNSIGNED))` })
    .from(serviceHistory).where(eq(serviceHistory.docType, docType));
  return String((Number(r[0]?.m) || 0) + 1);
}

/** Search customers by name / phone / email / postcode (for the job-sheet picker). */
export async function searchCustomers(query: string, limit = 10) {
  const db = await getDb();
  if (!db || !query || query.trim().length < 2) return [];
  const s = `%${query.trim()}%`;
  return db.select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, postcode: customers.postcode, address: customers.address })
    .from(customers)
    .where(or(like(customers.name, s), like(customers.phone, s), like(customers.email, s), like(customers.postcode, s)))
    .orderBy(customers.name)
    .limit(limit);
}

/** Pre-set description snippets (GA4 parity). */
export async function getDescriptionPresets() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(descriptionPresets).orderBy(descriptionPresets.title);
}
export async function createDescriptionPreset(input: { title: string; body: string; category?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [{ id }] = await db.insert(descriptionPresets).values({ title: input.title, body: input.body, category: input.category ?? null }).$returningId();
  return { id };
}
export async function deleteDescriptionPreset(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(descriptionPresets).where(eq(descriptionPresets.id, id));
}

/** Unified customer communication timeline: manual logs + reminders sent + messages received. */
export async function getCustomerLog(customerId?: number, vehicleId?: number) {
  const db = await getDb();
  if (!db || (!customerId && !vehicleId)) return [] as any[];
  type Entry = { key: string; date: Date | null; type: string; direction: string; channel: string; title: string; body: string; status?: string | null; createdBy?: string | null };
  const out: Entry[] = [];

  // 1) manual / system logs (customerLogs)
  const logConds: any[] = [];
  if (customerId) logConds.push(eq(customerLogs.customerId, customerId));
  if (vehicleId) logConds.push(eq(customerLogs.vehicleId, vehicleId));
  const logs = await db.select().from(customerLogs).where(logConds.length > 1 ? or(...logConds) : logConds[0]).orderBy(desc(customerLogs.createdAt)).limit(300);
  for (const l of logs as any[]) {
    out.push({ key: `log-${l.id}`, date: l.createdAt, type: l.type, direction: l.direction, channel: l.type,
      title: l.subject || ({ note: "Note", email: "Email", sms: "SMS", call: "Phone call", letter: "Letter", system: "System" } as any)[l.type] || "Log",
      body: l.body || "", createdBy: l.createdBy });
  }

  // 2) reminders sent (reminderLogs) — outbound
  if (customerId) {
    const rls = await db.select().from(reminderLogs).where(eq(reminderLogs.customerId, customerId)).orderBy(desc(reminderLogs.sentAt)).limit(200);
    for (const r of rls as any[]) {
      out.push({ key: `rl-${r.id}`, date: r.sentAt, type: "sms", direction: "out", channel: "reminder",
        title: `${r.messageType} reminder${r.registration ? ` · ${r.registration}` : ""}`,
        body: r.messageContent || "", status: r.status });
    }
  }

  // 3) messages received (customerMessages) — inbound
  if (customerId) {
    const cms = await db.select().from(customerMessages).where(eq(customerMessages.customerId, customerId)).orderBy(desc(customerMessages.receivedAt)).limit(200);
    for (const m of cms as any[]) {
      out.push({ key: `cm-${m.id}`, date: m.receivedAt, type: "sms", direction: "in", channel: "reply",
        title: `Reply from ${m.fromNumber || "customer"}`, body: m.messageBody || "", status: m.read ? "read" : "unread" });
    }
  }

  out.sort((a, b) => (new Date(b.date || 0).getTime()) - (new Date(a.date || 0).getTime()));
  return out;
}

export async function addCustomerLog(input: InsertCustomerLog) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [{ id }] = await db.insert(customerLogs).values({
    customerId: input.customerId ?? null,
    vehicleId: input.vehicleId ?? null,
    documentId: input.documentId ?? null,
    type: input.type ?? "note",
    direction: input.direction ?? "internal",
    subject: input.subject ?? null,
    body: input.body ?? null,
    createdBy: input.createdBy ?? null,
  }).$returningId();
  return { id };
}

export interface SaveDocInput {
  id?: number;
  docType?: string;
  registration?: string;
  customerId?: number;
  createCustomer?: boolean;
  updateCustomerRecord?: boolean;
  vehicle?: Record<string, any>;
  customerName?: string; custTitle?: string; custForename?: string; custSurname?: string;
  company?: string; accountNumber?: string;
  custHouseNo?: string; custRoad?: string; custLocality?: string; custTown?: string; custCounty?: string; custPostcode?: string;
  custTelephone?: string; custMobile?: string; custEmail?: string;
  mileage?: number | null; dateCreated?: any; dateIssued?: any;
  docStatus?: string; orderRef?: string; department?: string; terms?: string; description?: string;
  staffSalesPerson?: string; staffTechnician?: string; staffRoadTester?: string; staffMotTester?: string;
  motClass?: string; motStatus?: string;
  lineItems?: Array<Record<string, any>>;
}

const undef = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Create or update a job sheet / document, its vehicle link, line items, and recomputed totals. */
export async function saveDocument(input: SaveDocInput) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const docType = input.docType || "JS";

  // 1) upsert vehicle by registration
  let vehicleId: number | null = null;
  let customerId: number | null = null;
  if (input.registration && normReg(input.registration)) {
    const reg = normReg(input.registration);
    const existing = (await db.select().from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1))[0];
    const vf = undef({
      make: input.vehicle?.make, model: input.vehicle?.model, colour: input.vehicle?.colour,
      fuelType: input.vehicle?.fuelType, engineCC: input.vehicle?.engineCC ? Number(input.vehicle.engineCC) || null : input.vehicle?.engineCC,
      engineNo: input.vehicle?.engineNo, engineCode: input.vehicle?.engineCode, vin: input.vehicle?.vin,
      derivative: input.vehicle?.derivative,
      paintCode: input.vehicle?.paintCode, keyCode: input.vehicle?.keyCode, radioCode: input.vehicle?.radioCode,
    });
    if (existing) {
      vehicleId = existing.id; customerId = existing.customerId ?? null;
      if (Object.keys(vf).length) await db.update(vehicles).set(vf).where(eq(vehicles.id, existing.id));
    } else {
      const [{ id }] = await db.insert(vehicles).values({ registration: input.registration.toUpperCase(), ...vf } as any).$returningId();
      vehicleId = id;
    }
  }

  // 1b) create a new customer from entered details when requested
  if (!input.customerId && input.createCustomer && input.customerName) {
    const hadOwner = customerId != null;
    const address = [input.custHouseNo, input.custRoad, input.custLocality, input.custTown, input.custCounty].filter(Boolean).join(", ");
    const [{ id }] = await db.insert(customers).values({
      name: input.customerName,
      email: input.custEmail || null,
      phone: input.custMobile || input.custTelephone || null,
      postcode: input.custPostcode || null,
      address: address || null,
      externalId: `WEB-CUST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    } as any).$returningId();
    customerId = id;
    if (vehicleId && !hadOwner) await db.update(vehicles).set({ customerId: id }).where(eq(vehicles.id, vehicleId)); // only adopt ownerless vehicles
  }

  // 1c) push edited customer details back to the linked customer record
  if (input.updateCustomerRecord && (input.customerId ?? customerId)) {
    const cid = (input.customerId ?? customerId)!;
    const address = [input.custHouseNo, input.custRoad, input.custLocality, input.custTown, input.custCounty].filter(Boolean).join(", ");
    const cu = undef({
      name: input.customerName || undefined,
      email: input.custEmail || undefined,
      phone: (input.custMobile || input.custTelephone) || undefined,
      postcode: input.custPostcode || undefined,
      address: address || undefined,
    });
    if (Object.keys(cu).length) await db.update(customers).set(cu).where(eq(customers.id, cid));
  }

  // 2) recompute totals from line items
  const items = (input.lineItems ?? []).filter((i) => i && (i.description || i.subNet != null));
  const net = (pred: (i: any) => boolean) => items.filter(pred).reduce((a, i) => a + (Number(i.subNet) || 0), 0);
  const tax = (pred: (i: any) => boolean) => items.filter(pred).reduce((a, i) => a + (Number(i.taxAmount) || 0), 0);
  const subPartsNet = net((i) => i.itemType === "Part"), subPartsTax = tax((i) => i.itemType === "Part");
  const subLabourNet = net((i) => i.itemType === "Labour"), subLabourTax = tax((i) => i.itemType === "Labour");
  const totalNet = items.reduce((a, i) => a + (Number(i.subNet) || 0), 0);
  const totalTax = items.reduce((a, i) => a + (Number(i.taxAmount) || 0), 0);
  const totalGross = +(totalNet + totalTax).toFixed(2);

  // 3) document fields
  const docFields: any = undef({
    docType, vehicleId, customerId: input.customerId ?? customerId, registration: input.registration ? input.registration.toUpperCase() : undefined,
    customerName: input.customerName || [input.custTitle, input.custForename, input.custSurname].filter(Boolean).join(" ") || undefined,
    custTitle: input.custTitle, custForename: input.custForename, custSurname: input.custSurname,
    company: input.company, accountNumber: input.accountNumber,
    custHouseNo: input.custHouseNo, custRoad: input.custRoad, custLocality: input.custLocality,
    custTown: input.custTown, custCounty: input.custCounty, custPostcode: input.custPostcode,
    custTelephone: input.custTelephone, custMobile: input.custMobile, custEmail: input.custEmail,
    mileage: input.mileage, dateCreated: input.dateCreated ? new Date(input.dateCreated) : undefined,
    dateIssued: input.dateIssued ? new Date(input.dateIssued) : undefined,
    docStatus: input.docStatus, orderRef: input.orderRef, department: input.department, terms: input.terms,
    description: input.description, staffSalesPerson: input.staffSalesPerson, staffTechnician: input.staffTechnician,
    staffRoadTester: input.staffRoadTester, staffMotTester: input.staffMotTester, motClass: input.motClass, motStatus: input.motStatus,
    totalNet: String(totalNet.toFixed(2)), totalTax: String(totalTax.toFixed(2)), totalGross: String(totalGross.toFixed(2)),
    subPartsNet: String(subPartsNet.toFixed(2)), subPartsTax: String(subPartsTax.toFixed(2)),
    subLabourNet: String(subLabourNet.toFixed(2)), subLabourTax: String(subLabourTax.toFixed(2)),
  });

  let docId = input.id;
  if (docId) {
    await db.update(serviceHistory).set(docFields).where(eq(serviceHistory.id, docId));
  } else {
    const docNo = await getNextDocNo(docType);
    const externalId = `WEB-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id }] = await db.insert(serviceHistory).values({ ...docFields, docNo, externalId, balance: String(totalGross.toFixed(2)) }).$returningId();
    docId = id;
  }

  // 4) replace line items
  await db.delete(serviceLineItems).where(eq(serviceLineItems.documentId, docId!));
  if (items.length) {
    await db.insert(serviceLineItems).values(items.map((i, idx) => ({
      documentId: docId!, externalId: `WEB-LI-${docId}-${idx}-${Date.now()}`,
      itemType: i.itemType || "Part", description: i.description ?? null, partNumber: i.partNumber ?? null,
      nominalCode: i.nominalCode ?? null,
      quantity: i.quantity != null ? String(i.quantity) : null, unitPrice: i.unitPrice != null ? String(i.unitPrice) : null,
      subNet: i.subNet != null ? String(i.subNet) : null, taxAmount: i.taxAmount != null ? String(i.taxAmount) : null,
      vatRate: i.vatRate != null ? String(i.vatRate) : null,
    })) as any);
  }
  return { id: docId };
}

/** Convert a document to another type (Estimate↔Job Sheet↔Invoice…), copying all data into a new document. */
export async function convertDocument(id: number, toType: string) {
  const detail = await getDocumentDetail(id);
  if (!detail?.doc) throw new Error("Document not found");
  const { doc, vehicle, lineItems } = detail as any;
  return saveDocument({
    docType: toType,
    registration: vehicle?.registration || doc.registration,
    customerId: doc.customerId ?? undefined,
    vehicle: vehicle ? {
      make: vehicle.make, model: vehicle.model, colour: vehicle.colour, fuelType: vehicle.fuelType,
      engineCC: vehicle.engineCC, engineNo: vehicle.engineNo, engineCode: vehicle.engineCode, vin: vehicle.vin,
      derivative: vehicle.derivative, paintCode: vehicle.paintCode, keyCode: vehicle.keyCode, radioCode: vehicle.radioCode,
    } : undefined,
    customerName: doc.customerName, company: doc.company, accountNumber: doc.accountNumber,
    custHouseNo: doc.custHouseNo, custRoad: doc.custRoad, custLocality: doc.custLocality, custTown: doc.custTown,
    custCounty: doc.custCounty, custPostcode: doc.custPostcode, custTelephone: doc.custTelephone,
    custMobile: doc.custMobile, custEmail: doc.custEmail,
    mileage: doc.mileage, description: doc.description, orderRef: doc.orderRef, department: doc.department, terms: doc.terms,
    staffSalesPerson: doc.staffSalesPerson, staffTechnician: doc.staffTechnician, staffRoadTester: doc.staffRoadTester,
    staffMotTester: doc.staffMotTester, motClass: doc.motClass, motStatus: doc.motStatus, docStatus: "New",
    lineItems: (lineItems || []).map((li: any) => ({
      itemType: li.itemType, description: li.description, partNumber: li.partNumber, nominalCode: li.nominalCode,
      quantity: li.quantity, unitPrice: li.unitPrice, vatRate: li.vatRate, subNet: li.subNet, taxAmount: li.taxAmount,
    })),
  });
}

// ---------------------------------------------------------------------------
// Payments / receipts + Issue invoice
// ---------------------------------------------------------------------------

export async function getDocumentPayments(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments).where(eq(payments.documentId, documentId)).orderBy(desc(payments.paymentDate));
}

/** Recompute totalReceipts / balance / paid status on a document from its payments. */
async function recomputeDocBalance(documentId: number) {
  const db = await getDb();
  if (!db) return { receipts: 0, balance: 0 };
  const doc = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, documentId)).limit(1))[0];
  if (!doc) return { receipts: 0, balance: 0 };
  const r = await db.select({ sum: sql<number>`COALESCE(SUM(${payments.amount}),0)` }).from(payments).where(eq(payments.documentId, documentId));
  const receipts = Number(r[0]?.sum) || 0;
  const gross = Number(doc.totalGross) || 0;
  // a main insurance invoice has its excess paid on the separate XS invoice, so deduct it here
  const excess = doc.docType === "XS" ? 0 : (Number(doc.excessGross) || 0);
  const balance = +(gross - excess - receipts).toFixed(2);
  const methods = await db.selectDistinct({ m: payments.method }).from(payments).where(eq(payments.documentId, documentId));
  const set: any = {
    totalReceipts: String(receipts.toFixed(2)), balance: String(balance.toFixed(2)),
    paymentMethods: methods.map((x: any) => x.m).filter(Boolean).join(", ") || null,
  };
  // mark fully-paid issued invoices as Paid
  if (doc.dateIssued && balance <= 0 && receipts > 0) { set.docStatus = "Paid"; set.datePaid = new Date(); }
  await db.update(serviceHistory).set(set).where(eq(serviceHistory.id, documentId));
  return { receipts, balance };
}

export async function addPayment(input: { documentId: number; customerId?: number | null; method: string; amount: number; note?: string; paymentDate?: any }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(payments).values({
    documentId: input.documentId,
    customerId: input.customerId ?? null,
    method: input.method || "Cash",
    amount: String(Number(input.amount).toFixed(2)),
    paymentDate: input.paymentDate ? new Date(input.paymentDate) : new Date(),
    note: input.note ?? null,
  } as InsertPayment);
  return recomputeDocBalance(input.documentId);
}

export async function deletePayment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const row = (await db.select().from(payments).where(eq(payments.id, id)).limit(1))[0];
  await db.delete(payments).where(eq(payments.id, id));
  if (row) await recomputeDocBalance(row.documentId);
  return { ok: true };
}

/** Mark a document as issued (locks it in, stamps dateIssued + status, recomputes balance). */
export async function issueDocument(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const doc = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, documentId)).limit(1))[0];
  if (!doc) throw new Error("Document not found");
  const set: any = {};
  if (!doc.dateIssued) set.dateIssued = new Date();
  const { balance, receipts } = await recomputeDocBalance(documentId);
  set.docStatus = balance <= 0 && (receipts > 0 || Number(doc.totalGross) === 0) ? "Paid" : "Issued";
  await db.update(serviceHistory).set(set).where(eq(serviceHistory.id, documentId));
  return { id: documentId, status: set.docStatus };
}

// ---------------------------------------------------------------------------
// Policy-excess insurance split
// ---------------------------------------------------------------------------

/**
 * From a main (insurance) invoice, raise a related Policy Excess Invoice (docType XS)
 * billed to the customer for their excess, and deduct that excess from the main invoice
 * (which the insurer pays). Returns the new excess invoice id.
 */
export async function createExcessInvoice(input: { mainDocId: number; excessNet: number; discount?: number; vatRegistered?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const main = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, input.mainDocId)).limit(1))[0];
  if (!main) throw new Error("Main invoice not found");

  const discount = Math.max(0, Number(input.discount) || 0);
  const net = +(Math.max(0, Number(input.excessNet) || 0) - discount).toFixed(2);
  const vatRate = input.vatRegistered ? 20 : 0;
  const tax = +(net * vatRate / 100).toFixed(2);
  const gross = +(net + tax).toFixed(2);

  // 1) create the excess invoice (XS) for the customer
  const docNo = await getNextDocNo("XS");
  const externalId = `WEB-XS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const xsFields: any = undef({
    docType: "XS", docNo, externalId,
    customerId: main.customerId, vehicleId: main.vehicleId, registration: main.registration,
    customerName: main.customerName, custTitle: main.custTitle, custForename: main.custForename, custSurname: main.custSurname,
    custEmail: main.custEmail, company: main.company, accountNumber: main.accountNumber,
    custHouseNo: main.custHouseNo, custRoad: main.custRoad, custLocality: main.custLocality,
    custTown: main.custTown, custCounty: main.custCounty, custPostcode: main.custPostcode,
    custTelephone: main.custTelephone, custMobile: main.custMobile,
    mileage: main.mileage, dateCreated: new Date(), docStatus: "New",
    relatedDocId: main.id, relatedDocNo: main.docNo,
    excessDiscount: String(discount.toFixed(2)), custVatRegistered: input.vatRegistered ? 1 : 0,
    excessNet: String(net.toFixed(2)), excessTax: String(tax.toFixed(2)), excessGross: String(gross.toFixed(2)),
    totalNet: String(net.toFixed(2)), totalTax: String(tax.toFixed(2)), totalGross: String(gross.toFixed(2)),
    balance: String(gross.toFixed(2)), description: `Policy excess re. Invoice ${main.docNo}`,
  });
  const [{ id: xsId }] = await db.insert(serviceHistory).values(xsFields).$returningId();
  await db.insert(serviceLineItems).values({
    documentId: xsId, externalId: `WEB-LI-XS-${xsId}-${Date.now()}`,
    itemType: "Excess", description: `Insurance policy excess (re. Invoice ${main.docNo})`,
    quantity: "1", unitPrice: String(net.toFixed(2)), subNet: String(net.toFixed(2)),
    taxAmount: String(tax.toFixed(2)), vatRate: String(vatRate.toFixed(2)),
  } as any);

  // 2) record the excess on the main invoice and deduct it (insurer pays the reduced amount)
  await db.update(serviceHistory).set({
    relatedDocId: xsId, relatedDocNo: docNo,
    excessNet: String(net.toFixed(2)), excessTax: String(tax.toFixed(2)), excessGross: String(gross.toFixed(2)),
  }).where(eq(serviceHistory.id, main.id));
  await recomputeDocBalance(main.id);

  return { id: xsId, docNo };
}

/** Recompute an existing XS excess invoice's figures (and its main invoice's excess) after editing. */
export async function updateExcessInvoice(input: { docId: number; excessNet: number; discount?: number; vatRegistered?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const xs = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, input.docId)).limit(1))[0];
  if (!xs) throw new Error("Excess invoice not found");
  const discount = Math.max(0, Number(input.discount) || 0);
  const net = +(Math.max(0, Number(input.excessNet) || 0) - discount).toFixed(2);
  const vatRate = input.vatRegistered ? 20 : 0;
  const tax = +(net * vatRate / 100).toFixed(2);
  const gross = +(net + tax).toFixed(2);

  await db.update(serviceHistory).set({
    excessDiscount: String(discount.toFixed(2)), custVatRegistered: input.vatRegistered ? 1 : 0,
    excessNet: String(net.toFixed(2)), excessTax: String(tax.toFixed(2)), excessGross: String(gross.toFixed(2)),
    totalNet: String(net.toFixed(2)), totalTax: String(tax.toFixed(2)), totalGross: String(gross.toFixed(2)),
    balance: String(gross.toFixed(2)),
  }).where(eq(serviceHistory.id, input.docId));

  // refresh the single excess line item
  await db.delete(serviceLineItems).where(eq(serviceLineItems.documentId, input.docId));
  await db.insert(serviceLineItems).values({
    documentId: input.docId, externalId: `WEB-LI-XS-${input.docId}-${Date.now()}`,
    itemType: "Excess", description: `Insurance policy excess${xs.relatedDocNo ? ` (re. Invoice ${xs.relatedDocNo})` : ""}`,
    quantity: "1", unitPrice: String(net.toFixed(2)), subNet: String(net.toFixed(2)),
    taxAmount: String(tax.toFixed(2)), vatRate: String(vatRate.toFixed(2)),
  } as any);

  // mirror the excess onto the main insurance invoice
  if (xs.relatedDocId) {
    await db.update(serviceHistory).set({
      excessNet: String(net.toFixed(2)), excessTax: String(tax.toFixed(2)), excessGross: String(gross.toFixed(2)),
    }).where(eq(serviceHistory.id, xs.relatedDocId));
    await recomputeDocBalance(xs.relatedDocId);
  }
  return { id: input.docId };
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

export async function updateServiceDocument(id: number, doc: any, items: any[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { nanoid } = await import("nanoid");

  return await db.transaction(async (tx) => {
    // Update document header
    await tx.update(serviceHistory).set(doc).where(eq(serviceHistory.id, id));

    // Delete existing line items and re-insert (simpler than syncing)
    await tx.delete(serviceLineItems).where(eq(serviceLineItems.documentId, id));

    if (items.length > 0) {
      const itemsToInsert = items.map(item => ({
        ...item,
        documentId: id,
        externalId: item.externalId || `ITEM-${nanoid()}`,
      }));
      await tx.insert(serviceLineItems).values(itemsToInsert);
    }

    return { id };
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

  const {
    generateInvoicePDF,
    generateEstimatePDF,
    generateJobSheetPDF,
  } = await import("./pdf-templates");

  // Build shared data
  const company = {
    name: 'ELI MOTORS LIMITED',
    address_line1: '49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP',
    phone: '020 8203 6449, Sales 07950 250970',
    website: 'www.elimotors.co.uk',
    vat: '330 9339 65',
  };

  const customerData = {
    name: customer?.name || 'Unknown Client',
    address_lines: (customer?.address || '').split(',').map((s: string) => s.trim()),
    mobile: customer?.phone || '',
  };

  const vehicleData = {
    reg: vehicle?.registration || '',
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    chassis: vehicle?.vin || '',
    mileage: (doc.mileage || 0).toString(),
    engine_no: vehicle?.engineNo || '',
    engine_code: vehicle?.engineCode || '',
    engine_cc: vehicle?.engineCC || 0,
    date_reg: vehicle?.dateOfRegistration
      ? new Date(vehicle.dateOfRegistration).toLocaleDateString('en-GB')
      : '',
    colour: vehicle?.colour || '',
  };

  const labour = items.filter(i => i.itemType === 'Labour').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    unit: Number(i.unitPrice),
    d: '',
    subtotal: Number(i.subNet),
  }));

  const parts = items.filter(i => i.itemType === 'Part').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    unit: Number(i.unitPrice),
    d: '',
    subtotal: Number(i.subNet),
  }));

  const motItems = items.filter(i => i.itemType === 'MOT').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    status: '',
  }));

  // "Extras" categories (entered as single amounts on the job sheet)
  const sumNet = (t: string) => items.filter(i => i.itemType === t).reduce((a, i) => a + (Number(i.subNet) || 0), 0);
  const sundries = sumNet('Sundries'), lubricants = sumNet('Lubricant'), paint = sumNet('Paint'), motNet = sumNet('MOT');
  const isInvoice = doc.docType === 'SI' || doc.docType === 'XS';
  const excess = doc.docType === 'XS' ? 0 : (Number(doc.excessGross) || 0); // deducted from a main insurance invoice
  const receipts = Number(doc.totalReceipts) || 0;
  const totalGross = Number(doc.totalGross) || 0;

  const totals = {
    labour: labour.reduce((acc, i) => acc + i.subtotal, 0),
    parts: parts.reduce((acc, i) => acc + i.subtotal, 0),
    sundries, lubricants, paint,
    subtotal: +((Number(doc.totalNet) || 0) - motNet).toFixed(2), // SubTotal excludes the MOT fee (shown separately, 0% VAT)
    vat_rate: 20,
    vat: Number(doc.totalTax) || 0,
    mot: motNet > 0 ? motNet : null,
    total: totalGross,
    excess: excess > 0 ? excess : null,
    receipts: (isInvoice || receipts > 0) ? receipts : null,
    balance: isInvoice ? +(totalGross - excess - receipts).toFixed(2) : totalGross,
  };

  // Split description into title + work items
  const descLines = (doc.description || '').split('\n').filter((l: string) => l.trim());
  const work_title = descLines.length > 0 ? descLines[0] : '';
  const work_items = descLines.length > 1 ? descLines.slice(1) : [];

  const dateStr = doc.dateCreated
    ? new Date(doc.dateCreated).toLocaleDateString('en-GB')
    : '';

  console.log(`[PDF] Generating ${doc.docType} PDF for ${doc.docNo}`);

  // Dispatch to correct template
  if (doc.docType === 'ES') {
    return generateEstimatePDF({
      company, customer: customerData, vehicle: vehicleData,
      estimate: {
        number: doc.docNo,
        date: dateStr,
        account_no: '',
        order_ref: '',
        valid_to: '',
      },
      work_title, work_items,
      labour, parts, totals,
    });
  }

  if (doc.docType === 'JS') {
    const work_description = (doc.description || '').split('\n');

    let oil_specs: any[] = [];
    try {
      const techData = vehicle?.comprehensiveTechnicalData
        ? (typeof vehicle.comprehensiveTechnicalData === 'string'
          ? JSON.parse(vehicle.comprehensiveTechnicalData)
          : vehicle.comprehensiveTechnicalData)
        : null;
      if (techData?.oil_specs) oil_specs = techData.oil_specs;
    } catch { /* ignore */ }

    return generateJobSheetPDF({
      customer: customerData, vehicle: vehicleData,
      doc: {
        reference: doc.docNo,
        account_no: '',
        order_ref: '',
        receive_date: dateStr,
        due_date: dateStr,
        status: '~',
        technician: '',
      },
      work_description,
      oil_specs,
      labour_rows: 5,
      parts_rows: 5,
    });
  }

  // Default: Invoice (SI or any other type)
  return generateInvoicePDF({
    company, customer: customerData, vehicle: vehicleData,
    invoice: {
      number: doc.docNo,
      invoice_date: dateStr,
      account_no: '',
      order_ref: '',
      date_of_work: dateStr,
      payment_date: '',
      payment_method: '',
    },
    work_title, work_items,
    mot: motItems.length > 0 ? motItems : undefined,
    labour, parts, totals,
  });
}

/**
 * Generate a Vehicle Service History PDF for all documents associated with a vehicle.
 */
export async function getServiceHistoryPDF(vehicleId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { generateServiceHistoryPDF } = await import("./pdf-templates");

  const vehicle = await db.select().from(vehicles)
    .where(eq(vehicles.id, vehicleId)).limit(1).then(r => r[0]);
  if (!vehicle) throw new Error("Vehicle not found");

  const docs = await db.select().from(serviceHistory)
    .where(eq(serviceHistory.vehicleId, vehicleId))
    .orderBy(desc(serviceHistory.dateCreated));

  let cumulative = 0;
  const entries = docs.map(d => {
    const total = Number(d.totalGross) || 0;
    cumulative += total;
    const dateObj = d.dateCreated ? new Date(d.dateCreated) : new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const dateStr = `${String(dateObj.getDate()).padStart(2, '0')} ${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    const mileage = d.mileage ? `${Number(d.mileage).toLocaleString()} MI` : null;

    return {
      date: dateStr,
      invoice_number: `#${d.docNo}`,
      mileage,
      total: `£${total.toFixed(2)}`,
      description: d.description || '',
    };
  });

  return generateServiceHistoryPDF({
    company_name: 'ELI MOTORS LIMITED',
    address: '49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP',
    phone: '020 8203 6449, Sales 07950 250970',
    website: 'www.elimotors.co.uk',
    vehicle_reg: vehicle.registration || '',
    vehicle_make: vehicle.make || '',
    vehicle_model: vehicle.model || '',
    entries,
    total_records: entries.length,
    cumulative_spend: `£${cumulative.toFixed(2)}`,
  });
}

export async function deleteServiceDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.transaction(async (tx) => {
    // Delete line items first due to relationship
    await tx.delete(serviceLineItems).where(eq(serviceLineItems.documentId, id));
    // Delete the document header
    await tx.delete(serviceHistory).where(eq(serviceHistory.id, id));
    return { success: true };
  });
}

export async function getAppSetting(keyName: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(appSettings).where(eq(appSettings.keyName, keyName)).limit(1);
  return result[0]?.value || null;
}

export async function saveAppSetting(keyName: string, value: any) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(appSettings).where(eq(appSettings.keyName, keyName)).limit(1);
  if (existing.length > 0) {
    await db.update(appSettings).set({ value }).where(eq(appSettings.keyName, keyName));
  } else {
    await db.insert(appSettings).values({ keyName, value });
  }
}

