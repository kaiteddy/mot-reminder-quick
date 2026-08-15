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

/** Same person can exist as more than one `customers` row sharing a phone (see the Duplicates
 * page) — e.g. a fresh GA4 account number was created for a later car instead of reusing the
 * old one. The Duplicates merge tool deliberately refuses to merge those (different account
 * numbers could genuinely mean different people sharing a phone), so a customer's "Linked
 * Vehicles" list would otherwise only ever show whichever account you happened to open. This
 * pulls in vehicles from every customer record sharing the same phone, each tagged with which
 * account it actually belongs to — a read-only view, no records are touched or merged. */
/** The other customer records sharing this one's phone number — same signal used by
 * getVehiclesForCustomerAcrossLinkedAccounts/getServiceHistoryForCustomerAcrossLinkedAccounts,
 * exposed directly so the customer page can offer an explicit, human-confirmed "merge these
 * into this profile" action instead of just a read-only cross-reference. */
export async function getLinkedCustomerAccounts(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  const self = (await db.select({ id: customers.id, phone: customers.phone }).from(customers).where(eq(customers.id, customerId)).limit(1))[0];
  const phoneKey = self ? normPhoneKey(self.phone) : null;
  if (!phoneKey) return [];
  const all = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, accountNumber: customers.accountNumber }).from(customers);
  return all.filter((c) => c.id !== customerId && normPhoneKey(c.phone) === phoneKey);
}

export async function getVehiclesForCustomerAcrossLinkedAccounts(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  const self = (await db.select({ id: customers.id, phone: customers.phone }).from(customers).where(eq(customers.id, customerId)).limit(1))[0];
  if (!self) return [];
  const own = await db.select().from(vehicles).where(eq(vehicles.customerId, customerId));
  const phoneKey = normPhoneKey(self.phone);
  if (!phoneKey) return own.map((v) => ({ ...v, viaAccountId: customerId, viaAccountNumber: null as string | null, viaAccountSame: true }));

  const allCust = await db.select({ id: customers.id, phone: customers.phone, accountNumber: customers.accountNumber }).from(customers);
  const linkedIds = allCust.filter((c) => c.id !== customerId && normPhoneKey(c.phone) === phoneKey).map((c) => c.id);
  const acctById = new Map(allCust.map((c) => [c.id, c.accountNumber] as const));

  const tagged = own.map((v) => ({ ...v, viaAccountId: customerId, viaAccountNumber: acctById.get(customerId) ?? null, viaAccountSame: true }));
  if (!linkedIds.length) return tagged;

  const linkedVehicles = await db.select().from(vehicles).where(inArray(vehicles.customerId, linkedIds));
  const seen = new Set(tagged.map((v) => v.id));
  for (const v of linkedVehicles) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    tagged.push({ ...v, viaAccountId: v.customerId!, viaAccountNumber: acctById.get(v.customerId!) ?? null, viaAccountSame: false });
  }
  return tagged;
}

export async function getRemindersByCustomerId(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminders).where(eq(reminders.customerId, customerId));
}

// Drive distance/time from the garage (49 Victoria Road, Hendon NW4 2RP) to a customer's
// postcode — no API keys: postcodes.io geocodes the UK postcode, OSRM's public router gives
// the driving route. Time is free-flowing (no live traffic), so the UI labels it "~".
// Cached per postcode for the process lifetime — addresses don't move.
const GARAGE_LATLNG = { lat: 51.58854, lng: -0.218356 }; // NW4 2RP, geocoded via postcodes.io
const driveCache = new Map<string, { miles: number; minutes: number } | null>();
export async function getDriveFromGarage(postcode: string) {
  const pc = String(postcode || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) return null;
  if (driveCache.has(pc)) return driveCache.get(pc) ?? null;
  try {
    const geo: any = await fetch(`https://api.postcodes.io/postcodes/${pc}`).then((r) => r.json());
    const lat = geo?.result?.latitude, lng = geo?.result?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") { driveCache.set(pc, null); return null; }
    const route: any = await fetch(`https://router.project-osrm.org/route/v1/driving/${GARAGE_LATLNG.lng},${GARAGE_LATLNG.lat};${lng},${lat}?overview=false`).then((r) => r.json());
    const r0 = route?.routes?.[0];
    if (!r0) { driveCache.set(pc, null); return null; }
    const out = { miles: Math.round((r0.distance / 1609.34) * 10) / 10, minutes: Math.max(1, Math.round(r0.duration / 60)) };
    driveCache.set(pc, out);
    return out;
  } catch { return null; } // third-party hiccup — just omit the drive line rather than error the page
}

/** Unified reminder timeline for a customer's profile page. Two sources merged:
 *  - reminderLogs: actual messages sent by this app (WhatsApp/SMS) — real timestamps, delivery
 *    status, and the message text. Matched by customerId OR recipient phone, since MOT-batch
 *    sends often carry only a vehicleId (see the Mr Tony case).
 *  - reminders: the GA4-imported legacy queue — print/SMS-era reminders with only a DUE date
 *    (sentAt was never recorded), and duplicated wholesale by a historical double import, so
 *    they're deduped on type+dueDate+registration. Without this distinction the profile page
 *    was rendering their null sentAt as "01/01/70". */
