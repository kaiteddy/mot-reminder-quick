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
  motBookedDate: timestamp("motBookedDate"),
  bookingRequested: int("bookingRequested").default(0),
  customerId: int("customerId"),
  externalId: varchar("externalId", { length: 255 }), // GA4 _ID
  colour: varchar("colour", { length: 50 }),
  fuelType: varchar("fuelType", { length: 50 }),
  dateOfRegistration: datetime("dateOfRegistration"),
  vin: varchar("vin", { length: 50 }),
  engineCC: int("engineCC"),
  engineNo: varchar("engineNo", { length: 50 }),
  engineCode: varchar("engineCode", { length: 50 }),
  derivative: varchar("derivative", { length: 255 }),
  paintCode: varchar("paintCode", { length: 50 }),
  keyCode: varchar("keyCode", { length: 50 }),
  radioCode: varchar("radioCode", { length: 50 }),
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
  status: mysqlEnum("status", ["queued", "sent", "delivered", "read", "failed", "undelivered"]).default("queued").notNull(),
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
  // --- GA4 Documents import (added for full job-sheet/invoice/estimate parity) ---
  docStatus: varchar("docStatus", { length: 50 }), // GA4 docUserStatus (Issued, Paid, etc.)
  department: varchar("department", { length: 100 }), // GA4 docDepartment
  orderRef: varchar("orderRef", { length: 100 }), // GA4 docOrderRef
  balance: decimal("balance", { precision: 10, scale: 2 }), // GA4 us_Balance (outstanding)
  totalReceipts: decimal("totalReceipts", { precision: 10, scale: 2 }), // payments received
  subPartsNet: decimal("subPartsNet", { precision: 10, scale: 2 }),
  subPartsTax: decimal("subPartsTax", { precision: 10, scale: 2 }),
  subPartsGross: decimal("subPartsGross", { precision: 10, scale: 2 }),
  subLabourNet: decimal("subLabourNet", { precision: 10, scale: 2 }),
  subLabourTax: decimal("subLabourTax", { precision: 10, scale: 2 }),
  subLabourGross: decimal("subLabourGross", { precision: 10, scale: 2 }),
  subMotNet: decimal("subMotNet", { precision: 10, scale: 2 }),
  subMotTax: decimal("subMotTax", { precision: 10, scale: 2 }),
  subMotGross: decimal("subMotGross", { precision: 10, scale: 2 }),
  paymentMethods: varchar("paymentMethods", { length: 255 }), // GA4 ui_display_paymentMethods
  registration: varchar("registration", { length: 20 }), // denormalized for quick lookup/link
  // --- GA4 parity: document-snapshot customer/staff/mot fields ---
  customerName: varchar("customerName", { length: 255 }),
  custEmail: varchar("custEmail", { length: 320 }),
  accountNumber: varchar("accountNumber", { length: 50 }),
  accountHeld: varchar("accountHeld", { length: 20 }),
  company: varchar("company", { length: 255 }),
  custHouseNo: varchar("custHouseNo", { length: 50 }),
  custRoad: varchar("custRoad", { length: 255 }),
  custLocality: varchar("custLocality", { length: 100 }),
  custTown: varchar("custTown", { length: 100 }),
  custCounty: varchar("custCounty", { length: 100 }),
  custPostcode: varchar("custPostcode", { length: 20 }),
  custTelephone: varchar("custTelephone", { length: 50 }),
  custMobile: varchar("custMobile", { length: 50 }),
  staffSalesPerson: varchar("staffSalesPerson", { length: 100 }),
  staffTechnician: varchar("staffTechnician", { length: 100 }),
  staffRoadTester: varchar("staffRoadTester", { length: 100 }),
  staffMotTester: varchar("staffMotTester", { length: 100 }),
  motClass: varchar("motClass", { length: 50 }),
  motStatus: varchar("motStatus", { length: 50 }),
  excessNet: decimal("excessNet", { precision: 10, scale: 2 }),
  excessTax: decimal("excessTax", { precision: 10, scale: 2 }),
  excessGross: decimal("excessGross", { precision: 10, scale: 2 }),
  terms: varchar("terms", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  vehicleIdIdx: index("service_history_vehicle_id_idx").on(table.vehicleId),
  customerIdIdx: index("service_history_customer_id_idx").on(table.customerId),
  docTypeIdx: index("service_history_doc_type_idx").on(table.docType),
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
  documentExternalId: varchar("documentExternalId", { length: 255 }), // GA4 parent doc _ID (for import linking)
  description: text("description"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }),
  subNet: decimal("subNet", { precision: 10, scale: 2 }),
  taxAmount: decimal("taxAmount", { precision: 10, scale: 2 }),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }),
  discount: decimal("discount", { precision: 10, scale: 2 }),
  partNumber: varchar("partNumber", { length: 100 }), // GA4 part number for stock-linked parts
  nominalCode: varchar("nominalCode", { length: 50 }), // accounting nominal code
  itemType: varchar("itemType", { length: 50 }), // Labour, Part, MOT, Fixed, etc.
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  documentIdIdx: index("service_line_items_document_id_idx").on(table.documentId),
  documentExternalIdIdx: index("service_line_items_document_external_id_idx").on(table.documentExternalId),
}));

export type ServiceLineItem = typeof serviceLineItems.$inferSelect;
export type InsertServiceLineItem = typeof serviceLineItems.$inferInsert;

/**
 * Appointments table - stores Kanban calendar appointments
 */
export const appointments = mysqlTable("appointments", {
  id: int("id").autoincrement().primaryKey(),
  vehicleId: int("vehicleId"),
  customerId: int("customerId"),
  registration: varchar("registration", { length: 20 }),
  bayId: varchar("bayId", { length: 50 }).notNull(), // e.g., 'mot-bay', 'ramp-1'
  appointmentDate: datetime("appointmentDate").notNull(), // The day of the appointment
  startTime: varchar("startTime", { length: 10 }), // e.g., "09:00"
  endTime: varchar("endTime", { length: 10 }),
  status: mysqlEnum("status", ["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled").notNull(),
  notes: text("notes"),
  orderIndex: int("orderIndex").default(0).notNull(), // For dragging and dropping order
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  dateIdx: index("appointments_date_idx").on(table.appointmentDate),
  bayIdx: index("appointments_bay_idx").on(table.bayId),
}));

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

/**
 * App Settings table - stores single-row global settings (like Autodata tokens)
 */
export const appSettings = mysqlTable("appSettings", {
  id: int("id").autoincrement().primaryKey(),
  keyName: varchar("keyName", { length: 100 }).notNull().unique(), // e.g., 'autodata_tokens'
  value: json("value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

/**
 * Autodata Requests table - Queue for Browser Drone Proxy
 */
export const autodataRequests = mysqlTable("autodataRequests", {
  id: int("id").autoincrement().primaryKey(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(), // e.g. /w2/api/vehicles/TOY43021
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  resultData: json("resultData"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt")
});

export type AutodataRequest = typeof autodataRequests.$inferSelect;
export type InsertAutodataRequest = typeof autodataRequests.$inferInsert;

/**
 * Pre-set descriptions - reusable job-sheet description snippets (GA4 parity)
 */
export const descriptionPresets = mysqlTable("descriptionPresets", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  category: varchar("category", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  titleIdx: index("description_presets_title_idx").on(table.title),
}));

export type DescriptionPreset = typeof descriptionPresets.$inferSelect;
export type InsertDescriptionPreset = typeof descriptionPresets.$inferInsert;
