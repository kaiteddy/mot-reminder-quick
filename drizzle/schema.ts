import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, index, decimal, datetime, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Customers table - stores customer contact information
 */
export const customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 100 }),
  externalId: varchar("externalId", { length: 255 }).unique(), // GA4 _ID
  address: text("address"),
  postcode: varchar("postcode", { length: 20 }),
  notes: text("notes"),
  optedOut: int("optedOut").default(0).notNull(), // 0 = false, 1 = true
  optedOutAt: timestamp("optedOutAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  phoneIdx: index("customers_phone_idx").on(table.phone),
  emailIdx: index("customers_email_idx").on(table.email),
}));

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

/**
 * Vehicles table - stores vehicle registration and MOT information
 */
export const vehicles = mysqlTable("vehicles", {
  id: int("id").autoincrement().primaryKey(),
  registration: varchar("registration", { length: 20 }).notNull().unique(),
  make: varchar("make", { length: 100 }),
  model: varchar("model", { length: 100 }),
  motExpiryDate: timestamp("motExpiryDate"),
  taxStatus: varchar("taxStatus", { length: 20 }), // Taxed, Untaxed, SORN
  taxDueDate: timestamp("taxDueDate"),
  lastChecked: timestamp("lastChecked"),
  customerId: int("customerId"),
  externalId: varchar("externalId", { length: 255 }), // GA4 _ID
  colour: varchar("colour", { length: 50 }),
  fuelType: varchar("fuelType", { length: 50 }),
  dateOfRegistration: datetime("dateOfRegistration"),
  vin: varchar("vin", { length: 50 }),
  engineCC: int("engineCC"),
  engineNo: varchar("engineNo", { length: 50 }),
  engineCode: varchar("engineCode", { length: 50 }),
  notes: text("notes"),
  comprehensiveTechnicalData: json("comprehensiveTechnicalData"),
  swsLastUpdated: timestamp("swsLastUpdated"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  customerIdIdx: index("vehicles_customer_id_idx").on(table.customerId),
  motExpiryDateIdx: index("vehicles_mot_expiry_date_idx").on(table.motExpiryDate),
}));

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = typeof vehicles.$inferInsert;

/**
 * Reminders table - stores MOT and service reminders
 */
export const reminders = mysqlTable("reminders", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["MOT", "Service", "Cambelt", "Other"]).notNull(),
  dueDate: timestamp("dueDate").notNull(),
  registration: varchar("registration", { length: 20 }).notNull(),
  customerName: text("customerName"),
  customerEmail: varchar("customerEmail", { length: 320 }),
  customerPhone: varchar("customerPhone", { length: 20 }),
  vehicleMake: varchar("vehicleMake", { length: 100 }),
  vehicleModel: varchar("vehicleModel", { length: 100 }),
  motExpiryDate: timestamp("motExpiryDate"),
  status: mysqlEnum("status", ["pending", "sent", "archived"]).default("pending").notNull(),
  sentAt: timestamp("sentAt"),
  sentMethod: varchar("sentMethod", { length: 20 }), // email, print, sms, whatsapp
  customerResponded: int("customerResponded").default(0).notNull(), // 0 = no response, 1 = responded
  respondedAt: timestamp("respondedAt"),
  needsFollowUp: int("needsFollowUp").default(0).notNull(), // 0 = no, 1 = yes (auto-set after 7 days no response)
  notes: text("notes"),
  vehicleId: int("vehicleId"),
  customerId: int("customerId"),
  externalId: varchar("externalId", { length: 255 }), // GA4 _ID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  dueDateIdx: index("reminders_due_date_idx").on(table.dueDate),
  statusIdx: index("reminders_status_idx").on(table.status),
}));

export type Reminder = typeof reminders.$inferSelect;
export type InsertReminder = typeof reminders.$inferInsert;
/**
 * Reminder Logs table - tracks all sent reminders
 */