export async function getCustomerReminderTimeline(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  const cust = (await db.select({ phone: customers.phone }).from(customers).where(eq(customers.id, customerId)).limit(1))[0];
  const last9 = String(cust?.phone ?? "").replace(/\D/g, "").slice(-9);

  // registration falls back to the linked vehicle's plate — manual replies sent from the
  // Conversations page (messageType "Other") log a vehicleId but no registration text, yet
  // they're always part of a conversation about that car (WhatsApp's 24h window means the
  // customer messaged us about something — usually the reminder that started the thread).
  const logs = await db.select({
    id: reminderLogs.id, sentAt: reminderLogs.sentAt, messageType: reminderLogs.messageType,
    status: reminderLogs.status, messageContent: reminderLogs.messageContent, errorMessage: reminderLogs.errorMessage,
    registration: sql<string | null>`COALESCE(NULLIF(${reminderLogs.registration}, ''), ${vehicles.registration})`,
  }).from(reminderLogs)
    .leftJoin(vehicles, eq(reminderLogs.vehicleId, vehicles.id))
    .where(last9
      ? or(eq(reminderLogs.customerId, customerId), sql`RIGHT(regexp_replace(${reminderLogs.recipient}, '\\D', '', 'g'), 9) = ${last9}`)
      : eq(reminderLogs.customerId, customerId))
    .orderBy(desc(reminderLogs.sentAt)).limit(200);

  const legacy = await db.select().from(reminders).where(eq(reminders.customerId, customerId));
  const seen = new Set<string>();
  const legacyDeduped = legacy.filter((r) => {
    const k = `${r.type}|${r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : ""}|${(r.registration || "").toUpperCase().replace(/\s+/g, "")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // A manual reply ("Other") is part of whatever conversation the customer replied to — almost
  // always the last reminder we sent them (WhatsApp's 24h window guarantees a preceding message).
  // Its stored vehicleId is only sendReply's newest-vehicle-by-id GUESS, so when the log has no
  // registration of its own, attribute it to the closest preceding reminder's car instead
  // (e.g. Mrs Kagan's booking replies belong to FH54JVM's MOT thread, not FA17NHD).
  const asc = [...logs].sort((a, b) => new Date(a.sentAt as any).getTime() - new Date(b.sentAt as any).getTime());
  let lastReminderReg: string | null = null;
  const threadRegByLogId = new Map<number, string | null>();
  for (const l of asc) {
    if (l.messageType !== "Other") lastReminderReg = l.registration ?? lastReminderReg;
    threadRegByLogId.set(l.id, l.messageType === "Other" ? (lastReminderReg ?? l.registration) : l.registration);
  }

  const timeline = [
    ...logs.map((l) => ({
      kind: "message" as const, id: `log-${l.id}`, date: l.sentAt, type: l.messageType,
      registration: threadRegByLogId.get(l.id) ?? l.registration, method: "whatsapp", status: l.status,
      preview: l.messageContent ? String(l.messageContent).replace(/\s+/g, " ").slice(0, 160) : null,
      errorMessage: l.errorMessage,
    })),
    ...legacyDeduped.map((r) => ({
      kind: "legacy" as const, id: `rem-${r.id}`, date: r.dueDate, type: r.type,
      registration: r.registration, method: r.sentMethod || null, status: r.status,
      preview: null as string | null, errorMessage: null as string | null,
    })),
  ];
  timeline.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return timeline;
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

/** Base plate for a registration, ignoring GA4's superseded-record marker: when a cherished
 * plate moves to another car GA4 renames the old row "S8 BEP* (03/03/2023)" (the date it lost
 * the plate). Everything from the "*" on is dropped, then punctuation/case normalized. */
const basePlateSql = (col: any) => sql`UPPER(REGEXP_REPLACE(SPLIT_PART(${col}, '*', 1), '[^A-Za-z0-9]', '', 'g'))`;

/** Physically DIFFERENT cars that have worn this car's plate — the previous holders of a
 * cherished registration. Deliberately NOT merged into the vehicle's own history (see
 * getServiceHistoryByVehicleId); shown as a separate, collapsed strip so the old car's work is
 * still one click away when a customer rings about it. */
export async function getOtherVehiclesOnPlate(vehicleId: number) {
  const db = await getDb();
  if (!db) return [];
  const v = (await db.select({ registration: vehicles.registration }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1))[0];
  if (!v?.registration) return [];
  const sameCarIds = await getVehicleIdsForSamePlate(db, vehicleId);
  const base = v.registration.toUpperCase().split("*")[0].replace(/[^A-Z0-9]/g, "");
  if (!base) return [];

  const rows = await db.select({
    id: vehicles.id,
    registration: vehicles.registration,
    make: vehicles.make,
    model: vehicles.model,
    vin: vehicles.vin,
  })
    .from(vehicles)
    .where(and(sql`${basePlateSql(vehicles.registration)} = ${base}`, sql`${vehicles.id} NOT IN (${sql.join(sameCarIds.map((i) => sql`${i}`), sql`, `)})`));
  if (!rows.length) return [];

  // Counts come from one grouped pass rather than a correlated subquery per row — the
  // subquery form returned the same totals for every car (an uncorrelated outer reference).
  const stats = await db.select({
    vehicleId: serviceHistory.vehicleId,
    docs: sql<number>`COUNT(*)`,
    firstSeen: sql<string>`MIN(${serviceHistory.dateCreated})`,
    lastSeen: sql<string>`MAX(${serviceHistory.dateCreated})`,
  })
    .from(serviceHistory)
    .where(inArray(serviceHistory.vehicleId, rows.map((r) => r.id)))
    .groupBy(serviceHistory.vehicleId);
  const byId = new Map(stats.map((s) => [s.vehicleId, s]));

  return rows
    .map((r) => {
      const s = byId.get(r.id);
      return { ...r, docs: Number(s?.docs ?? 0), firstSeen: s?.firstSeen ?? null, lastSeen: s?.lastSeen ?? null };
    })
    .filter((r) => r.docs > 0)
    .sort((a, b) => new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime());
}

export async function getRemindersByVehicleId(vehicleId: number) {
  const db = await getDb();
  if (!db) return [];
  const ids = await getVehicleIdsForSamePlate(db, vehicleId);
  // The legacy `reminders` table is the GA4-imported QUEUE — it has due dates but no send
  // record (null sentAt, status "pending") and was duplicated by a double import. Real sends
  // live in reminderLogs, so merge both here: without this the vehicle page showed a stale
  // queue and hid genuinely delivered messages (GC18EJO, MOT SMS delivered 17/07/2026).
  const queued = await db.select().from(reminders).where(inArray(reminders.vehicleId, ids));
  const sent = await db.select({
    id: reminderLogs.id, sentAt: reminderLogs.sentAt, reminderType: reminderLogs.messageType,
    status: reminderLogs.status, method: reminderLogs.messageType,
    messageContent: reminderLogs.messageContent, recipient: reminderLogs.recipient,
    readAt: reminderLogs.readAt, messageSid: reminderLogs.messageSid,
  }).from(reminderLogs).where(inArray(reminderLogs.vehicleId, ids)).orderBy(desc(reminderLogs.sentAt)).limit(50);

  const seen = new Set<string>();
  const legacy = queued.filter((r: any) => {
    const key = `${r.reminderType}|${r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : ""}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  const merged = [
    ...sent.map((r: any) => ({ id: `log-${r.id}`, type: r.reminderType, reminderType: r.reminderType,
      dueDate: null, status: r.status || "sent", sentAt: r.sentAt,
      // Channel isn't stored explicitly. A read receipt only exists on WhatsApp, so that's
      // proof; otherwise we genuinely don't know, and must not claim SMS.
      method: r.readAt ? "WhatsApp" : "", readAt: r.readAt,
      messageContent: r.messageContent, recipient: r.recipient })),
    // legacy rows carry `type`; mirror it so the table reads one field either way
    ...legacy.map((r: any) => ({ ...r, reminderType: r.reminderType ?? r.type, type: r.type ?? r.reminderType })),
  ];
  return merged.sort((a: any, b: any) =>
    new Date(b.sentAt || b.dueDate || 0).getTime() - new Date(a.sentAt || a.dueDate || 0).getTime());
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
    .where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') ILIKE ${normalized + "%"}`)
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
  // Business price floors override history: a historical average can sit well below today's
  // minimum charge (e.g. "OIL FILTER" avg £6.47 across 4,000+ old jobs vs the £11.95 minimum),
  // and the exact-key price-list override above misses the many description variants ("OIL
  // FILTER", "CASTROL 5W/30 ENGINE OIL", …). Clamp every suggestion up to its matching floor.
  const floorRules = await getPriceFloorRules();
  for (const o of out) {
    const floor = matchPriceFloor(o.description, floorRules);
    if (floor != null && (o.unitPrice == null || o.unitPrice < floor)) o.unitPrice = floor;
  }
  return out.slice(0, limit);
}

/** Price-floor rules: parts-price-list rows with a minPrice set. Kept small (the list is
 *  maintained by hand), so callers fetch all rules and match in JS. */
export async function getPriceFloorRules() {
  const db = await getDb();
  if (!db) return [] as { description: string; minPrice: number }[];
  const rows = await db.select({ description: partsPriceList.description, minPrice: partsPriceList.minPrice })
    .from(partsPriceList).where(isNotNull(partsPriceList.minPrice));
  return rows.map((r) => ({ description: r.description, minPrice: Number(r.minPrice) })).filter((r) => r.minPrice > 0);
}

/** The floor (if any) that applies to a line description. Whole-word phrase match, case-
 *  insensitive — so an "Oil" rule catches "CASTROL 5W/30 ENGINE OIL" but NOT "COIL SPRING" or
 *  "SPOILER" — and when several rules match, the most specific (longest phrase) wins, so an
 *  "Oil Filter" £11.95 rule beats the general "Oil" £12.95 one for filters.
 *  NOTE: mirrored client-side in DocumentDetails.tsx (matchPriceFloor) for the live job-sheet
 *  warning — keep the two in sync if the matching semantics ever change. */
export function matchPriceFloor(description: string | null | undefined, rules: { description: string; minPrice: number }[]): number | null {
  const d = String(description ?? "");
  if (!d.trim() || !rules.length) return null;
  let best: { len: number; min: number } | null = null;
  for (const r of rules) {
    const phrase = r.description.trim();
    if (!phrase) continue;
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\b${esc}\\b`, "i").test(d)) continue;
    if (!best || phrase.length > best.len) best = { len: phrase.length, min: r.minPrice };
  }
  return best ? best.min : null;
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
export async function upsertPartsPriceListEntry(input: { id?: number; partNumber?: string; description: string; unitPrice: number; vatRate?: number; quantity?: number; nominalCode?: string; minPrice?: number | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = {
    partNumber: input.partNumber?.trim() || null,
    description: input.description.trim(),
    unitPrice: String(input.unitPrice),
    vatRate: input.vatRate != null ? String(input.vatRate) : "20",
    quantity: input.quantity != null ? String(input.quantity) : null,
    nominalCode: input.nominalCode?.trim() || null,
    minPrice: input.minPrice != null ? String(input.minPrice) : null,
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
    // Also match on the national core (digits only, minus +44/0 prefix) so non-canonically
    // stored numbers (spaces, missing "+") still resolve — see findCustomerByPhone.
    let core = phone.replace(/\D/g, '');
    if (core.startsWith('44')) core = core.slice(2); else if (core.startsWith('0')) core = core.slice(1);
    if (core.length >= 7) {
      conditions.push(sql`regexp_replace(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), '^(44|0)', '') = ${core}`);
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
  // National "core" (digits only, minus the +44/0/44 prefix), compared on BOTH sides so a stored
  // number in a non-canonical format (spaces, missing "+") still matches — the exact-format eq()
  // variants alone miss those. Full-core equality, so no cross-person false match; duplicates that
  // share a core are still ordered by opt-out below. Guarded at >=7 digits to avoid over-matching.
  let core = normalizedPhone.replace(/\D/g, '');
  if (core.startsWith('44')) core = core.slice(2); else if (core.startsWith('0')) core = core.slice(1);
  if (core.length >= 7) {
    conditions.push(sql`regexp_replace(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), '^(44|0)', '') = ${core}`);
  }
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

    const lastVisitMap = await getLastVisitDatesForVehicles();

    return allVehicles.map(v => {
      const log = v.id ? logMap.get(v.id) : null;
      return {
        ...v,
        lastReminderSent: log ? log.sentAt : null,
        lastReminderStatus: log ? log.status : null,
        lastVisit: v.id ? lastVisitMap.get(v.id) || null : null,
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

/** Which documents belong to THIS car — shared by the history and the servicing summary so the
 * two can never disagree. See getServiceHistoryByVehicleId for why it isn't a plain plate match. */
async function vehicleDocMatch(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, vehicleId: number) {
  const v = (await db.select({ registration: vehicles.registration }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1))[0];
  const normReg = v?.registration ? v.registration.toUpperCase().replace(/\s+/g, "") : null;
  const ids = await getVehicleIdsForSamePlate(db, vehicleId);
  return normReg
    ? or(
        inArray(serviceHistory.vehicleId, ids),
        and(isNull(serviceHistory.vehicleId), sql`REPLACE(UPPER(${serviceHistory.registration}), ' ', '') = ${normReg}`),
      )!
    : inArray(serviceHistory.vehicleId, ids);
}

/** What was actually fitted on a job, read from the line items.
 *
 * Wording is consistent in the parts list ("OIL FILTER", "Castrol 5w/30 Engine Oil", "AIR
 * FILTER", "CABIN FILTER"/"Pollen Filter"), so plain matchers are reliable — but "oil" alone
 * is not engine oil: gear oil, gearbox/transmission oil, an oil cooler and an oil LEAK all
 * contain it, and "CASTROL SYNTRAX GEAROIL" would otherwise read as an oil change. */
const SERVICE_ITEM_TESTS: { key: string; test: (s: string) => boolean }[] = [
  { key: "oilFilter", test: (s) => /oil\s*filter/.test(s) },
  { key: "airFilter", test: (s) => /air\s*(filter|cleaner)/.test(s) },
  { key: "cabinFilter", test: (s) => /(pollen|cabin|micro)\s*filter/.test(s) },
  { key: "fuelFilter", test: (s) => /fuel\s*filter/.test(s) },
  {
    key: "engineOil",
    test: (s) => /\boil\b|oil$/.test(s)
      && !/(gear|transmission|diff|brake|steering|cooler|filter|seal|leak|pump|sump|level|top\s*up)/.test(s),
  },
];

/** Big interval jobs that aren't part of a routine service but you need the date of: when the
 * gearbox oil was last changed, and when the timing belt was last done.
 *
 * Unlike the service grade these DO consider the document description as well as the line
 * items — "To Replace Timing Belt" is a named job, not a vague write-up, and some belt jobs
 * bill the parts as a bare "BELT KIT" that only the description disambiguates from a drive belt.
 *
 * Exclusions matter as much as the matches: GEARBOX MOUNTING and SPECIALIST TRANSMISSION
 * REPAIR are not an oil change, and DRIVE BELT KIT / BELT TENSIONER are the auxiliary belt. */
/** Advisory wording — "TIMING BELT CHANGE NOW DUE !! PLEASE REBOOK", "Note - Timing Belt Change
 * Every 4 Years", "NOISE FROM TIMING BELT AREA". These say the job is OUTSTANDING, the exact
 * opposite of done, and counting them would show an overdue belt as recently replaced. They sit
 * on "Other" line items (93 of 120 such rows), while every Part and Labour line is genuine — so
 * item type does most of the work and this is the second line of defence, also applied to the
 * document description, which has no item type to lean on. */
const MILESTONE_ADVISORY = /(\bdue\b|note|report|recommend|rebook|advis|noise|when tested|quote|estimate|next|should be|require)/;

export const MILESTONE_TESTS: { key: string; label: string; test: (s: string) => boolean }[] = [
  {
    key: "gearboxOil",
    label: "Gearbox oil change",
    // Deliberately NOT differential oil — that's a separate job and would be mislabelled here.
    test: (s) => (/gearoil/.test(s) || /(gear\s*box|gear|transmission|cvt)\b[a-z\s]*\b(oil|fluid)\b/.test(s))
      && !/(mounting|repair|specialist|leak|seal|pump|cooler|diff)/.test(s),
  },
  {
    key: "timingBelt",
    label: "Timing belt",
    test: (s) => /(timing|cam)\s*(belt|chain)/.test(s) && !/(drive|aux|alternator|fan)\s*belt/.test(s),
  },
];

/** A milestone only counts off a line that represents work actually done: a fitted Part or the
 * Labour to fit it. "Other" lines are where the advisories live. */
const milestoneHit = (key: string, text: string, itemType?: string | null) => {
  if (!text || MILESTONE_ADVISORY.test(text)) return false;
  if (itemType != null && !/^(part|labour)$/i.test(String(itemType))) return false;
  return MILESTONE_TESTS.find((t) => t.key === key)!.test(text);
};

export type ServiceGrade = "full" | "interim" | "oil" | "none";

/** Grade a job from what was fitted, using Adam's definition:
 *   interim ("small")  — engine oil + oil filter
 *   full   ("large")   — plus air filter AND pollen/cabin filter
 * Anything with oil but no oil filter is an oil change, not a service. */
function gradeService(items: Record<string, boolean>): ServiceGrade {
  if (!items.engineOil && !items.oilFilter) return "none";
  if (!items.oilFilter) return "oil";
  if (items.airFilter && items.cabinFilter) return "full";
  return "interim";
}

export const SERVICE_GRADE_LABEL: Record<ServiceGrade, string> = {
  full: "Full service", interim: "Interim service", oil: "Oil change", none: "—",
};

/** Every service this car has had, newest first, each graded by what was actually fitted —
 * plus the miles covered since the one before it, which is the number that tells you whether
 * it's due. Reads the line items rather than the description, because a job described as
 * "Carried Out Full Service" doesn't prove the filters were on the invoice. */
export async function getVehicleServicing(vehicleId: number) {
  const db = await getDb();
  if (!db) return { last: null, services: [] as any[] };

  const rows = await db.select({
    id: serviceHistory.id,
    docNo: serviceHistory.docNo,
    ga4Number: serviceHistory.ga4Number,
    docType: serviceHistory.docType,
    date: serviceHistory.dateCreated,
    mileage: serviceHistory.mileage,
    description: serviceHistory.description,
    itemDesc: serviceLineItems.description,
    itemType: serviceLineItems.itemType,
  })
    .from(serviceHistory)
    .leftJoin(serviceLineItems, eq(serviceLineItems.documentId, serviceHistory.id))
    .where(and(await vehicleDocMatch(db, vehicleId), inArray(serviceHistory.docType, ["SI", "XS"])))
    .orderBy(desc(serviceHistory.dateCreated));

  const byDoc = new Map<number, any>();
  for (const r of rows) {
    let d = byDoc.get(r.id);
    if (!d) {
      d = { id: r.id, docNo: r.docNo, ga4Number: r.ga4Number, date: r.date, mileage: r.mileage, description: r.description, items: {} as Record<string, boolean>, milestones: {} as Record<string, boolean> };
      byDoc.set(r.id, d);
      // Milestones also read the job description — see MILESTONE_TESTS.
      const docText = String(r.description || "").toLowerCase();
      for (const { key } of MILESTONE_TESTS) if (milestoneHit(key, docText)) d.milestones[key] = true;
    }
    const text = String(r.itemDesc || "").toLowerCase();
    if (!text) continue;
    for (const { key, test } of SERVICE_ITEM_TESTS) if (test(text)) d.items[key] = true;
    for (const { key } of MILESTONE_TESTS) if (milestoneHit(key, text, r.itemType)) d.milestones[key] = true;
  }

  const allDocs = Array.from(byDoc.values()).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  const services = allDocs
    .map((d) => ({ ...d, grade: gradeService(d.items) }))
    .filter((d) => d.grade !== "none");

  // Miles since the previous service — only when both odometer readings are present and sane.
  for (let i = 0; i < services.length; i++) {
    const prev = services[i + 1];
    const a = Number(services[i].mileage) || 0, b = Number(prev?.mileage) || 0;
    services[i].milesSincePrevious = a > 0 && b > 0 && a > b ? a - b : null;
  }

  // Most recent occurrence of each big interval job. Searched across ALL invoices, not just the
  // ones that graded as a service — a timing belt is usually its own job, not part of a service.
  const milestones: Record<string, any> = {};
  for (const { key, label } of MILESTONE_TESTS) {
    const hit = allDocs.find((d) => d.milestones[key]);
    milestones[key] = hit
      ? { label, date: hit.date, mileage: hit.mileage, docNo: hit.docNo, ga4Number: hit.ga4Number, description: hit.description }
      : null;
  }

  return { last: services[0] || null, services, milestones };
}

/** Last service per vehicle, for a whole list at once — the customer page shows one row per car
 * and would otherwise fire a query each. Same grading as getVehicleServicing; matches on
 * vehicleId only (these are the customer's own linked cars, so the unlinked-document fallback
 * that single-vehicle scoping needs doesn't apply). */
export async function getLastServiceForVehicles(vehicleIds: number[]) {
  const out = new Map<number, { date: any; mileage: any; grade: ServiceGrade; items: Record<string, boolean>; docNo: any; ga4Number: any }>();
  const db = await getDb();
  if (!db || !vehicleIds.length) return out;

  const rows = await db.select({
    vehicleId: serviceHistory.vehicleId,
    id: serviceHistory.id,
    docNo: serviceHistory.docNo,
    ga4Number: serviceHistory.ga4Number,
    date: serviceHistory.dateCreated,
    mileage: serviceHistory.mileage,
    itemDesc: serviceLineItems.description,
  })
    .from(serviceHistory)
    .leftJoin(serviceLineItems, eq(serviceLineItems.documentId, serviceHistory.id))
    .where(and(inArray(serviceHistory.vehicleId, vehicleIds), inArray(serviceHistory.docType, ["SI", "XS"])))
    .orderBy(desc(serviceHistory.dateCreated));

  const byDoc = new Map<number, any>();
  for (const r of rows) {
    let d = byDoc.get(r.id);
    if (!d) { d = { ...r, items: {} as Record<string, boolean> }; byDoc.set(r.id, d); }
    const text = String(r.itemDesc || "").toLowerCase();
    if (!text) continue;
    for (const { key, test } of SERVICE_ITEM_TESTS) if (test(text)) d.items[key] = true;
  }

  for (const d of byDoc.values()) {
    const grade = gradeService(d.items);
    if (grade === "none" || d.vehicleId == null) continue;
    const cur = out.get(d.vehicleId);
    if (!cur || new Date(d.date || 0) > new Date(cur.date || 0)) {
      out.set(d.vehicleId, { date: d.date, mileage: d.mileage, grade, items: d.items, docNo: d.docNo, ga4Number: d.ga4Number });
    }
  }
  return out;
}

// Last time ANY document was created against a vehicle (any doc type) — a lighter-weight cousin
// of getLastServiceForVehicles above, which only counts graded service jobs. This just answers
// "when were they last in", so it's a single grouped aggregate over every vehicle at once rather
// than per-customer.
export async function getLastVisitDatesForVehicles() {
  const out = new Map<number, Date>();
  const db = await getDb();
  if (!db) return out;

  const rows = await db
    .select({
      vehicleId: serviceHistory.vehicleId,
      lastVisit: sql<Date>`max(${serviceHistory.dateCreated})`,
    })
    .from(serviceHistory)
    .where(isNotNull(serviceHistory.vehicleId))
    .groupBy(serviceHistory.vehicleId);

  for (const r of rows) if (r.vehicleId != null && r.lastVisit) out.set(r.vehicleId, r.lastVisit);
  return out;
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
  const sameCarIds = await getVehicleIdsForSamePlate(db, vehicleId);

  // ...but a plate is NOT a car. A cherished/private plate transfers between physically
  // different vehicles, and the documents written while the plate was on the OLD car still
  // carry that plate as text — so matching document registration text alone dragged three
  // different cars into one history (S8 BEP: Lexus IS250 08/11-05/22, Lexus CT200h
  // 03/23-11/24, Volvo XC40 05/25-> ; the Volvo was showing a 2016 door-glass job and its own
  // cherished-transfer invoice). GA4 already disambiguates these by renaming the superseded
  // row "S8 BEP* (03/03/2023)", and every one of those documents is correctly linked by
  // vehicleId — so trust the link and keep the registration-text match ONLY for documents
  // that have no vehicleId at all (~2,527 of 34,912), which would otherwise vanish from every
  // history. Other cars that wore this plate are surfaced separately — getOtherVehiclesOnPlate.
  const vehicleMatch = normReg
    ? or(
        inArray(serviceHistory.vehicleId, sameCarIds),
        and(isNull(serviceHistory.vehicleId), sql`REPLACE(UPPER(${serviceHistory.registration}), ' ', '') = ${normReg}`),
      )
    : inArray(serviceHistory.vehicleId, sameCarIds);

  // We join with line items to get a main description and a fallback total
  const rawDocs = await db.select({
    id: serviceHistory.id,
    externalId: serviceHistory.externalId,
    customerId: serviceHistory.customerId,
    vehicleId: serviceHistory.vehicleId,
    docType: serviceHistory.docType,
    docNo: serviceHistory.docNo,
    ga4Number: serviceHistory.ga4Number,
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
    // History deliberately shows every document, converted or not — same as real GA4, which
    // never deletes a job sheet once it's invoiced, it just leaves the old JS record sitting
    // alongside the new SI (see "Job Sheets" tab's own filter, getDocuments, for the same
    // origJobSheetNo/description-fingerprint match reused here). Rather than hide a converted
    // job sheet from this full audit trail, flag which invoice it became so the UI can label it
    // instead of showing what looks like a separate, still-outstanding job. vehicleId is REQUIRED
    // on BOTH branches — GA4 job-sheet numbers get reused over a long history, so matching by
    // origJobSheetNo alone can false-positive against an unrelated invoice for a different car.
    convertedToDocNo: sql<string | null>`CASE WHEN ${serviceHistory.docType} = 'JS' THEN (
      SELECT si."docNo" FROM "serviceHistory" si
      WHERE si."docType" = 'SI'
        AND si."vehicleId" = ${serviceHistory.vehicleId}
        AND (
          si."origJobSheetNo" = (NULLIF(regexp_replace(${serviceHistory.docNo}, '[^0-9]', '', 'g'), ''))::int
          OR (
            si."dateCreated" >= ${serviceHistory.dateCreated}
            AND si.description = ${serviceHistory.description}
            AND length(${serviceHistory.description}) >= 15
          )
        )
      ORDER BY si."dateCreated" ASC LIMIT 1
    ) ELSE NULL END`,
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
  return getServiceHistoryByCustomerIds([customerId]);
}

async function getServiceHistoryByCustomerIds(customerIds: number[]) {
  const db = await getDb();
  if (!db || !customerIds.length) return [];
  const rawDocs = await db.select({
    id: serviceHistory.id,
    externalId: serviceHistory.externalId,
    customerId: serviceHistory.customerId,
    vehicleId: serviceHistory.vehicleId,
    docType: serviceHistory.docType,
    docNo: serviceHistory.docNo,
    ga4Number: serviceHistory.ga4Number,
    dateCreated: serviceHistory.dateCreated,
    dateIssued: serviceHistory.dateIssued,
    datePaid: serviceHistory.datePaid,
    totalNet: serviceHistory.totalNet,
    totalTax: serviceHistory.totalTax,
    totalGross: sql<string>`COALESCE(NULLIF(CAST(${serviceHistory.totalGross} AS DECIMAL(10,2)), 0), SUM(${serviceLineItems.subNet}))`,
    balance: serviceHistory.balance,
    mileage: serviceHistory.mileage,
    createdAt: serviceHistory.createdAt,
    description: serviceHistory.description,
    mainDescription: sql<string>`COALESCE(${serviceHistory.description}, MIN(${serviceLineItems.description}))`,
    registration: vehicles.registration,
  })
    .from(serviceHistory)
    .leftJoin(serviceLineItems, eq(serviceHistory.id, serviceLineItems.documentId))
    .leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
    .where(inArray(serviceHistory.customerId, customerIds))
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

/** Same idea as getVehiclesForCustomerAcrossLinkedAccounts — a person can be split across
 * more than one `customers` row sharing a phone (fresh GA4 account created for a later car
 * instead of reusing the old one), and the Duplicates page won't merge accounts with different
 * account numbers since that's its signal two different people might share a phone. Without
 * this, a customer's own invoices could be invisible from their OTHER account's page — exactly
 * how two real unpaid invoices for "Hakkimian" went unfound (accounts HAK002 and HAK006, same
 * phone, one invoice each). Read-only: no records are touched or merged. */
export async function getServiceHistoryForCustomerAcrossLinkedAccounts(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  const self = (await db.select({ id: customers.id, phone: customers.phone }).from(customers).where(eq(customers.id, customerId)).limit(1))[0];
  if (!self) return [];
  const phoneKey = normPhoneKey(self.phone);
  if (!phoneKey) return (await getServiceHistoryByCustomerIds([customerId])).map((h) => ({ ...h, viaAccountId: customerId, viaAccountNumber: null as string | null, viaAccountSame: true }));

  const allCust = await db.select({ id: customers.id, phone: customers.phone, accountNumber: customers.accountNumber }).from(customers);
  const linkedIds = allCust.filter((c) => c.id === customerId || normPhoneKey(c.phone) === phoneKey).map((c) => c.id);
  const acctById = new Map(allCust.map((c) => [c.id, c.accountNumber] as const));

  const docs = await getServiceHistoryByCustomerIds(linkedIds);
  return docs.map((h) => ({
    ...h,
    viaAccountId: h.customerId ?? customerId,
    viaAccountNumber: h.customerId != null ? (acctById.get(h.customerId) ?? null) : null,
    viaAccountSame: h.customerId === customerId,
  }));
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
  // "Archive" is orthogonal to doc type — it shows whatever's been archived (any type), while
  // every other tab hides archived docs so an archived estimate doesn't linger in "Estimates"/"All".
  if (opts.docType === "archive") {
    conds.push(sql`${serviceHistory.archived} = 1`);
  } else {
    conds.push(sql`(${serviceHistory.archived} IS NULL OR ${serviceHistory.archived} = 0)`);
  }
  if (opts.docType && opts.docType !== "all" && opts.docType !== "archive") {
    // A policy-excess invoice (XS) is a real invoice sent to a real customer for real money — it
    // belongs in the "Invoices" tab alongside the main SI it's linked to, not hidden from it.
    if (opts.docType === "SI") conds.push(inArray(serviceHistory.docType, ["SI", "XS"]));
    else conds.push(eq(serviceHistory.docType, opts.docType));
    if (opts.docType === "JS") {
      // GA4 never deletes a job sheet once it's converted to an invoice there — it just leaves the
      // old JS record sitting alongside the new SI, and our one-way mirror faithfully copies both.
      // Job sheets already invoiced (tracked via the invoice's origJobSheetNo) are done — keep them
      // out of the working Job Sheets queue so it isn't cluttered with stale, already-closed jobs.
      // Still fully visible under "All" — nothing here is deleted or hidden from the record.
      // vehicleId is REQUIRED here, not just docNo/origJobSheetNo — GA4 job-sheet numbers get
      // reused over a long enough history, so matching by number alone can false-positive against
      // a totally unrelated invoice for a different car that happens to share that old number
      // (found via ET23VRE job sheet 93156 numerically colliding with an unrelated BW72AGV invoice).
      conds.push(sql`NOT EXISTS (
        SELECT 1 FROM "serviceHistory" si
        WHERE si."docType" = 'SI'
          AND si."vehicleId" = ${serviceHistory.vehicleId}
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
    const regNorm = `%${opts.search.trim().toUpperCase().replace(/\s+/g, "")}%`;
    // ga4Number is what's actually printed/emailed on an issued invoice — search must match it
    // too, or looking up the number a customer was given finds nothing (or the wrong doc).
    // Registration is normalized both sides — GA4-synced docs store the plate spaced ("FM13
    // KKB") while others don't ("FM13KKB"), and a plain ilike misses whichever way the doc
    // wasn't stored ("Reg format split matching").
    conds.push(or(
      ilike(serviceHistory.docNo, s), ilike(serviceHistory.ga4Number, s),
      sql`REPLACE(UPPER(${serviceHistory.registration}), ' ', '') ILIKE ${regNorm}`,
      sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') ILIKE ${regNorm}`,
      ilike(customers.name, s), ilike(vehicles.make, s), ilike(vehicles.model, s),
    ));
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
    archivedAt: serviceHistory.archivedAt,
  })
    .from(serviceHistory)
    .leftJoin(customers, eq(serviceHistory.customerId, customers.id))
    .leftJoin(vehicles, eq(serviceHistory.vehicleId, vehicles.id))
    .where(where as any)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
}

