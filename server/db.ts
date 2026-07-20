import { eq, or, inArray, and, sql, desc, asc, isNotNull, isNull, ilike, gte, lte, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import os from "os";
import fs from "fs";
import path from "path";
import {
  users, customers, vehicles, reminders, reminderLogs,
  customerMessages, serviceHistory, serviceLineItems, appointments, appSettings, autodataRequests,
  descriptionPresets, customerLogs, payments, addressLookups, salesStock, ga4NumberPool, partsPriceList,
  InsertUser, InsertReminder, InsertCustomer, InsertReminderLog, InsertCustomerLog, InsertPayment
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export async function getDb() {
  // Prefer the Neon (London) URL when present; falls back to DATABASE_URL post-cutover.
  const url = ENV.databaseUrlNeon || ENV.databaseUrl;
  if (!_db && url) {
    try {
      _pool = new Pool({
        connectionString: url,
        // Neon's pooler endpoint handles connection multiplexing; keep a small per-instance pool.
        max: 5,
        ssl: { rejectUnauthorized: true },
      });
      _db = drizzle(_pool);
    } catch (error: any) {
      const maskedUrl = url ? url.substring(0, 18) + "..." + url.substring(url.length - 10) : "NOT SET";
      console.error(`[Database] Failed to connect to ${maskedUrl}:`, error.message);
      _db = null;
    }
  } else if (!_db && !url) {
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

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
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
  const [row] = await db.insert(reminders).values(data).returning({ id: reminders.id });
  return { insertId: row.id };
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

  const [row] = await db.insert(reminderLogs).values(sanitizedData).returning({ id: reminderLogs.id });
  return { insertId: row.id };
}

export async function getAllReminderLogs() {
  const db = await getDb();
  if (!db) return [];

  const rows: any[] = await db
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
      logCustomerName: reminderLogs.customerName,
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

  // Resolve a display name: linked customer → the name stored on the log → matched by recipient
  // phone. Many older / GA4-scanner logs were written with customerId=null, which showed as
  // "Unknown" even though the customer exists and is reachable on that number.
  const norm = (p: any) => { let s = String(p || "").replace(/^whatsapp:/i, "").replace(/[\s\-()]/g, ""); if (s.startsWith("0")) s = "+44" + s.slice(1); if (s.startsWith("44")) s = "+" + s; return s; };
  const needByPhone = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    r.customerName = r.customerName || r.logCustomerName || null;
    if ((!r.customerName || !r.customerId) && r.recipient) {
      const k = norm(r.recipient);
      if (k.length >= 8) { if (!needByPhone.has(k)) needByPhone.set(k, []); needByPhone.get(k)!.push(i); }
    }
  }
  if (needByPhone.size) {
    const variants: string[] = [];
    for (const k of needByPhone.keys()) { variants.push(k); if (k.startsWith("+44")) variants.push("0" + k.slice(3)); }
    const matched: any[] = await db.select({ id: customers.id, name: customers.name, phone: customers.phone })
      .from(customers).where(inArray(customers.phone, variants));
    const byPhone = new Map<string, { id: number; name: string }>();
    for (const c of matched) { const k = norm(c.phone); if (k && c.name && !byPhone.has(k)) byPhone.set(k, { id: c.id, name: c.name }); }
    for (const [k, idxs] of needByPhone) {
      const hit = byPhone.get(k);
      if (hit) for (const i of idxs) { rows[i].customerName = rows[i].customerName || hit.name; rows[i].customerId = rows[i].customerId || hit.id; }
    }
  }
  for (const r of rows) delete r.logCustomerName;
  return rows;
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

/** Today's MOT-bay appointments still needing a day-of reminder — contactable, opted-in customer,
 *  not already reminded. `dateStr` = 'YYYY-MM-DD' for the workshop's local day. */
export async function getMotAppointmentsForReminder(dateStr: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: appointments.id,
    registration: appointments.registration,
    startTime: appointments.startTime,
    customerId: appointments.customerId,
    customerName: sql<string>`COALESCE(NULLIF(${customers.name}, ''), ${appointments.registration})`,
    phone: customers.phone,
    optedOut: customers.optedOut,
    make: vehicles.make,
    model: vehicles.model,
    serviceType: appointments.serviceType,
  })
    .from(appointments)
    .leftJoin(customers, eq(appointments.customerId, customers.id))
    .leftJoin(vehicles, eq(appointments.vehicleId, vehicles.id))
    .where(and(
      eq(appointments.bayId, "mot-bay"),
      isNull(appointments.reminderSentAt),
      inArray(appointments.status, ["scheduled", "in_progress"]),
      sql`${appointments.appointmentDate}::date = ${dateStr}::date`,
    ));
}

export async function markAppointmentReminded(id: number, messageSid?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(appointments)
    .set({ reminderSentAt: new Date(), reminderMessageSid: messageSid ?? null, reminderStatus: "sent" })
    .where(eq(appointments.id, id));
}

/** Update a reminder's delivery status (from the Twilio status callback) by its message SID. */
export async function updateAppointmentReminderStatus(messageSid: string, status: string) {
  const db = await getDb();
  if (!db || !messageSid) return;
  await db.update(appointments).set({ reminderStatus: status }).where(eq(appointments.reminderMessageSid, messageSid));
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
  const [result] = await db.insert(customers).values(data).returning({ id: customers.id });
  return result.id;
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

/** The customer's account number (e.g. "TOD001"). It's stored on documents, not the customer
 *  record, so we read it from their most-recent document that has one. */
export async function getCustomerAccountNumber(customerId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const r = await db.select({ acc: serviceHistory.accountNumber })
    .from(serviceHistory)
    .where(and(eq(serviceHistory.customerId, customerId), isNotNull(serviceHistory.accountNumber), ne(serviceHistory.accountNumber, "")))
    .orderBy(desc(serviceHistory.dateCreated))
    .limit(1);
  return r[0]?.acc ?? null;
}

export async function createVehicle(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(vehicles).values(data).returning({ id: vehicles.id });
  return { insertId: row.id };
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

/** All vehicle ids that represent the SAME physical car as `vehicleId` — the same plate can
 * end up as two `vehicles` rows split by registration spacing/case (e.g. "PE59OFH" vs
 * "PE59 OFH" — see "Reg format split matching"), so a bare vehicleId match on a dependent
 * table silently misses whatever's linked to the "other" row. Falls back to [vehicleId]
 * if the vehicle can't be found or has no registration. */
async function getVehicleIdsForSamePlate(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, vehicleId: number): Promise<number[]> {
  const v = (await db.select({ registration: vehicles.registration }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1))[0];
  const normReg = v?.registration ? v.registration.toUpperCase().replace(/\s+/g, "") : null;
  if (!normReg) return [vehicleId];
  const matches = await db.select({ id: vehicles.id }).from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${normReg}`);
  return matches.map((m) => m.id);
}

export async function getRemindersByVehicleId(vehicleId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminders).where(inArray(reminders.vehicleId, await getVehicleIdsForSamePlate(db, vehicleId)));
}

export async function getVehicleByRegistration(registration: string) {
  const db = await getDb();
  if (!db) return undefined;
  const cleanReg = registration.toUpperCase().replace(/\s/g, "");
  // space-insensitive: GA4 regs are stored with a space, so compare both normalised
  const result = await db.select().from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${cleanReg}`).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function searchVehiclesByRegistration(query: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const normalized = query.replace(/\s/g, "").toUpperCase();
  return db.select()
    .from(vehicles)
    .where(ilike(vehicles.registration, `${normalized}%`))
    .limit(limit);
}

// Vehicle picker for the job sheet: match by reg (partial), make, model or owner name, and return
// the owner so the user can pick the right car. Reg matches are ranked first.
export async function searchVehiclesForJob(query: string, limit = 12) {
  const db = await getDb();
  if (!db) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  // Token-based: split into words; EACH word must match SOME field (words AND-ed together,
  // fields OR-ed within a word). So "dave rich toyota yaris" matches when dave->email,
  // rich->name, toyota->make, yaris->model — even though no single field holds the whole phrase.
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const perToken = tokens.map((tok) => {
    const term = `%${tok}%`;
    const regNorm = tok.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const digits = tok.replace(/\D/g, "");
    const ors = [
      ilike(vehicles.make, term),
      ilike(vehicles.model, term),
      ilike(sql`COALESCE(${vehicles.make}, '') || ' ' || COALESCE(${vehicles.model}, '')`, term),
      ilike(customers.name, term),
      ilike(customers.email, term),
      ilike(customers.postcode, term),
      ilike(customers.address, term),
    ];
    if (regNorm) ors.push(ilike(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '')`, `%${regNorm}%`));
    // phone: strip formatting both sides so "07712 345678" matches "07712345678"
    if (digits.length >= 4) ors.push(ilike(sql`REPLACE(REPLACE(${customers.phone}, ' ', ''), '+', '')`, `%${digits}%`));
    return or(...ors);
  });
  const fullRegNorm = q.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(); // for reg-prefix ranking
  return db.select({
    id: vehicles.id,
    registration: vehicles.registration,
    make: vehicles.make,
    model: vehicles.model,
    customerId: vehicles.customerId,
    ownerName: customers.name,
    ownerPhone: customers.phone,
    ownerEmail: customers.email,
    ownerPostcode: customers.postcode,
  })
    .from(vehicles)
    .leftJoin(customers, eq(vehicles.customerId, customers.id))
    .where(and(...perToken))
    .orderBy(asc(sql`CASE WHEN REPLACE(UPPER(${vehicles.registration}), ' ', '') LIKE ${fullRegNorm + "%"} THEN 0 ELSE 1 END`), vehicles.registration)
    .limit(limit);
}

// Shorthand the workshop types → fuller search terms, so e.g. "OF1" finds oil filters and "5/30"
// finds 5W-30 oil even when the historical description is spelled differently. Extend freely.
const PART_ALIASES: Record<string, string[]> = {
  of: ["oil filter"], of1: ["oil filter"], oilf: ["oil filter"],
  af: ["air filter"], airf: ["air filter"],
  cab: ["cabin filter", "pollen filter"], caf: ["cabin filter"], pollen: ["pollen filter", "cabin filter"],
  ff: ["fuel filter"], fuelf: ["fuel filter"],
  pads: ["brake pads"], fp: ["front pads", "front brake pads"], rp: ["rear pads", "rear brake pads"],
  discs: ["brake discs"], fd: ["front discs", "front brake discs"], rd: ["rear discs", "rear brake discs"],
  plug: ["spark plug"], plugs: ["spark plugs"], wiper: ["wiper blade"], wipers: ["wiper blades"],
  bulb: ["bulb"], bat: ["battery"], batt: ["battery"],
};

/** Suggest parts the workshop has used before (part number + description), matching the typed text
 *  or a known shorthand. Powers the parts autocomplete so typing fills both fields quickly — and,
 *  now, quantity/price too: a maintained partsPriceList entry wins when one matches, otherwise we
 *  fall back to the part's average historical price so picking a suggestion is never a £0 line. */
export async function suggestParts(query: string, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  const qn = (query || "").toLowerCase().trim();
  if (qn.length < 2) return [];
  const terms = new Set<string>([qn]);
  for (const [k, vals] of Object.entries(PART_ALIASES)) if (qn === k || qn.startsWith(k) || k.startsWith(qn)) vals.forEach((v) => terms.add(v));
  const oil = qn.match(/^(\d{1,2})\s*[\/w-]+\s*(\d{2})$/); // "5/30", "5w30", "5-30" → 5W-30 oil
  if (oil) { terms.add(`${oil[1]}w-${oil[2]}`); terms.add(`${oil[1]}w${oil[2]}`); }
  const histConds = Array.from(terms).flatMap((t) => [ilike(serviceLineItems.description, `%${t}%`), ilike(serviceLineItems.partNumber, `%${t}%`)]);
  const priceConds = Array.from(terms).flatMap((t) => [ilike(partsPriceList.description, `%${t}%`), ilike(partsPriceList.partNumber, `%${t}%`)]);

  const [histRows, priceRows] = await Promise.all([
    db.select({
      partNumber: serviceLineItems.partNumber, description: serviceLineItems.description,
      n: sql<number>`COUNT(*)`, avgPrice: sql<number>`AVG(${serviceLineItems.unitPrice})`,
    })
      .from(serviceLineItems)
      .where(and(inArray(serviceLineItems.itemType, ["Part", "Lubricant"]), isNotNull(serviceLineItems.description), ne(serviceLineItems.description, ""), or(...histConds)))
      .groupBy(serviceLineItems.partNumber, serviceLineItems.description)
      .orderBy(desc(sql<number>`COUNT(*)`))
      .limit(limit * 2),
    db.select().from(partsPriceList).where(or(...priceConds)).limit(limit * 2),
  ]);

  const keyOf = (partNumber: string | null | undefined, description: string | null | undefined) =>
    `${(partNumber || "").toLowerCase().trim()}|${(description || "").toLowerCase().trim()}`;
  const priceByKey = new Map(priceRows.map((p) => [keyOf(p.partNumber, p.description), p]));
  const seen = new Set<string>();
  const out: { partNumber: string | null; description: string | null; count: number; unitPrice: number | null; vatRate: number | null; quantity: number | null }[] = [];

  // Historical usage first (ranked by how often it's been picked) — a price-list match, if any, overrides its price.
  for (const r of histRows) {
    const k = keyOf(r.partNumber, r.description);
    if (seen.has(k)) continue;
    seen.add(k);
    const priced = priceByKey.get(k);
    out.push({
      partNumber: r.partNumber, description: r.description, count: Number(r.n),
      unitPrice: priced ? Number(priced.unitPrice) : (r.avgPrice != null ? Math.round(Number(r.avgPrice) * 100) / 100 : null),
      vatRate: priced?.vatRate != null ? Number(priced.vatRate) : null,
      quantity: priced?.quantity != null ? Number(priced.quantity) : null,
    });
  }
  // Then price-list entries with no usage history yet (freshly added parts).
  for (const p of priceRows) {
    const k = keyOf(p.partNumber, p.description);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      partNumber: p.partNumber, description: p.description, count: 0,
      unitPrice: Number(p.unitPrice), vatRate: p.vatRate != null ? Number(p.vatRate) : null, quantity: p.quantity != null ? Number(p.quantity) : null,
    });
  }
  return out.slice(0, limit);
}

/** List the maintained parts price list, optionally filtered by a search term. */
export async function listPartsPriceList(search?: string) {
  const db = await getDb();
  if (!db) return [];
  const s = (search || "").trim();
  const rows = s
    ? await db.select().from(partsPriceList).where(or(ilike(partsPriceList.description, `%${s}%`), ilike(partsPriceList.partNumber, `%${s}%`))).orderBy(asc(partsPriceList.description)).limit(500)
    : await db.select().from(partsPriceList).orderBy(asc(partsPriceList.description)).limit(500);
  return rows;
}

/** Create or (if `id` given) update a parts price list entry. */
export async function upsertPartsPriceListEntry(input: { id?: number; partNumber?: string; description: string; unitPrice: number; vatRate?: number; quantity?: number; nominalCode?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = {
    partNumber: input.partNumber?.trim() || null,
    description: input.description.trim(),
    unitPrice: String(input.unitPrice),
    vatRate: input.vatRate != null ? String(input.vatRate) : "20",
    quantity: input.quantity != null ? String(input.quantity) : null,
    nominalCode: input.nominalCode?.trim() || null,
  };
  if (input.id) {
    const [row] = await db.update(partsPriceList).set(values).where(eq(partsPriceList.id, input.id)).returning();
    return row;
  }
  const [row] = await db.insert(partsPriceList).values(values).returning();
  return row;
}

export async function deletePartsPriceListEntry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(partsPriceList).where(eq(partsPriceList.id, id));
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
  // Fail-safe for duplicate records sharing a phone: if ANY of them is opted out, return that
  // one so the opt-out guard blocks the send. Without this ordering, limit(1) could pick an
  // opted-in duplicate and we'd message someone who sent STOP on their other record.
  const result = await db.select().from(customers).where(or(...conditions)).orderBy(desc(customers.optedOut)).limit(1);
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

// Tidy a raw SWS "full name" into a concise derivative: drop the make prefix and parenthetical
// chassis/body codes, normalise separators. e.g. "AUDI A1 (8X) 1.4 TFSI" → "A1 1.4 TFSI",
// "MERCEDES-BENZ C (W203, S203) 180 Kompressor, -T, -Coupe, LPG" → "C 180 Kompressor T Coupe LPG".
export function tidyDerivative(raw: any, make?: any): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();             // drop (chassis/body codes)
  // drop a leading make token, separator-insensitive so e.g. stored make "MERCEDES" still strips
  // the full name's "MERCEDES-BENZ" cleanly (not leaving "BENZ").
  const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const first = s.split(" ")[0];
  const mkN = norm(String(make ?? ""));
  if (first && mkN && (norm(first) === mkN || mkN.startsWith(norm(first)) || norm(first).startsWith(mkN))) {
    s = s.slice(first.length).trim();
  }
  s = s.replace(/,\s*-?\s*/g, " ").replace(/\s+/g, " ").replace(/^[\s,;-]+|[\s,;-]+$/g, "").trim();
  return s || null;
}

export async function saveTechnicalData(registration: string, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Match space-insensitively: GA4 stores regs WITH a space ("EX64 ARZ") but lookups often pass
  // none ("EX64ARZ"); an exact match here created duplicate vehicles. Update the matched row by id.
  const regNorm = registration.toUpperCase().replace(/\s/g, "");
  const existing = await db.select().from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${regNorm}`).limit(1);

  const make = data?.ukvd?.make || data?.specs?.make || (data?.specs?.fullName ? data?.specs?.fullName.split(' ')[0] : null) || "Unknown";
  const model = data?.ukvd?.model || data?.specs?.model || (data?.specs?.fullName ? data?.specs?.fullName.split(' ').slice(1).join(' ') : null) || "Unknown";
  const fuelType = data?.ukvd?.fuelType || data?.specs?.fuelType || null;
  const colour = data?.ukvd?.colour || data?.specs?.colour || null;
  const engineCC = data?.ukvd?.engineSize || data?.specs?.engineSize || null;
  const vin = data?.ukvd?.vin || data?.specs?.vin || data?.raw?.vinNumber || null;
  const engineCode = data?.specs?.engineCode || data?.raw?.engineCode || null;
  // derivative (variant/trim) — same source the lookup uses; previously omitted here, which left
  // enriched vehicles with swsLastUpdated set but a blank derivative the lookup would never refill.
  const derivative = tidyDerivative(data?.specs?.fullName || data?.specs?.name, make);

  if (existing.length > 0) {
    const v = existing[0];
    await db.update(vehicles)
      .set({
        make: v.make && v.make !== "Unknown" ? v.make : make,
        model: v.model && v.model !== "Unknown" ? v.model : model,
        derivative: v.derivative || derivative,
        fuelType: v.fuelType || fuelType,
        colour: v.colour || colour,
        engineCC: v.engineCC || engineCC,
        vin: v.vin || vin,
        engineCode: v.engineCode || engineCode,
        comprehensiveTechnicalData: data,
        swsLastUpdated: new Date()
      })
      .where(eq(vehicles.id, v.id));
  } else {
    await db.insert(vehicles).values({
      registration,
      make: make,
      model: model,
      derivative: derivative,
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
    .where(inArray(serviceHistory.vehicleId, await getVehicleIdsForSamePlate(db, vehicleId)))
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

  // The same physical car can end up as TWO `vehicles` rows when a document synced in with
  // a differently-spaced registration ("PE59OFH" vs "PE59 OFH") — a strict vehicleId match
  // then silently drops real history onto the "other" row. Also pull in any serviceHistory
  // row whose own registration text normalizes to the same plate, regardless of which
  // vehicleId it happens to be linked to (see "Reg format split matching" — this same
  // DVLA-solid vs GA4-spaced split was already known to affect ~3,743 vehicles).
  const thisVehicle = (await db.select({ registration: vehicles.registration }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1))[0];
  const normReg = thisVehicle?.registration ? thisVehicle.registration.toUpperCase().replace(/\s+/g, "") : null;
  const vehicleMatch = normReg
    ? or(eq(serviceHistory.vehicleId, vehicleId), sql`REPLACE(UPPER(${serviceHistory.registration}), ' ', '') = ${normReg}`)
    : eq(serviceHistory.vehicleId, vehicleId);

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
    accountNumber: serviceHistory.accountNumber,
    // Same gap as globalSearch's documents query: the doc's own denormalized customerName
    // text is blank on plenty of real GA4-synced rows even though customerId correctly
    // links to a customer — fall back to the linked record's name.
    customerName: sql<string>`COALESCE(${serviceHistory.customerName}, MIN(${customers.name}))`,
    paymentMethods: serviceHistory.paymentMethods,
    balance: serviceHistory.balance,
  })
    .from(serviceHistory)
    .leftJoin(serviceLineItems, eq(serviceHistory.id, serviceLineItems.documentId))
    .leftJoin(customers, eq(serviceHistory.customerId, customers.id))
    .where(vehicleMatch)
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
    registration: vehicles.registration,
  })
    .from(serviceHistory)
    .leftJoin(serviceLineItems, eq(serviceHistory.id, serviceLineItems.documentId))
    .leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
    .where(eq(serviceHistory.customerId, customerId))
    .groupBy(serviceHistory.id, vehicles.registration)
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
export async function getDocuments(opts: { search?: string; docType?: string; limit?: number; offset?: number; sortKey?: string; sortDir?: "asc" | "desc"; dateFrom?: string; dateTo?: string }) {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  const conds: any[] = [];
  // Same "effective date" as the Date column/sort: issued date if set, else created date.
  if (opts.dateFrom) conds.push(sql`COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated}) >= ${opts.dateFrom}::date`);
  if (opts.dateTo) conds.push(sql`COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated}) < (${opts.dateTo}::date + interval '1 day')`);
  if (opts.docType && opts.docType !== "all") {
    conds.push(eq(serviceHistory.docType, opts.docType));
    if (opts.docType === "JS") {
      // GA4 never deletes a job sheet once it's converted to an invoice there — it just leaves the
      // old JS record sitting alongside the new SI, and our one-way mirror faithfully copies both.
      // Job sheets already invoiced (tracked via the invoice's origJobSheetNo) are done — keep them
      // out of the working Job Sheets queue so it isn't cluttered with stale, already-closed jobs.
      // Still fully visible under "All" — nothing here is deleted or hidden from the record.
      conds.push(sql`NOT EXISTS (
        SELECT 1 FROM "serviceHistory" si
        WHERE si."docType" = 'SI'
          AND si."origJobSheetNo" = (NULLIF(regexp_replace(${serviceHistory.docNo}, '[^0-9]', '', 'g'), ''))::int
      )`);
      // The web app's own "Convert" button doesn't stamp origJobSheetNo (only the GA4 sync does),
      // so a GA4-mirrored job sheet converted to an invoice IN the app also leaked through above.
      // convertDocument() copies the description verbatim onto the new invoice, so a substantial
      // (≥15 char, to skip generic "MOT"-style text) exact description match on the same vehicle,
      // where the invoice was created on/after the job sheet, is a reliable fingerprint for that.
      conds.push(sql`NOT EXISTS (
        SELECT 1 FROM "serviceHistory" si
        WHERE si."docType" = 'SI'
          AND si."vehicleId" = ${serviceHistory.vehicleId}
          AND si."dateCreated" >= ${serviceHistory.dateCreated}
          AND si.description = ${serviceHistory.description}
          AND length(${serviceHistory.description}) >= 15
      )`);
    }
  }
  if (opts.search && opts.search.trim()) {
    const s = `%${opts.search.trim()}%`;
    // ga4Number is what's actually printed/emailed on an issued invoice — search must match it
    // too, or looking up the number a customer was given finds nothing (or the wrong doc).
    conds.push(or(ilike(serviceHistory.docNo, s), ilike(serviceHistory.ga4Number, s), ilike(serviceHistory.registration, s), ilike(customers.name, s), ilike(vehicles.make, s), ilike(vehicles.model, s)));
  }
  const where = conds.length ? and(...conds) : undefined;
  // Best available customer name: the linked customer record, else the name stored ON the doc
  // (typed walk-ins have no customerId link but do have a denormalised name) — so the list never
  // shows "—" for a job that clearly has a customer.
  // Prefer the DOCUMENT's own customer snapshot (what was actually invoiced) over the linked
  // customer record — the link can be wrong when two customers share a phone (duplicate-phone
  // hazard), which showed e.g. "Mrs Paris" on Ruth Ehreich's invoice. Falls back to the link.
  const custNameExpr = sql<string>`COALESCE(NULLIF(${serviceHistory.customerName}, ''), NULLIF(TRIM(CONCAT_WS(' ', ${serviceHistory.custTitle}, ${serviceHistory.custForename}, ${serviceHistory.custSurname})), ''), NULLIF(${customers.name}, ''))`;
  // sortable columns (numeric casts so doc numbers/money sort by value, not as text)
  const SORT: Record<string, any> = {
    docNo: sql`(NULLIF(regexp_replace(${serviceHistory.docNo}, '[^0-9]', '', 'g'), ''))::bigint`,
    type: serviceHistory.docType,
    date: sql`COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated})`, // expression-indexed below

    customer: custNameExpr,
    registration: serviceHistory.registration,
    vehicle: sql`CONCAT_WS(' ', ${vehicles.make}, ${vehicles.model})`,
    total: sql`CAST(${serviceHistory.totalGross} AS DECIMAL(12,2))`,
    balance: sql`CAST(${serviceHistory.balance} AS DECIMAL(12,2))`,
    status: serviceHistory.docStatus,
  };
  const sortCol = SORT[opts.sortKey ?? "date"] ?? SORT.date;
  // NULLS LAST: undated / dateless docs (e.g. GA4 estimates synced without a date) must sink to
  // the bottom, not pin to the top. Postgres DESC defaults to NULLS FIRST, which floated docs
  // with both dateIssued and dateCreated empty (e.g. estimates 5318/5334) above every real job.
  const orderBy = sql`${sortCol} ${opts.sortDir === "asc" ? sql`ASC` : sql`DESC`} NULLS LAST`;
  return db.select({
    id: serviceHistory.id,
    docType: serviceHistory.docType,
    docNo: serviceHistory.docNo,
    ga4Number: serviceHistory.ga4Number,
    dateIssued: serviceHistory.dateIssued,
    dateCreated: serviceHistory.dateCreated,
    createdAt: serviceHistory.createdAt, // DB row timestamp — fallback when dateCreated is unset
    registration: serviceHistory.registration,
    totalGross: serviceHistory.totalGross,
    balance: serviceHistory.balance,
    docStatus: serviceHistory.docStatus,
    customerId: serviceHistory.customerId,
    customerName: custNameExpr,
    phone: sql<string>`COALESCE(NULLIF(${serviceHistory.custMobile},''), NULLIF(${serviceHistory.custTelephone},''), ${customers.phone})`,
    vehicleId: serviceHistory.vehicleId,
    make: vehicles.make,
    model: vehicles.model,
    description: serviceHistory.description, // job-sheet work notes → at-a-glance summary/badges
  })
    .from(serviceHistory)
    .leftJoin(customers, eq(serviceHistory.customerId, customers.id))
    .leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
    .where(where as any)
    .orderBy(orderBy)
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

// --- Business reports ---------------------------------------------------------
// Sum a money column stored as text, robustly: strip anything that isn't a digit/dot/minus, treat
// blanks as 0, then SUM. (GA4-imported totals are text.)
const _moneySum = (c: any) => sql<string>`COALESCE(SUM(COALESCE(NULLIF(regexp_replace(${c}::text, '[^0-9.\-]', '', 'g'), '')::numeric, 0)), 0)`;

/** Sales summary for a date range: per document-type totals (count/net/VAT/gross) + a parts /
 *  labour / MOT split, filtered by issue or created date and optionally department. */
export async function getSalesSummary(opts: { from: string; to: string; basedOn?: "issue" | "created"; department?: string }) {
  const db = await getDb();
  const empty = { rows: [] as any[], departments: [] as string[] };
  if (!db) return empty;
  const dateCol = opts.basedOn === "created" ? serviceHistory.dateCreated : serviceHistory.dateIssued;
  const from = new Date(opts.from + "T00:00:00");
  const to = new Date(opts.to + "T23:59:59.999");
  const conds: any[] = [gte(dateCol, from), lte(dateCol, to)];
  if (opts.department) conds.push(eq(serviceHistory.department, opts.department));

  const rows = await db.select({
    docType: serviceHistory.docType,
    count: sql<number>`COUNT(*)`,
    net: _moneySum(serviceHistory.totalNet),
    tax: _moneySum(serviceHistory.totalTax),
    gross: _moneySum(serviceHistory.totalGross),
    partsNet: _moneySum(serviceHistory.subPartsNet),
    labourNet: _moneySum(serviceHistory.subLabourNet),
    motNet: _moneySum(serviceHistory.subMotNet),
  })
    .from(serviceHistory)
    .where(and(...conds))
    .groupBy(serviceHistory.docType);

  // distinct departments for the filter dropdown
  const deptRows = await db.selectDistinct({ d: serviceHistory.department }).from(serviceHistory)
    .where(sql`COALESCE(${serviceHistory.department}, '') <> ''`).orderBy(serviceHistory.department);

  return {
    rows: rows.map((r) => ({
      docType: r.docType,
      count: Number(r.count),
      net: Number(r.net), tax: Number(r.tax), gross: Number(r.gross),
      partsNet: Number(r.partsNet), labourNet: Number(r.labourNet), motNet: Number(r.motNet),
    })),
    departments: deptRows.map((d) => d.d!).filter(Boolean),
  };
}

/** GA4 "Sales Issued ... grouped by Month": every invoice/credit note issued in the range, in
 *  date order, with the per-doc net/VAT/gross (grouping, running totals & sub-totals done client-side). */
export async function getSalesListing(opts: { from: string; to: string; basedOn?: "issue" | "created"; department?: string }) {
  const db = await getDb();
  if (!db) return { rows: [] as any[] };
  const dateCol = opts.basedOn === "created" ? serviceHistory.dateCreated : serviceHistory.dateIssued;
  const from = new Date(opts.from + "T00:00:00");
  const to = new Date(opts.to + "T23:59:59.999");
  // Prefer the DOCUMENT's own customer snapshot (what was actually invoiced) over the linked
  // customer record — the link can be wrong when two customers share a phone (duplicate-phone
  // hazard), which showed e.g. "Mrs Paris" on Ruth Ehreich's invoice. Falls back to the link.
  const custNameExpr = sql<string>`COALESCE(NULLIF(${serviceHistory.customerName}, ''), NULLIF(TRIM(CONCAT_WS(' ', ${serviceHistory.custTitle}, ${serviceHistory.custForename}, ${serviceHistory.custSurname})), ''), NULLIF(${customers.name}, ''))`;
  // GA4's "Sales Issued" report counts invoices (SI), excess/counter-sales (XS) and credit notes (CR).
  const conds: any[] = [gte(dateCol, from), lte(dateCol, to), inArray(serviceHistory.docType, ["SI", "XS", "CR"])];
  if (opts.department) conds.push(eq(serviceHistory.department, opts.department));
  const rows = await db.select({
    date: dateCol,
    docType: serviceHistory.docType,
    docNo: serviceHistory.docNo,
    accountNumber: serviceHistory.accountNumber,
    customerName: custNameExpr,
    balance: serviceHistory.balance,
    net: serviceHistory.totalNet,
    tax: serviceHistory.totalTax,
    gross: serviceHistory.totalGross,
    receipts: serviceHistory.totalReceipts,
  })
    .from(serviceHistory)
    .leftJoin(customers, eq(serviceHistory.customerId, customers.id))
    .where(and(...conds))
    .orderBy(asc(dateCol), asc(serviceHistory.docNo));
  const num = (x: any) => Number(x) || 0;
  return {
    rows: rows.map((r) => {
      const bal = num(r.balance), rec = num(r.receipts);
      const sign = r.docType === "CR" ? -1 : 1;
      return {
        date: r.date, docType: r.docType, docNo: r.docNo,
        accountNumber: r.accountNumber || "", customerName: r.customerName || "",
        payMethod: bal > 0.005 && rec > 0.005 ? "Partial" : "",
        balance: num(r.balance), net: sign * num(r.net), tax: sign * num(r.tax), gross: sign * num(r.gross),
      };
    }),
  };
}

export type ReportColumn = { key: string; label: string; align?: "right"; kind?: "money" | "int" | "text" };
export type ReportResult = { title: string; subtitle?: string; columns: ReportColumn[]; rows: any[]; totals?: any; note?: string };

const _numExpr = (c: any) => sql`COALESCE(NULLIF(regexp_replace(${c}::text, '[^0-9.\-]', '', 'g'), '')::numeric, 0)`;

/** Run a named business report over a date range — returns a normalised {columns, rows, totals}
 *  so the launcher can render any report the same way. */
export async function runReport(opts: { reportId: string; from: string; to: string; basedOn?: "issue" | "created"; department?: string }): Promise<ReportResult> {
  const db = await getDb();
  if (!db) return { title: "Unavailable", columns: [], rows: [] };
  const dateCol = opts.basedOn === "created" ? serviceHistory.dateCreated : serviceHistory.dateIssued;
  const from = new Date(opts.from + "T00:00:00");
  const to = new Date(opts.to + "T23:59:59.999");
  const inRange = and(gte(dateCol, from), lte(dateCol, to), ...(opts.department ? [eq(serviceHistory.department, opts.department)] : []));
  const DOC_LABEL: Record<string, string> = { SI: "Invoices", ES: "Estimates", JS: "Job Sheets", CR: "Credit Notes", XS: "Excess", PA: "Purchases", VS: "Vehicle Sales", VP: "Vehicle Purchases" };

  switch (opts.reportId) {
    case "sales-summary": {
      const s = await getSalesSummary(opts);
      const REV = new Set(["SI", "XS"]); const NEG = new Set(["CR"]);
      let net = 0, tax = 0, gross = 0, count = 0;
      for (const r of s.rows) { const sign = NEG.has(r.docType!) ? -1 : 1; if (REV.has(r.docType!) || NEG.has(r.docType!)) { net += sign * r.net; tax += sign * r.tax; gross += sign * r.gross; count += r.count; } }
      return {
        title: "Sales — Summary",
        columns: [{ key: "type", label: "Type" }, { key: "count", label: "Count", align: "right", kind: "int" }, { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" }, { key: "gross", label: "Gross", align: "right", kind: "money" }],
        rows: s.rows.map((r) => ({ type: DOC_LABEL[r.docType!] || r.docType || "—", count: r.count, net: r.net, tax: r.tax, gross: r.gross })),
        totals: { type: "Net Sales (inv + excess − credits)", count, net, tax, gross },
      };
    }
    case "sales-by-month": {
      // GA4 "Sales Issued ... grouped by Month": per-invoice lines, monthly sub-totals, running total.
      const { rows: items } = await getSalesListing(opts);
      const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const out: any[] = [];
      let running = 0, curMonth = "", sB = 0, sN = 0, sT = 0, sG = 0, gB = 0, gN = 0, gT = 0, gG = 0;
      const flush = () => { if (curMonth) out.push({ _subtotal: true, balance: sB, net: sN, tax: sT, gross: sG, running }); sB = sN = sT = sG = 0; };
      for (const it of items) {
        const d = new Date(it.date as any);
        const mk = `${MN[d.getMonth()]} ${d.getFullYear()}`;
        if (mk !== curMonth) { flush(); curMonth = mk; out.push({ _group: mk }); }
        running += it.gross;
        out.push({ date: d.toLocaleDateString("en-GB"), docType: it.docType, docNo: it.docNo, acc: it.accountNumber, customer: it.customerName, pay: it.payMethod, balance: it.balance, net: it.net, tax: it.tax, gross: it.gross, running });
        sB += it.balance; sN += it.net; sT += it.tax; sG += it.gross; gB += it.balance; gN += it.net; gT += it.tax; gG += it.gross;
      }
      flush();
      return {
        title: "Sales — Issued (grouped by Month)",
        columns: [
          { key: "date", label: "Date" }, { key: "docType", label: "Type" }, { key: "docNo", label: "No." }, { key: "acc", label: "Acc" }, { key: "customer", label: "Customer" }, { key: "pay", label: "Pay" },
          { key: "balance", label: "Balance", align: "right", kind: "money" }, { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" }, { key: "gross", label: "Gross", align: "right", kind: "money" }, { key: "running", label: "Running Total", align: "right", kind: "money" },
        ],
        rows: out,
        totals: { customer: "Total", balance: gB, net: gN, tax: gT, gross: gG, running },
      };
    }
    case "mot-sales-summary": {
      const r: any = (await db.select({
        count: sql<number>`COUNT(*)`, net: _moneySum(serviceHistory.subMotNet), tax: _moneySum(serviceHistory.subMotTax), gross: _moneySum(serviceHistory.subMotGross),
      }).from(serviceHistory).where(and(inRange, sql`${_numExpr(serviceHistory.subMotGross)} > 0`)))[0];
      return {
        title: "MOT Sales — Summary",
        columns: [{ key: "period", label: "Period" }, { key: "count", label: "MOTs", align: "right", kind: "int" }, { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" }, { key: "gross", label: "Gross", align: "right", kind: "money" }],
        rows: [{ period: `${opts.from} → ${opts.to}`, count: Number(r.count), net: Number(r.net), tax: Number(r.tax), gross: Number(r.gross) }],
      };
    }
    case "payments-summary": {
      const conds: any[] = [gte(payments.paymentDate, from), lte(payments.paymentDate, to)];
      const rows: any = await db.select({
        method: sql<string>`INITCAP(LOWER(TRIM(${payments.method})))`, count: sql<number>`COUNT(*)`, amount: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
      }).from(payments).where(and(...conds)).groupBy(sql`INITCAP(LOWER(TRIM(${payments.method})))`).orderBy(desc(sql`SUM(${payments.amount})`));
      let total = 0, n = 0; const out = rows.map((r: any) => { const a = Number(r.amount) || 0; total += a; n += Number(r.count); return { method: r.method || "—", count: Number(r.count), amount: a }; });
      return {
        title: "Payments — Summary",
        columns: [{ key: "method", label: "Method" }, { key: "count", label: "Count", align: "right", kind: "int" }, { key: "amount", label: "Amount", align: "right", kind: "money" }],
        rows: out, totals: { method: "Total", count: n, amount: total },
      };
    }
    case "unpaid-list": {
      const rows: any = await db.select({
        docNo: serviceHistory.docNo,
        date: sql<string>`COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated})`,
        customer: sql<string>`COALESCE(NULLIF(${customers.name}, ''), ${serviceHistory.customerName})`,
        gross: _numExpr(serviceHistory.totalGross), balance: _numExpr(serviceHistory.balance),
      }).from(serviceHistory).leftJoin(customers, eq(serviceHistory.customerId, customers.id))
        .where(and(inArray(serviceHistory.docType, ["SI", "XS"]), sql`${_numExpr(serviceHistory.balance)} > 0.005`))
        .orderBy(desc(_numExpr(serviceHistory.balance))).limit(500);
      let total = 0; const out = rows.map((r: any) => { const b = Number(r.balance) || 0; total += b; return { docNo: r.docNo || "—", date: r.date ? new Date(r.date).toLocaleDateString("en-GB") : "", customer: r.customer || "—", gross: Number(r.gross) || 0, balance: b }; });
      return {
        title: "Unpaid List (still outstanding)",
        subtitle: "Every invoice with an outstanding balance — not limited to the date range.",
        columns: [{ key: "docNo", label: "Doc No" }, { key: "date", label: "Date" }, { key: "customer", label: "Customer" }, { key: "gross", label: "Gross", align: "right", kind: "money" }, { key: "balance", label: "Outstanding", align: "right", kind: "money" }],
        rows: out, totals: { docNo: "", date: "", customer: `${out.length} invoice(s)`, gross: null, balance: total },
      };
    }
    case "activity-brief":
    case "activity-fixed": {
      // GA4 "Activity" reports — one row per day. Fixed-Price Breakdown splits each day's net into
      // category columns (Labour / Parts / MOT / Sundries / Lubricants / Paint / Excess); "Other"
      // absorbs any net GA4 didn't itemise (the ~4% of docs it leaves without a stored breakdown),
      // so each row's categories always reconcile to that day's Net.
      const dayExpr = sql<string>`to_char(date_trunc('day', ${dateCol}), 'YYYY-MM-DD')`;
      const S = (c: any) => sql<number>`SUM(CASE WHEN ${serviceHistory.docType}='CR' THEN -1 ELSE 1 END * ${_numExpr(c)})`;
      const rows: any = await db.select({
        day: dayExpr, n: sql<number>`COUNT(*)`,
        labour: S(serviceHistory.subLabourNet), parts: S(serviceHistory.subPartsNet), mot: S(serviceHistory.subMotNet),
        sundries: S(serviceHistory.fixedItem1Net), lubricants: S(serviceHistory.fixedItem2Net), paint: S(serviceHistory.fixedItem3Net),
        excess: S(serviceHistory.excessNet), net: S(serviceHistory.totalNet), tax: S(serviceHistory.totalTax), gross: S(serviceHistory.totalGross),
      }).from(serviceHistory).where(and(inRange, inArray(serviceHistory.docType, ["SI", "XS", "CR"]))).groupBy(dayExpr).orderBy(dayExpr);
      const g: any = { n: 0, labour: 0, parts: 0, mot: 0, sundries: 0, lubricants: 0, paint: 0, excess: 0, other: 0, net: 0, tax: 0, gross: 0 };
      const fmt = (d: string) => { const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; };
      const out = rows.map((r: any) => {
        const v: any = {}; for (const k of ["n", "labour", "parts", "mot", "sundries", "lubricants", "paint", "excess", "net", "tax", "gross"]) v[k] = Number(r[k]) || 0;
        v.other = +(v.net - (v.labour + v.parts + v.mot + v.sundries + v.lubricants + v.paint + v.excess)).toFixed(2);
        for (const k of Object.keys(g)) g[k] += v[k] || 0;
        return { date: fmt(r.day), ...v };
      });
      if (opts.reportId === "activity-brief") {
        return {
          title: "Activity — Brief (by Day)",
          columns: [{ key: "date", label: "Date" }, { key: "n", label: "Docs", align: "right", kind: "int" }, { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" }, { key: "gross", label: "Gross", align: "right", kind: "money" }],
          rows: out.map((r: any) => ({ date: r.date, n: r.n, net: r.net, tax: r.tax, gross: r.gross })),
          totals: { date: "Total", n: g.n, net: g.net, tax: g.tax, gross: g.gross },
        };
      }
      return {
        title: "Activity — Fixed Price Breakdown (by Day)",
        subtitle: "Each day's net split by GA4 category. ‘Other’ nets off invoice discounts (shown −) and any net GA4 didn't itemise; columns always reconcile to Net.",
        columns: [
          { key: "date", label: "Date" },
          { key: "labour", label: "Labour", align: "right", kind: "money" }, { key: "parts", label: "Parts", align: "right", kind: "money" },
          { key: "mot", label: "MOT", align: "right", kind: "money" }, { key: "sundries", label: "Sundries", align: "right", kind: "money" },
          { key: "lubricants", label: "Lubricants", align: "right", kind: "money" }, { key: "paint", label: "Paint & Mat.", align: "right", kind: "money" },
          { key: "excess", label: "Excess", align: "right", kind: "money" }, { key: "other", label: "Other", align: "right", kind: "money" },
          { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" }, { key: "gross", label: "Gross", align: "right", kind: "money" },
        ],
        rows: out,
        totals: { date: "Total", labour: g.labour, parts: g.parts, mot: g.mot, sundries: g.sundries, lubricants: g.lubricants, paint: g.paint, excess: g.excess, other: g.other, net: g.net, tax: g.tax, gross: g.gross },
      };
    }
    case "activity-detailed": {
      // Per-document listing grouped by day, with daily sub-totals + running total.
      const { rows: items } = await getSalesListing(opts);
      const out: any[] = [];
      let running = 0, curDay = "", sN = 0, sT = 0, sG = 0, gN = 0, gT = 0, gG = 0;
      const flush = () => { if (curDay) out.push({ _subtotal: true, net: sN, tax: sT, gross: sG, running }); sN = sT = sG = 0; };
      for (const it of items) {
        const dk = new Date(it.date as any).toLocaleDateString("en-GB");
        if (dk !== curDay) { flush(); curDay = dk; out.push({ _group: dk }); }
        running += it.gross;
        out.push({ docType: it.docType, docNo: it.docNo, acc: it.accountNumber, customer: it.customerName, net: it.net, tax: it.tax, gross: it.gross, running });
        sN += it.net; sT += it.tax; sG += it.gross; gN += it.net; gT += it.tax; gG += it.gross;
      }
      flush();
      return {
        title: "Activity — Detailed (by Day)",
        columns: [
          { key: "docType", label: "Type" }, { key: "docNo", label: "No." }, { key: "acc", label: "Acc" }, { key: "customer", label: "Customer" },
          { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" }, { key: "gross", label: "Gross", align: "right", kind: "money" }, { key: "running", label: "Running Total", align: "right", kind: "money" },
        ],
        rows: out,
        totals: { customer: "Total", net: gN, tax: gT, gross: gG, running },
      };
    }
    default:
      return { title: "Coming soon", columns: [{ key: "msg", label: "" }], rows: [], note: "This report isn't built into the web app yet — tell me and I'll add it next." };
  }
}

/** Filter options for the reports launcher (departments only carry meaning today). */
export async function getReportFilters() {
  const db = await getDb();
  if (!db) return { departments: [] as string[] };
  const deptRows = await db.selectDistinct({ d: serviceHistory.department }).from(serviceHistory)
    .where(sql`COALESCE(${serviceHistory.department}, '') <> ''`).orderBy(serviceHistory.department);
  return { departments: deptRows.map((d) => d.d!).filter(Boolean) };
}

// An insurance/accident-management/fleet-claims bill-to (the insurer pays the repair; the
// vehicle owner pays the policy excess). Deliberately insurer-specific so ordinary business
// customers (e.g. "Doppio Coffee Ltd") are NOT treated as insurance jobs.
const INSURER_RE = /\b(Insurance|Assurance|Underwrit\w*|Indemnity|Accident|Claims?|Motability|Brokers?|FMG|Auxillis|Acromas|Kindertons|Albany Assistance|Aviva|Admiral|Hastings|Ageas|Allianz|AXA|Zurich|Covea|Esure|Churchill|Hiscox|Markerstudy|Direct Line|Innovation Group|Accident Exchange|Enterprise Rent)\b/i;
export function detectInsurer(name?: string | null): boolean {
  const s = String(name ?? "").trim();
  return !!s && INSURER_RE.test(s);
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
      .from(serviceHistory).where(inArray(serviceHistory.vehicleId, await getVehicleIdsForSamePlate(db, doc.vehicleId)));
    vehLastInvoiced = r[0]?.last ?? null;
  }
  const docPayments = await db.select().from(payments).where(eq(payments.documentId, id)).orderBy(desc(payments.paymentDate));
  let relatedDoc: any = null;
  if (doc.relatedDocId) relatedDoc = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, doc.relatedDocId)).limit(1))[0] ?? null;
  // bill-to summary: a company on the doc, and whether it looks like an insurer/fleet (→ excess split applies)
  const billToName = String(doc.insuranceCompany || doc.company || "").trim();
  const billTo = { company: billToName || null, isInsurer: detectInsurer(doc.insuranceCompany) || detectInsurer(doc.company) };
  return { doc, customer, vehicle, lineItems, history, accBalance, custLastInvoiced, vehLastInvoiced, payments: docPayments, relatedDoc, billTo };
}

/** All parts ever fitted to a vehicle (across every document), with the price charged. */
// Repair pricing intelligence: search past Labour/Part line items for a repair (e.g. "shock
// absorber") and return what was historically charged — parts vs labour — with same-model /
// same-make / all-cars benchmarks. Read-only over existing data; no external API calls.
export async function getRepairPricing(input: { query: string; make?: string; model?: string }) {
  const db = await getDb();
  if (!db) return { terms: [] as string[], scopes: {} as any, jobs: [] as any[] };
  const STOP = new Set("the a an and or of to for on in at it with has have had its is was need needs needed see what we charged charge cost costs price prices similar car cars vehicle vehicles repair repairs repaired job side near nearside offside rear front left right serious leak leaking failed failure replace replaced new".split(/\s+/));
  const makeWords = new Set(String(input.make ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  const modelWords = new Set(String(input.model ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  const terms = Array.from(new Set(String(input.query ?? "").toLowerCase().match(/[a-z]{3,}/g) || []))
    .filter((t) => !STOP.has(t) && !makeWords.has(t) && !modelWords.has(t)).slice(0, 6);
  if (!terms.length) return { terms: [], scopes: {}, jobs: [] };

  const termCond = terms.length === 1 ? ilike(serviceLineItems.description, `%${terms[0]}%`)
    : or(...terms.map((t) => ilike(serviceLineItems.description, `%${t}%`)));
  const rows: any[] = await db
    .select({
      itemType: serviceLineItems.itemType, description: serviceLineItems.description,
      qty: serviceLineItems.quantity, unit: serviceLineItems.unitPrice, subNet: serviceLineItems.subNet,
      docId: serviceHistory.id, docNo: serviceHistory.docNo, date: serviceHistory.dateCreated,
      make: vehicles.make, model: vehicles.model,
    })
    .from(serviceLineItems)
    .innerJoin(serviceHistory, eq(serviceHistory.id, serviceLineItems.documentId))
    .leftJoin(vehicles, eq(vehicles.id, serviceHistory.vehicleId))
    .where(and(termCond, inArray(serviceLineItems.itemType, ["Labour", "Part"])))
    .orderBy(desc(serviceHistory.dateCreated)).limit(1500);

  const mk = String(input.make ?? "").trim().toLowerCase().split(" ")[0];
  const md = String(input.model ?? "").trim().toLowerCase().split(" ")[0];
  const byDoc = new Map<number, any>();
  for (const r of rows) {
    const unit = Number(r.unit) || 0; const net = Number(r.subNet) || unit * (Number(r.qty) || 1);
    if (unit <= 0 && net <= 0) continue;
    let j = byDoc.get(r.docId);
    if (!j) {
      const vmake = String(r.make ?? "").toLowerCase(); const vmodel = String(r.model ?? "").toLowerCase();
      const sameMake = !!mk && vmake.includes(mk);
      const sameModel = sameMake && !!md && vmodel.includes(md);
      j = { docId: r.docId, docNo: r.docNo, date: r.date, make: r.make, model: r.model, sameMake, sameModel, parts: [] as any[], labour: [] as any[], partNet: 0, labourNet: 0 };
      byDoc.set(r.docId, j);
    }
    const line = { description: r.description, qty: Number(r.qty) || 1, unit, net: +net.toFixed(2) };
    if (r.itemType === "Part") { j.parts.push(line); j.partNet += net; } else { j.labour.push(line); j.labourNet += net; }
  }
  const jobs = Array.from(byDoc.values()).map((j) => ({ ...j, repairNet: +(j.partNet + j.labourNet).toFixed(2) }));

  const agg = (a: number[]) => a.length ? { n: a.length, avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), min: +Math.min(...a).toFixed(2), max: +Math.max(...a).toFixed(2) } : { n: 0, avg: 0, min: 0, max: 0 };
  const statOf = (set: any[]) => ({
    jobs: set.length,
    parts: agg(set.flatMap((j) => j.parts).map((l: any) => l.net).filter((n: number) => n > 0)),
    labour: agg(set.flatMap((j) => j.labour).map((l: any) => l.net).filter((n: number) => n > 0)),
    total: agg(set.map((j) => j.repairNet).filter((n: number) => n > 0)),
  });
  const scopes = {
    model: md ? statOf(jobs.filter((j) => j.sameModel)) : null,
    make: mk ? statOf(jobs.filter((j) => j.sameMake)) : null,
    all: statOf(jobs),
  };
  jobs.sort((a, b) => (Number(b.sameModel) - Number(a.sameModel)) || (Number(b.sameMake) - Number(a.sameMake)) || (new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()));
  return { terms, scopes, jobs: jobs.slice(0, 60) };
}

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
    .where(and(inArray(serviceHistory.vehicleId, await getVehicleIdsForSamePlate(db, vehicleId)), eq(serviceLineItems.itemType, "Part")))
    .orderBy(desc(serviceHistory.dateCreated))
    .limit(limit);
}

// Canonicalise a UK registration. Current-format plates are AA00 AAA: positions 1-2 letters,
// 3-4 digits, 5-7 letters. Fix the usual letter/digit confusions PER POSITION so a typo'd reg
// like "LS09B0V" (zero) resolves to the real "LS09BOV" (letter O) — otherwise the DB match and
// the SWS/DVLA providers reject it and every derived field comes back empty.
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B", "4": "A", "7": "T" };
const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8", T: "7" };
const normReg = (r?: string) => {
  const s = (r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Trust plates already in a recognised format — never coerce them. A dateless/personalised plate
  // (letters-then-digits or digits-then-letters, e.g. XLZ1872) is NOT a mis-OCR'd current plate and
  // must not be forced into the AA00AAA template (which would turn XLZ1872 into XL21BTZ).
  if (/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(s)) return s;   // current  AA00 AAA
  if (/^[A-Z]{1,3}[0-9]{1,4}$/.test(s)) return s;        // dateless AAA 9999 (incl. XLZ1872)
  if (/^[0-9]{1,4}[A-Z]{1,3}$/.test(s)) return s;        // dateless 9999 AAA
  if (/^[A-Z0-9]{7}$/.test(s)) {
    const L = (c: string) => TO_LETTER[c] ?? c, D = (c: string) => TO_DIGIT[c] ?? c;
    const cand = L(s[0]) + L(s[1]) + D(s[2]) + D(s[3]) + L(s[4]) + L(s[5]) + L(s[6]);
    if (/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(cand)) return cand; // confidently current-format
  }
  return s;
};

/** Reg lookup for the job sheet form: DB first, then DVLA (like GA4's VRM lookup). */
// UKVD returns a ".../missing" placeholder URL when it has no photo — never treat it as a real image.
const cleanImg = (u: any): string | null => (u && !/\/missing(?:[?#]|$)/i.test(String(u))) ? u : null;

export async function lookupVehicleForReg(registration: string, opts?: { force?: boolean }) {
  const force = !!opts?.force;
  const db = await getDb();
  const reg = normReg(registration);
  if (!reg) return { found: false, source: "none", vehicle: null, customer: null };
  // surface a UKVD account/billing problem (it silently blocks VIN/colour on every lookup)
  const ukvdWarning = async (): Promise<string | null> => {
    try {
      const { getLastUkvdStatus } = await import("./ukvd");
      const s = getLastUkvdStatus() || "";
      return /billing|account|credit|subscription|balance|fund|payment/i.test(s)
        ? "Vehicle-data provider (UKVD) reports an account/billing problem — VIN & colour are unavailable until it's resolved." : null;
    } catch { return null; }
  };
  if (db) {
    const v: any = (await db.select().from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1))[0];
    if (v) {
      try { const _ctd = typeof v.comprehensiveTechnicalData === "string" ? JSON.parse(v.comprehensiveTechnicalData) : v.comprehensiveTechnicalData; v.imageUrl = cleanImg(_ctd?.ukvd?.imageUrl); } catch { v.imageUrl = null; }
      const cust = v.customerId ? (await db.select().from(customers).where(eq(customers.id, v.customerId)).limit(1))[0] ?? null : null;
      // A known vehicle imported from GA4 is often sparse (e.g. only the make). The SWS-derived
      // fields (derivative, model, fuel, engine code, A/C, oil) are only fetched for brand-new
      // regs — so backfill any MISSING fields from SWS+DVLA on lookup, then cache them back.
      // Treat a blank OR the literal string "null"/"NULL" (a GA4 import artifact) as empty, so a
      // record showing "NULL" for make/model/derivative gets backfilled instead of looking filled.
      const empty = (s: any) => { const t = String(s ?? "").trim(); return !t || /^null$/i.test(t); };
      // Free self-heal: if the derivative is blank but the SWS data we already stored has it,
      // fill it from cache (no API call). Covers vehicles enriched before the derivative was saved.
      if (empty(v.derivative)) {
        try {
          const _c = typeof v.comprehensiveTechnicalData === "string" ? JSON.parse(v.comprehensiveTechnicalData) : v.comprehensiveTechnicalData;
          const dv = tidyDerivative(_c?.specs?.fullName || _c?.specs?.name, v.make);
          if (dv) { v.derivative = dv; await db.update(vehicles).set({ derivative: dv }).where(eq(vehicles.id, v.id)); }
        } catch { /* no usable cached data */ }
      }
      if (force || ((empty(v.derivative) || empty(v.model) || empty(v.fuelType) || empty(v.engineCode) || empty(v.vin) || empty(v.colour)) && !v.swsLastUpdated)) {
        try {
          const { fetchRichVehicleData } = await import("./sws");
          const sws: any = await fetchRichVehicleData(reg, true);
          const u = sws?.ukvd || {}; const sp = sws?.specs || {};
          const _img = cleanImg(u.imageUrl); if (_img) v.imageUrl = _img;
          // SWS/UKVD can hand back junk placeholders ("NULL", "undefined", and via fullName even
          // "undefined undefined") for fields it can't resolve — scrub them so they're never stored.
          const clean = (s: any) => { const t = String(s ?? "").trim(); return /^(null|undefined)(\s+(null|undefined))*$/i.test(t) ? "" : t; };
          const fn = clean(sp.fullName);
          const updates: any = {};
          // force = an explicit lookup after the reg was changed → OVERWRITE the identity fields
          // with the fresh data (clears stale data from a previous, wrong reg). Otherwise fill blanks.
          const want = (field: string) => force || empty(v[field]);
          const swsMake = clean(u.make) || (fn ? fn.trim().split(/\s+/)[0] : "");
          if (want("make") && swsMake) v.make = updates.make = String(swsMake).toUpperCase();
          const newMake = updates.make ?? v.make;
          const stripMake = (s: string) => { const p = s.trim().split(/\s+/); if (p[0] && String(newMake || "").toUpperCase().startsWith(p[0].toUpperCase())) p.shift(); return p.join(" "); };
          if (want("model")) { const m = clean(u.model) || (fn ? clean(stripMake(fn).split("(")[0].trim()) : ""); if (m) v.model = updates.model = m; }
          if (want("derivative")) { const dv = clean(tidyDerivative(fn || clean(sp.name), newMake)); if (dv) v.derivative = updates.derivative = dv; }
          if (want("fuelType") && clean(u.fuelType || sp.fuelType)) v.fuelType = updates.fuelType = clean(u.fuelType || sp.fuelType);
          if (want("engineCode") && clean(sp.engineCode)) v.engineCode = updates.engineCode = clean(sp.engineCode);
          if (want("colour") && clean(u.colour)) v.colour = updates.colour = clean(u.colour);
          if (want("vin") && clean(u.vin || sp.vin || sws?.raw?.vinNumber)) v.vin = updates.vin = clean(u.vin || sp.vin || sws?.raw?.vinNumber);
          if (want("engineCC") && (u.engineSize || sp.capacity)) v.engineCC = updates.engineCC = Number(u.engineSize || sp.capacity) || v.engineCC;
          if (force) { v.engineNo = updates.engineNo = null; updates.comprehensiveTechnicalData = sws; v.comprehensiveTechnicalData = sws; } // drop stale physical engine no + refresh cached data
          updates.swsLastUpdated = new Date(); // mark "SWS/UKVD attempted" so we never re-pay for this vehicle
          await db.update(vehicles).set(updates).where(eq(vehicles.id, v.id));
          const oil = (sws?.lubricants || []).find((l: any) => /engine oil/i.test(l?.description || ""));
          if (oil || sws?.aircon) {
            v.technical = { oilSpec: oil?.specification || null, oilCapacity: oil?.capacity || null, airconType: sws?.aircon?.type || null, airconCapacity: sws?.aircon?.quantity ?? sws?.aircon?.capacity ?? null, transmission: sws?.ukvd?.transmission ?? null };
          }
        } catch { /* SWS unavailable — keep stored record */ }
      }
      // DVLA (free, government) — fetch MOT expiry / tax status / colour and PERSIST them to the
      // record, so the saved vehicle AND the printed job sheet (which reads the record) have them.
      // NOT gated by the paid-SWS flag: these change over time and DVLA costs nothing.
      if (force || empty(v.motExpiryDate) || empty(v.taxStatus) || empty(v.colour) || empty(v.dateOfRegistration)) {
        try {
          const { getVehicleDetails } = await import("./dvlaApi");
          const { getCurrentMotExpiry } = await import("./motApi");
          // MOT expiry from DVSA MOT History (authoritative); tax + colour + first-reg date from DVLA VES
          const [d, motExp] = await Promise.all([getVehicleDetails(reg).catch(() => null) as any, getCurrentMotExpiry(reg)]);
          const du: any = {};
          const toDate = (x: any) => { if (!x) return null; const dt = x instanceof Date ? x : new Date(x); return isNaN(dt.getTime()) ? null : dt; };
          if (motExp) { v.motExpiryDate = motExp; du.motExpiryDate = motExp; }
          if (d) {
            if (d.taxStatus) { v.taxStatus = d.taxStatus; du.taxStatus = d.taxStatus; }
            const tdd = toDate(d.taxDueDate); if (tdd) { v.taxDueDate = tdd; du.taxDueDate = tdd; }
            // DVLA make is authoritative for UK plates — fill it when UKVD couldn't (e.g. grey imports
            // where UKVD returns no/"NULL" make), so the record never shows a blank or "NULL" make.
            if ((force || empty(v.make)) && d.make) { v.make = du.make = String(d.make).toUpperCase(); }
            if ((force || empty(v.colour)) && d.colour) { v.colour = d.colour; du.colour = d.colour; }
            // date of first registration — prefer DVLA's month, else the year of manufacture
            if ((force || empty(v.dateOfRegistration)) && (d.monthOfFirstRegistration || d.yearOfManufacture)) {
              const dor = d.monthOfFirstRegistration ? new Date(d.monthOfFirstRegistration + "-01") : new Date(d.yearOfManufacture, 0, 1);
              if (!isNaN(dor.getTime())) { v.dateOfRegistration = dor; du.dateOfRegistration = dor; }
            }
          }
          if (Object.keys(du).length) await db.update(vehicles).set(du).where(eq(vehicles.id, v.id));
        } catch { /* DVLA/DVSA unavailable */ }
      }
      // No owner linked to the vehicle? Fall back to the customer on this vehicle's MOST RECENT
      // document, so a new sheet can still pre-fill name/address/phone — this covers invoices that
      // were typed without ever linking/creating a customer record. If that prior document WAS
      // linked to a real customer, return it as the owner instead.
      let lastCustomer: any = null;
      if (!cust) {
        const prior: any = (await db.select({
          customerId: serviceHistory.customerId,
          customerName: serviceHistory.customerName,
          custTitle: serviceHistory.custTitle, custForename: serviceHistory.custForename, custSurname: serviceHistory.custSurname,
          company: serviceHistory.company, accountNumber: serviceHistory.accountNumber,
          custHouseNo: serviceHistory.custHouseNo, custRoad: serviceHistory.custRoad, custLocality: serviceHistory.custLocality,
          custTown: serviceHistory.custTown, custCounty: serviceHistory.custCounty, custPostcode: serviceHistory.custPostcode,
          custTelephone: serviceHistory.custTelephone, custMobile: serviceHistory.custMobile, custEmail: serviceHistory.custEmail,
        })
          .from(serviceHistory)
          .where(and(eq(serviceHistory.vehicleId, v.id),
            sql`(COALESCE(${serviceHistory.customerName}, '') <> '' OR COALESCE(${serviceHistory.custSurname}, '') <> '' OR COALESCE(${serviceHistory.company}, '') <> '')`))
          .orderBy(desc(serviceHistory.dateIssued), desc(serviceHistory.id))
          .limit(1))[0];
        if (prior?.customerId) {
          const linked = (await db.select().from(customers).where(eq(customers.id, prior.customerId)).limit(1))[0];
          if (linked) return { found: true, source: "database", vehicle: v, customer: linked, warning: await ukvdWarning() };
        }
        if (prior && (prior.customerName || prior.custSurname || prior.company)) lastCustomer = prior;
      }
      return { found: true, source: "database", vehicle: v, customer: cust, lastCustomer, warning: await ukvdWarning() };
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
      v.derivative = tidyDerivative(sws?.specs?.fullName || sws?.specs?.name, v.make);
      v.imageUrl = cleanImg(u.imageUrl);
      sources.push("sws");
    }
    const oil = (sws?.lubricants || []).find((l: any) => /engine oil/i.test(l?.description || ""));
    if (oil || sws?.aircon) {
      v.technical = { oilSpec: oil?.specification || null, oilCapacity: oil?.capacity || null, airconType: sws?.aircon?.type || null, airconCapacity: sws?.aircon?.quantity ?? sws?.aircon?.capacity ?? null, transmission: sws?.ukvd?.transmission ?? null };
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

  return { found: false, source: sources.join("+") || "none", customer: null, vehicle: v, warning: await ukvdWarning() };
}

/** Record one billable address lookup (best-effort — never blocks the lookup). */
export async function recordAddressLookup(postcode: string, results: number, source: string) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(addressLookups).values({ postcode: (postcode || "").slice(0, 12), results, source });
  } catch { /* logging must never break the lookup */ }
}

/** Address-lookup (credit) usage stats — only billable Ideal Postcodes lookups are counted. */
export async function getAddressLookupStats() {
  const db = await getDb();
  if (!db) return { total: 0, thisMonth: 0, today: 0 };
  const rows = await db.select({
    total: sql<number>`COUNT(*)`,
    thisMonth: sql<number>`COUNT(*) FILTER (WHERE ${addressLookups.createdAt} >= date_trunc('month', now()))`,
    today: sql<number>`COUNT(*) FILTER (WHERE ${addressLookups.createdAt} >= CURRENT_DATE)`,
  }).from(addressLookups).where(sql`${addressLookups.source} = 'Ideal Postcodes' AND ${addressLookups.results} > 0`);
  const r = rows[0];
  return { total: Number(r?.total) || 0, thisMonth: Number(r?.thisMonth) || 0, today: Number(r?.today) || 0 };
}

/** Technical/spec data (engine oil, A/C, vehicle image) + MOT/tax for the job-sheet info cards.
 *  PAID data (SWS technical + UKVD spec/image) is static per vehicle, so it is fetched at most
 *  ONCE and cached in comprehensiveTechnicalData — subsequent opens are served from cache and are
 *  never re-billed. MOT/tax come from the FREE DVLA API, so they are always refreshed live. */
export async function liveVehicleTech(registration: string) {
  const reg = normReg(registration);
  if (!reg) return null;
  const out: any = {};

  // --- Paid technical + UKVD spec/image: serve from cache; pay only once per vehicle. ---
  try {
    const db = await getDb();
    const veh: any = db ? (await db.select().from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1))[0] : null;
    let ctd: any = null;
    if (veh?.comprehensiveTechnicalData) {
      try { ctd = typeof veh.comprehensiveTechnicalData === "string" ? JSON.parse(veh.comprehensiveTechnicalData) : veh.comprehensiveTechnicalData; } catch { ctd = null; }
    }
    if (!ctd || !ctd.ukvd) {
      // Never cached (or cached before UKVD ran) — hit the paid APIs once, then store for good.
      console.log(`[liveVehicleTech] tech cache MISS for ${reg} — one-off paid lookup`);
      const { fetchRichVehicleData } = await import("./sws");
      const fresh: any = await fetchRichVehicleData(reg, true);
      ctd = fresh || ctd || {};
      if (!ctd.ukvd) ctd.ukvd = {}; // mark UKVD attempted so an unresolved vehicle is never re-billed
      if (veh) { try { await saveTechnicalData(reg, ctd); } catch { /* cache write best-effort */ } }
    } else {
      console.log(`[liveVehicleTech] tech cache HIT for ${reg} — no paid API call`);
    }
    const oils = (ctd?.lubricants || []).filter((l: any) => /engine oil/i.test(l?.description || ""));
    const oil = oils[0];
    out.oilSpec = oil?.specification ?? null;
    out.oilCapacity = oil?.capacity ?? null;
    // distinct SAE grades the engine accepts (preferred first) so callers can print every option
    const gradeOf = (s: any) => (String(s).match(/\b\d+W[-\s]?\d+\b/i) || [])[0]?.toUpperCase().replace(/\s+/g, "") || "";
    const prefG = Array.from(new Set(oils.filter((o: any) => /preferred/i.test(o?.description || "")).map((o: any) => gradeOf(o.specification)).filter(Boolean))) as string[];
    const allG = Array.from(new Set(oils.map((o: any) => gradeOf(o.specification)).filter(Boolean))) as string[];
    out.oilGrades = [...prefG, ...allG.filter((g) => !prefG.includes(g))];
    out.oilPreferred = prefG;
    out.airconType = ctd?.aircon?.type ?? null;
    out.airconCapacity = ctd?.aircon?.quantity ?? ctd?.aircon?.capacity ?? null;
    out.imageUrl = cleanImg(ctd?.ukvd?.imageUrl);
  } catch { /* tech cache/fetch unavailable */ }

  // --- MOT & tax: free (DVLA) and time-sensitive → always live. ---
  try {
    const { getVehicleDetails } = await import("./dvlaApi");
    const d: any = await getVehicleDetails(reg);
    if (d) { out.motExpiry = d.motExpiryDate ?? null; out.taxStatus = d.taxStatus ?? null; out.taxDueDate = d.taxDueDate ?? null; }
  } catch { /* DVLA unavailable */ }

  return out;
}

/**
 * Next document number for a given doc type — always allocated AHEAD of GA4.
 *
 * GA4 mints its own numbers and the sync is one-way (GA4 -> web), so at the moment we allocate,
 * GA4 may already hold invoices we haven't pulled yet. If we simply used max(known)+1 we'd hand out
 * a number GA4 has quietly used for a different job, and the two collide once it syncs in (this is
 * exactly how web SI 90684-90687 clashed with GA4). To prevent that we reserve numbers from a
 * monotonic high-water that sits `clearance` above the highest number we can see, and leap clear
 * again whenever GA4 surges past our reserve. GA4 stays the invoicing authority: once a web doc is
 * keyed into GA4 it reconciles by reg+total and GA4's number is the real one (see cross-check.sh
 * section 3, the "web ahead of GA4" worklist). `docNoClearance` is tunable via appSettings (0 = the
 * old contiguous max+1 behaviour).
 */
export async function getNextDocNo(docType: string) {
  const db = await getDb();
  if (!db) return "1";
  const r = await db.select({ m: sql<number>`MAX((NULLIF(regexp_replace(${serviceHistory.docNo}, '[^0-9]', '', 'g'), ''))::bigint)` })
    .from(serviceHistory).where(eq(serviceHistory.docType, docType));
  const dbMax = Number(r[0]?.m) || 0;
  const clearance = Number(await getAppSetting("docNoClearance")) || 20;
  const key = `docNoNext:${docType}`;
  const reserved = Number(await getAppSetting(key)) || 0;
  // still ahead of GA4 -> take our next reserved slot; GA4 caught up (or first run) -> leap clear
  let next = reserved > dbMax ? reserved : dbMax + clearance + 1;
  // skip any number already taken as a docNo/ga4Number, or reserved in the pool
  for (;;) {
    const taken: any = await db.execute(sql`
      SELECT 1 WHERE EXISTS (SELECT 1 FROM "serviceHistory" WHERE "docNo"=${String(next)} OR "ga4Number"=${String(next)})
                OR EXISTS (SELECT 1 FROM "ga4NumberPool" WHERE "ga4Number"=${String(next)})`);
    if (!(taken.rows?.length)) break;
    next++;
  }
  await setAppSetting(key, next + 1);
  return String(next);
}

/**
 * Round money to 2dp with decimal round-half-up — matches GA4's VAT/total rounding.
 * `.toFixed(2)` / `Math.round(n*100)/100` round a half-penny DOWN when the float sits just
 * under the boundary (e.g. 7 × 5.975 = 41.82499… → 41.82 not 41.83), under-charging VAT a
 * penny and drifting totals off GA4. The +1e-6 pence-space nudge absorbs that; sign-aware.
 */
function round2(n: number): number {
  return (n < 0 ? -1 : 1) * Math.round(Math.abs(n) * 100 + 1e-6) / 100;
}

/** Search customers by name / phone / email / postcode (for the job-sheet picker). */
// Find customers whose phone matches the given number — normalised for +44/0 prefix and spaces, so
// "07719763259" matches a stored "+44 7719 763259". Used by the "already on file" hint on the job
// sheet to avoid creating duplicate customers.
export async function findCustomersByPhone(phone: string, limit = 5) {
  const db = await getDb();
  if (!db) return [];
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return [];
  const core = digits.slice(-10); // the last 10 digits identify the number regardless of +44/0 prefix
  return db.select({ id: customers.id, name: customers.name, phone: customers.phone, postcode: customers.postcode, address: customers.address, email: customers.email })
    .from(customers)
    .where(ilike(sql`REPLACE(${customers.phone}, ' ', '')`, `%${core}%`))
    .limit(limit);
}

export async function searchCustomers(query: string, limit = 10) {
  const db = await getDb();
  if (!db || !query || query.trim().length < 2) return [];
  const q = query.trim();
  const s = `%${q}%`;
  const conds: any[] = [ilike(customers.name, s), ilike(customers.phone, s), ilike(customers.email, s), ilike(customers.postcode, s)];
  // Match on the national significant number so "07951387353" finds "+447951387353" (and vice
  // versa) — strip the 0 / +44 / 44 prefix and match the remaining digits as a substring.
  let core = q.replace(/\D/g, "");
  if (core.startsWith("44")) core = core.slice(2); else if (core.startsWith("0")) core = core.slice(1);
  if (core.length >= 6) conds.push(ilike(customers.phone, `%${core}%`));
  return db.select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, postcode: customers.postcode, address: customers.address })
    .from(customers)
    .where(or(...conds))
    .orderBy(customers.name)
    .limit(limit);
}

// Universal omni-search across customers, vehicles and jobs (documents). Used by the popup
// search on the Live Jobs page — matches name/surname, phone, email, address/postcode,
// registration, make/model, doc number and account number.
export async function globalSearch(query: string, full = false) {
  const db = await getDb();
  const qq = String(query ?? "").trim();
  if (!db || qq.length < 2) return { customers: [], vehicles: [], documents: [], documentsTotal: 0 };
  const limC = full ? 100 : 8, limV = full ? 200 : 15, limD = full ? 300 : 50;
  // Every typed word must match SOMEWHERE on the row — an AND of (per-word OR-across-fields).
  // So "Honda Jazz John" finds the Honda Jazz owned by John: words can span make/model/owner/reg.
  const tokens = qq.split(/\s+/).filter(Boolean);
  const likeOf = (t: string) => `%${t}%`;
  const regLikeOf = (t: string) => `%${t.toUpperCase().replace(/\s+/g, "")}%`;
  const allTokens = (colsFor: (t: string) => any[]) => and(...tokens.map((t) => or(...colsFor(t))));

  // A part name ("brake pads") can hit thousands of documents over the years — cap what's
  // rendered but still report the true total, and sort by the SAME date shown in the UI
  // (issued, falling back to created) so the capped page is actually the most recent ones.
  const docsWhere = allTokens((t) => { const l = likeOf(t); return [
    ilike(serviceHistory.docNo, l), ilike(serviceHistory.ga4Number, l), ilike(serviceHistory.registration, l), ilike(serviceHistory.customerName, l), ilike(serviceHistory.accountNumber, l),
    sql`EXISTS (SELECT 1 FROM ${serviceLineItems} WHERE ${serviceLineItems.documentId} = ${serviceHistory.id} AND (${serviceLineItems.description} ILIKE ${l} OR ${serviceLineItems.partNumber} ILIKE ${l}))`,
  ]; });
  const docDateDesc = desc(sql`COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated})`);

  const [cust, veh, docs, docsCount] = await Promise.all([
    db.select({ id: customers.id, name: customers.name, phone: customers.phone, postcode: customers.postcode, address: customers.address })
      .from(customers)
      .where(allTokens((t) => {
        const l = likeOf(t);
        const cols = [ilike(customers.name, l), ilike(customers.phone, l), ilike(customers.email, l), ilike(customers.postcode, l), ilike(customers.address, l)];
        let core = t.replace(/\D/g, ""); if (core.startsWith("44")) core = core.slice(2); else if (core.startsWith("0")) core = core.slice(1);
        if (core.length >= 6) cols.push(ilike(customers.phone, `%${core}%`)); // match national number across 0/+44 formats
        return cols;
      }))
      .orderBy(customers.name).limit(limC),
    db.select({ id: vehicles.id, registration: vehicles.registration, make: vehicles.make, model: vehicles.model, colour: vehicles.colour, customerId: vehicles.customerId, ownerName: customers.name, ownerPhone: customers.phone })
      .from(vehicles)
      .leftJoin(customers, eq(vehicles.customerId, customers.id))
      .where(allTokens((t) => { const l = likeOf(t); return [sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') ILIKE ${regLikeOf(t)}`, ilike(vehicles.make, l), ilike(vehicles.model, l), ilike(vehicles.derivative, l), ilike(customers.name, l)]; }))
      .orderBy(customers.name).limit(limV),
    db.select({
        id: serviceHistory.id, docNo: serviceHistory.docNo, ga4Number: serviceHistory.ga4Number, docType: serviceHistory.docType, registration: serviceHistory.registration,
        // The doc's own denormalized customerName text is blank on plenty of real GA4-synced
        // rows even though customerId correctly links to a customer — fall back to the linked
        // record's name so the results don't show a blank "—" for a document that DOES have
        // an owner on file.
        customerName: sql<string>`COALESCE(${serviceHistory.customerName}, ${customers.name})`,
        accountNumber: serviceHistory.accountNumber, date: serviceHistory.dateCreated, dateIssued: serviceHistory.dateIssued, make: vehicles.make, model: vehicles.model,
      })
      .from(serviceHistory)
      .leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
      .leftJoin(customers, eq(serviceHistory.customerId, customers.id))
      // ga4Number is what's actually printed/emailed on an issued invoice — search must match it
      // too, or looking up the number a customer was given finds nothing (or the wrong doc).
      // Also match a part description/number on any line item of the doc, so typing a part
      // ("Oil Filter", "BP1234") surfaces the job sheets/invoices that used it.
      .where(docsWhere)
      .orderBy(docDateDesc).limit(limD),
    db.select({ n: sql<number>`COUNT(*)` }).from(serviceHistory).leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id)).where(docsWhere),
  ]);
  const documentsTotal = Number(docsCount[0]?.n ?? docs.length);

  // Attach each matched customer's vehicles so they show next to the name.
  const custIds = cust.map((c) => c.id);
  const vehByCust = new Map<number, { registration: string; make: string | null; model: string | null }[]>();
  if (custIds.length) {
    const cv = await db.select({ customerId: vehicles.customerId, registration: vehicles.registration, make: vehicles.make, model: vehicles.model })
      .from(vehicles).where(inArray(vehicles.customerId, custIds)).orderBy(vehicles.registration);
    for (const v of cv) {
      if (v.customerId == null || !v.registration) continue;
      const list = vehByCust.get(v.customerId) || [];
      list.push({ registration: v.registration, make: v.make, model: v.model });
      vehByCust.set(v.customerId, list);
    }
  }
  const customersWithVehicles = cust.map((c) => ({ ...c, vehicles: (vehByCust.get(c.id) || []).slice(0, 6) }));

  // Last visit per matched vehicle = the newest document (invoice/job sheet/etc.) for that car,
  // so the results show when the customer was last in.
  const vehIds = veh.map((v) => v.id).filter((id): id is number => id != null);
  const lastVisitByVeh = new Map<number, any>();
  if (vehIds.length) {
    const visits = await db.select({ vehicleId: serviceHistory.vehicleId, last: sql<string>`MAX(COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated}))` })
      .from(serviceHistory).where(inArray(serviceHistory.vehicleId, vehIds)).groupBy(serviceHistory.vehicleId);
    for (const r of visits) if (r.vehicleId != null) lastVisitByVeh.set(r.vehicleId, r.last);
  }
  const vehiclesWithVisit = veh.map((v) => ({ ...v, lastVisit: lastVisitByVeh.get(v.id) || null }));

  return { customers: customersWithVehicles, vehicles: vehiclesWithVisit, documents: docs, documentsTotal };
}

// Sales forecourt stock with DVLA MOT/tax. Imported via scripts/import-sales-stock.ts.
export async function getSalesStock() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(salesStock).orderBy(desc(salesStock.price));
}

// Re-fetch DVLA MOT expiry + tax status for every stock car (free). Used by the "Refresh" button.
export async function refreshSalesStockMotTax() {
  const db = await getDb();
  if (!db) return { updated: 0 };
  const cars = await db.select({ id: salesStock.id, registration: salesStock.registration }).from(salesStock);
  const { getVehicleDetails } = await import("./dvlaApi");
  const { getCurrentMotExpiry } = await import("./motApi");
  const toDate = (x: any) => { if (!x) return null; const d = x instanceof Date ? x : new Date(x); return isNaN(d.getTime()) ? null : d; };
  let updated = 0;
  for (const car of cars) {
    if (!car.registration) continue;
    const reg = String(car.registration).toUpperCase().replace(/\s+/g, "");
    try {
      // MOT expiry from DVSA MOT History (authoritative); tax from DVLA VES
      const [d, motExp]: any = await Promise.all([getVehicleDetails(reg).catch(() => null), getCurrentMotExpiry(reg)]);
      const set: any = { taxStatus: d?.taxStatus || null, taxDueDate: toDate(d?.taxDueDate), motTaxChecked: new Date() };
      if (motExp) set.motExpiryDate = motExp;
      await db.update(salesStock).set(set).where(eq(salesStock.id, car.id));
      updated++;
    } catch { /* skip this reg */ }
  }
  return { updated };
}

export async function getCustomerContacts(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  const r = (await db.select({ altContacts: customers.altContacts }).from(customers).where(eq(customers.id, customerId)).limit(1))[0];
  return Array.isArray(r?.altContacts) ? r!.altContacts : [];
}

// Save a customer's extra named phone numbers (family members etc.) as [{ name, phone }].
export async function saveCustomerContacts(customerId: number, contacts: { name?: string; phone?: string }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const clean = (contacts || [])
    .map((c) => ({ name: String(c.name ?? "").trim(), phone: String(c.phone ?? "").trim() }))
    .filter((c) => c.name || c.phone)
    .slice(0, 20);
  await db.update(customers).set({ altContacts: clean }).where(eq(customers.id, customerId));
  return { saved: clean.length };
}

// ─── Duplicate customer review ───────────────────────────────────────────────
function normPhoneKey(raw: any): string | null {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, "");
  const m = s.match(/(?:\+?44|0)\d{9,10}/) || s.match(/\d{10,11}/);
  if (!m) return null;
  let d = m[0].replace(/\D/g, "");
  if (d.startsWith("44")) d = "0" + d.slice(2);
  if (d.length === 10 && d.startsWith("7")) d = "0" + d;
  return (d.length === 11 && d[0] === "0") ? d : null;
}
const _DUP_TITLES = /^(mr|mrs|ms|miss|dr|prof)\.?$/i;
const _DUP_COMPANY = /\b(ltd|limited|plc|llp|centre|center|trade|parts|services|company|consultants|garage|motors|cars|valeting|bodywork|deli|conditioning|prestige)\b/i;
const _DUP_CATCHALL = /\b(cash|account|sundry|misc|unknown|test|sale|estimate)\b/i;
const _surnameKey = (name: string) => { const w = String(name || "").trim().split(/\s+/).filter((x) => !_DUP_TITLES.test(x)); return (w[w.length - 1] || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 5); };
const _surnameFull = (name: string) => { const w = String(name || "").trim().split(/\s+/).filter((x) => !_DUP_TITLES.test(x)); return (w[w.length - 1] || "").toLowerCase().replace(/[^a-z]/g, ""); };
function _lev(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
// Two names are likely the SAME person if their surnames match closely (exact, prefix, or a tiny edit distance — covers "Hakkimian"/"Hakimian").
function _likelySamePerson(a: string, b: string): boolean {
  const sa = _surnameFull(a), sb = _surnameFull(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  if (sa.length >= 4 && sb.length >= 4 && (sa.startsWith(sb) || sb.startsWith(sa))) return true;
  const maxLen = Math.max(sa.length, sb.length);
  return maxLen >= 4 && _lev(sa, sb) <= (maxLen >= 7 ? 2 : 1);
}

/** Customer records that share a phone number — grouped for manual review/merge. */
export async function getDuplicateGroups() {
  const db = await getDb();
  if (!db) return [];
  await db.execute(sql`CREATE TABLE IF NOT EXISTS duplicateDismissals (phone VARCHAR(20) PRIMARY KEY, dismissedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  const custs = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, accountNumber: customers.accountNumber }).from(customers);
  const byPhone = new Map<string, any[]>();
  for (const cu of custs) { const p = normPhoneKey(cu.phone); if (!p) continue; if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p)!.push(cu); }
  const groups = Array.from(byPhone.entries()).filter(([, g]: [string, any[]]) => g.length >= 2);
  const dismissed = new Set<string>((((await db.execute(sql`SELECT phone FROM duplicateDismissals`)) as any).rows || []).map((r: any) => r.phone)); // pg returns { rows }, not [rows, fields]
  const ids = groups.flatMap(([, g]: [string, any[]]) => g.map((x: any) => x.id));
  const docCnt = new Map<number, number>(), vehCnt = new Map<number, number>();
  if (ids.length) {
    for (const r of await db.select({ id: serviceHistory.customerId, n: sql<number>`COUNT(*)` }).from(serviceHistory).where(inArray(serviceHistory.customerId, ids)).groupBy(serviceHistory.customerId)) docCnt.set(r.id as number, Number(r.n));
    for (const r of await db.select({ id: vehicles.customerId, n: sql<number>`COUNT(*)` }).from(vehicles).where(inArray(vehicles.customerId, ids)).groupBy(vehicles.customerId)) vehCnt.set(r.id as number, Number(r.n));
  }
  const out = groups.filter(([p]: [string, any[]]) => !dismissed.has(p)).map(([phone, g]: [string, any[]]) => {
    const members: any[] = g.map((x: any) => ({ id: x.id, name: x.name || "(no name)", acct: x.accountNumber || null, docs: docCnt.get(x.id) || 0, vehicles: vehCnt.get(x.id) || 0 }))
      .sort((a: any, b: any) => b.docs - a.docs || a.id - b.id);
    // cluster records that look like the same person (fuzzy surname) so we can pre-tick the likely match
    const clusters: any[] = [];
    for (const m of members) { const cl = clusters.find((c: any) => _likelySamePerson(c.name, m.name)); if (cl) cl.members.push(m); else clusters.push({ name: m.name, members: [m] }); }
    clusters.forEach((c: any, i: number) => c.members.forEach((m: any) => (m.cluster = i)));
    const multi = clusters.filter((c: any) => c.members.length >= 2)
      .sort((a: any, b: any) => b.members.reduce((s: number, m: any) => s + m.docs + m.vehicles, 0) - a.members.reduce((s: number, m: any) => s + m.docs + m.vehicles, 0));
    // Don't pre-tick a suggested merge whose members span DIFFERENT GA4 account numbers — those
    // are distinct accounts (e.g. ROS013 vs SHA019), not the same person, however close the names.
    const acctsOf = (ms: any[]) => Array.from(new Set(ms.map((m: any) => String(m.acct || "").trim().toUpperCase()).filter(Boolean)));
    const suggestedIds: number[] = (multi[0] && acctsOf(multi[0].members).length <= 1) ? multi[0].members.map((m: any) => m.id) : [];
    return { phone, members, suggestedIds, activity: members.reduce((s: number, m: any) => s + m.docs + m.vehicles, 0) };
  }).sort((a: any, b: any) => (b.suggestedIds.length ? 1 : 0) - (a.suggestedIds.length ? 1 : 0) || b.activity - a.activity);
  return out;
}

/** Merge secondary customer records into a primary (re-points all refs, unions contacts, records aliases). */
export async function mergeCustomerRecords(primaryId: number, secondaryIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  secondaryIds = secondaryIds.filter((id) => id && id !== primaryId);
  if (!secondaryIds.length) return { moved: 0 };
  const FK = [serviceHistory, vehicles, reminders, reminderLogs, payments, customerLogs, customerMessages, appointments];
  const recs = await db.select().from(customers).where(inArray(customers.id, [primaryId, ...secondaryIds]));
  const primary: any = recs.find((r) => r.id === primaryId);
  const secs = secondaryIds.map((id) => recs.find((r) => r.id === id)).filter(Boolean) as any[];
  if (!primary || !secs.length) throw new Error("customer(s) not found");
  // Account-number guard (Layer B): records with DIFFERENT non-empty GA4 account numbers are
  // genuinely different accounts and must never be fused, even on a shared phone — this is the
  // exact Shah/Rosenfelder-class mis-merge (ROS013 ≠ SHA019) that motivated the safeguard.
  const distinctAccts = Array.from(new Set([primary, ...secs].map((r: any) => String(r.accountNumber || "").trim().toUpperCase()).filter(Boolean)));
  if (distinctAccts.length > 1)
    throw new Error(`Won't merge across different GA4 account numbers (${distinctAccts.join(" ≠ ")}). These are distinct accounts — use "Not duplicates" if they really are separate.`);
  let moved = 0;
  for (const t of FK) { const r: any = await db.update(t as any).set({ customerId: primaryId }).where(inArray((t as any).customerId, secondaryIds)); moved += (r as any).rowsAffected ?? (r as any)[0]?.affectedRows ?? 0; }
  const parse = (x: any) => { try { return typeof x === "string" ? JSON.parse(x) : (x || []); } catch { return []; } };
  const all = [primary, ...secs];
  const hasTitle = (n: string) => _DUP_TITLES.test(String(n || "").trim().split(/\s+/)[0] || "");
  const name = all.map((r) => r.name).filter(Boolean).sort((a, b) => ((hasTitle(b) ? 1e3 : 0) + b.length) - ((hasTitle(a) ? 1e3 : 0) + a.length))[0] || primary.name;
  const pick = (f: string) => primary[f] || secs.map((s) => s[f]).find(Boolean) || null;
  // Opt-out must be sticky: if ANY merged record opted out, the survivor stays opted out
  // (otherwise folding an opted-out duplicate into an opted-in record would silently
  // re-enable reminders for someone who sent STOP). Keep the earliest opt-out timestamp.
  const optedOut = all.some((r: any) => r.optedOut) ? 1 : 0;
  const optedOutAt = optedOut
    ? (all.map((r: any) => r.optedOutAt).filter(Boolean).map((d: any) => new Date(d)).sort((a: any, b: any) => a.getTime() - b.getTime())[0] ?? new Date())
    : null;
  const seen = new Set<string>(), alt: any[] = [];
  for (const r of all) for (const ct of parse(r.altContacts)) { const k = String(ct.phone || ct.name || "").replace(/\s+/g, "").toLowerCase(); if (k && !seen.has(k)) { seen.add(k); alt.push({ name: ct.name || "", phone: ct.phone || "" }); } }
  const aliases = new Set<string>(parse(primary.mergedExternalIds));
  for (const s of secs) { for (const a of parse(s.mergedExternalIds)) aliases.add(a); if (s.externalId && !String(s.externalId).startsWith("WEB-")) aliases.add(s.externalId); }
  await db.update(customers).set({ name, phone: pick("phone"), email: pick("email"), address: pick("address"), postcode: pick("postcode"), optedOut, optedOutAt, altContacts: alt.length ? alt : null, mergedExternalIds: aliases.size ? Array.from(aliases) : null }).where(eq(customers.id, primaryId));
  await db.delete(customers).where(inArray(customers.id, secondaryIds));
  return { moved, primaryId, merged: secondaryIds.length, name };
}

/** Mark a shared-phone group as "not duplicates" so it stops appearing in the review list. */
export async function dismissDuplicateGroup(phone: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.execute(sql`CREATE TABLE IF NOT EXISTS duplicateDismissals (phone VARCHAR(20) PRIMARY KEY, dismissedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(sql`INSERT INTO duplicateDismissals (phone) VALUES (${phone}) ON CONFLICT (phone) DO NOTHING`); // pg syntax (was MySQL INSERT IGNORE)
  return { dismissed: phone };
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
  const [{ id }] = await db.insert(descriptionPresets).values({ title: input.title, body: input.body, category: input.category ?? null }).returning({ id: descriptionPresets.id });
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
  if (vehicleId) logConds.push(inArray(customerLogs.vehicleId, await getVehicleIdsForSamePlate(db, vehicleId)));
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
  }).returning({ id: customerLogs.id });
  return { id };
}

const DOC_TYPE_LABEL: Record<string, string> = { SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note", XS: "Excess Invoice", PA: "Payment", VS: "Vehicle Sale", VP: "Vehicle Purchase" };

/** Record a document lifecycle event (created / printed / issued / emailed) in the activity log.
 *  Best-effort: never throws, so it can't break the underlying action. */
export async function logDocEvent(documentId: number, verb: string, by?: string | null) {
  try {
    const db = await getDb();
    if (!db) return;
    const d = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, documentId)).limit(1))[0];
    if (!d) return;
    const label = DOC_TYPE_LABEL[d.docType as string] || d.docType || "Document";
    await addCustomerLog({
      customerId: d.customerId ?? undefined, vehicleId: d.vehicleId ?? undefined, documentId,
      type: "system", direction: "internal",
      subject: `${label} ${verb}`,
      body: `${label} ${d.docNo ? `#${d.docNo}` : `#${documentId}`} ${verb}`,
      createdBy: by ?? null,
    } as any);
  } catch { /* logging must never break the action */ }
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
  docStatus?: string; orderRef?: string; department?: string; terms?: string; description?: string; insuranceCompany?: string;
  staffSalesPerson?: string; staffTechnician?: string; staffRoadTester?: string; staffMotTester?: string;
  motClass?: string; motStatus?: string;
  lineItems?: Array<Record<string, any>>;
}

const undef = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Mint a new GA4-style account number: first 3 letters of the surname (uppercase) + the
 * next unused 3-digit sequence for that prefix — e.g. "Stone" -> STO014 if STO001..STO013
 * are already taken. Format reverse-engineered from real GA4-synced customer records
 * (ROS013, SHA019, MAL014/MAL018/MAL006 for three different "Mal-" surnames, etc.). */
async function generateAccountNumber(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, name: string, surname?: string) {
  const source = (surname || name.trim().split(/\s+/).pop() || name).replace(/[^A-Za-z]/g, "");
  const prefix = (source.slice(0, 3) || "CUS").toUpperCase().padEnd(3, "X");

  const [fromCustomers, fromDocs] = await Promise.all([
    db.select({ accountNumber: customers.accountNumber }).from(customers).where(ilike(customers.accountNumber, `${prefix}%`)),
    db.select({ accountNumber: serviceHistory.accountNumber }).from(serviceHistory).where(ilike(serviceHistory.accountNumber, `${prefix}%`)),
  ]);

  let max = 0;
  for (const row of [...fromCustomers, ...fromDocs]) {
    const digits = String(row.accountNumber || "").slice(3).replace(/\D/g, "");
    if (digits) max = Math.max(max, parseInt(digits, 10));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

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
      // Only overwrite fields with a real value — never blank out an existing vehicle's details
      // (e.g. an auto-save firing in the gap between setting the reg and the lookup filling make/model).
      const vfUpd = Object.fromEntries(Object.entries(vf).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      if (Object.keys(vfUpd).length) await db.update(vehicles).set(vfUpd).where(eq(vehicles.id, existing.id));
    } else {
      const [{ id }] = await db.insert(vehicles).values({ registration: input.registration.toUpperCase(), ...vf } as any).returning({ id: vehicles.id });
      vehicleId = id;
    }
  }

  // 1b) create a new customer from entered details when requested
  let accountNumber = input.accountNumber;
  if (!input.customerId && input.createCustomer && input.customerName) {
    const hadOwner = customerId != null;
    const address = [input.custHouseNo, input.custRoad, input.custLocality, input.custTown, input.custCounty].filter(Boolean).join(", ");
    if (!accountNumber) accountNumber = await generateAccountNumber(db, input.customerName, input.custSurname);
    const [{ id }] = await db.insert(customers).values({
      name: input.customerName,
      email: input.custEmail || null,
      phone: input.custMobile || input.custTelephone || null,
      postcode: input.custPostcode || null,
      address: address || null,
      accountNumber,
      externalId: `WEB-CUST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    } as any).returning({ id: customers.id });
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
  const totalNet = round2(items.reduce((a, i) => a + (Number(i.subNet) || 0), 0));
  const totalTax = round2(items.reduce((a, i) => a + (Number(i.taxAmount) || 0), 0));
  const totalGross = round2(totalNet + totalTax);

  // 3) document fields
  const docFields: any = undef({
    // Manually-set document number (to match an external system e.g. GA4). When omitted,
    // a new doc gets the next auto number and an existing doc keeps its current number.
    docNo: input.docNo != null && String(input.docNo).trim() ? String(input.docNo).trim().slice(0, 50) : undefined,
    docType, vehicleId, customerId: input.customerId ?? customerId, registration: input.registration ? input.registration.toUpperCase() : undefined,
    customerName: input.customerName || [input.custTitle, input.custForename, input.custSurname].filter(Boolean).join(" ") || undefined,
    custTitle: input.custTitle, custForename: input.custForename, custSurname: input.custSurname,
    company: input.company, accountNumber,
    custHouseNo: input.custHouseNo, custRoad: input.custRoad, custLocality: input.custLocality,
    custTown: input.custTown, custCounty: input.custCounty, custPostcode: input.custPostcode,
    custTelephone: input.custTelephone, custMobile: input.custMobile, custEmail: input.custEmail,
    mileage: input.mileage, dateCreated: input.dateCreated ? new Date(input.dateCreated) : undefined,
    dateIssued: input.dateIssued ? new Date(input.dateIssued) : undefined,
    docStatus: input.docStatus, orderRef: input.orderRef, department: input.department, terms: input.terms, insuranceCompany: input.insuranceCompany,
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
    const docNo = docFields.docNo || await getNextDocNo(docType);
    const externalId = `WEB-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // new docs always get a creation date (so the list never shows a blank date)
    const [{ id }] = await db.insert(serviceHistory).values({ ...docFields, docNo, externalId, dateCreated: docFields.dateCreated ?? new Date(), balance: String(totalGross.toFixed(2)) }).returning({ id: serviceHistory.id });
    docId = id;
    await logDocEvent(docId!, "created"); // audit: new document
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
      discount: i.discount != null ? String(i.discount) : null, discountType: i.discountType ?? null,
    })) as any);
  }
  return { id: docId, customerId, accountNumber };
}

/** Convert a document to another type (Estimate↔Job Sheet↔Invoice…), copying all data into a new document. */
export async function convertDocument(id: number, toType: string) {
  const detail = await getDocumentDetail(id);
  if (!detail?.doc) throw new Error("Document not found");
  const { doc, vehicle, customer, lineItems } = detail as any;
  const created = await saveDocument({
    docType: toType,
    registration: vehicle?.registration || doc.registration,
    customerId: doc.customerId ?? undefined,
    vehicle: vehicle ? {
      make: vehicle.make, model: vehicle.model, colour: vehicle.colour, fuelType: vehicle.fuelType,
      engineCC: vehicle.engineCC, engineNo: vehicle.engineNo, engineCode: vehicle.engineCode, vin: vehicle.vin,
      derivative: vehicle.derivative, paintCode: vehicle.paintCode, keyCode: vehicle.keyCode, radioCode: vehicle.radioCode,
    } : undefined,
    // doc.customerName is the document's own denormalized snapshot, which is blank on plenty of
    // real GA4-synced rows — fall back so a convert never carries a blank name into the new doc.
    customerName: doc.customerName || [doc.custTitle, doc.custForename, doc.custSurname].filter(Boolean).join(" ") || customer?.name || undefined,
    company: doc.company, accountNumber: doc.accountNumber,
    custHouseNo: doc.custHouseNo, custRoad: doc.custRoad, custLocality: doc.custLocality, custTown: doc.custTown,
    custCounty: doc.custCounty, custPostcode: doc.custPostcode, custTelephone: doc.custTelephone,
    custMobile: doc.custMobile, custEmail: doc.custEmail,
    mileage: doc.mileage, description: doc.description, orderRef: doc.orderRef, department: doc.department, terms: doc.terms,
    staffSalesPerson: doc.staffSalesPerson, staffTechnician: doc.staffTechnician, staffRoadTester: doc.staffRoadTester,
    staffMotTester: doc.staffMotTester, motClass: doc.motClass, motStatus: doc.motStatus, insuranceCompany: doc.insuranceCompany, docStatus: "New",
    lineItems: (lineItems || []).map((li: any) => ({
      itemType: li.itemType, description: li.description, partNumber: li.partNumber, nominalCode: li.nominalCode,
      quantity: li.quantity, unitPrice: li.unitPrice, vatRate: li.vatRate, subNet: li.subNet, taxAmount: li.taxAmount,
      discount: li.discount, discountType: li.discountType, // carry the per-line discount across convert/copy
    })),
  });

  // "Convert to Invoice/Job Sheet" supersedes the original; "Copy to Estimate/Credit Note" keeps it.
  // On a convert, remove the source so it isn't left behind as a duplicate — but only a web-created
  // working doc (job sheet / estimate). Never auto-delete invoices/credit notes, and never a
  // GA4-mirrored doc (the sync owns those and would just recreate it).
  const isConvert = toType === "SI" || toType === "JS";
  const sourceIsWorkingDoc = doc.docType === "JS" || doc.docType === "ES";
  const sourceIsWeb = !doc.externalId || String(doc.externalId).startsWith("WEB-");
  const replacedSource = isConvert && sourceIsWorkingDoc && sourceIsWeb && !!created?.id && created.id !== id;
  if (replacedSource) {
    const db = await getDb();
    if (db) await db.update(payments).set({ documentId: created.id! }).where(eq(payments.documentId, id)); // keep any receipts
    await deleteServiceDocument(id);
  }
  return { ...created, replacedSource };
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

// ---------------------------------------------------------------------------
// GA4 number pool — hand a real GA4 invoice number to a printing doc INSTANTLY.
// Numbers are reserved ahead of demand (each backed by a pre-created blank GA4 draft);
// the Mac worker fills+issues the reserved draft in the background. See create-invoice.md.
// ---------------------------------------------------------------------------

/** Atomically claim the lowest available reserved GA4 number for this document.
 *  FOR UPDATE SKIP LOCKED makes concurrent issues safe (no two grab the same number).
 *  Returns the number, or null if the pool is empty (caller should alert + backfill). */
export async function popGa4Number(documentId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const res: any = await db.execute(sql`
    UPDATE "ga4NumberPool" SET status='claimed', "claimedByDocId"=${documentId}, "claimedAt"=now(), "updatedAt"=now()
    WHERE id = (
      SELECT p.id FROM "ga4NumberPool" p WHERE p.status='available'
        AND NOT EXISTS (
          SELECT 1 FROM "serviceHistory" sh
          WHERE (sh."docNo" = p."ga4Number" OR sh."ga4Number" = p."ga4Number")
            AND sh.id <> ${documentId}
        )
      ORDER BY (p."ga4Number")::bigint ASC
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING "ga4Number"`);
  return (res.rows?.[0]?.ga4Number as string | undefined) ?? null;
}

/** Add reserved numbers to the pool (called by the worker/seeder after pre-creating blank GA4
 *  drafts). Idempotent on ga4Number (ON CONFLICT DO NOTHING). */
export async function addPoolNumbers(entries: Array<{ ga4Number: string; ga4DraftExternalId?: string }>) {
  const db = await getDb();
  if (!db || !entries.length) return { added: 0 };
  const rows = entries.map((e) => ({ ga4Number: String(e.ga4Number), ga4DraftExternalId: e.ga4DraftExternalId ?? null }));
  const r: any = await db.insert(ga4NumberPool).values(rows as any).onConflictDoNothing().returning({ id: ga4NumberPool.id });
  return { added: Array.isArray(r) ? r.length : 0 };
}

/** Pool health: counts by status + how many are ready to hand out (for depth monitoring/replenish). */
export async function getPoolStatus() {
  const db = await getDb();
  if (!db) return { available: 0, claimed: 0, filled: 0, failed: 0, dead: 0 };
  const rows = await db.select({ status: ga4NumberPool.status, n: sql<number>`COUNT(*)` }).from(ga4NumberPool).groupBy(ga4NumberPool.status);
  const out: Record<string, number> = { available: 0, claimed: 0, filled: 0, failed: 0, dead: 0 };
  for (const r of rows) out[r.status as string] = Number(r.n);
  return out as { available: number; claimed: number; filled: number; failed: number; dead: number };
}

/** The safety net the pool code always assumed but never had ("getPoolStatus()/monitor should
 *  alert and the worker backfills"). A reserved number is claimed at web-issue time (popGa4Number),
 *  but the GA4 draft is only filled+issued later; if that fill never happens the web invoice carries
 *  a ga4Number pointing at a blank GA4 shell — silently. This returns that worklist: pool rows
 *  claimed/failed, never filled, older than `minAgeHours`, AND with no real GA4-imported invoice of
 *  that number yet (so a filled-but-not-yet-reconciled number auto-drops off once GA4 sync imports it).
 *  Read-only. Consumed by the /api/cron/ga4-pool-check monitor. */
export async function getStuckGa4Claims(minAgeHours = 24) {
  const db = await getDb();
  if (!db) return [] as any[];
  const res: any = await db.execute(sql`
    SELECT p."ga4Number", p.status, p.attempts, p."claimedByDocId", p."claimedAt",
           ROUND(EXTRACT(EPOCH FROM (now() - p."claimedAt")) / 3600)::int AS "ageHours",
           sh."docNo", sh."registration", COALESCE(NULLIF(sh."customerName", ''), c.name) AS "customerName", sh."totalGross", sh."docStatus"
      FROM "ga4NumberPool" p
      LEFT JOIN "serviceHistory" sh ON sh.id = p."claimedByDocId"
      LEFT JOIN "customers" c ON c.id = sh."customerId"
     WHERE p.status IN ('claimed','failed')
       AND p."filledAt" IS NULL
       AND p."claimedAt" < now() - (${String(minAgeHours)} || ' hours')::interval
       AND NOT EXISTS (
         SELECT 1 FROM "serviceHistory" g
          WHERE g."docNo" = p."ga4Number"
            AND (g."externalId" IS NULL OR g."externalId" NOT LIKE 'WEB-%')
       )
     ORDER BY p."claimedAt" ASC`);
  return (res.rows ?? []) as Array<{
    ga4Number: string; status: string; attempts: number; claimedByDocId: number | null;
    claimedAt: string; ageHours: number; docNo: string | null; registration: string | null;
    customerName: string | null; totalGross: string | null; docStatus: string | null;
  }>;
}

/** Mark a document as issued (locks it in, stamps dateIssued + status, recomputes balance).
 *  On issuing an invoice we also POP a reserved GA4 number so the printed document carries the
 *  real GA4 number instantly; the claimed pool row becomes the worker's fill queue. */
export async function issueDocument(documentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const doc = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, documentId)).limit(1))[0];
  if (!doc) throw new Error("Document not found");
  const set: any = {};
  if (!doc.dateIssued) set.dateIssued = new Date();
  const { balance, receipts } = await recomputeDocBalance(documentId);
  set.docStatus = balance <= 0 && (receipts > 0 || Number(doc.totalGross) === 0) ? "Paid" : "Issued";
  // Instant GA4 number for the printed doc. Only for invoice-type docs (SI/XS), only once,
  // and only for web-created records (GA4-imported docs already have their real number).
  if (!doc.ga4Number && (doc.docType === "SI" || doc.docType === "XS") && String(doc.externalId || "").startsWith("WEB-")) {
    const n = await popGa4Number(documentId);
    if (n) set.ga4Number = n;
    // Pool empty → leave ga4Number null; getPoolStatus()/monitor should alert and the worker
    // backfills. The doc is still issued; its number just gets stamped when the pool refills.
  }
  await db.update(serviceHistory).set(set).where(eq(serviceHistory.id, documentId));
  return { id: documentId, status: set.docStatus, ga4Number: set.ga4Number ?? doc.ga4Number ?? null };
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

  // auto-wire: if the bill-to company looks like an insurer and none is recorded yet, treat it
  // as the insurance bill-to on the main invoice. The XS then bills the person (owner), so don't
  // carry the insurer's company name onto the excess invoice.
  const insurer = (String(main.insuranceCompany || "").trim() || (detectInsurer(main.company) ? main.company : "")) || null;
  const xsCompany = detectInsurer(main.company) ? null : main.company;

  // main.customerName is the document's own denormalized snapshot, which is blank on plenty of
  // real GA4-synced rows even though customerId correctly links to a customer — fall back so the
  // excess invoice doesn't inherit a blank name.
  let mainCustomerName = main.customerName || [main.custTitle, main.custForename, main.custSurname].filter(Boolean).join(" ") || null;
  if (!mainCustomerName && main.customerId) {
    const linked = (await db.select({ name: customers.name }).from(customers).where(eq(customers.id, main.customerId)).limit(1))[0];
    mainCustomerName = linked?.name || null;
  }

  const discount = Math.max(0, Number(input.discount) || 0);
  const net = round2(Math.max(0, Number(input.excessNet) || 0) - discount);
  const vatRate = input.vatRegistered ? 20 : 0;
  const tax = round2(net * vatRate / 100);
  const gross = round2(net + tax);

  // 1) create the excess invoice (XS) for the customer
  const docNo = await getNextDocNo("XS");
  const externalId = `WEB-XS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const xsFields: any = undef({
    docType: "XS", docNo, externalId,
    customerId: main.customerId, vehicleId: main.vehicleId, registration: main.registration,
    customerName: mainCustomerName, custTitle: main.custTitle, custForename: main.custForename, custSurname: main.custSurname,
    custEmail: main.custEmail, company: xsCompany, accountNumber: main.accountNumber,
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
  const [{ id: xsId }] = await db.insert(serviceHistory).values(xsFields).returning({ id: serviceHistory.id });
  await db.insert(serviceLineItems).values({
    documentId: xsId, externalId: `WEB-LI-XS-${xsId}-${Date.now()}`,
    itemType: "Excess", description: `Insurance policy excess (re. Invoice ${main.docNo})`,
    quantity: "1", unitPrice: String(net.toFixed(2)), subNet: String(net.toFixed(2)),
    taxAmount: String(tax.toFixed(2)), vatRate: String(vatRate.toFixed(2)),
  } as any);

  // 2) record the excess on the main invoice and deduct it (insurer pays the reduced amount),
  //    and stamp the insurer as the main invoice's bill-to so it prints/bills to the insurer
  await db.update(serviceHistory).set({
    relatedDocId: xsId, relatedDocNo: docNo, insuranceCompany: insurer,
    excessNet: String(net.toFixed(2)), excessTax: String(tax.toFixed(2)), excessGross: String(gross.toFixed(2)),
  }).where(eq(serviceHistory.id, main.id));
  await recomputeDocBalance(main.id);

  await logDocEvent(xsId, "created"); // audit: excess invoice raised
  return { id: xsId, docNo };
}

/** Recompute an existing XS excess invoice's figures (and its main invoice's excess) after editing. */
export async function updateExcessInvoice(input: { docId: number; excessNet: number; discount?: number; vatRegistered?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const xs = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, input.docId)).limit(1))[0];
  if (!xs) throw new Error("Excess invoice not found");
  const discount = Math.max(0, Number(input.discount) || 0);
  const net = round2(Math.max(0, Number(input.excessNet) || 0) - discount);
  const vatRate = input.vatRegistered ? 20 : 0;
  const tax = round2(net * vatRate / 100);
  const gross = round2(net + tax);

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

    const [result] = await tx.insert(serviceHistory).values(docToInsert).returning({ id: serviceHistory.id });
    const documentId = result.id;

    if (items.length > 0) {
      const itemsToInsert = items.map(item => ({
        ...item,
        documentId,
        externalId: item.externalId || `ITEM-${nanoid()}`,
      }));
      await tx.insert(serviceLineItems).values(itemsToInsert);
    }

    return { id: documentId };
  }).then(async (r) => { await logDocEvent(r.id, "created"); return r; });
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

export async function getRichPDF(documentId: number, opts?: { customerCopyOnly?: boolean }) {
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

  // who the invoice is addressed to: the insurer on a main insurance invoice, else the customer
  const billTo = (doc.docType !== 'XS' && (doc as any).insuranceCompany) ? String((doc as any).insuranceCompany) : null;
  // Use the details stored ON the document (what the form shows) first — a walk-in typed straight
  // onto a job sheet has no linked customer record but still has a name/address/phone — then fall
  // back to the linked customer. Prevents "Unknown Client" on a sheet that clearly has a customer.
  const d2: any = doc;
  const docName = [d2.custTitle, d2.custForename, d2.custSurname].filter(Boolean).join(" ").trim();
  // Street lines WITHOUT the postcode — otherwise a doc that only has a postcode makes docStreet
  // truthy and blocks the fallback to the linked customer's full address. Postcode appended below.
  const docStreet = [d2.custHouseNo, d2.custRoad, d2.custLocality, d2.custTown, d2.custCounty].filter(Boolean).join(", ");
  const docPostcode = String(d2.custPostcode || customer?.postcode || "").trim();
  // Some imported records have the whole address (town, postcode and all) crammed into a single
  // free-text field like custRoad — splitting that on commas can repeat the town or the postcode
  // as its own line. Dedupe case/space-insensitively, and skip appending the postcode again if a
  // line already IS it, so we never print e.g. "London" or "NW4 1HD" twice.
  const normAddrPart = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  // Collect EVERY number we hold for this customer — the doc's mobile/tel, the linked
  // customer's primary phone, and any "Other numbers" (altContacts) — so the printed sheet
  // shows all of them. Dedupe on the digits (treating +44… and 0… as the same UK number).
  const normPhone = (s: any) => {
    let d = String(s ?? '').replace(/\D/g, '');
    if (d.startsWith('44')) d = '0' + d.slice(2);
    return d;
  };
  const phones: { label?: string; value: string }[] = [];
  const seenPhones = new Map<string, number>(); // normalised number -> index in phones
  // "Mobile"/"Tel" are placeholders for whoever owns the doc/customer record — if the SAME
  // number later shows up in altContacts with an actual person's name (e.g. this job's mobile
  // turns out to be "Elaine"), that name is far more useful on a printed sheet, so it replaces
  // the placeholder instead of being silently dropped as a duplicate.
  const GENERIC_LABELS = new Set(['Mobile', 'Tel']);
  const addPhone = (value: any, label?: string) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    const key = normPhone(v);
    if (!key) return;
    const cleanLabel = (label || '').trim() || undefined;
    const existingIdx = seenPhones.get(key);
    if (existingIdx !== undefined) {
      const existing = phones[existingIdx];
      if (cleanLabel && !GENERIC_LABELS.has(cleanLabel) && (!existing.label || GENERIC_LABELS.has(existing.label))) {
        existing.label = cleanLabel;
      }
      return;
    }
    seenPhones.set(key, phones.length);
    phones.push({ label: cleanLabel, value: v });
  };
  addPhone(d2.custMobile, 'Mobile');
  addPhone(d2.custTelephone, 'Tel');
  addPhone(customer?.phone, 'Tel');
  const altList = Array.isArray((customer as any)?.altContacts) ? (customer as any).altContacts : [];
  for (const ct of altList) addPhone(ct?.phone, ct?.name);

  const addressLines: string[] = [];
  const seenAddrParts = new Set<string>();
  for (const part of (docStreet || customer?.address || '').split(',').map((s: string) => s.trim()).filter(Boolean)) {
    const key = normAddrPart(part);
    if (seenAddrParts.has(key)) continue;
    seenAddrParts.add(key);
    addressLines.push(part);
  }
  if (docPostcode && !seenAddrParts.has(normAddrPart(docPostcode))) addressLines.push(docPostcode);

  const customerData = {
    name: docName || d2.customerName || customer?.name || 'Unknown Client',
    company: String(d2.company || '').trim(),
    address_lines: addressLines,
    mobile: d2.custMobile || d2.custTelephone || customer?.phone || '',
    phones,
    billTo,
  };

  // Technical info for the boxed row. Use the SAME live source as the on-screen cards
  // (oil/aircon from the tech cache, MOT/tax live from DVLA) so the printed row matches what's
  // shown — the raw vehicle record often has no cached oil/aircon, which left the row blank.
  let lt: any = null;
  try { lt = vehicle?.registration ? await liveVehicleTech(vehicle.registration) : null; } catch { /* fall back to the record */ }
  const td = (vehicle?.comprehensiveTechnicalData as any) || {};
  const recOil = (td.lubricants || []).find((l: any) => /engine oil/i.test(l?.description || ""));
  const oilSpec = lt?.oilSpec || recOil?.specification || "";
  const oilCap = lt?.oilCapacity || recOil?.capacity || "";
  // All distinct grades the engine accepts (for the job sheet) — prefer the live tech result,
  // fall back to deriving from the cached record's lubricants, then to the single spec.
  const gradeOf = (s: any) => (String(s).match(/\b\d+W[-\s]?\d+\b/i) || [])[0]?.toUpperCase().replace(/\s+/g, "") || "";
  let oilGrades: string[] = Array.isArray(lt?.oilGrades) ? lt.oilGrades : [];
  let oilPreferred: string[] = Array.isArray(lt?.oilPreferred) ? lt.oilPreferred : [];
  if (!oilGrades.length) {
    const recOils = (td.lubricants || []).filter((l: any) => /engine oil/i.test(l?.description || ""));
    const prefG = Array.from(new Set(recOils.filter((o: any) => /preferred/i.test(o?.description || "")).map((o: any) => gradeOf(o.specification)).filter(Boolean))) as string[];
    const allG = Array.from(new Set(recOils.map((o: any) => gradeOf(o.specification)).filter(Boolean))) as string[];
    oilGrades = [...prefG, ...allG.filter((g) => !prefG.includes(g))];
    oilPreferred = prefG;
  }
  if (!oilGrades.length) { const g = gradeOf(oilSpec); if (g) oilGrades = [g]; }
  const airType = lt?.airconType || td.aircon?.type || "";
  const airQty = lt?.airconCapacity ?? td.aircon?.quantity ?? td.aircon?.capacity ?? "";
  const motRaw = lt?.motExpiry || vehicle?.motExpiryDate;
  const motExp = motRaw ? new Date(motRaw).toLocaleDateString('en-GB') : "";
  const taxStatus = lt?.taxStatus || vehicle?.taxStatus || "";
  const taxDueRaw = lt?.taxDueDate || vehicle?.taxDueDate;
  const taxDue = taxDueRaw ? new Date(taxDueRaw).toLocaleDateString('en-GB') : "";

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
    // boxed tech row
    engine_oil: oilSpec ? `${oilSpec}${oilCap ? ` ${oilCap}` : ''}` : '',
    oil_grades: oilGrades,
    oil_preferred: oilPreferred,
    oil_capacity: oilCap || '',
    air_con: airType ? `${airType}${airQty ? ` ${airQty}` : ''}` : '',
    mot_expiry: motExp,
    tax_info: taxStatus ? `${taxStatus}${taxDue ? ` · due ${taxDue}` : ''}` : (taxDue ? `Due ${taxDue}` : ''),
  };

  // Discount shown in the "D" column: "10%" for a percentage, else the £ knocked off the line.
  const discCell = (i: any) => {
    const dv = Number(i.discount) || 0;
    if (dv <= 0) return '';
    if (i.discountType === 'amt') return '-£' + dv.toFixed(2); // legacy/GA4 + new % both render as a percentage
    return `${dv}%`;
  };
  const labour = items.filter(i => i.itemType === 'Labour').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    unit: Number(i.unitPrice),
    d: discCell(i),
    subtotal: Number(i.subNet),
  }));

  const parts = items.filter(i => i.itemType === 'Part').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    unit: Number(i.unitPrice),
    d: discCell(i),
    subtotal: Number(i.subNet),
  }));

  const motItems = items.filter(i => i.itemType === 'MOT').map(i => ({
    description: i.description,
    qty: Number(i.quantity),
    status: '',
  }));

  // "Extras" categories (entered as single amounts on the job sheet)
  const sumNet = (t: string) => items.filter(i => i.itemType === t).reduce((a, i) => a + (Number(i.subNet) || 0), 0);
  const sundries = sumNet('Sundries'), lubricants = sumNet('Lubricant'), paint = sumNet('Paint');
  // MOT fee is zero-rated and must be shown as its own line. Prefer a MOT line item, else
  // fall back to the document-level Sub MOT Net (synced invoices keep it there, not as a line).
  const motNet = sumNet('MOT') || Number((doc as any).subMotNet) || 0;
  const isInvoice = doc.docType === 'SI' || doc.docType === 'XS';
  const excess = doc.docType === 'XS' ? 0 : (Number(doc.excessGross) || 0); // deducted from a main insurance invoice
  const receipts = Number(doc.totalReceipts) || 0;
  const totalGross = Number(doc.totalGross) || 0;
  // Total £ knocked off across all discounted lines (subNet is already net of the line discount).
  const discountTotal = +items.reduce((a, i) => {
    const base = (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    return a + Math.max(0, base - (Number(i.subNet) || 0));
  }, 0).toFixed(2);

  const totals = {
    labour: labour.reduce((acc, i) => acc + i.subtotal, 0),
    parts: parts.reduce((acc, i) => acc + i.subtotal, 0),
    sundries, lubricants, paint,
    discount: discountTotal > 0 ? discountTotal : null,
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
  const descLines = (doc.description || '').split('\n'); // keep blank lines for paragraph spacing
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
        account_no: (doc as any).accountNumber || '',
        order_ref: (doc as any).orderRef || '',
        valid_to: '',
      },
      work_title, work_items,
      labour, parts, totals,
    });
  }

  if (doc.docType === 'JS') {
    const work_description = (doc.description || '').split('\n');
    // The actual parts on the job, so the job sheet lists them (not the description) for ticking off.
    const jsParts = items.filter((i) => i.itemType === 'Part').map((i) => ({
      description: i.description || '',
      partNumber: (i as any).partNumber || '',
      quantity: Number(i.quantity) || 1,
    }));

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
        account_no: (doc as any).accountNumber || '',
        order_ref: (doc as any).orderRef || '',
        receive_date: dateStr,
        due_date: dateStr,
        status: '~',
        technician: '',
      },
      work_description,
      parts: jsParts,
      oil_specs,
      labour_rows: 5,
      parts_rows: 5,
    });
  }

  // Default: Invoice (SI or any other type)
  return generateInvoicePDF({
    company, customer: customerData, vehicle: vehicleData,
    invoice: {
      // Print GA4's authoritative number when we have it (from the number pool / write-back);
      // the web docNo is only a guess-ahead placeholder. See ga4NumberPool / issueDocument.
      number: (doc as any).ga4Number || doc.docNo,
      invoice_date: doc.dateIssued ? new Date(doc.dateIssued).toLocaleDateString('en-GB') : dateStr,
      account_no: (doc as any).accountNumber || '',
      order_ref: (doc as any).orderRef || '',
      date_of_work: dateStr,
      payment_date: doc.datePaid ? new Date(doc.datePaid).toLocaleDateString('en-GB') : '',
      payment_method: (doc as any).paymentMethods || '',
    },
    work_title, work_items,
    mot: motItems.length > 0 ? motItems : undefined,
    labour, parts, totals,
  }, { customerCopyOnly: opts?.customerCopyOnly });
}

/**
 * Generate a Vehicle Service History PDF for all documents associated with a vehicle.
 * With { includeInvoices: true } the full PDF of every invoice is appended after the
 * summary (merged into one document), so the customer gets all their copies in one file.
 */
export async function getServiceHistoryPDF(vehicleId: number, opts?: { includeInvoices?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { generateServiceHistoryPDF } = await import("./pdf-templates");

  const vehicle = await db.select().from(vehicles)
    .where(eq(vehicles.id, vehicleId)).limit(1).then(r => r[0]);
  if (!vehicle) throw new Error("Vehicle not found");

  // A customer-facing service history covers invoiced work only — never job sheets (internal,
  // in-progress) or estimates (quotes). Only SI (invoice) and XS (policy-excess invoice).
  const INVOICE_TYPES = new Set(["SI", "XS"]);
  const allDocs = await db.select().from(serviceHistory)
    .where(inArray(serviceHistory.vehicleId, await getVehicleIdsForSamePlate(db, vehicleId)))
    .orderBy(desc(serviceHistory.dateCreated));
  const docs = allDocs
    .filter((d) => INVOICE_TYPES.has(String(d.docType)))
    // Customer-facing history: only the current owner's invoices. Drop anything explicitly
    // billed to a different customer — pre-sales/sales prep and previous-owner work (e.g. ELI's
    // internal trade account) shouldn't appear on the owner's copy. Unlinked docs are kept.
    .filter((d) => !vehicle.customerId || !d.customerId || d.customerId === vehicle.customerId);

  const cumulative = docs.reduce((s, d) => s + (Number(d.totalGross) || 0), 0);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const num = (x: any) => Number(x) || 0;
  const norm = (x: any) => String(x ?? '').trim();
  const entries = await Promise.all(docs.map(async (d) => {
    const dateObj = d.dateCreated ? new Date(d.dateCreated) : new Date();
    const dateStr = `${String(dateObj.getDate()).padStart(2, '0')} ${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    const mileage = d.mileage ? `${Number(d.mileage).toLocaleString()} MI` : null;

    // Mirror the GA4 Vehicle History Report: the work narrative, then MOT / Labour / Parts
    // sections — but with our prices added and reconciled to the stored totals. The MOT fee is
    // zero-rated (a MOT line or subMotNet); any leftover net gap (sundries) becomes its own
    // part line so the items always sum to the subtotal.
    const items = await getServiceLineItemsByDocumentId(d.id);
    const labour = items.filter((i: any) => i.itemType === 'Labour')
      .map((i: any) => ({ qty: num(i.quantity), label: norm(i.description) || 'Labour', amount: num(i.subNet) }));
    const parts = items.filter((i: any) => i.itemType === 'Part')
      .map((i: any) => ({ qty: num(i.quantity), code: norm(i.partNumber), label: norm(i.description) || 'Part', amount: num(i.subNet) }));
    const other = items.filter((i: any) => !['Labour', 'Part', 'MOT'].includes(String(i.itemType)))
      .map((i: any) => ({ qty: num(i.quantity), code: norm(i.partNumber), label: norm(i.description) || 'Item', amount: num(i.subNet) }));

    const motLineNet = items.filter((i: any) => i.itemType === 'MOT').reduce((a: number, i: any) => a + num(i.subNet), 0);
    const motNet = motLineNet || num((d as any).subMotNet);
    const motStatus = norm(d.motStatus);
    const motClass = norm(d.motClass);
    const mot = motNet > 0
      ? { label: motStatus ? `MOT Full${motClass ? ` ${motClass}` : ''} - ${motStatus}` : 'MOT Test', amount: +motNet.toFixed(2) }
      : (motStatus ? { label: `MOT Full${motClass ? ` ${motClass}` : ''} - ${motStatus}`, amount: 0 } : null);

    const itemsNet = items.reduce((a: number, i: any) => a + num(i.subNet), 0);
    const net = num(d.totalNet) || (itemsNet + motNet);
    const gross = num(d.totalGross) || 0;
    const vat = num(d.totalTax) || Math.max(0, +(gross - net).toFixed(2));
    const gapNet = +(net - (itemsNet + motNet)).toFixed(2);
    if (Math.abs(gapNet) >= 0.01) other.push({ qty: 1, code: '', label: gapNet >= 0 ? 'Other / sundries' : 'Discount', amount: gapNet });

    // Split the narrative into a heading (first non-empty line) + the rest, like GA4.
    const descLines = norm(d.description).split('\n');
    const titleIdx = descLines.findIndex((l) => l.trim());
    const title = titleIdx >= 0 ? descLines[titleIdx].trim() : '';
    const narrative = titleIdx >= 0 ? descLines.slice(titleIdx + 1).join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd() : '';

    return {
      date: dateStr,
      doc_ref: `${d.docType} ${d.ga4Number || d.docNo}`,
      invoice_number: `#${d.ga4Number || d.docNo}`,
      mileage,
      total: `£${(gross || (net + vat)).toFixed(2)}`,
      title,
      narrative,
      mot,
      labour,
      parts: parts.concat(other),
      totals: { net: +net.toFixed(2), vat: +vat.toFixed(2), gross: +(gross || (net + vat)).toFixed(2) },
    };
  }));

  const summary = await generateServiceHistoryPDF({
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
    // When the full invoices are appended, the summary is a brief one-page overview (the detail
    // lives in the invoice copies); on its own it stays the full itemised report.
    compact: !!opts?.includeInvoices,
  });

  if (!opts?.includeInvoices || docs.length === 0) return summary;

  // Append the full PDF of each invoice after the summary, merged into one document so the
  // customer gets all their copies in a single file (newest first, matching the summary order).
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  const append = async (b64: string) => {
    const src = await PDFDocument.load(Buffer.from(b64, "base64"));
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  };
  await append(summary.content);
  for (const d of docs) {
    try { await append((await getRichPDF(d.id, { customerCopyOnly: true })).content); }
    catch (e) { console.error(`[history bundle] skipped invoice ${d.docNo}:`, (e as any)?.message); }
  }
  const content = Buffer.from(await merged.save()).toString("base64");
  return { content, filename: summary.filename.replace(/\.pdf$/i, "_with_invoices.pdf") };
}

export async function deleteServiceDocument(id: number) {
  return deleteDocuments([id]);
}

/** Delete one or more documents and their line items, payments, and dangling excess links. */
export async function deleteDocuments(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const clean = (ids || []).filter((n) => Number.isFinite(n));
  if (!clean.length) return { success: true, deleted: 0 };

  await db.transaction(async (tx) => {
    await tx.delete(serviceLineItems).where(inArray(serviceLineItems.documentId, clean));
    await tx.delete(payments).where(inArray(payments.documentId, clean));
    // remove dangling links from any document that referenced a deleted one (e.g. an
    // insurance invoice ↔ its policy-excess invoice)
    await tx.update(serviceHistory).set({ relatedDocId: null, relatedDocNo: null }).where(inArray(serviceHistory.relatedDocId, clean));
    await tx.delete(serviceHistory).where(inArray(serviceHistory.id, clean));
  });
  return { success: true, deleted: clean.length };
}

export async function getAppSetting(keyName: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(appSettings).where(eq(appSettings.keyName, keyName)).limit(1);
  return result[0]?.value || null;
}

export async function setAppSetting(keyName: string, value: any) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(appSettings).where(eq(appSettings.keyName, keyName)).limit(1);
  if (existing.length) {
    await db.update(appSettings).set({ value, updatedAt: new Date() }).where(eq(appSettings.keyName, keyName));
  } else {
    await db.insert(appSettings).values({ keyName, value });
  }
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