export const reminderLogs = mysqlTable("reminderLogs", {
  id: int("id").autoincrement().primaryKey(),
  reminderId: int("reminderId"),
  customerId: int("customerId"),
  vehicleId: int("vehicleId"),
  messageType: mysqlEnum("messageType", ["MOT", "Service", "Cambelt", "Other"]).notNull(),
  recipient: varchar("recipient", { length: 20 }).notNull(), // phone number
  messageSid: varchar("messageSid", { length: 100 }), // Twilio message ID
  status: mysqlEnum("status", ["queued", "sent", "delivered", "read", "failed"]).default("queued").notNull(),
  templateUsed: varchar("templateUsed", { length: 255 }), // template SID or name
  customerName: text("customerName"),
  registration: varchar("registration", { length: 20 }),
  dueDate: timestamp("dueDate"),
  messageContent: text("messageContent"), // Actual message text sent
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  deliveredAt: timestamp("deliveredAt"),
  readAt: timestamp("readAt"),
  failedAt: timestamp("failedAt"),
  errorMessage: text("errorMessage"),
}, (table) => ({
  vehicleIdIdx: index("reminder_logs_vehicle_id_idx").on(table.vehicleId),
  sentAtIdx: index("reminder_logs_sent_at_idx").on(table.sentAt),
}));

export type ReminderLog = typeof reminderLogs.$inferSelect;
export type InsertReminderLog = typeof reminderLogs.$inferInsert;

/**
 * Customer Messages table - stores incoming WhatsApp messages from customers
 */
export const customerMessages = mysqlTable("customerMessages", {
  id: int("id").autoincrement().primaryKey(),
  messageSid: varchar("messageSid", { length: 100 }).notNull().unique(), // Twilio message ID
  fromNumber: varchar("fromNumber", { length: 20 }).notNull(),
  toNumber: varchar("toNumber", { length: 20 }).notNull(),
  messageBody: text("messageBody"),
  customerId: int("customerId"), // linked customer if found
  relatedLogId: int("relatedLogId"), // linked to reminder log if applicable
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  read: int("read").default(0).notNull(), // 0 = unread, 1 = read
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  customerIdIdx: index("customer_messages_customer_id_idx").on(table.customerId),
  receivedAtIdx: index("customer_messages_received_at_idx").on(table.receivedAt),
}));

export type CustomerMessage = typeof customerMessages.$inferSelect;
export type InsertCustomerMessage = typeof customerMessages.$inferInsert;


/**
 * Service History table - stores document headers (invoices/estimates)
 */
export const serviceHistory = mysqlTable("serviceHistory", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("externalId", { length: 255 }).notNull().unique(), // GA4 Document _ID
  customerId: int("customerId"),
  vehicleId: int("vehicleId"),
  docType: varchar("docType", { length: 20 }), // SI, ES, etc.
  docNo: varchar("docNo", { length: 50 }),
  dateCreated: datetime("dateCreated"),
  dateIssued: datetime("dateIssued"),
  datePaid: datetime("datePaid"),
  totalNet: decimal("totalNet", { precision: 10, scale: 2 }),
  totalTax: decimal("totalTax", { precision: 10, scale: 2 }),
  totalGross: decimal("totalGross", { precision: 10, scale: 2 }),
  mileage: int("mileage"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  vehicleIdIdx: index("service_history_vehicle_id_idx").on(table.vehicleId),
  customerIdIdx: index("service_history_customer_id_idx").on(table.customerId),
}));

export type ServiceHistory = typeof serviceHistory.$inferSelect;
export type InsertServiceHistory = typeof serviceHistory.$inferInsert;

/**
 * Service Line Items table - stores detail lines for documents
 */
export const serviceLineItems = mysqlTable("serviceLineItems", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("externalId", { length: 255 }).notNull().unique(), // GA4 LineItem _ID
  documentId: int("documentId").notNull(),
  description: text("description"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }),
  subNet: decimal("subNet", { precision: 10, scale: 2 }),
  itemType: varchar("itemType", { length: 50 }), // Labour, Part, etc.
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  documentIdIdx: index("service_line_items_document_id_idx").on(table.documentId),
}));

export type ServiceLineItem = typeof serviceLineItems.$inferSelect;
export type InsertServiceLineItem = typeof serviceLineItems.$inferInsert;