/** Document counts by type for the list header. Archived docs are excluded from every type's
 *  count (they're not shown on that type's tab any more) and totalled separately. */
export async function getDocumentStats() {
  const db = await getDb();
  if (!db) return { total: 0, byType: [] as { docType: string | null; n: number }[], archived: 0 };
  const rows = await db.select({
    docType: serviceHistory.docType,
    n: sql<number>`COUNT(*)`,
  }).from(serviceHistory)
    .where(sql`(${serviceHistory.archived} IS NULL OR ${serviceHistory.archived} = 0)`)
    .groupBy(serviceHistory.docType);
  const archived = Number((await db.select({ n: sql<number>`COUNT(*)` }).from(serviceHistory).where(sql`${serviceHistory.archived} = 1`))[0]?.n ?? 0);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  return { total, byType: rows.map(r => ({ docType: r.docType, n: Number(r.n) })), archived };
}

// --- Business reports ---------------------------------------------------------
// Sum a money column stored as text, robustly: strip anything that isn't a digit/dot/minus, treat
// blanks as 0, then SUM. (GA4-imported totals are text.)
const _moneySum = (c: any) => sql<string>`COALESCE(SUM(COALESCE(NULLIF(regexp_replace(${c}::text, '[^0-9.\-]', '', 'g'), '')::numeric, 0)), 0)`;

/** Every section of GA4's printed "Summary of Sales Issued", computed from our own documents.
 *
 *  GA4's own copy of this report only covers invoices that reached GA4 — for 01-15 Aug 2026 that
 *  was 23 of the 59 we issued — so this rebuilds it over everything we hold. The category split
 *  comes from line items rather than the sub* sub-total columns, which stopped being written in
 *  June 2026 (see the mot-sales-summary report for the same problem).
 *
 *  Documents are unique by docNo (verified: no clashes across SI/XS/CR), so nothing is deduped
 *  away; every document in the range is counted exactly once.
 */
export async function getSalesSummaryIssued(opts: { from: string; to: string; basedOn?: "issue" | "created"; department?: string }) {
  const db = await getDb();
  const from = new Date(opts.from + "T00:00:00");
  const to = new Date(opts.to + "T23:59:59.999");
  const blank = {
    from: opts.from, to: opts.to,
    invoices: { count: 0, gross: 0 }, credits: { count: 0, gross: 0 }, totalGross: 0,
    discounts: { net: 0, tax: 0, gross: 0 },
    mot: { full: 0, retest: 0, duplicate: 0 },
    breakdown: [] as { label: string; qty?: number; net: number; tax: number; gross: number }[],
    totals: { net: 0, tax: 0, gross: 0 },
    taxBreakdown: [] as { code: string; rate: number; net: number; tax: number; gross: number }[],
    labourProfit: { cost: 0, salesNet: 0, salesTax: 0, salesGross: 0 },
    partsProfit: { cost: 0, salesNet: 0, salesTax: 0, salesGross: 0 },
    receipts: { cash: 0, cheque: 0, digital: 0, total: 0, credited: 0, outstanding: 0 },
    costsUnavailable: true,
  };
  if (!db) return blank;

  const dateCol = opts.basedOn === "created" ? serviceHistory.dateCreated : serviceHistory.dateIssued;
  const inRange = and(gte(dateCol, from), lte(dateCol, to),
    ...(opts.department ? [eq(serviceHistory.department, opts.department)] : []));
  const n = (v: any) => Number(v) || 0;

  // ── Header counts: invoices (SI/XS) vs credit notes (CR), plus discounts and what's still owed
  const head: any = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${serviceHistory.docType} IN ('SI','XS'))::int AS inv_count,
      COALESCE(SUM(${_numExpr(serviceHistory.totalGross)}) FILTER (WHERE ${serviceHistory.docType} IN ('SI','XS')), 0) AS inv_gross,
      COUNT(*) FILTER (WHERE ${serviceHistory.docType} = 'CR')::int AS cr_count,
      COALESCE(SUM(${_numExpr(serviceHistory.totalGross)}) FILTER (WHERE ${serviceHistory.docType} = 'CR'), 0) AS cr_gross,
      COALESCE(SUM(${_numExpr(serviceHistory.totalDiscountNet)}), 0) AS disc_net,
      COALESCE(SUM(${_numExpr(serviceHistory.totalDiscountGross)}), 0) AS disc_gross,
      COALESCE(SUM(${_numExpr(serviceHistory.excessDiscount)}), 0) AS excess_disc,
      COALESCE(SUM(${_numExpr(serviceHistory.balance)}) FILTER (WHERE ${serviceHistory.docType} IN ('SI','XS')), 0) AS outstanding
    FROM ${serviceHistory}
    WHERE ${inRange} AND ${inArray(serviceHistory.docType, ["SI", "XS", "CR"])}`)).rows?.[0] ?? {};

  // ── MOT counts. motStatus is what the MOT option sets; a document with only an MOT line item
  //    (web app) still counts as a full test. Duplicates are billed as a "DUP MOT" item.
  const motRow: any = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${serviceHistory.motStatus} IN ('Pass','Fail')
                          OR (NULLIF(TRIM(${serviceHistory.motStatus}), '') IS NULL AND li.id IS NOT NULL))::int AS full,
      COUNT(*) FILTER (WHERE ${serviceHistory.motStatus} IN ('Pass Retest','Fail Retest'))::int AS retest,
      COUNT(*) FILTER (WHERE dup.id IS NOT NULL)::int AS duplicate
    FROM ${serviceHistory}
    LEFT JOIN LATERAL (SELECT id FROM "serviceLineItems" WHERE "documentId" = ${serviceHistory.id}
                        AND "itemType" = 'MOT' LIMIT 1) li ON TRUE
    LEFT JOIN LATERAL (SELECT id FROM "serviceLineItems" WHERE "documentId" = ${serviceHistory.id}
                        AND description ~* '^\\s*dup\\s+mot' LIMIT 1) dup ON TRUE
    WHERE ${inRange} AND ${inArray(serviceHistory.docType, ["SI", "XS"])}`)).rows?.[0] ?? {};

  // ── Category split, from line items. 'Other'/untyped fall into Surcharge so the rows always
  //    add up to the documents' own totals rather than quietly dropping money.
  const catRows: any[] = (await db.execute(sql`
    SELECT CASE li."itemType"
             WHEN 'Labour' THEN 'Labour' WHEN 'Part' THEN 'Parts'
             WHEN 'Sundries' THEN 'Sundries' WHEN 'Lubricant' THEN 'Lubricants'
             WHEN 'Paint' THEN 'Paint & Mat.' WHEN 'MOT' THEN 'MOT'
             WHEN 'Excess' THEN 'Excess' ELSE 'Surcharge' END AS label,
           COALESCE(SUM(li.quantity), 0) AS qty,
           COALESCE(SUM(li."subNet"), 0) AS net,
           COALESCE(SUM(li."taxAmount"), 0) AS tax
    FROM ${serviceHistory} JOIN "serviceLineItems" li ON li."documentId" = ${serviceHistory.id}
    WHERE ${inRange} AND ${inArray(serviceHistory.docType, ["SI", "XS"])}
    GROUP BY 1`)).rows ?? [];

  const byLabel = new Map(catRows.map((r: any) => [r.label, r]));
  // Same rows, in the same order, as GA4's printed Sales Breakdown — including the trailing
  // "Minus Excess" deduction, which GA4 lists separately from the Excess charge itself.
  const ORDER = ["Labour", "Parts", "Sundries", "Lubricants", "Paint & Mat.", "MOT", "Surcharge", "Excess"];
  const breakdown = ORDER.map((label) => {
    const r: any = byLabel.get(label);
    const net = n(r?.net), tax = n(r?.tax);
    return { label, ...(label === "Labour" ? { qty: n(r?.qty) } : {}), net, tax, gross: round2(net + tax) };
  });
  const excessDisc = n(head.excess_disc);
  breakdown.push({ label: "Minus Excess", net: -excessDisc, tax: 0, gross: -excessDisc });
  const totals = breakdown.reduce((a, r) => ({
    net: round2(a.net + r.net), tax: round2(a.tax + r.tax), gross: round2(a.gross + r.gross),
  }), { net: 0, tax: 0, gross: 0 });

  // ── Tax breakdown by GA4 tax code: T0 is zero-rated (MOT), T1 the 20% standard rate.
  const taxRows: any[] = (await db.execute(sql`
    SELECT COALESCE(li."vatRate", 0) AS rate,
           COALESCE(SUM(li."subNet"), 0) AS net, COALESCE(SUM(li."taxAmount"), 0) AS tax
    FROM ${serviceHistory} JOIN "serviceLineItems" li ON li."documentId" = ${serviceHistory.id}
    WHERE ${inRange} AND ${inArray(serviceHistory.docType, ["SI", "XS"])}
    GROUP BY 1 ORDER BY 1`)).rows ?? [];
  const taxBreakdown = taxRows.map((t: any) => {
    const rate = Number(t.rate) || 0;
    const net = n(t.net), tax = n(t.tax);
    return { code: rate === 0 ? "T0" : "T1", rate, net, tax, gross: round2(net + tax) };
  });

  // ── Receipts against those documents, mapped onto GA4's Cash / Cheque / Digital buckets
  const payRows: any[] = (await db.execute(sql`
    SELECT COALESCE(NULLIF(TRIM(p.method), ''), 'Unknown') AS method, COALESCE(SUM(p.amount), 0) AS amount
    FROM ${payments} p JOIN ${serviceHistory} ON ${serviceHistory.id} = p."documentId"
    WHERE ${inRange} AND ${inArray(serviceHistory.docType, ["SI", "XS", "CR"])}
    GROUP BY 1`)).rows ?? [];

  const receipts = { cash: 0, cheque: 0, digital: 0, total: 0, credited: 0, outstanding: n(head.outstanding) };
  for (const p of payRows) {
    const m = String(p.method).toLowerCase();
    const amt = n(p.amount);
    if (m.includes("cash")) receipts.cash = round2(receipts.cash + amt);
    else if (m.includes("cheque")) receipts.cheque = round2(receipts.cheque + amt);
    else receipts.digital = round2(receipts.digital + amt); // card / BACS / everything else
    receipts.total = round2(receipts.total + amt);
  }
  receipts.credited = n(head.cr_gross);

  const labour = breakdown.find((b) => b.label === "Labour")!;
  const parts = breakdown.find((b) => b.label === "Parts")!;

  return {
    from: opts.from, to: opts.to,
    invoices: { count: n(head.inv_count), gross: n(head.inv_gross) },
    credits: { count: n(head.cr_count), gross: n(head.cr_gross) },
    totalGross: round2(n(head.inv_gross) - n(head.cr_gross)),
    discounts: { net: n(head.disc_net), tax: round2(n(head.disc_gross) - n(head.disc_net)), gross: n(head.disc_gross) },
    mot: { full: n(motRow.full), retest: n(motRow.retest), duplicate: n(motRow.duplicate) },
    breakdown, totals, taxBreakdown,
    // Cost prices aren't stored on line items, so the profit sections show sales only — the same
    // figures GA4 prints when it has no cost data.
    labourProfit: { cost: 0, salesNet: labour.net, salesTax: labour.tax, salesGross: labour.gross },
    partsProfit: { cost: 0, salesNet: parts.net, salesTax: parts.tax, salesGross: parts.gross },
    receipts,
    costsUnavailable: true,
  };
}

export type SalesSummaryRow = {
  label: string;
  qty?: number;
  /** Up to three column values; null leaves the cell blank, as GA4 does for unused columns. */
  v: (number | string | null)[];
  kind?: "money" | "int" | "text";
  bold?: boolean;
  /** Right-align the label and indent it, the way GA4 prints its "Total" rows. */
  total?: boolean;
};
export type SalesSummarySection = { title?: string; captions: (string | null)[]; rows: SalesSummaryRow[] };

/** Lay the summary out exactly as GA4 prints it — one section per boxed block, each with its own
 *  three column captions. Both the PDF and the on-screen report render from this, so the two
 *  can't drift apart. */
export function buildSalesSummarySections(s: any): SalesSummarySection[] {
  const blank = (v: number) => (v ? v : null); // GA4 leaves a cell empty rather than printing 0
  return [
    {
      captions: ["Invoices", "Credit Notes", null],
      rows: [
        { label: "", v: [String(s.invoices.count), String(s.credits.count), "Total Gross"], kind: "text" },
        { label: "Summary", v: [s.invoices.gross, s.credits.gross, s.totalGross], kind: "money", bold: true },
      ],
    },
    {
      captions: ["Net", "Tax", "Gross"],
      rows: [{ label: "Discounts Given", v: [s.discounts.net, s.discounts.tax, s.discounts.gross], kind: "money" }],
    },
    {
      title: "MOT Counts",
      captions: ["Full", "Retest", "Duplicate"],
      rows: [{ label: "MOT's", v: [blank(s.mot.full), blank(s.mot.retest), blank(s.mot.duplicate)], kind: "int" }],
    },
    {
      title: "Sales Breakdown",
      captions: ["Net", "Tax", "Gross"],
      rows: [
        ...s.breakdown.map((b: any) => ({
          label: b.label, ...(b.qty !== undefined ? { qty: b.qty } : {}),
          v: [b.net, b.tax, b.gross], kind: "money" as const,
        })),
        { label: "Total", v: [s.totals.net, s.totals.tax, s.totals.gross], kind: "money", bold: true, total: true },
      ],
    },
    {
      title: "Labour Profit",
      captions: ["Net", "Tax", "Gross"],
      rows: [
        // GA4 prints the cost line unlabelled when it has no cost data; ours never does.
        { label: "", v: [s.labourProfit.cost, s.labourProfit.cost, s.labourProfit.cost], kind: "money" },
        { label: "Labour Sales", v: [s.labourProfit.salesNet, s.labourProfit.salesTax, s.labourProfit.salesGross], kind: "money" },
        { label: "Total", v: [s.labourProfit.salesNet, null, s.labourProfit.salesGross], kind: "money", bold: true, total: true },
      ],
    },
    {
      title: "Parts Profit",
      captions: ["Net", "Tax", "Gross"],
      rows: [
        { label: "Parts Cost", v: [s.partsProfit.cost, s.partsProfit.cost, s.partsProfit.cost], kind: "money" },
        { label: "Parts Sales", v: [s.partsProfit.salesNet, s.partsProfit.salesTax, s.partsProfit.salesGross], kind: "money" },
        { label: "Total", v: [s.partsProfit.salesNet, null, s.partsProfit.salesGross], kind: "money", bold: true, total: true },
      ],
    },
    {
      title: "Receipts Breakdown",
      captions: ["Receipts", "Refunds", "Total"],
      rows: [
        { label: "Cash", v: [blank(s.receipts.cash), null, null], kind: "money" },
        { label: "Cheque", v: [blank(s.receipts.cheque), null, null], kind: "money" },
        { label: "Digital", v: [blank(s.receipts.digital), null, null], kind: "money" },
        { label: "Total", v: [null, null, s.receipts.total], kind: "money", bold: true, total: true },
        { label: "", v: [null, "Credited", s.receipts.credited], kind: "money", bold: true },
        { label: "", v: [null, "Outstanding", s.receipts.outstanding], kind: "money", bold: true },
      ],
    },
  ];
}

/** GA4's "Sales Summary Extended" — the plain summary plus the extra blocks it prints: a titled
 *  Discount section, a labelled Labour Cost line, the Lab/Part/MOT cost total, receipts and
 *  refunds split by type, and the tax-code breakdown. */
