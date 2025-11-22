import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, InsertReminder } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
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

// Customer queries
export async function createCustomer(data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const { customers } = await import("../drizzle/schema");
  const result = await db.insert(customers).values(data);
  return result;
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