export function buildSalesSummaryExtendedSections(s: any): SalesSummarySection[] {
  const base = buildSalesSummarySections(s);
  const blank = (v: number) => (v ? v : null);

  // Extended titles its Discount block and labels the labour cost line; the plain summary doesn't.
  const discount = { ...base[1], title: "Discount" };
  const labour = {
    ...base[4],
    rows: base[4].rows.map((r, i) => (i === 0 ? { ...r, label: "Labour Cost" } : r)),
  };

  const rcpt = s.receipts;
  // GA4 splits receipts into Standard vs Account columns. We don't record which ledger a receipt
  // was taken against, so everything lands in Standard and Account stays blank rather than
  // implying a split we can't evidence.
  const byType = (title: string, cash: number, cheque: number, digital: number, total: number): SalesSummarySection => ({
    title, captions: ["Standard", "Account", "Total"],
    rows: [
      { label: "Cash", v: [blank(cash), null, null], kind: "money" },
      { label: "Cheque", v: [blank(cheque), null, null], kind: "money" },
      { label: "Digital", v: [blank(digital), null, null], kind: "money" },
      { label: "Total", v: [total, null, total], kind: "money", bold: true, total: true },
    ],
  });

  return [
    base[0],                       // Summary
    discount,                      // Discount
    base[2],                       // MOT Counts
    base[3],                       // Sales Breakdown
    labour,                        // Labour Profit
    base[5],                       // Parts Profit
    {
      title: "Sales - Lab,Part & Mot Cost",
      captions: ["Net", "Tax", "Gross"],
      rows: [{ label: "Total", v: [s.totals.net, null, s.totals.gross], kind: "money", bold: true, total: true }],
    },
    byType("Receipts by Type", rcpt.cash, rcpt.cheque, rcpt.digital, rcpt.total),
    byType("Refunds by Type", 0, 0, 0, 0),
    {
      title: "Total Receipts / Refunds",
      captions: ["Standard", "Account", "Total"],
      rows: [
        { label: "Grand Total", v: [rcpt.total, null, rcpt.total], kind: "money", bold: true, total: true },
        { label: "", v: [null, "Credited", rcpt.credited], kind: "money", bold: true },
        { label: "", v: [null, "Outstanding", rcpt.outstanding], kind: "money", bold: true },
      ],
    },
    {
      title: "Tax Breakdown",
      captions: ["Net", "Tax", "Gross"],
      rows: (s.taxBreakdown || []).map((t: any) => ({
        label: t.code, v: [t.net, t.tax || null, t.gross], kind: "money" as const,
      })),
    },
  ];
}

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
    case "sales-summary-issued": {
      // GA4's printed "Summary of Sales Issued", section for section, over our own documents.
      // The PDF version (reports.salesSummaryPDF) renders the same figures in GA4's layout.
      const s = await getSalesSummaryIssued(opts);
      return {
        title: "Summary of Sales Issued",
        subtitle: "Built from web app documents, so it includes invoices GA4 never received. Cost prices aren't stored against line items, so the profit sections show sales only.",
        // Rendered by the GA4-layout view in Reports.tsx rather than the generic table.
        sections: buildSalesSummarySections(s),
        columns: [], rows: [],
      } as any;
    }
    case "sales-breakdown-month":
    case "sales-tax-breakdown-month": {
      // GA4's two per-invoice ledger variants. "Breakdown" splits each invoice's gross into
      // Labour / Parts / Fixed-price (the Extras panel less the MOT, which is listed separately
      // because it's zero-rated); "Customer - Tax Breakdown" splits net and VAT by tax code.
      const taxVariant = opts.reportId === "sales-tax-breakdown-month";
      const custNameExpr = sql<string>`COALESCE(NULLIF(${serviceHistory.customerName}, ''), NULLIF(TRIM(CONCAT_WS(' ', ${serviceHistory.custTitle}, ${serviceHistory.custForename}, ${serviceHistory.custSurname})), ''), NULLIF(${customers.name}, ''))`;
      const res: any = await db.execute(sql`
        SELECT ${dateCol} AS date, ${serviceHistory.docType} AS "docType", ${serviceHistory.docNo} AS "docNo",
               ${serviceHistory.accountNumber} AS acc, ${custNameExpr} AS customer,
               ${serviceHistory.registration} AS reg,
               TRIM(CONCAT_WS(' ', ${vehicles.make}, ${vehicles.model})) AS "makeModel",
               ${_numExpr(serviceHistory.totalNet)} AS net, ${_numExpr(serviceHistory.totalTax)} AS tax,
               ${_numExpr(serviceHistory.totalGross)} AS gross,
               COALESCE(li.labour, 0) AS labour, COALESCE(li.parts, 0) AS parts, COALESCE(li.fixed, 0) AS fixed,
               COALESCE(li.net0, 0) AS net0, COALESCE(li.vat0, 0) AS vat0,
               COALESCE(li.net1, 0) AS net1, COALESCE(li.vat1, 0) AS vat1
        FROM ${serviceHistory}
        LEFT JOIN ${customers} ON ${customers.id} = ${serviceHistory.customerId}
        LEFT JOIN ${vehicles} ON ${vehicles.id} = ${serviceHistory.vehicleId}
        LEFT JOIN (
          SELECT "documentId",
                 SUM(CASE WHEN "itemType" = 'Labour' THEN COALESCE("subNet",0) + COALESCE("taxAmount",0) ELSE 0 END) AS labour,
                 SUM(CASE WHEN "itemType" = 'Part'   THEN COALESCE("subNet",0) + COALESCE("taxAmount",0) ELSE 0 END) AS parts,
                 SUM(CASE WHEN "itemType" IN ('Sundries','Lubricant','Paint','Excess') THEN COALESCE("subNet",0) + COALESCE("taxAmount",0) ELSE 0 END) AS fixed,
                 SUM(CASE WHEN COALESCE("vatRate",0) = 0 THEN COALESCE("subNet",0) ELSE 0 END) AS net0,
                 SUM(CASE WHEN COALESCE("vatRate",0) = 0 THEN COALESCE("taxAmount",0) ELSE 0 END) AS vat0,
                 SUM(CASE WHEN COALESCE("vatRate",0) > 0 THEN COALESCE("subNet",0) ELSE 0 END) AS net1,
                 SUM(CASE WHEN COALESCE("vatRate",0) > 0 THEN COALESCE("taxAmount",0) ELSE 0 END) AS vat1
          FROM "serviceLineItems" GROUP BY "documentId"
        ) li ON li."documentId" = ${serviceHistory.id}
        WHERE ${inRange} AND ${inArray(serviceHistory.docType, ["SI", "XS", "CR"])}
        ORDER BY ${dateCol} ASC, ${serviceHistory.docNo} ASC`);

      const src: any[] = res.rows ?? res;
      const nn = (v: any) => Number(v) || 0;
      const MN = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
      const out: any[] = [];
      let running = 0, curMonth = "";
      const tot: any = { count: 0, labour: 0, parts: 0, fixed: 0, net0: 0, vat0: 0, net1: 0, vat1: 0, net: 0, tax: 0, gross: 0 };
      const sub: any = { labour: 0, parts: 0, fixed: 0, net0: 0, vat0: 0, net1: 0, vat1: 0, net: 0, tax: 0, gross: 0 };
      const flushSub = () => {
        if (!curMonth) return;
        out.push({ _subtotal: true, ...Object.fromEntries(Object.keys(sub).map((k) => [k, sub[k]])), running });
        for (const k of Object.keys(sub)) sub[k] = 0;
      };
      for (const r of src) {
        const d = new Date(r.date);
        const mk = `${MN[d.getMonth()]}.${d.getFullYear()}`;
        if (mk !== curMonth) { flushSub(); curMonth = mk; out.push({ _group: mk }); }
        running = round2(running + nn(r.gross));
        const row: any = {
          date: d.toLocaleDateString("en-GB"), docType: r.docType, docNo: r.docNo, acc: r.acc || "",
          customer: r.customer || "—",
          description: [r.reg, r.makeModel].filter(Boolean).join(" ") || "—",
          labour: nn(r.labour), parts: nn(r.parts), fixed: nn(r.fixed),
          net0: nn(r.net0), vat0: nn(r.vat0), net1: nn(r.net1), vat1: nn(r.vat1),
          net: nn(r.net), tax: nn(r.tax), gross: nn(r.gross), running,
        };
        out.push(row);
        for (const k of Object.keys(sub)) sub[k] = round2(sub[k] + nn(row[k]));
        for (const k of Object.keys(tot)) if (k !== "count") tot[k] = round2(tot[k] + nn(row[k]));
        tot.count += 1;
      }
      flushSub();

      const cols: ReportColumn[] = taxVariant
        ? [
            { key: "date", label: "Date" }, { key: "docType", label: "Type" }, { key: "docNo", label: "No." },
            { key: "acc", label: "Acc Number" }, { key: "customer", label: "Customer" },
            { key: "net0", label: "Net (T0)", align: "right", kind: "money" }, { key: "vat0", label: "VAT (T0)", align: "right", kind: "money" },
            { key: "net1", label: "Net (T1)", align: "right", kind: "money" }, { key: "vat1", label: "VAT (T1)", align: "right", kind: "money" },
            { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" },
            { key: "gross", label: "Gross", align: "right", kind: "money" }, { key: "running", label: "Running Total", align: "right", kind: "money" },
          ]
        : [
            { key: "date", label: "Date" }, { key: "docType", label: "Type" }, { key: "docNo", label: "No." },
            { key: "acc", label: "Acc Number" }, { key: "description", label: "Description" },
            { key: "labour", label: "Labour Gross", align: "right", kind: "money" },
            { key: "parts", label: "Parts Gross", align: "right", kind: "money" },
            { key: "fixed", label: "Fixed P. Gross", align: "right", kind: "money" },
            { key: "net", label: "Net", align: "right", kind: "money" }, { key: "tax", label: "VAT", align: "right", kind: "money" },
            { key: "gross", label: "Gross", align: "right", kind: "money" }, { key: "running", label: "Running Total", align: "right", kind: "money" },
          ];

      return {
        title: taxVariant
          ? "Sales — Customer Tax Breakdown (grouped by Month)"
          : "Sales — Breakdown (grouped by Month)",
        subtitle: taxVariant
          ? "T0 is the zero-rated portion (MOTs), T1 the standard-rated remainder."
          : "Labour, Parts and Fixed-price are gross. They exclude the MOT, which is zero-rated and shown only in the Net/Gross totals — the same way GA4 prints it.",
        columns: cols,
        rows: out,
        totals: { date: "Grand Totals", docType: "", docNo: `${tot.count} doc(s)`, acc: "", customer: "", description: "",
          labour: tot.labour, parts: tot.parts, fixed: tot.fixed,
          net0: tot.net0, vat0: tot.vat0, net1: tot.net1, vat1: tot.vat1,
          net: tot.net, tax: tot.tax, gross: tot.gross, running: tot.gross },
      };
    }
    case "sales-summary-extended": {
      const s = await getSalesSummaryIssued(opts);
      return {
        title: "Summary of Sales Issued — Extended",
        subtitle: "Built from web app documents, so it includes invoices GA4 never received. Cost prices aren't stored against line items, so the profit sections show sales only, and receipts aren't split Standard/Account because we don't record which ledger they were taken against.",
        sections: buildSalesSummaryExtendedSections(s),
        columns: [], rows: [],
      } as any;
    }
    case "sales-ledger-month": {
      // GA4's "Summary Ledger ... grouped by Month": one line per period, with a running total.
      const { rows: items } = await getSalesListing(opts);
      const buckets = new Map<string, { period: string; invoices: number; receipts: number; balance: number; net: number; tax: number; gross: number }>();
      for (const it of items) {
        const d = new Date(it.date as any);
        const key = `${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
        const b = buckets.get(key) ?? { period: key, invoices: 0, receipts: 0, balance: 0, net: 0, tax: 0, gross: 0 };
        b.invoices += 1;
        b.receipts = round2(b.receipts + (it.gross - it.balance));
        b.balance = round2(b.balance + it.balance);
        b.net = round2(b.net + it.net);
        b.tax = round2(b.tax + it.tax);
        b.gross = round2(b.gross + it.gross);
        buckets.set(key, b);
      }
      const ordered = Array.from(buckets.values()).sort((a, b) => {
        const [am, ay] = a.period.split("."), [bm, by] = b.period.split(".");
        return ay === by ? Number(am) - Number(bm) : Number(ay) - Number(by);
      });
      let running = 0;
      const rows = ordered.map((b) => { running = round2(running + b.gross); return { ...b, running }; });
      const tot = ordered.reduce((a, b) => ({
        invoices: a.invoices + b.invoices, receipts: round2(a.receipts + b.receipts), balance: round2(a.balance + b.balance),
        net: round2(a.net + b.net), tax: round2(a.tax + b.tax), gross: round2(a.gross + b.gross),
      }), { invoices: 0, receipts: 0, balance: 0, net: 0, tax: 0, gross: 0 });
      return {
        title: "Sales — Summary Ledger (grouped by Month)",
        columns: [
          { key: "period", label: "Period" },
          { key: "invoices", label: "Invoices", align: "right", kind: "int" },
          { key: "receipts", label: "Receipts", align: "right", kind: "money" },
          { key: "balance", label: "Balance", align: "right", kind: "money" },
          { key: "net", label: "Net", align: "right", kind: "money" },
          { key: "tax", label: "VAT", align: "right", kind: "money" },
          { key: "gross", label: "Gross", align: "right", kind: "money" },
          { key: "running", label: "Running Total", align: "right", kind: "money" },
        ],
        rows,
        totals: { period: "Grand Totals", ...tot, running: tot.gross },
      };
    }
    case "mot-sales-summary": {
      // "MOT done" is recorded three different ways depending on where the invoice came from:
      //   motStatus  — set whenever the MOT option is used on the invoice (Pass/Fail/Retest)
      //   subMot*    — GA4's calculated sub-totals; stopped being written in June 2026
      //   line item  — itemType 'MOT', how the web app records it (DocumentDetails Extras)
      // Count a document if ANY of them is present, or MOTs go missing: July 2026 has 71
      // documents with motStatus but 0 with subMot*, and only 41 with a line item.
      const hasSubMot = sql`${_numExpr(serviceHistory.subMotGross)} > 0`;
      const hasStatus = sql`NULLIF(TRIM(${serviceHistory.motStatus}), '') IS NOT NULL`;
      const res: any = await db.execute(sql`
        WITH mot AS (
          SELECT
            CASE WHEN ${hasSubMot} THEN ${_numExpr(serviceHistory.subMotNet)}   ELSE COALESCE(li.net, 0) END AS net,
            CASE WHEN ${hasSubMot} THEN ${_numExpr(serviceHistory.subMotTax)}   ELSE COALESCE(li.tax, 0) END AS tax,
            CASE WHEN ${hasSubMot} THEN ${_numExpr(serviceHistory.subMotGross)} ELSE COALESCE(li.net, 0) + COALESCE(li.tax, 0) END AS gross,
            (${hasSubMot} OR li."documentId" IS NOT NULL) AS priced,
            ${serviceHistory.motStatus} AS status,
            ${serviceHistory.motClass} AS class,
            -- An MOT is normally zero-rated; only treat it as taxable if VAT was actually charged.
            (COALESCE(li.tax, ${_numExpr(serviceHistory.subMotTax)}) > 0) AS taxable
          FROM ${serviceHistory}
          LEFT JOIN (
            SELECT "documentId", SUM(COALESCE("subNet", 0)) AS net, SUM(COALESCE("taxAmount", 0)) AS tax
            FROM "serviceLineItems" WHERE "itemType" = 'MOT' GROUP BY "documentId"
          ) li ON li."documentId" = ${serviceHistory.id}
          WHERE ${inRange}
            AND ${inArray(serviceHistory.docType, ["SI", "XS"])}
            AND (${hasSubMot} OR li."documentId" IS NOT NULL OR ${hasStatus})
        )
        SELECT net, tax, gross, priced, status, class, taxable FROM mot`);
      const rows: any[] = res.rows ?? res;
      const n = (v: any) => Number(v) || 0;
      const isRetest = (s: string) => /retest/i.test(s || "");
      const count = rows.length;
      const unpriced = rows.filter((r) => !r.priced).length;

      // GA4 prints three blocks: the counts, the split between the zero-rated and taxable MOT
      // money, and a per-class table with quantities.
      const full = rows.filter((r) => !isRetest(r.status)).length;
      const retest = rows.filter((r) => isRetest(r.status)).length;
      const sum = (rs: any[], k: string) => round2(rs.reduce((a, r) => a + n(r[k]), 0));
      const exempt = rows.filter((r) => !r.taxable);
      const taxable = rows.filter((r) => r.taxable);

      const byClass = new Map<string, { qty: number; net: number; tax: number }>();
      for (const r of rows) {
        const raw = String(r.class || "").trim();
        // We store the bare MOT class ("4"); GA4 spells its own out ("TYPE A - RETAIL"). Label a
        // bare number so the column reads as something rather than a stray digit.
        const k = raw ? (/^\d+$/.test(raw) ? `Class ${raw}` : raw) : "(no class recorded)";
        const b = byClass.get(k) ?? { qty: 0, net: 0, tax: 0 };
        b.qty += 1; b.net = round2(b.net + n(r.net)); b.tax = round2(b.tax + n(r.tax));
        byClass.set(k, b);
      }
      const classRows = Array.from(byClass.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));

      return {
        title: "Summary of MOT Sales Issued",
        // Some documents record that an MOT happened without storing what it was charged at
        // (motCost is empty across the whole table), so say so rather than let the money read
        // as though it covered every MOT counted.
        ...(unpriced ? { subtitle: `${unpriced} of ${count} MOT(s) have no MOT amount recorded, so the values below exclude them.` } : {}),
        sections: [
          {
            title: "MOT Counts", captions: ["Full", "Retest", "Duplicate"],
            rows: [{ label: "MOT's", v: [full || null, retest || null, null], kind: "int" }],
          },
          {
            title: "Breakdown by Tax", captions: ["Net", "Tax", "Gross"],
            rows: [
              { label: "MOT (tax exempt)", v: [sum(exempt, "net"), null, sum(exempt, "gross")], kind: "money" },
              { label: "MOT (taxable)", v: [sum(taxable, "net"), sum(taxable, "tax"), sum(taxable, "gross")], kind: "money" },
              { label: "Total", v: [sum(rows, "net"), sum(rows, "tax"), sum(rows, "gross")], kind: "money", bold: true, total: true },
            ],
          },
          {
            title: "Breakdown by Class", captions: ["Net", "Tax", "Gross"],
            rows: [
              ...classRows.map(([label, b]) => ({
                label, qty: b.qty, v: [b.net, b.tax, round2(b.net + b.tax)], kind: "money" as const,
              })),
              { label: "Total", v: [sum(rows, "net"), sum(rows, "tax"), sum(rows, "gross")], kind: "money", bold: true, total: true },
            ],
          },
        ],
        columns: [], rows: [],
      } as any;
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
    // Real GA4 lists the open document alongside its siblings in its own History tab (it's the
    // vehicle's full record set, not "everything but this one") — don't filter it out.
    history = await getServiceHistoryByVehicleId(doc.vehicleId);
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
    ga4Number: serviceHistory.ga4Number,
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
  // Prefix (1983-2001) A999 AAA and suffix (1963-1983) AAA 999A plates are also real formats and
  // must be trusted as-is. Without this, W466 YHJ (a Toyota) was coerced to the current-format
  // template as WA66YHJ — a DIFFERENT vehicle — so a job sheet silently changed registration.
  if (/^[A-Z][0-9]{1,3}[A-Z]{3}$/.test(s)) return s;     // prefix   A999 AAA
  if (/^[A-Z]{3}[0-9]{1,3}[A-Z]$/.test(s)) return s;     // suffix   AAA 999A
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
      // Set by either enrichment source below if a forced lookup's fresh make conflicts with what's
      // already stored — see the long comment further down for why that blocks the overwrite.
      let identityConflict = false;
      let reassignWarning: string | null = null;
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
          const swsMake = clean(u.make) || (fn ? fn.trim().split(/\s+/)[0] : "");
          // force = an explicit lookup after the reg was changed → OVERWRITE the identity fields
          // with the fresh data (clears stale data from a previous, wrong reg). BUT a registration
          // can also be reused/transferred onto a genuinely different physical vehicle (private
          // plates move with the owner, not the car — see [[registration-reuse-across-vehicles]]),
          // and this existing row can be that OLDER vehicle's real, GA4-synced record. If the
          // fresh make doesn't match what's already stored, treat it as a reassigned plate, not a
          // typo correction: don't touch this row's identity, and warn instead of overwriting a
          // different vehicle's history in place.
          const storedMake = String(v.make || "").trim().toUpperCase();
          const freshMake = String(swsMake || "").trim().toUpperCase();
          if (force && storedMake && freshMake && storedMake !== freshMake
              && !storedMake.startsWith(freshMake) && !freshMake.startsWith(storedMake)) {
            identityConflict = true;
            reassignWarning = `${reg} is already on file as a ${v.make} ${v.model || ""}`.trim()
              + ` — the fresh lookup found a ${swsMake}, which looks like a different vehicle now carrying this plate. Nothing was overwritten; use "New Vehicle" if this is a different car.`;
          }
          const effectiveForce = force && !identityConflict;
          const want = (field: string) => effectiveForce || empty(v[field]);
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
          if (effectiveForce) { v.engineNo = updates.engineNo = null; updates.comprehensiveTechnicalData = sws; v.comprehensiveTechnicalData = sws; } // drop stale physical engine no + refresh cached data
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
            // DVLA is free and authoritative for UK plates — but that also makes it the most
            // reliable place to catch a reassigned plate (see the identityConflict comment above):
            // if DVLA's make doesn't match what's already stored, this row is the OLD vehicle that
            // used to hold this reg, not a typo to correct.
            if (force && !identityConflict && d.make) {
              const dvlaMake = String(d.make).trim().toUpperCase();
              const storedMake2 = String(v.make || "").trim().toUpperCase();
              if (storedMake2 && dvlaMake !== storedMake2 && !storedMake2.startsWith(dvlaMake) && !dvlaMake.startsWith(storedMake2)) {
                identityConflict = true;
                reassignWarning = reassignWarning || (`${reg} is already on file as a ${v.make} ${v.model || ""}`.trim()
                  + ` — DVLA now returns a ${d.make}, which looks like a different vehicle now carrying this plate. Nothing was overwritten; use "New Vehicle" if this is a different car.`);
              }
            }
            const effectiveForce2 = force && !identityConflict;
            // DVLA make is authoritative for UK plates — fill it when UKVD couldn't (e.g. grey imports
            // where UKVD returns no/"NULL" make), so the record never shows a blank or "NULL" make.
            if ((effectiveForce2 || empty(v.make)) && d.make) { v.make = du.make = String(d.make).toUpperCase(); }
            if ((effectiveForce2 || empty(v.colour)) && d.colour) { v.colour = d.colour; du.colour = d.colour; }
            // date of first registration — prefer DVLA's month, else the year of manufacture
            if ((effectiveForce2 || empty(v.dateOfRegistration)) && (d.monthOfFirstRegistration || d.yearOfManufacture)) {
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
          if (linked) return { found: true, source: "database", vehicle: v, customer: linked, warning: reassignWarning || await ukvdWarning() };
        }
        if (prior && (prior.customerName || prior.custSurname || prior.company)) lastCustomer = prior;
      }
      return { found: true, source: "database", vehicle: v, customer: cust, lastCustomer, warning: reassignWarning || await ukvdWarning() };
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
  // MOT expiry comes from the DVSA MOT History API, not DVLA VES's own motExpiryDate field —
  // VES lags behind a freshly-completed test (same distinction lookupVehicleForReg already
  // makes), so a job sheet reopened right after a renewal would otherwise keep showing "Expired".
  try {
    const { getVehicleDetails } = await import("./dvlaApi");
    const { getCurrentMotExpiry } = await import("./motApi");
    const [d, motExp]: any = await Promise.all([getVehicleDetails(reg).catch(() => null), getCurrentMotExpiry(reg).catch(() => null)]);
    if (d) { out.taxStatus = d.taxStatus ?? null; out.taxDueDate = d.taxDueDate ?? null; }
    out.motExpiry = motExp ?? d?.motExpiryDate ?? null;
  } catch { /* DVLA/DVSA unavailable */ }

  return out;
}

/** Free, time-sensitive DVLA refresh for MOT expiry + tax — the vehicle page called this
 *  automatically before this fix; it only ever read the cached vehicles row, which could be
 *  weeks stale (a renewed MOT still showed "Expired"). SWS/UKVD spec data stays cached/manual
 *  ("Fetch Premium Data") since that costs money per call; DVLA is free, so there's no reason
 *  not to refresh it on every view. Persists the fresh values back so the cache catches up too. */
export async function refreshVehicleMotTax(registration: string) {
  const reg = normReg(registration);
  if (!reg) return null;
  try {
    const { getVehicleDetails } = await import("./dvlaApi");
    const { getCurrentMotExpiry } = await import("./motApi");
    // MOT expiry from the DVSA MOT History API, not DVLA VES's own motExpiryDate — VES lags
    // behind a just-completed test, so a car reopened right after its MOT would still read
    // "Expired" if this only trusted VES (same distinction lookupVehicleForReg/liveVehicleTech
    // already make).
    const [d, motExp] = await Promise.all([getVehicleDetails(reg).catch(() => null), getCurrentMotExpiry(reg).catch(() => null)]);
    if (!d && !motExp) return null;
    const patch: any = {};
    if (motExp) patch.motExpiryDate = motExp;
    else if (d?.motExpiryDate) patch.motExpiryDate = new Date(d.motExpiryDate);
    if (d?.taxStatus) patch.taxStatus = d.taxStatus;
    if (d?.taxDueDate) patch.taxDueDate = new Date(d.taxDueDate);
    if (Object.keys(patch).length) {
      const db = await getDb();
      if (db) {
        await db.update(vehicles).set({ ...patch, lastChecked: new Date() })
          .where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`);
      }
    }
    return { motExpiryDate: patch.motExpiryDate ?? null, taxStatus: patch.taxStatus ?? null, taxDueDate: patch.taxDueDate ?? null };
  } catch {
    return null; // DVLA unavailable — page keeps showing the cached value
  }
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
  // Only GA4-sourced rows count toward dbMax — web-native placeholders (externalId LIKE 'WEB-%')
  // are themselves guesses-ahead, so including them would compound the gap on every call instead
  // of tracking GA4's real pace.
  const r = await db.select({ m: sql<number>`MAX((NULLIF(regexp_replace(${serviceHistory.docNo}, '[^0-9]', '', 'g'), ''))::bigint)` })
    .from(serviceHistory).where(and(eq(serviceHistory.docType, docType), sql`(${serviceHistory.externalId} IS NULL OR ${serviceHistory.externalId} NOT LIKE 'WEB-%')`));
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
  return db.select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, postcode: customers.postcode, address: customers.address, accountNumber: customers.accountNumber })
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
  // A document's own registration text can be spaced/unspaced differently from how staff type
  // it ("FM13KKB" vs "FM13 KKB" — the same "Reg format split matching" issue seen everywhere
  // else) — a plain ilike misses every doc stored the other way. Normalize both sides, and also
  // check the joined vehicle's registration so a doc whose own reg column is blank still matches.
  const docsWhere = allTokens((t) => { const l = likeOf(t); return [
    ilike(serviceHistory.docNo, l), ilike(serviceHistory.ga4Number, l),
    sql`REPLACE(UPPER(${serviceHistory.registration}), ' ', '') ILIKE ${regLikeOf(t)}`,
    sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') ILIKE ${regLikeOf(t)}`,
    ilike(serviceHistory.customerName, l), ilike(serviceHistory.accountNumber, l),
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
        customerPhone: sql<string>`COALESCE(NULLIF(${serviceHistory.custMobile}, ''), NULLIF(${serviceHistory.custTelephone}, ''), ${customers.phone})`,
        accountNumber: serviceHistory.accountNumber, date: serviceHistory.dateCreated, dateIssued: serviceHistory.dateIssued, make: vehicles.make, model: vehicles.model,
        description: serviceHistory.description, // job-sheet work notes → at-a-glance summary/badges
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
  const cv = custIds.length
    ? await db.select({ id: vehicles.id, customerId: vehicles.customerId, registration: vehicles.registration, make: vehicles.make, model: vehicles.model })
        .from(vehicles).where(inArray(vehicles.customerId, custIds)).orderBy(vehicles.registration)
    : [];

  // Last visit per vehicle = the newest document (invoice/job sheet/etc.) for that car — computed
  // once for every vehicle id we might display (both the top-level Vehicles matches and each
  // matched customer's attached cars) so both can show "last visited in this car".
  const allVehIds = Array.from(new Set([...veh.map((v) => v.id), ...cv.map((v) => v.id)].filter((id): id is number => id != null)));
  const lastVisitByVeh = new Map<number, string>();
  if (allVehIds.length) {
    const visits = await db.select({ vehicleId: serviceHistory.vehicleId, last: sql<string>`MAX(COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated}))` })
      .from(serviceHistory).where(inArray(serviceHistory.vehicleId, allVehIds)).groupBy(serviceHistory.vehicleId);
    for (const r of visits) if (r.vehicleId != null && r.last) lastVisitByVeh.set(r.vehicleId, r.last);
  }

  const vehByCust = new Map<number, { registration: string; make: string | null; model: string | null; lastVisit: string | null }[]>();
  for (const v of cv) {
    if (v.customerId == null || !v.registration) continue;
    const list = vehByCust.get(v.customerId) || [];
    list.push({ registration: v.registration, make: v.make, model: v.model, lastVisit: v.id != null ? lastVisitByVeh.get(v.id) || null : null });
    vehByCust.set(v.customerId, list);
  }
  const customersWithVehicles = cust.map((c) => ({ ...c, vehicles: (vehByCust.get(c.id) || []).slice(0, 6) }));

  // The same person is very often duplicated across several `customers` rows — same phone,
  // near-identical name/address formatting ("Mr A Miller" vs "Mr Miller") — which showed the
  // same customer 2-3 times in results instead of once. Group by normalized phone (the same
  // identity key already used for opt-out enforcement — see "duplicate-phone hazard") and merge
  // into one entry with the combined vehicle list, keeping the fullest name/address on file.
  const normPhoneKey = (p: any) => { let s = String(p || "").replace(/\D/g, ""); if (s.startsWith("44")) s = s.slice(2); else if (s.startsWith("0")) s = s.slice(1); return s; };
  const byLen = (a: string | null | undefined, b: string | null | undefined) => (b?.length || 0) - (a?.length || 0);
  const phoneGroups = new Map<string, typeof customersWithVehicles>();
  const singles: typeof customersWithVehicles = [];
  for (const c of customersWithVehicles) {
    const key = normPhoneKey(c.phone);
    if (!key || key.length < 6) { singles.push(c); continue; }
    if (!phoneGroups.has(key)) phoneGroups.set(key, []);
    phoneGroups.get(key)!.push(c);
  }
  const merged = [
    ...Array.from(phoneGroups.values()).map((members) => {
      const primary = [...members].sort((a, b) => byLen(a.name, b.name))[0];
      const address = [...members].map((m) => m.address).sort(byLen)[0] || primary.address;
      const postcode = members.find((m) => m.postcode)?.postcode || primary.postcode;
      const vehMap = new Map<string, { registration: string; make: string | null; model: string | null; lastVisit: string | null }>();
      for (const m of members) for (const v of m.vehicles) vehMap.set(v.registration.toUpperCase().replace(/\s+/g, ""), v);
      return { ...primary, address, postcode, vehicles: Array.from(vehMap.values()).slice(0, 6), ids: members.map((m) => m.id) };
    }),
    ...singles.map((c) => ({ ...c, ids: [c.id] })),
  ];

  // Last visit across every merged customer id — so a duplicate-split customer still shows
  // when they were actually last in, not just whichever split happened to have recent history.
  const allMergedIds = merged.flatMap((c) => c.ids);
  const lastVisitByCust = new Map<number, string>();
  if (allMergedIds.length) {
    const visits = await db.select({ customerId: serviceHistory.customerId, last: sql<string>`MAX(COALESCE(${serviceHistory.dateIssued}, ${serviceHistory.dateCreated}))` })
      .from(serviceHistory).where(inArray(serviceHistory.customerId, allMergedIds)).groupBy(serviceHistory.customerId);
    for (const r of visits) if (r.customerId != null && r.last) lastVisitByCust.set(r.customerId, r.last);
  }
  const customersMerged = merged.map((c) => ({
    ...c,
    lastVisit: c.ids.reduce((max: string | null, id) => { const v = lastVisitByCust.get(id); return v && (!max || v > max) ? v : max; }, null),
  })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Last visit per matched vehicle (computed once, above, alongside every attached-customer car).
  const vehiclesWithVisit = veh.map((v) => ({ ...v, lastVisit: (v.id != null && lastVisitByVeh.get(v.id)) || null }));

  return { customers: customersMerged, vehicles: vehiclesWithVisit, documents: docs, documentsTotal };
}

// Sales forecourt stock with DVLA MOT/tax. Imported via scripts/import-sales-stock.ts.
/**
 * Stock list, plus the two things the forecourt view needs that aren't on the stock row itself:
 * when the car was bought (from its car deal) and the details the sales invoice needs — some of
 * which only exist on the garage's own vehicle record, as the stocklist carries no engine number.
 *
 * Both joins are LATERAL so a car with more than one deal, or a duplicate vehicle row, still
 * yields exactly one row per stock car rather than silently multiplying the list.
 */
export async function getSalesStock() {
  const db = await getDb();
  if (!db) return [];
  const res: any = await db.execute(sql`
    SELECT s.*,
           d."purchaseDate" "purchasedOn", d."purchaseCost" "purchasedFor", d."source" "purchasedFrom",
           d."id" "dealId", d."reconditioningCost" "purchaseOnCosts", d."onCostVat" "purchaseOnCostVat",
           v."engineNo" "vehEngineNo", v."vin" "vehVin",
           v."dateOfRegistration" "vehFirstRegistered", v."derivative" "vehDerivative"
    FROM "salesStock" s
    LEFT JOIN LATERAL (
      SELECT cd."id", cd."purchaseDate", cd."purchaseCost", cd."source", cd."reconditioningCost", cd."onCostVat" FROM "carDeals" cd
      WHERE cd."salesStockId" = s."id"
      ORDER BY cd."purchaseDate" ASC NULLS LAST, cd."id" ASC LIMIT 1
    ) d ON TRUE
    LEFT JOIN LATERAL (
      SELECT vv."engineNo", vv."vin", vv."dateOfRegistration", vv."derivative" FROM "vehicles" vv
      WHERE UPPER(REPLACE(vv."registration", ' ', '')) = UPPER(REPLACE(COALESCE(s."registration", ''), ' ', ''))
      LIMIT 1
    ) v ON TRUE
    ORDER BY s."price" DESC NULLS LAST`);
  return res.rows || [];
}

// Re-fetch DVLA MOT expiry + tax status for every stock car (free). Used by the "Refresh" button.
export async function refreshSalesStockMotTax() {
  const db = await getDb();
  if (!db) return { updated: 0 };
  const cars = await db.select({
    id: salesStock.id, registration: salesStock.registration,
    mileage: salesStock.mileage, registrationDate: salesStock.registrationDate,
    make: salesStock.make, model: salesStock.model, colour: salesStock.colour, fuelType: salesStock.fuelType,
    vin: salesStock.vin, engineNo: salesStock.engineNo,
  }).from(salesStock);
  const { getVehicleDetails } = await import("./dvlaApi");
  const { getMOTHistory, getLatestMOTExpiry } = await import("./motApi");
  const { fetchUKVDData } = await import("./ukvd");
  const toDate = (x: any) => { if (!x) return null; const d = x instanceof Date ? x : new Date(x); return isNaN(d.getTime()) ? null : d; };
  let updated = 0, filled = 0;
  const gapsFilled: Record<string, number> = {};
  for (const car of cars) {
    if (!car.registration) continue;
    const reg = String(car.registration).toUpperCase().replace(/\s+/g, "");
    try {
      // MOT history from DVSA (authoritative for expiry, and the only source of a mileage
      // reading); tax and the vehicle's registry details from DVLA VES.
      const [d, mot]: any = await Promise.all([getVehicleDetails(reg).catch(() => null), getMOTHistory(reg).catch(() => null)]);
      const motExp = mot ? getLatestMOTExpiry(mot) : null;
      const set: any = { taxStatus: d?.taxStatus || null, taxDueDate: toDate(d?.taxDueDate), motTaxChecked: new Date() };
      if (motExp) set.motExpiryDate = motExp;

      // Backfill only — a blank is filled from the registry, but anything already on the stock
      // row is left alone. The stocklist is what the forecourt advertises and must win.
      const fill = (col: string, value: any) => {
        if (value == null || value === "") return;
        set[col] = value;
        gapsFilled[col] = (gapsFilled[col] || 0) + 1;
        filled++;
      };
      if (car.mileage == null) {
        // Latest test by completion date — motTests aren't guaranteed to be ordered.
        const readings = (mot?.motTests || [])
          .filter((t: any) => t.odometerValue && /mi/i.test(t.odometerUnit || "mi"))
          .sort((a: any, b: any) => +new Date(b.completedDate) - +new Date(a.completedDate));
        const miles = Number(String(readings[0]?.odometerValue || "").replace(/\D/g, ""));
        if (Number.isFinite(miles) && miles > 0) fill("mileage", miles);
      }

      // Chassis and engine number exist on no free source — only the paid UKVD lookup returns
      // them. It is billed per call, so it only fires for a car actually short of something it
      // can supply; a Refresh over complete stock costs nothing.
      const wantsUkvd = !car.vin || !car.engineNo || !car.registrationDate;
      const ukvd: any = wantsUkvd ? await fetchUKVDData(reg).catch(() => null) : null;
      if (!car.vin) fill("vin", ukvd?.vin);
      if (!car.engineNo) fill("engineNo", ukvd?.engineNumber);

      if (!car.registrationDate) {
        // Registered-in-the-UK from the paid lookup is the date the invoice asks for and the only
        // full one; DVSA's first-use date is next, and DVLA's month-only value is the last resort.
        fill("registrationDate", toDate(ukvd?.firstRegisteredUk)
          ?? toDate(mot?.firstUsedDate)
          ?? (d?.monthOfFirstRegistration ? toDate(`${d.monthOfFirstRegistration}-01`) : null));
      }
      if (!car.make) fill("make", (d?.make || mot?.make || "").toUpperCase() || null);
      if (!car.model) fill("model", (mot?.model || "").toUpperCase() || null);
      if (!car.colour) fill("colour", (d?.colour || mot?.primaryColour || "").toUpperCase() || null);
      if (!car.fuelType) fill("fuelType", d?.fuelType || mot?.fuelType || null);

      await db.update(salesStock).set(set).where(eq(salesStock.id, car.id));
      updated++;
    } catch { /* skip this reg */ }
  }
  return { updated, filled, gapsFilled };
}

export async function getCustomerContacts(customerId: number) {
  const db = await getDb();
  if (!db) return [];
  const r = (await db.select({ altContacts: customers.altContacts }).from(customers).where(eq(customers.id, customerId)).limit(1))[0];
  return Array.isArray(r?.altContacts) ? r!.altContacts : [];
}

// Save a customer's extra contacts (family members, a second work address, the accounts
// department) as [{ name, phone, email }]. Email was added alongside phone because plenty of
// customers genuinely have more than one — a personal address and a company one — and the
// single `customers.email` column forced a choice between them.
export async function saveCustomerContacts(customerId: number, contacts: { name?: string; phone?: string; email?: string }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const clean = (contacts || [])
    .map((c) => ({ name: String(c.name ?? "").trim(), phone: String(c.phone ?? "").trim(), email: String(c.email ?? "").trim() }))
    .filter((c) => c.name || c.phone || c.email)
    .slice(0, 20);
  await db.update(customers).set({ altContacts: clean }).where(eq(customers.id, customerId));
  return { saved: clean.length };
}

// ─── Duplicate customer review ───────────────────────────────────────────────
export function normPhoneKey(raw: any): string | null {
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
export async function mergeCustomerRecords(primaryId: number, secondaryIds: number[], force = false) {
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
  // `force` (only set by an explicit, human-reviewed "merge linked accounts" action on the
  // customer page — never the default /duplicates flow) skips this specifically because that
  // flow already showed the user exactly which accounts/vehicles/invoices are involved.
  const distinctAccts = Array.from(new Set([primary, ...secs].map((r: any) => String(r.accountNumber || "").trim().toUpperCase()).filter(Boolean)));
  if (!force && distinctAccts.length > 1)
    throw new Error(`Won't merge across different GA4 account numbers (${distinctAccts.join(" ≠ ")}). These are distinct accounts — use "Not duplicates" if they really are separate.`);
  let moved = 0;
  // node-postgres reports `rowCount`; the mysql-style keys were always undefined here, so the
  // merge reported "0 rows moved" even when it had moved hundreds.
  for (const t of FK) { const r: any = await db.update(t as any).set({ customerId: primaryId }).where(inArray((t as any).customerId, secondaryIds)); moved += (r as any).rowCount ?? (r as any).rowsAffected ?? (r as any)[0]?.affectedRows ?? 0; }
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
  const addAlt = (c: { name?: string; phone?: string; email?: string }) => {
    // Dedupe on the NORMALIZED phone: the same mobile arrives as "07970111327" on one record and
    // "+447970111327" on another, and a raw string compare kept both (Mrs Perl landed twice).
    const k = (c.phone ? normPhoneKey(c.phone) : null)
      || String(c.email || c.name || "").replace(/\s+/g, "").toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    alt.push({ name: c.name || "", phone: c.phone || "", email: c.email || "" });
  };
  for (const r of all) for (const ct of parse(r.altContacts)) addAlt(ct);
  // A merge keeps only ONE primary phone/email (see `pick` below), so carry every OTHER
  // record's contact details down into the alt list rather than deleting them with the record.
  // Without this, folding Benjamin Perl into Sixtrees Ltd would have silently destroyed
  // bperl@sixtrees.co.uk and his mobile — the only way to reach him.
  const primaryPhoneKey = String(primary.phone || "").replace(/\s+/g, "").toLowerCase();
  const primaryEmailKey = String(primary.email || "").trim().toLowerCase();
  for (const s of secs) {
    const ph = String(s.phone || "").trim(), em = String(s.email || "").trim();
    const phDup = !ph || ph.replace(/\s+/g, "").toLowerCase() === primaryPhoneKey;
    const emDup = !em || em.toLowerCase() === primaryEmailKey;
    if (phDup && emDup) continue;
    addAlt({ name: s.name || "", phone: phDup ? "" : ph, email: emDup ? "" : em });
  }
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
  docStatus?: string; orderRef?: string; department?: string; terms?: string; description?: string; insuranceCompany?: string; insurerAddress?: string; insurerEmail?: string;
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
  const vehicleHadOwner = customerId != null; // captured before 1b/1c can reassign customerId

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

  // 1d) if this doc links an EXISTING customer to a vehicle that has no owner yet (a brand-new
  // vehicle, or one nobody had claimed), adopt it — otherwise every future lookup for that vehicle
  // (MOT reminders, the appointment-booking dialog, VehicleDetails) comes back "no customer" despite
  // this very document's own clear customer link. Never overwrites a vehicle with a different owner.
  const finalCustomerId = input.customerId ?? customerId;
  if (vehicleId && finalCustomerId && !vehicleHadOwner) {
    await db.update(vehicles).set({ customerId: finalCustomerId }).where(eq(vehicles.id, vehicleId));
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
    insurerAddress: input.insurerAddress, insurerEmail: input.insurerEmail,
    description: input.description, staffSalesPerson: input.staffSalesPerson, staffTechnician: input.staffTechnician,
    staffRoadTester: input.staffRoadTester, staffMotTester: input.staffMotTester, motClass: input.motClass, motStatus: input.motStatus,
    totalNet: String(totalNet.toFixed(2)), totalTax: String(totalTax.toFixed(2)), totalGross: String(totalGross.toFixed(2)),
    subPartsNet: String(subPartsNet.toFixed(2)), subPartsTax: String(subPartsTax.toFixed(2)),
    subLabourNet: String(subLabourNet.toFixed(2)), subLabourTax: String(subLabourTax.toFixed(2)),
  });

  let docId = input.id;
  if (docId) {
    await db.update(serviceHistory).set(docFields).where(eq(serviceHistory.id, docId));
    // "Full VAT to customer" excess jobs (see createExcessInvoice): the customer's excess invoice
    // carries the WHOLE job's VAT, captured at the time the excess was raised. If the job's own
    // work/parts are edited afterwards (changing its true VAT), the linked excess invoice would
    // otherwise go stale — re-sync it here so it always reflects the job's current VAT, not a
    // frozen snapshot from whenever the excess was first created.
    if (docType !== "XS") {
      const row = (await db.select({ excessFullVatToCustomer: serviceHistory.excessFullVatToCustomer, relatedDocId: serviceHistory.relatedDocId, excessNet: serviceHistory.excessNet })
        .from(serviceHistory).where(eq(serviceHistory.id, docId)).limit(1))[0];
      if (row?.excessFullVatToCustomer && row.relatedDocId) {
        const xsNet = round2(Number(row.excessNet) || 0);
        const xsGross = round2(xsNet + totalTax);
        const xsReceipts = Number((await db.select({ totalReceipts: serviceHistory.totalReceipts }).from(serviceHistory).where(eq(serviceHistory.id, row.relatedDocId)).limit(1))[0]?.totalReceipts) || 0;
        await db.update(serviceHistory).set({
          totalTax: String(totalTax.toFixed(2)), totalGross: String(xsGross.toFixed(2)),
          balance: String((xsGross - xsReceipts).toFixed(2)),
        }).where(eq(serviceHistory.id, row.relatedDocId));
      }
      if (row?.relatedDocId) await recomputeDocBalance(docId); // refresh this doc's own stored balance too (list views/reports read it directly)
    }
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
    staffMotTester: doc.staffMotTester, motClass: doc.motClass, motStatus: doc.motStatus, insuranceCompany: doc.insuranceCompany, insurerAddress: (doc as any).insurerAddress, insurerEmail: (doc as any).insurerEmail, docStatus: "New",
    lineItems: (lineItems || []).map((li: any) => ({
      itemType: li.itemType, description: li.description, partNumber: li.partNumber, nominalCode: li.nominalCode,
      quantity: li.quantity, unitPrice: li.unitPrice, vatRate: li.vatRate, subNet: li.subNet, taxAmount: li.taxAmount,
      discount: li.discount, discountType: li.discountType, // carry the per-line discount across convert/copy
    })),
  });

  // A converted/copied doc doesn't carry its own policy-excess link across via saveDocument (those
  // fields aren't part of the normal save form) — copy them onto the new doc directly, and if a
  // customer excess invoice (XS) is linked, re-point IT at the new doc too. Otherwise deleting the
  // source below (deleteDocuments) would clear the XS invoice's link as a "dangling reference" to
  // a doc that no longer exists, orphaning the very invoice this was created for.
  if ((doc as any).relatedDocId || Number((doc as any).excessNet) > 0) {
    const db = await getDb();
    if (db && created?.id) {
      await db.update(serviceHistory).set({
        relatedDocId: (doc as any).relatedDocId, relatedDocNo: (doc as any).relatedDocNo,
        excessNet: (doc as any).excessNet, excessTax: (doc as any).excessTax, excessGross: (doc as any).excessGross,
        excessFullVatToCustomer: (doc as any).excessFullVatToCustomer,
      }).where(eq(serviceHistory.id, created.id));
      if ((doc as any).relatedDocId) {
        const newDocNo = (await db.select({ docNo: serviceHistory.docNo }).from(serviceHistory).where(eq(serviceHistory.id, created.id)).limit(1))[0]?.docNo;
        await db.update(serviceHistory).set({
          relatedDocId: created.id, relatedDocNo: newDocNo,
        }).where(eq(serviceHistory.id, (doc as any).relatedDocId));
      }
    }
  }

  // Carry the AI job guide across too — it describes the same work, and the invoice is
  // where the technician/customer conversation usually happens.
  if ((doc as any).jobGuide && created?.id) {
    const db = await getDb();
    if (db) await db.update(serviceHistory).set({ jobGuide: (doc as any).jobGuide }).where(eq(serviceHistory.id, created.id));
  }

  // Pasted images (diagram screenshots etc.) belong to the job — re-point them at the new doc.
  // The source is usually deleted below on a convert, so move rather than copy.
  if (created?.id && created.id !== id) {
    const db = await getDb();
    if (db) {
      const { docAttachments } = await import("../drizzle/schema");
      await db.update(docAttachments).set({ documentId: created.id }).where(eq(docAttachments.documentId, id));
    }
  }

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
  // a main insurance invoice has its excess paid on the separate XS invoice, so deduct it here.
  // "Full VAT to customer" jobs (see createExcessInvoice) move the WHOLE job's VAT onto the
  // customer's excess invoice, not just VAT on the excess itself — excessGross on the main doc is
  // deliberately just the bare excess amount (for correct display), so the deduction here has to
  // separately add the job's own VAT back in to land on the true insurer balance.
  const excess = doc.docType === "XS" ? 0
    : (doc as any).excessFullVatToCustomer ? (Number(doc.excessNet) || 0) + (Number(doc.totalTax) || 0)
    : (Number(doc.excessGross) || 0);
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
export async function createExcessInvoice(input: { mainDocId: number; excessNet: number; discount?: number; vatRegistered?: boolean; fullVatToCustomer?: boolean }) {
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
  // "Full VAT to customer" (commercial/fleet arrangement): the excess itself carries no VAT — the
  // ENTIRE job's VAT is charged on this excess invoice instead, so a VAT-registered policyholder
  // can reclaim it in full. Per the insurer's approved-repairer scheme rules (e.g. Allianz), the
  // main invoice (below) is made out to the CUSTOMER — never the insurer — and shows the full job
  // total, the excess+VAT collected from the customer, and the balance due from the insurer.
  // Otherwise (the standard case), VAT applies to the excess amount itself at 20%/0%.
  const fullVat = !!input.fullVatToCustomer;
  const vatRate = fullVat ? 0 : (input.vatRegistered ? 20 : 0);
  const tax = fullVat ? round2(Number(main.totalTax) || 0) : round2(net * vatRate / 100);
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
    excessDiscount: String(discount.toFixed(2)), custVatRegistered: (fullVat || input.vatRegistered) ? 1 : 0,
    excessNet: String(net.toFixed(2)), excessTax: String(tax.toFixed(2)), excessGross: String(gross.toFixed(2)),
    totalNet: String(net.toFixed(2)), totalTax: String(tax.toFixed(2)), totalGross: String(gross.toFixed(2)),
    balance: String(gross.toFixed(2)), excessFullVatToCustomer: fullVat ? 1 : 0,
    description: fullVat ? `Policy excess re. Invoice ${main.docNo} (VAT charged in full on this invoice)` : `Policy excess re. Invoice ${main.docNo}`,
  });
  const [{ id: xsId }] = await db.insert(serviceHistory).values(xsFields).returning({ id: serviceHistory.id });
  await db.insert(serviceLineItems).values({
    documentId: xsId, externalId: `WEB-LI-XS-${xsId}-${Date.now()}`,
    itemType: "Excess", description: `Insurance policy excess (re. Invoice ${main.docNo})`,
    quantity: "1", unitPrice: String(net.toFixed(2)), subNet: String(net.toFixed(2)),
    taxAmount: String(tax.toFixed(2)), vatRate: String(vatRate.toFixed(2)),
  } as any);

  // 2) record the excess on the main invoice and deduct it (insurer pays the reduced amount),
  //    and record the insurer for reference (Insurance panel) — the main invoice itself is NEVER
  //    addressed to the insurer when fullVat is set (see getRichPDF's billTo), per the insurer's
  //    approved-repairer scheme rules.
  // The excess itself never carries VAT in "full VAT to customer" mode (per the user: "no VAT on
  // the excess") — `tax`/`gross` above are the XS/customer invoice's OWN figures (excess + the
  // whole job's VAT); the main doc's excess fields must stay just the bare excess amount, or
  // "Excess (gross)" on the main invoice's side panel would misleadingly show excess+full-VAT.
  // totalNet/totalTax/totalGross on the main doc are deliberately left untouched — they remain the
  // true full job value for accounting/VAT-return purposes, and the print output shows that same
  // full value (see getRichPDF) — nothing is hidden from the invoice sent to the insurer.
  const mainExcessTax = fullVat ? 0 : tax;
  const mainExcessGross = fullVat ? net : gross;
  await db.update(serviceHistory).set({
    relatedDocId: xsId, relatedDocNo: docNo, insuranceCompany: insurer,
    excessNet: String(net.toFixed(2)), excessTax: String(mainExcessTax.toFixed(2)), excessGross: String(mainExcessGross.toFixed(2)),
    excessFullVatToCustomer: fullVat ? 1 : 0,
  }).where(eq(serviceHistory.id, main.id));
  await recomputeDocBalance(main.id);

  await logDocEvent(xsId, "created"); // audit: excess invoice raised
  return { id: xsId, docNo };
}

/** Recompute an existing XS excess invoice's figures (and its main invoice's excess) after editing. */
export async function updateExcessInvoice(input: { docId: number; excessNet: number; discount?: number; vatRegistered?: boolean; fullVatToCustomer?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const xs = (await db.select().from(serviceHistory).where(eq(serviceHistory.id, input.docId)).limit(1))[0];
  if (!xs) throw new Error("Excess invoice not found");
  const main = xs.relatedDocId ? (await db.select().from(serviceHistory).where(eq(serviceHistory.id, xs.relatedDocId)).limit(1))[0] : null;
  const discount = Math.max(0, Number(input.discount) || 0);
  const net = round2(Math.max(0, Number(input.excessNet) || 0) - discount);
  const fullVat = !!input.fullVatToCustomer;
  const vatRate = fullVat ? 0 : (input.vatRegistered ? 20 : 0);
  const tax = fullVat ? round2(Number(main?.totalTax) || 0) : round2(net * vatRate / 100);
  const gross = round2(net + tax);

  await db.update(serviceHistory).set({
    excessDiscount: String(discount.toFixed(2)), custVatRegistered: (fullVat || input.vatRegistered) ? 1 : 0,
    excessNet: String(net.toFixed(2)), excessTax: String(tax.toFixed(2)), excessGross: String(gross.toFixed(2)),
    totalNet: String(net.toFixed(2)), totalTax: String(tax.toFixed(2)), totalGross: String(gross.toFixed(2)),
    balance: String(gross.toFixed(2)), excessFullVatToCustomer: fullVat ? 1 : 0,
    description: fullVat ? `Policy excess re. Invoice ${xs.relatedDocNo} (VAT charged in full on this invoice)` : `Policy excess re. Invoice ${xs.relatedDocNo}`,
  }).where(eq(serviceHistory.id, input.docId));

  // refresh the single excess line item
  await db.delete(serviceLineItems).where(eq(serviceLineItems.documentId, input.docId));
  await db.insert(serviceLineItems).values({
    documentId: input.docId, externalId: `WEB-LI-XS-${input.docId}-${Date.now()}`,
    itemType: "Excess", description: `Insurance policy excess${xs.relatedDocNo ? ` (re. Invoice ${xs.relatedDocNo})` : ""}`,
    quantity: "1", unitPrice: String(net.toFixed(2)), subNet: String(net.toFixed(2)),
    taxAmount: String(tax.toFixed(2)), vatRate: String(vatRate.toFixed(2)),
  } as any);

  // mirror the excess onto the main insurance invoice — same net-tax split as createExcessInvoice:
  // the excess itself never carries VAT in "full VAT to customer" mode, so the main doc's own
  // excess fields stay the bare excess amount (recomputeDocBalance separately adds the job's VAT
  // back in for the actual balance deduction).
  if (xs.relatedDocId) {
    const mainExcessTax = fullVat ? 0 : tax;
    const mainExcessGross = fullVat ? net : gross;
    await db.update(serviceHistory).set({
      excessNet: String(net.toFixed(2)), excessTax: String(mainExcessTax.toFixed(2)), excessGross: String(mainExcessGross.toFixed(2)),
      excessFullVatToCustomer: fullVat ? 1 : 0,
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

export async function getRichPDF(documentId: number, opts?: { customerCopyOnly?: boolean; liveTech?: any }) {
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

  // Who the invoice is addressed to. Insurance Approved Repairer Scheme rule (e.g. Allianz): the
  // invoice sent to the insurer must be made out to the CUSTOMER, never the insurer — "Invoices
  // made out to Allianz Insurance will be returned unpaid for correction." A "full VAT to customer"
  // job (see createExcessInvoice) is exactly this scheme's arrangement, so it never addresses the
  // insurer here even though insuranceCompany is recorded (for internal reference/the Insurance
  // panel) — the customer/company block below is used instead, same as any ordinary invoice.
  const billTo = (doc.docType !== 'XS' && (doc as any).insuranceCompany && !(doc as any).excessFullVatToCustomer)
    ? String((doc as any).insuranceCompany) : null;
  // Use the details stored ON the document (what the form shows) first — a walk-in typed straight
  // onto a job sheet has no linked customer record but still has a name/address/phone — then fall
  // back to the linked customer. Prevents "Unknown Client" on a sheet that clearly has a customer.
  const d2: any = doc;
  const docName = [d2.custTitle, d2.custForename, d2.custSurname].filter(Boolean).join(" ").trim();
  // Street lines WITHOUT the postcode — otherwise a doc that only has a postcode makes docStreet
  // truthy and blocks the fallback to the linked customer's full address. Postcode appended below.
  // House number + road are ONE address line ("19 Grosvenor Gardens") — join them with a space
  // first, or the comma-join below (needed to separate locality/town/county) gets split back
  // apart a few lines down and prints "19" and "Grosvenor Gardens" as two separate lines.
  const houseAndRoad = [d2.custHouseNo, d2.custRoad].filter(Boolean).join(" ");
  const docStreet = [houseAndRoad, d2.custLocality, d2.custTown, d2.custCounty].filter(Boolean).join(", ");
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

  // On a main insurance invoice, print the INSURER's claims address (not the policyholder's home
  // address) under "Invoice to: {insurer}" — falls back to the customer's own address lines above
  // if no insurer address has been recorded yet.
  const insurerAddressLines = String((d2 as any).insurerAddress || '').split('\n').map((s: string) => s.trim()).filter(Boolean);
  const billToAddressLines = billTo && insurerAddressLines.length ? insurerAddressLines : addressLines;

  const customerData = {
    name: docName || d2.customerName || customer?.name || 'Unknown Client',
    company: String(d2.company || '').trim(),
    address_lines: billTo ? billToAddressLines : addressLines,
    mobile: d2.custMobile || d2.custTelephone || customer?.phone || '',
    phones,
    billTo,
  };

  // Technical info for the boxed row. Use the SAME live source as the on-screen cards
  // (oil/aircon from the tech cache, MOT/tax live from DVLA) so the printed row matches what's
  // shown — the raw vehicle record often has no cached oil/aircon, which left the row blank.
  // A caller merging many invoices for the SAME vehicle (getServiceHistoryPDF) passes opts.liveTech
  // pre-fetched once — the DVLA/tax lookup is identical for every one of that vehicle's invoices,
  // and re-fetching it per invoice was making a 39-invoice history do 39 sequential live DVLA
  // calls (the actual cause of the "stuck loading" preview for vehicles with a long history).
  let lt: any = opts && "liveTech" in opts ? opts.liveTech : null;
  if (lt == null && !(opts && "liveTech" in opts)) {
    try { lt = vehicle?.registration ? await liveVehicleTech(vehicle.registration) : null; } catch { /* fall back to the record */ }
  }
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
  // Deducted from a main insurance invoice. "Full VAT to customer" jobs (see createExcessInvoice)
  // move the WHOLE job's VAT onto the customer's excess invoice, not just VAT on the excess itself
  // — excessGross on the main doc is deliberately just the bare excess amount (for correct display
  // elsewhere), so the deduction here has to separately add the job's own VAT back in.
  const excess = doc.docType === 'XS' ? 0
    : (doc as any).excessFullVatToCustomer ? (Number(doc.excessNet) || 0) + (Number(doc.totalTax) || 0)
    : (Number(doc.excessGross) || 0);
  const receipts = Number(doc.totalReceipts) || 0;
  const totalGross = Number(doc.totalGross) || 0;
  // Total £ knocked off across all discounted lines (subNet is already net of the line discount).
  const discountTotal = +items.reduce((a, i) => {
    const base = (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    return a + Math.max(0, base - (Number(i.subNet) || 0));
  }, 0).toFixed(2);

  // Insurance Approved Repairer Scheme rule (e.g. Allianz): the invoice sent to the insurer must be
  // made out to the CUSTOMER (never the insurer — that gets returned unpaid for correction) and
  // must show the FULL job value, the amount collected from the customer (excess + VAT for a
  // VAT-registered customer), and the balance due from the insurer — never a net-only figure with
  // the breakdown hidden. See getRichPDF's billTo, just above, which never addresses this doc to
  // the insurer for exactly this reason. "Full VAT to customer" jobs (see createExcessInvoice)
  // still move the whole job's VAT onto the customer's separate excess invoice — doc.totalTax on
  // THAT document IS the full amount already — so its own VAT % label would misleadingly look
  // wrong against just the excess subtotal; give it a plain-English label instead of a percentage.
  const fullVatExcess = doc.docType === 'XS' && !!(doc as any).excessFullVatToCustomer;
  const fullVatMain = doc.docType === 'SI' && !!(doc as any).excessFullVatToCustomer && excess > 0;
  const baseSubtotal = +((Number(doc.totalNet) || 0) - motNet).toFixed(2);

  const totals: any = {
    labour: labour.reduce((acc, i) => acc + i.subtotal, 0),
    parts: parts.reduce((acc, i) => acc + i.subtotal, 0),
    sundries, lubricants, paint,
    discount: discountTotal > 0 ? discountTotal : null,
    subtotal: baseSubtotal, // SubTotal excludes the MOT fee (shown separately, 0% VAT)
    vat_rate: 20,
    vat: Number(doc.totalTax) || 0,
    vat_label: fullVatExcess ? `VAT (full, re. Inv ${(doc as any).relatedDocNo || ''})`.trim() : undefined,
    mot: motNet > 0 ? motNet : null,
    total: totalGross,
    excess: excess > 0 ? excess : null,
    excess_label: fullVatMain ? "Excess + VAT (customer)" : undefined,
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

    // Diagnostic and service job sheets automatically carry the car's Service Reset & OBD
    // sheet as an extra page — the technician gets the OBD location (with the Trakm8
    // diagram) AND the reset procedure without asking for it. If the vehicle has no card
    // yet, generate the FULL card now (AI steps + diagram, cached on the vehicle) — the
    // first print for a car waits a few seconds; every later one is instant. If the AI is
    // unavailable, fall back to fetching at least the diagram.
    let service_reset: any = null;
    if (vehicle && /diagnos|service/i.test(String(doc.description || ""))) {
      let info: any = (vehicle as any).serviceResetInfo;
      if (!info?.resetSteps?.length) {
        try {
          const { generateServiceResetCard } = await import("./services/serviceReset");
          info = await generateServiceResetCard(vehicle.id);
        } catch {
          // AI unavailable/failed — at least capture the diagram so the sheet shows the port.
          if (!info?.obdImage) {
            try {
              const { fetchTrakm8ObdImage } = await import("./services/trakm8");
              const regYear = vehicle.dateOfRegistration ? new Date(vehicle.dateOfRegistration).getFullYear() : null;
              const img = await fetchTrakm8ObdImage(vehicle.make, vehicle.model, regYear);
              if (img) {
                info = { ...(info || {}), obdImage: { locationId: img.locationId, matched: img.matched, source: "Trakm8 OBD checker", dataBase64: img.dataBase64 }, generatedAt: info?.generatedAt || new Date().toISOString() };
                const db2 = await getDb();
                if (db2) await db2.update(vehicles).set({ serviceResetInfo: info }).where(eq(vehicles.id, vehicle.id));
              }
            } catch { /* print works fine without the diagram */ }
          }
        }
      }
      if (info) service_reset = { registration: vehicle.registration, vehicleDesc: [vehicle.make, vehicle.model].filter(Boolean).join(" "), ...info };
    }

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
      service_reset,
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
      // The summary table used to print `title` alone — the FIRST LINE of the description —
      // so a job written up as a heading plus steps showed only its heading, and the customer's
      // service history said "Check front and rear brakes." for a £395 job. This carries the
      // whole write-up for that table; markdown bullets and bold markers are stripped since
      // the PDF renders plain text.
      work: [title, narrative].filter(Boolean).join("\n")
        .replace(/\*\*/g, "")
        .replace(/^[ \t]*[-*\u2022][ \t]+/gm, "\u2022 ")
        .trim(),
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
    // The one-row-per-visit table is always the summary now, whether or not full invoice copies
    // are also attached — a "full itemised, one block per visit" mode used to render instead
    // whenever invoices weren't attached, which is exactly backwards: that's the MORE common
    // case (a quick overview, no attachments), and it read as a wall of text with no actual
    // summary at the top of it.
    invoicesFollow: !!opts?.includeInvoices,
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
  // Fetch the live DVLA/tech lookup ONCE for this vehicle and reuse it across every invoice —
  // it's the same registration on every one of them, so doing it per-invoice was turning a
  // 39-invoice history into 39 sequential external DVLA calls (the actual cause of a preview
  // that appeared to hang/stay blank for a vehicle with a long history).
  const sharedLiveTech = await liveVehicleTech(vehicle.registration || "").catch(() => null);
  for (const d of docs) {
    try { await append((await getRichPDF(d.id, { customerCopyOnly: true, liveTech: sharedLiveTech })).content); }
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

  // Deleting a policy-excess invoice must also clear the excess amount it mirrored onto the
  // main insurance invoice (see updateExcessInvoice) — otherwise the main invoice keeps
  // showing an "Excess (to customer)" deduction for an excess invoice that no longer exists,
  // with no way to remove it short of re-editing the excess to zero first.
  const referencing = await db.select({ id: serviceHistory.id }).from(serviceHistory).where(inArray(serviceHistory.relatedDocId, clean));

  await db.transaction(async (tx) => {
    await tx.delete(serviceLineItems).where(inArray(serviceLineItems.documentId, clean));
    await tx.delete(payments).where(inArray(payments.documentId, clean));
    // remove dangling links + the mirrored excess amount from any document that referenced a
    // deleted one (e.g. an insurance invoice ↔ its policy-excess invoice)
    await tx.update(serviceHistory).set({
      relatedDocId: null, relatedDocNo: null,
      excessNet: null, excessTax: null, excessGross: null,
    }).where(inArray(serviceHistory.relatedDocId, clean));
    await tx.delete(serviceHistory).where(inArray(serviceHistory.id, clean));
  });
  for (const r of referencing) await recomputeDocBalance(r.id);
  return { success: true, deleted: clean.length };
}

/** Soft-hide documents from their normal doc-type tab into the Archive tab. Reversible — see unarchiveDocuments. */
export async function archiveDocuments(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const clean = (ids || []).filter((n) => Number.isFinite(n));
  if (!clean.length) return { success: true, archived: 0 };
  await db.update(serviceHistory).set({ archived: 1, archivedAt: new Date() }).where(inArray(serviceHistory.id, clean));
  return { success: true, archived: clean.length };
}

/** Restore documents from the Archive tab back to their normal doc-type tab. */
export async function unarchiveDocuments(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const clean = (ids || []).filter((n) => Number.isFinite(n));
  if (!clean.length) return { success: true, unarchived: 0 };
  await db.update(serviceHistory).set({ archived: 0, archivedAt: null }).where(inArray(serviceHistory.id, clean));
  return { success: true, unarchived: clean.length };
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


/** A customer's ENTIRE history — every car they've had work on — as one PDF.
 *
 * Built by running the existing per-vehicle report for each car and merging the results rather
 * than by writing a second template: the per-vehicle report already handles the pagination,
 * the invoice-copy appending and the "invoiced work only" rule, and one template means the two
 * can't drift. Cars with no invoiced work are skipped so the file isn't padded with empty
 * sections. Newest-active vehicle first. */
export async function getCustomerServiceHistoryPDF(customerId: number, opts?: { includeInvoices?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const customer = (await db.select().from(customers).where(eq(customers.id, customerId)).limit(1))[0];
  if (!customer) throw new Error("Customer not found");

  const cars = await db.select({ id: vehicles.id, registration: vehicles.registration }).from(vehicles).where(eq(vehicles.customerId, customerId));
  if (!cars.length) throw new Error("This customer has no vehicles on file.");

  // Only cars with actual invoiced work, ordered newest first. The per-vehicle report happily
  // renders an empty section for a car we've never invoiced, which would pad a 12-car customer
  // with blank pages — so exclude those here rather than hoping the generator refuses.
  const lastByVehicle = new Map<number, number>();
  const lastRows = await db.select({ vehicleId: serviceHistory.vehicleId, last: sql<string>`MAX(${serviceHistory.dateCreated})` })
    .from(serviceHistory)
    .where(and(inArray(serviceHistory.vehicleId, cars.map((c) => c.id)), inArray(serviceHistory.docType, ["SI", "XS"])))
    .groupBy(serviceHistory.vehicleId);
  for (const r of lastRows) if (r.vehicleId != null) lastByVehicle.set(r.vehicleId, new Date(r.last || 0).getTime());

  const ordered = cars
    .filter((c) => lastByVehicle.has(c.id))
    .sort((a, b) => (lastByVehicle.get(b.id) || 0) - (lastByVehicle.get(a.id) || 0));
  if (!ordered.length) throw new Error("No invoiced work found for this customer's vehicles.");

  const parts: string[] = [];
  let included = 0;
  for (const car of ordered) {
    try {
      const pdf: any = await getServiceHistoryPDF(car.id, opts);
      if (pdf?.content) { parts.push(pdf.content); included++; }
    } catch {
      // A car with no invoiced work throws rather than producing an empty report — skip it.
    }
  }
  if (!parts.length) throw new Error("No invoiced work found for this customer's vehicles.");

  const safeName = String(customer.name || `Customer-${customerId}`).replace(/[^\w\-]+/g, "-").replace(/^-|-$/g, "");
  const filename = `Service-History-${safeName}.pdf`;
  if (parts.length === 1) return { content: parts[0], filename, vehicleCount: included };

  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const b64 of parts) {
    const src = await PDFDocument.load(Buffer.from(b64, "base64"));
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  return { content: Buffer.from(await merged.save()).toString("base64"), filename, vehicleCount: included };
}

/** Mark a forecourt car as sold (or put it back on sale). Status is free text in this table —
 * the values in use are "ON FORECOURT" and "IN PREP" — so SOLD joins them rather than becoming
 * an enum. The sale price is kept separately from `price` (the advertised figure) so the
 * asking price isn't overwritten by what it actually went for. */
export async function setSalesStockSold(input: { id: number; sold: boolean; soldPrice?: number | null; soldAt?: Date | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const patch = input.sold
    ? { status: "SOLD", soldAt: input.soldAt || new Date(), soldPrice: input.soldPrice != null ? String(input.soldPrice) : null }
    : { status: "ON FORECOURT", soldAt: null, soldPrice: null };
  await db.update(salesStock).set(patch as any).where(eq(salesStock.id, input.id));
  return (await db.select().from(salesStock).where(eq(salesStock.id, input.id)).limit(1))[0];
}

// ─── Job price guide ─────────────────────────────────────────────────────────
/** What we actually charge for the jobs customers ring up about, worked out from our own
 * invoices, per manufacturer.
 *
 * The hard part is that a real invoice bundles work: a service, an MOT and two wiper blades on
 * one bill. Pricing from the document total therefore massively overstates every job (an
 * interim service "cost" £286 that way). So each job is priced from ITS OWN lines:
 *
 *   - a document only counts for a category if it carries NO parts outside that category, so a
 *     service done alongside a brake job prices neither;
 *   - the MOT charge is stripped out, since that's quoted separately;
 *   - line values are net, so the guide figure is grossed up by VAT — customers ask
 *     "how much", and they mean the number on the card machine.
 *
 * Reported as a MEDIAN with the quartiles either side: an average is dragged around by the
 * occasional big job, and the quartile spread is what tells you whether a brand's price is
 * genuinely predictable or varies with the car. `n` is always carried so a figure resting on
 * three jobs can be seen for what it is. */
const PG_SERVICE_PART = (s: string) =>
  (/\boil\b|oil$/.test(s) && !/(gear|transmission|diff|brake|steering|cooler|seal|leak|pump|level|top\s*up)/.test(s))
  || /oil\s*filter|air\s*(filter|cleaner)|(pollen|cabin|micro)\s*filter|fuel\s*filter|sump\s*plug|washer|sundr|\bppe\b|lubricant|anti\s*freeze|screen\s*wash/.test(s);

const PG_CATEGORIES: { key: string; label: string; group: string; part: (s: string) => boolean }[] = [
  { key: "frontPads", label: "Front brake pads", group: "Brakes", part: (s) => /pad/.test(s) && /(frt|front)/.test(s) },
  { key: "rearPads", label: "Rear brake pads", group: "Brakes", part: (s) => /pad/.test(s) && /(\brr\b|rear)/.test(s) },
  { key: "frontDiscs", label: "Front discs & pads", group: "Brakes", part: (s) => /disc/.test(s) && /(frt|front)/.test(s) },
  { key: "rearDiscs", label: "Rear discs & pads", group: "Brakes", part: (s) => /disc/.test(s) && /(\brr\b|rear)/.test(s) },
  { key: "brakeFluid", label: "Brake fluid change", group: "Brakes", part: (s) => /brake fluid|dot ?4/.test(s) && !/(bulb|light|cleaner|switch|hose|pipe)/.test(s) },
];

export const PRICE_GUIDE_CATEGORIES = [
  { key: "interimService", label: "Interim service", group: "Servicing" },
  { key: "fullService", label: "Full service", group: "Servicing" },
  ...PG_CATEGORIES.map(({ key, label, group }) => ({ key, label, group })),
];

type PgJob = { total: number; labour: number; parts: number };

/** Median, quartiles, and the labour/parts split — because that's how the job is quoted: the
 * labour is a rate we set, the parts are whatever the car takes. Quoting only the all-in total
 * hides which half moves. Each is taken independently, so labour + parts won't always add up to
 * the total to the penny; they're each the middle of their own column. */
const pgStats = (jobs: PgJob[]) => {
  if (!jobs.length) return null;
  const mid = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const totals = jobs.map((j) => j.total).sort((a, b) => a - b);
  const at = (p: number) => totals[Math.min(totals.length - 1, Math.floor(totals.length * p))];
  return {
    median: Math.round(mid(totals)),
    low: Math.round(at(0.25)),
    high: Math.round(at(0.75)),
    labour: Math.round(mid(jobs.map((j) => j.labour))),
    parts: Math.round(mid(jobs.map((j) => j.parts))),
    n: jobs.length,
  };
};

export async function getJobPriceGuide(opts?: { years?: number }) {
  const db = await getDb();
  if (!db) return { years: 0, categories: PRICE_GUIDE_CATEGORIES, all: {} as Record<string, any>, sizes: [] as any[], makes: [] as any[] };
  const years = Math.max(1, Math.min(10, opts?.years ?? 3));

  const rows: any = await db.execute(sql`
    SELECT s.id, v.make, split_part(COALESCE(v.model,''), ' ', 1) model, v."engineCC" cc,
           -- GA4 "Fixed Item 1/2/3" = Sundries / Lubricants / Paint & Mat. These are charged on
           -- the Extras side panel, NOT as line items, on about two thirds of services — so
           -- summing line items alone understated parts by the sundries charge on most jobs.
           COALESCE(s."fixedItem1Net",0) + COALESCE(s."fixedItem2Net",0) + COALESCE(s."fixedItem3Net",0) extras,
           li.description d, li."itemType" t,
           COALESCE(li."subNet", li.quantity * li."unitPrice") amt
    FROM "serviceHistory" s
    JOIN vehicles v ON v.id = s."vehicleId"
    JOIN "serviceLineItems" li ON li."documentId" = s.id
    WHERE s."docType" IN ('SI','XS')
      AND s."dateCreated" >= now() - (${years} || ' years')::interval`);

  type Doc = { make: string; model: string; cc: number; own: number; other: number; labour: number; cats: Set<string>; oilFilter: boolean; airFilter: boolean; cabinFilter: boolean };
  const docs = new Map<number, Doc>();
  for (const r of rows.rows) {
    let d = docs.get(r.id);
    if (!d) {
      d = {
        make: String(r.make || "").toUpperCase(),
        model: String(r.model || "").toUpperCase(),
        cc: Number(r.cc) || 0,
        // Extras are per-document, so they're taken once when the doc is first seen.
        own: Number(r.extras) || 0,
        other: 0, labour: 0, cats: new Set(), oilFilter: false, airFilter: false, cabinFilter: false,
      };
      docs.set(r.id, d);
    }
    const s = String(r.d || "").toLowerCase();
    const amt = Number(r.amt) || 0;
    const type = String(r.t || "");
    if (!s) continue;
    if (/^labour$/i.test(type)) { if (!/\bmot\b/.test(s)) d.labour += amt; continue; }
    if (!/^part$/i.test(type)) continue;                    // "Other" rows are notes/advisories
    if (/oil\s*filter/.test(s)) d.oilFilter = true;
    if (/air\s*(filter|cleaner)/.test(s)) d.airFilter = true;
    if (/(pollen|cabin|micro)\s*filter/.test(s)) d.cabinFilter = true;
    const cat = PG_CATEGORIES.find((c) => c.part(s));
    if (cat) { d.cats.add(cat.key); d.own += amt; }
    else if (PG_SERVICE_PART(s)) { d.cats.add("service"); d.own += amt; }
    else d.other += amt;                                     // unrelated work — disqualifies the doc
  }

  const byKey = new Map<string, PgJob[]>();
  const push = (k: string, v: PgJob) => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(v); };
  // Engine size per make/model, to say whether it's a small car or a big one. It's a proxy, but
  // a good one on this data: it ranks Picanto 1149cc -> Sorento 2030cc and A-Class -> GLE
  // correctly, and it's populated on 87% of the fleet where a body type isn't recorded at all.
  const ccByKey = new Map<string, number[]>();
  const pushCc = (k: string, cc: number) => { if (cc > 0) { if (!ccByKey.has(k)) ccByKey.set(k, []); ccByKey.get(k)!.push(cc); } };

  for (const d of docs.values()) {
    if (d.other > 0.01 || d.labour <= 0) continue;
    // `own` is seeded with the Extras total, so it can no longer stand in for "had a relevant
    // part" — the category set is what decides that.
    if (!d.cats.size) continue;
    // Discs are never fitted without pads, so a front-disc job always carries BOTH categories
    // and would disqualify itself under the one-category rule. Collapse the pad into the disc:
    // "front discs & pads" is how the job is actually sold and quoted.
    if (d.cats.has("frontDiscs")) d.cats.delete("frontPads");
    if (d.cats.has("rearDiscs")) d.cats.delete("rearPads");
    if (d.cats.size !== 1) continue;
    const only = Array.from(d.cats)[0];
    const cat = only === "service"
      ? (d.oilFilter ? (d.airFilter && d.cabinFilter ? "fullService" : "interimService") : null)
      : only;
    if (!cat) continue;
    // Grossed up per component, so the labour and parts figures are quotable in their own right.
    const job: PgJob = { total: (d.own + d.labour) * 1.2, labour: d.labour * 1.2, parts: d.own * 1.2 };
    const price = job.total;
    if (!(price > 40) || price > 2000) continue;             // guard against broken records
    push(`ALL|${cat}`, job);
    // Size band is judged per JOB, from that car's own engine size — pooling by band gives the
    // stable figure to quote, where a single model's handful of jobs never can.
    const band = !d.cc ? null : d.cc < 1400 ? "Small" : d.cc < 2000 ? "Medium" : "Large";
    if (band) push(`SIZE:${band}|${cat}`, job);
    if (d.make) { push(`${d.make}|${cat}`, job); pushCc(d.make, d.cc); }
    if (d.make && d.model) { push(`${d.make}~${d.model}|${cat}`, job); pushCc(`${d.make}~${d.model}`, d.cc); }
  }

  const avgCc = (k: string) => {
    const v = ccByKey.get(k) || [];
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
  };
  /** Small / Medium / Large — the distinction that actually changes the price of a service
   * (oil capacity and filter cost both track it). Blank when we've no engine size to go on,
   * rather than guessing a band. */
  const sizeOf = (cc: number) => (!cc ? null : cc < 1400 ? "Small" : cc < 2000 ? "Medium" : "Large");

  const all: Record<string, any> = {};
  for (const c of PRICE_GUIDE_CATEGORIES) all[c.key] = pgStats(byKey.get(`ALL|${c.key}`) || []);

  const sizes = ["Small", "Medium", "Large"].map((band) => {
    const cats: Record<string, any> = {};
    let jobs = 0;
    for (const c of PRICE_GUIDE_CATEGORIES) {
      const st = pgStats(byKey.get(`SIZE:${band}|${c.key}`) || []);
      cats[c.key] = st;
      jobs += st?.n || 0;
    }
    return { band, jobs, cats };
  }).filter((b) => b.jobs > 0);

  // byKey holds three kinds of key — "ALL", "SIZE:<band>", "<MAKE>" and "<MAKE>~<MODEL>". Only
  // the bare make is a make: without this the size bands and every model turned up in the table
  // as manufacturers of their own ("SIZE:Medium", "HONDA~JAZZ", complete with a fallback logo).
  const makeNames = new Set<string>();
  for (const k of Array.from(byKey.keys())) {
    const m = k.split("|")[0];
    if (m === "ALL" || m.startsWith("SIZE:") || m.includes("~")) continue;
    makeNames.add(m);
  }

  const modelNames = new Map<string, Set<string>>();
  for (const k of Array.from(byKey.keys())) {
    const left = k.split("|")[0];
    if (!left.includes("~")) continue;
    const [mk, md] = left.split("~");
    if (!modelNames.has(mk)) modelNames.set(mk, new Set());
    modelNames.get(mk)!.add(md);
  }

  const statsFor = (prefix: string) => {
    const cats: Record<string, any> = {};
    let jobs = 0;
    for (const c of PRICE_GUIDE_CATEGORIES) {
      const st = pgStats(byKey.get(`${prefix}|${c.key}`) || []);
      cats[c.key] = st;
      jobs += st?.n || 0;
    }
    return { cats, jobs };
  };

  const makes = Array.from(makeNames).map((make) => {
    const { cats, jobs } = statsFor(make);
    const cc = avgCc(make);
    const models = Array.from(modelNames.get(make) || [])
      .map((model) => {
        const m = statsFor(`${make}~${model}`);
        const mcc = avgCc(`${make}~${model}`);
        return { model, jobs: m.jobs, cats: m.cats, cc: mcc, size: sizeOf(mcc) };
      })
      // Two jobs can't carry a model's price; those cars still count towards the make's row.
      .filter((m) => m.jobs >= 3)
      .sort((a, b) => a.cc - b.cc || b.jobs - a.jobs);
    // A make is not a size: Ford runs from a 999cc B-Max to a 2331cc Kuga, and badging the
    // whole make "Small" off its average was actively misleading. Report the span its models
    // actually cover, and leave the band itself to the model rows where it means something.
    const bands = Array.from(new Set(models.map((m) => m.size).filter(Boolean)));
    const ccs = models.map((m) => m.cc).filter((v) => v > 0);
    const ccRange = ccs.length ? { min: Math.min(...ccs), max: Math.max(...ccs) } : null;
    return { make, jobs, cats, cc, size: bands.length === 1 ? bands[0] : null, bands, ccRange, models };
  })
    .filter((m) => m.jobs >= 3)
    .sort((a, b) => b.jobs - a.jobs);

  return { years, categories: PRICE_GUIDE_CATEGORIES, all, sizes, makes };
}

/** "How much is a service for this car?" — the whole price guide, reduced to one answer.
 *
 * Takes a registration, works out which size band that car is in, and hands back the prices for
 * it. Falls back to DVLA when we've never seen the car, so a new customer on the phone gets an
 * answer too. The model's own figures come back alongside, but only when there are enough of
 * them to mean anything — otherwise the band is the answer. */
export async function getPriceGuideForRegistration(registration: string, opts?: { years?: number }) {
  const reg = String(registration || "").toUpperCase().replace(/\s+/g, "");
  if (!reg) return null;

  const db = await getDb();
  let vehicle: any = db
    ? (await db.select().from(vehicles).where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1))[0]
    : null;

  let source: "ours" | "dvla" | null = vehicle ? "ours" : null;
  if (!vehicle) {
    try {
      const { getVehicleDetails } = await import("./dvlaApi");
      const d: any = await getVehicleDetails(reg);
      if (d) { vehicle = { registration: reg, make: d.make, model: d.model, engineCC: d.engineCapacity ?? d.engineCC }; source = "dvla"; }
    } catch { /* no DVLA answer — fall through to "unknown car" */ }
  }
  if (!vehicle) return { found: false, registration: reg };

  const cc = Number(vehicle.engineCC) || 0;
  const band = !cc ? null : cc < 1400 ? "Small" : cc < 2000 ? "Medium" : "Large";

  const guide = await getJobPriceGuide({ years: opts?.years });
  const bandRow = guide.sizes.find((b: any) => b.band === band) || null;
  const make = String(vehicle.make || "").toUpperCase();
  const model = String(vehicle.model || "").split(" ")[0].toUpperCase();
  const makeRow = guide.makes.find((m: any) => m.make === make) || null;
  const modelRow = makeRow?.models?.find((m: any) => m.model === model) || null;

  // Our own banded labour price for this engine size — what to actually quote, alongside what
  // the history says we've charged.
  const labourBands = await getServiceLabourBands("interimService");
  const ourLabour = pickLabourBand(labourBands, cc);

  /** What a customer is buying, and the difference between the two services — the question
   * that follows "how much" every single time. Taken from what these jobs ACTUALLY carry
   * rather than a generic menu: across 1,240 interims and 267 full services, an oil filter is
   * on 100% of both, while the air and pollen filters are on 100% of full services and only 3%
   * of interims. That IS the difference, so that's what's stated. */
  const interimStats = guide.sizes.find((b: any) => b.band === band)?.cats?.interimService || guide.all.interimService;
  const fullStats = guide.sizes.find((b: any) => b.band === band)?.cats?.fullService || guide.all.fullService;
  const MOT_PRICE = 50;

  const options = [
    {
      key: "mot",
      name: "MOT only",
      price: MOT_PRICE,
      priceExVat: MOT_PRICE,
      note: "No VAT on an MOT test",
      includes: ["MOT test", "Written pass or failure sheet with any advisories"],
    },
    {
      key: "interimService",
      name: "Interim service (small)",
      price: interimStats?.median ?? null,
      priceExVat: interimStats ? Math.round(interimStats.median / 1.2) : null,
      note: ourLabour ? `Labour £${ourLabour.labour} + parts` : null,
      includes: ["Engine oil replaced", "Oil filter replaced", "Sump plug seal where needed", "Levels topped up and vehicle checked over"],
    },
    {
      key: "fullService",
      name: "Full service (large)",
      price: fullStats?.median ?? null,
      priceExVat: fullStats ? Math.round(fullStats.median / 1.2) : null,
      note: "Everything in the interim, plus the two filters",
      includes: ["Everything in the interim service", "Air filter replaced", "Pollen / cabin filter replaced"],
    },
  ];

  // The combinations people actually ask for, so the difference is a number and not mental
  // arithmetic on the phone.
  const combos = [
    interimStats ? { name: "MOT + interim service", price: interimStats.median + MOT_PRICE } : null,
    fullStats ? { name: "MOT + full service", price: fullStats.median + MOT_PRICE } : null,
    interimStats && fullStats ? { name: "Difference: interim → full", price: fullStats.median - interimStats.median, isDiff: true } : null,
  ].filter(Boolean);

  return {
    found: true,
    source,
    registration: reg,
    vehicle: { make: vehicle.make, model: vehicle.model, engineCC: cc },
    band,
    ourLabour,
    labourBands,
    options,
    combos,
    motPrice: MOT_PRICE,
    categories: guide.categories,
    // Band prices are the answer; the model's own only when they're solid enough to beat it.
    prices: bandRow?.cats || guide.all,
    usedFallback: !bandRow,
    model: modelRow ? { name: modelRow.model, cc: modelRow.cc, cats: modelRow.cats } : null,
  };
}

/** Our chosen labour price for a job, by engine size — what we mean to charge, as distinct from
 * the historical medians the price guide derives. Adam's bands, 06/08/2026:
 *   up to 999cc £124 · 1.0–1.5L £134 · over 1.5–2.0L £144 · over 2.0L £164
 * A car with no engine size on file gets no band rather than a guessed one. */
export async function getServiceLabourBands(jobKey = "interimService") {
  const db = await getDb();
  if (!db) return [];
  const rows: any = await db.execute(sql`
    SELECT id, "jobKey", "maxCC", label, labour FROM "serviceLabourBands"
    WHERE "jobKey" = ${jobKey} ORDER BY COALESCE("maxCC", 2147483647) ASC`);
  return rows.rows.map((r: any) => ({ id: r.id, jobKey: r.jobKey, maxCC: r.maxCC == null ? null : Number(r.maxCC), label: r.label, labour: Number(r.labour) }));
}

export function pickLabourBand(bands: { maxCC: number | null; label: string; labour: number }[], cc: number) {
  if (!cc || !bands.length) return null;
  return bands.find((b) => b.maxCC == null || cc <= b.maxCC) || null;
}

/** Retire a plate from the car that currently holds it, so a genuinely different vehicle can
 * take it on.
 *
 * A private plate moves with the owner, not the car. When that happens the existing record is
 * the OLD car's real history and must not be rewritten with the new car's identity — which is
 * what the identity-conflict guard in getVehicleByRegistration protects against. But that guard
 * told the user to "use New Vehicle", which is impossible: vehicles.registration is UNIQUE, so
 * the plate has to be freed first.
 *
 * This does what GA4 does — renames the old row to "LR72 VXE* (10/08/2026)", the date it lost
 * the plate. History, invoices and links all stay attached to that record, and the plate is
 * free for the new car. Nothing is deleted.
 */
export async function retirePlateFromVehicle(registration: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const reg = String(registration || "").toUpperCase().replace(/\s+/g, "");
  if (!reg) throw new Error("A registration is required");

  const v = (await db.select().from(vehicles)
    .where(sql`REPLACE(UPPER(${vehicles.registration}), ' ', '') = ${reg}`).limit(1))[0];
  if (!v) throw new Error(`${reg} isn't on file`);
  if (String(v.registration || "").includes("*")) throw new Error(`${v.registration} has already been retired`);

  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const retired = `${v.registration}* (${stamp})`;

  // How much of a record this actually is. A reg typed into a job sheet creates a vehicle row
  // from the DVLA/SWS lookup whether or not the job was ever written — so plenty of these rows
  // are empty artifacts, and renaming one to "LR72VXE* (10/08/2026)" would leave permanent
  // clutter in the vehicle list to preserve nothing at all.
  const counts: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM ${serviceHistory} WHERE ${serviceHistory.vehicleId} = ${v.id}) docs,
      (SELECT COUNT(*) FROM "reminders"           WHERE "vehicleId" = ${v.id}) rem,
      (SELECT COUNT(*) FROM "reminderLogs"        WHERE "vehicleId" = ${v.id}) rlog,
      (SELECT COUNT(*) FROM "appointments"        WHERE "vehicleId" = ${v.id}) appt,
      (SELECT COUNT(*) FROM "vehicleSaleInvoices" WHERE "vehicleId" = ${v.id}) sale`);
  const c = counts.rows[0] || {};
  const docs = Number(c.docs || 0);
  // customerLogs are deliberately NOT counted: a lookup writes one, so they're a record of us
  // looking at the car, not of work done on it.
  const hasHistory = docs > 0 || Number(c.rem || 0) > 0 || Number(c.rlog || 0) > 0
    || Number(c.appt || 0) > 0 || Number(c.sale || 0) > 0 || !!v.customerId;

  if (!hasHistory) {
    // Nothing attached — the row is a lookup artifact, so free the plate by removing it rather
    // than parking a retired-plate ghost in the vehicle list forever.
    await db.execute(sql`DELETE FROM "customerLogs" WHERE "vehicleId" = ${v.id}`);
    await db.delete(vehicles).where(eq(vehicles.id, v.id));
    return {
      action: "deleted" as const,
      retiredVehicleId: v.id,
      retiredAs: null,
      was: `${v.make || ""} ${v.model || ""}`.trim(),
      documentsKept: 0,
      plateFreed: v.registration,
    };
  }

  await db.update(vehicles).set({ registration: retired }).where(eq(vehicles.id, v.id));
  return {
    action: "retired" as const,
    retiredVehicleId: v.id,
    retiredAs: retired,
    was: `${v.make || ""} ${v.model || ""}`.trim(),
    documentsKept: docs,
    plateFreed: v.registration,
  };
}
