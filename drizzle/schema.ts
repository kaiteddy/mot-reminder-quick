import { pgTable, serial, integer, text, varchar, timestamp, numeric, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Postgres schema (Neon). Ported from the original MySQL/TiDB schema:
 *  - int().autoincrement() -> serial(); int() -> integer()
 *  - mysqlEnum(...)        -> text().$type<union>()  (keeps TS types, no PG enum type needed)
 *  - decimal(...)          -> numeric(...)
 *  - datetime(...)         -> timestamp({ mode: 'date' })
 *  - json(...)             -> jsonb(...)
 *  - .onUpdateNow()        -> .$onUpdate(() => new Date())
 * Column names stay camelCase (Drizzle quotes identifiers) so app code is unchanged.
 */

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: text("role").$type<"user" | "admin">().default("user").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Customers table - stores customer contact information
 */
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 100 }),
  externalId: varchar("externalId", { length: 255 }).unique(), // GA4 _ID
  address: text("address"),
  postcode: varchar("postcode", { length: 20 }),
  notes: text("notes"),
  altContacts: jsonb("altContacts"), // extra named phone numbers: [{ name, phone }]
  mergedExternalIds: jsonb("mergedExternalIds"), // GA4 ids of duplicate records merged into this one
  optedOut: integer("optedOut").default(0).notNull(), // 0 = false, 1 = true
  optedOutAt: timestamp("optedOutAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  phoneIdx: index("customers_phone_idx").on(table.phone),
  emailIdx: index("customers_email_idx").on(table.email),
}));

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

/**
 * Vehicles table - stores vehicle registration and MOT information
 */
export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  registration: varchar("registration", { length: 20 }).notNull().unique(),
  make: varchar("make", { length: 100 }),
  model: varchar("model", { length: 100 }),
  motExpiryDate: timestamp("motExpiryDate", { mode: "date" }),
  taxStatus: varchar("taxStatus", { length: 20 }), // Taxed, Untaxed, SORN
  taxDueDate: timestamp("taxDueDate", { mode: "date" }),
  lastChecked: timestamp("lastChecked", { mode: "date" }),
  motBookedDate: timestamp("motBookedDate", { mode: "date" }),
  bookingRequested: integer("bookingRequested").default(0),
  customerId: integer("customerId"),
  externalId: varchar("externalId", { length: 255 }), // GA4 _ID
  colour: varchar("colour", { length: 50 }),
  fuelType: varchar("fuelType", { length: 50 }),
  dateOfRegistration: timestamp("dateOfRegistration", { mode: "date" }),
  vin: varchar("vin", { length: 50 }),
  engineCC: integer("engineCC"),
  engineNo: varchar("engineNo", { length: 50 }),
  engineCode: varchar("engineCode", { length: 50 }),
  derivative: varchar("derivative", { length: 255 }),
  paintCode: varchar("paintCode", { length: 50 }),
  keyCode: varchar("keyCode", { length: 50 }),
  radioCode: varchar("radioCode", { length: 50 }),
  notes: text("notes"),
  comprehensiveTechnicalData: jsonb("comprehensiveTechnicalData"),
  swsLastUpdated: timestamp("swsLastUpdated", { mode: "date" }),
  autodataMid: varchar("autodataMid", { length: 64 }), // Autodata vehicle/model id for /w1/vehicles/{mid}
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  customerIdIdx: index("vehicles_customer_id_idx").on(table.customerId),
  motExpiryDateIdx: index("vehicles_mot_expiry_date_idx").on(table.motExpiryDate),
}));

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = typeof vehicles.$inferInsert;

/**
 * Reminders table - stores MOT and service reminders
 */
export const reminders = pgTable("reminders", {
  id: serial("id").primaryKey(),
  type: text("type").$type<"MOT" | "Service" | "Cambelt" | "Other">().notNull(),
  dueDate: timestamp("dueDate", { mode: "date" }).notNull(),
  registration: varchar("registration", { length: 20 }).notNull(),
  customerName: text("customerName"),
  customerEmail: varchar("customerEmail", { length: 320 }),
  customerPhone: varchar("customerPhone", { length: 20 }),
  vehicleMake: varchar("vehicleMake", { length: 100 }),
  vehicleModel: varchar("vehicleModel", { length: 100 }),
  motExpiryDate: timestamp("motExpiryDate", { mode: "date" }),
  status: text("status").$type<"pending" | "sent" | "archived">().default("pending").notNull(),
  sentAt: timestamp("sentAt", { mode: "date" }),
  sentMethod: varchar("sentMethod", { length: 20 }), // email, print, sms, whatsapp
  customerResponded: integer("customerResponded").default(0).notNull(),
  respondedAt: timestamp("respondedAt", { mode: "date" }),
  needsFollowUp: integer("needsFollowUp").default(0).notNull(),
  notes: text("notes"),
  vehicleId: integer("vehicleId"),
  customerId: integer("customerId"),
  externalId: varchar("externalId", { length: 255 }), // GA4 _ID
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  dueDateIdx: index("reminders_due_date_idx").on(table.dueDate),
  statusIdx: index("reminders_status_idx").on(table.status),
}));

export type Reminder = typeof reminders.$inferSelect;
export type InsertReminder = typeof reminders.$inferInsert;

/**
 * Reminder Logs table - tracks all sent reminders
 */
export const reminderLogs = pgTable("reminderLogs", {
  id: serial("id").primaryKey(),
  reminderId: integer("reminderId"),
  customerId: integer("customerId"),
  vehicleId: integer("vehicleId"),
  messageType: text("messageType").$type<"MOT" | "Service" | "Cambelt" | "Other">().notNull(),
  recipient: varchar("recipient", { length: 20 }).notNull(), // phone number
  messageSid: varchar("messageSid", { length: 100 }), // Twilio message ID
  status: text("status").$type<"queued" | "sent" | "delivered" | "read" | "failed" | "undelivered">().default("queued").notNull(),
  templateUsed: varchar("templateUsed", { length: 255 }),
  customerName: text("customerName"),
  registration: varchar("registration", { length: 20 }),
  dueDate: timestamp("dueDate", { mode: "date" }),
  messageContent: text("messageContent"),
  sentAt: timestamp("sentAt", { mode: "date" }).defaultNow().notNull(),
  deliveredAt: timestamp("deliveredAt", { mode: "date" }),
  readAt: timestamp("readAt", { mode: "date" }),
  failedAt: timestamp("failedAt", { mode: "date" }),
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
export const customerMessages = pgTable("customerMessages", {
  id: serial("id").primaryKey(),
  messageSid: varchar("messageSid", { length: 100 }).notNull().unique(), // Twilio message ID
  fromNumber: varchar("fromNumber", { length: 20 }).notNull(),
  toNumber: varchar("toNumber", { length: 20 }).notNull(),
  messageBody: text("messageBody"),
  customerId: integer("customerId"),
  relatedLogId: integer("relatedLogId"),
  receivedAt: timestamp("receivedAt", { mode: "date" }).defaultNow().notNull(),
  read: integer("read").default(0).notNull(), // 0 = unread, 1 = read
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  customerIdIdx: index("customer_messages_customer_id_idx").on(table.customerId),
  receivedAtIdx: index("customer_messages_received_at_idx").on(table.receivedAt),
}));

export type CustomerMessage = typeof customerMessages.$inferSelect;
export type InsertCustomerMessage = typeof customerMessages.$inferInsert;

/**
 * Service History table - stores document headers (invoices/estimates)
 */
export const serviceHistory = pgTable("serviceHistory", {
  id: serial("id").primaryKey(),
  externalId: varchar("externalId", { length: 255 }).notNull().unique(), // GA4 Document _ID
  customerId: integer("customerId"),
  vehicleId: integer("vehicleId"),
  docType: varchar("docType", { length: 20 }), // SI, ES, etc.
  docNo: varchar("docNo", { length: 50 }),
  dateCreated: timestamp("dateCreated", { mode: "date" }),
  dateIssued: timestamp("dateIssued", { mode: "date" }),
  datePaid: timestamp("datePaid", { mode: "date" }),
  totalNet: numeric("totalNet", { precision: 10, scale: 2 }),
  totalTax: numeric("totalTax", { precision: 10, scale: 2 }),
  totalGross: numeric("totalGross", { precision: 10, scale: 2 }),
  mileage: integer("mileage"),
  description: text("description"),
  docStatus: varchar("docStatus", { length: 50 }),
  department: varchar("department", { length: 100 }),
  orderRef: varchar("orderRef", { length: 100 }),
  balance: numeric("balance", { precision: 10, scale: 2 }),
  totalReceipts: numeric("totalReceipts", { precision: 10, scale: 2 }),
  subPartsNet: numeric("subPartsNet", { precision: 10, scale: 2 }),
  subPartsTax: numeric("subPartsTax", { precision: 10, scale: 2 }),
  subPartsGross: numeric("subPartsGross", { precision: 10, scale: 2 }),
  subLabourNet: numeric("subLabourNet", { precision: 10, scale: 2 }),
  subLabourTax: numeric("subLabourTax", { precision: 10, scale: 2 }),
  subLabourGross: numeric("subLabourGross", { precision: 10, scale: 2 }),
  subMotNet: numeric("subMotNet", { precision: 10, scale: 2 }),
  subMotTax: numeric("subMotTax", { precision: 10, scale: 2 }),
  subMotGross: numeric("subMotGross", { precision: 10, scale: 2 }),
  paymentMethods: varchar("paymentMethods", { length: 255 }),
  registration: varchar("registration", { length: 20 }),
  customerName: varchar("customerName", { length: 255 }),
  custTitle: varchar("custTitle", { length: 20 }),
  custForename: varchar("custForename", { length: 100 }),
  custSurname: varchar("custSurname", { length: 150 }),
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
  origJobSheetNo: integer("origJobSheetNo"), // GA4 docNumber_Orig_JS — links an invoice to the job sheet that holds the work narrative
  excessNet: numeric("excessNet", { precision: 10, scale: 2 }),
  excessTax: numeric("excessTax", { precision: 10, scale: 2 }),
  excessGross: numeric("excessGross", { precision: 10, scale: 2 }),
  // GA4 "Fixed Item 1/2/3" = Sundries / Lubricants / Paint & Mat. on the Sales-Summary breakdown
  fixedItem1Net: numeric("fixedItem1Net", { precision: 10, scale: 2 }),
  fixedItem1Tax: numeric("fixedItem1Tax", { precision: 10, scale: 2 }),
  fixedItem1Gross: numeric("fixedItem1Gross", { precision: 10, scale: 2 }),
  fixedItem2Net: numeric("fixedItem2Net", { precision: 10, scale: 2 }),
  fixedItem2Tax: numeric("fixedItem2Tax", { precision: 10, scale: 2 }),
  fixedItem2Gross: numeric("fixedItem2Gross", { precision: 10, scale: 2 }),
  fixedItem3Net: numeric("fixedItem3Net", { precision: 10, scale: 2 }),
  fixedItem3Tax: numeric("fixedItem3Tax", { precision: 10, scale: 2 }),
  fixedItem3Gross: numeric("fixedItem3Gross", { precision: 10, scale: 2 }),
  subPartsCostNet: numeric("subPartsCostNet", { precision: 10, scale: 2 }),
  subPartsCostTax: numeric("subPartsCostTax", { precision: 10, scale: 2 }),
  subPartsCostGross: numeric("subPartsCostGross", { precision: 10, scale: 2 }),
  labourQty: numeric("labourQty", { precision: 10, scale: 2 }),
  totalSurcharge: numeric("totalSurcharge", { precision: 10, scale: 2 }),
  // GA4 us_TotalDiscount — invoice-level discount (line subtotals above are pre-discount; net = subtotals − discount)
  totalDiscountNet: numeric("totalDiscountNet", { precision: 10, scale: 2 }),
  totalDiscountGross: numeric("totalDiscountGross", { precision: 10, scale: 2 }),
  motQty: integer("motQty"),
  motCost: numeric("motCost", { precision: 10, scale: 2 }),
  motOutsourced: varchar("motOutsourced", { length: 10 }),
  relatedDocId: integer("relatedDocId"),
  relatedDocNo: varchar("relatedDocNo", { length: 50 }),
  insuranceCompany: varchar("insuranceCompany", { length: 255 }),
  excessDiscount: numeric("excessDiscount", { precision: 10, scale: 2 }),
  custVatRegistered: integer("custVatRegistered"),
  terms: varchar("terms", { length: 255 }),
  accountsExportedAt: timestamp("accountsExportedAt", { mode: "date" }), // set when exported to the accounts package (Sage CSV); prevents re-export
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
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
export const serviceLineItems = pgTable("serviceLineItems", {
  id: serial("id").primaryKey(),
  externalId: varchar("externalId", { length: 255 }).notNull().unique(), // GA4 LineItem _ID
  documentId: integer("documentId").notNull(),
  documentExternalId: varchar("documentExternalId", { length: 255 }),
  description: text("description"),
  quantity: numeric("quantity", { precision: 10, scale: 2 }),
  unitPrice: numeric("unitPrice", { precision: 10, scale: 2 }),
  subNet: numeric("subNet", { precision: 10, scale: 2 }),
  taxAmount: numeric("taxAmount", { precision: 10, scale: 2 }),
  vatRate: numeric("vatRate", { precision: 5, scale: 2 }),
  discount: numeric("discount", { precision: 10, scale: 2 }),
  discountType: varchar("discountType", { length: 10 }), // 'pct' | 'amt'
  partNumber: varchar("partNumber", { length: 100 }),
  nominalCode: varchar("nominalCode", { length: 50 }),
  itemType: varchar("itemType", { length: 50 }), // Labour, Part, MOT, Fixed, etc.
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  documentIdIdx: index("service_line_items_document_id_idx").on(table.documentId),
  documentExternalIdIdx: index("service_line_items_document_external_id_idx").on(table.documentExternalId),
}));

export type ServiceLineItem = typeof serviceLineItems.$inferSelect;
export type InsertServiceLineItem = typeof serviceLineItems.$inferInsert;

/**
 * Appointments table - stores Kanban calendar appointments
 */
export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicleId"),
  customerId: integer("customerId"),
  registration: varchar("registration", { length: 20 }),
  externalId: varchar("externalId", { length: 255 }).unique(), // GA4 appointment _ID (null for web-created)
  serviceType: varchar("serviceType", { length: 30 }).default("MOT"), // MOT | MOT & Service | Service — drives the reminder wording
  bayId: varchar("bayId", { length: 50 }).notNull(),
  appointmentDate: timestamp("appointmentDate", { mode: "date" }).notNull(),
  startTime: varchar("startTime", { length: 10 }),
  endTime: varchar("endTime", { length: 10 }),
  status: text("status").$type<"scheduled" | "in_progress" | "completed" | "cancelled">().default("scheduled").notNull(),
  notes: text("notes"),
  orderIndex: integer("orderIndex").default(0).notNull(),
  reminderSentAt: timestamp("reminderSentAt", { mode: "date" }), // day-of MOT reminder sent (dedup)
  reminderMessageSid: varchar("reminderMessageSid", { length: 64 }), // Twilio SID of the sent reminder (for delivery status)
  reminderStatus: varchar("reminderStatus", { length: 20 }), // sent/delivered/read/undelivered/failed (from status callback)
  customerResponse: text("customerResponse").$type<"confirmed" | "cancel" | "reschedule">(), // their WhatsApp button reply
  respondedAt: timestamp("respondedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  dateIdx: index("appointments_date_idx").on(table.appointmentDate),
  bayIdx: index("appointments_bay_idx").on(table.bayId),
}));

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

/**
 * App Settings table - stores single-row global settings (like Autodata tokens)
 */
export const appSettings = pgTable("appSettings", {
  id: serial("id").primaryKey(),
  keyName: varchar("keyName", { length: 100 }).notNull().unique(),
  value: jsonb("value"),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

/**
 * Autodata Requests table - Queue for Browser Drone Proxy
 */
export const autodataRequests = pgTable("autodataRequests", {
  id: serial("id").primaryKey(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  status: text("status").$type<"pending" | "processing" | "completed" | "failed">().default("pending").notNull(),
  resultData: jsonb("resultData"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  completedAt: timestamp("completedAt", { mode: "date" }),
});

export type AutodataRequest = typeof autodataRequests.$inferSelect;
export type InsertAutodataRequest = typeof autodataRequests.$inferInsert;

/**
 * Pre-set descriptions - reusable job-sheet description snippets (GA4 parity)
 */
export const descriptionPresets = pgTable("descriptionPresets", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  category: varchar("category", { length: 100 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  titleIdx: index("description_presets_title_idx").on(table.title),
}));

export type DescriptionPreset = typeof descriptionPresets.$inferSelect;
export type InsertDescriptionPreset = typeof descriptionPresets.$inferInsert;

/**
 * Customer communication / activity log.
 */
export const customerLogs = pgTable("customerLogs", {
  id: serial("id").primaryKey(),
  customerId: integer("customerId"),
  vehicleId: integer("vehicleId"),
  documentId: integer("documentId"),
  type: text("type").$type<"note" | "email" | "sms" | "call" | "letter" | "system">().default("note").notNull(),
  direction: text("direction").$type<"in" | "out" | "internal">().default("out").notNull(),
  subject: varchar("subject", { length: 255 }),
  body: text("body"),
  createdBy: varchar("createdBy", { length: 100 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  customerIdIdx: index("customer_logs_customer_id_idx").on(table.customerId),
  vehicleIdIdx: index("customer_logs_vehicle_id_idx").on(table.vehicleId),
  createdAtIdx: index("customer_logs_created_at_idx").on(table.createdAt),
}));

export type CustomerLog = typeof customerLogs.$inferSelect;
export type InsertCustomerLog = typeof customerLogs.$inferInsert;

/**
 * Payments / receipts recorded against a document when it is issued.
 */
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  documentId: integer("documentId").notNull(),
  customerId: integer("customerId"),
  method: varchar("method", { length: 50 }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  paymentDate: timestamp("paymentDate", { mode: "date" }),
  note: varchar("note", { length: 255 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  documentIdIdx: index("payments_document_id_idx").on(table.documentId),
  customerIdIdx: index("payments_customer_id_idx").on(table.customerId),
}));

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/** One row per billable address lookup (Ideal Postcodes), so credit usage can be tracked. */
export const addressLookups = pgTable("addressLookups", {
  id: serial("id").primaryKey(),
  postcode: varchar("postcode", { length: 12 }),
  results: integer("results"),
  source: varchar("source", { length: 40 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index("address_lookups_created_at_idx").on(table.createdAt),
}));

export type AddressLookup = typeof addressLookups.$inferSelect;

/**
 * Sales Cars Stock — the dealership's forecourt stock.
 */
export const salesStock = pgTable("salesStock", {
  id: serial("id").primaryKey(),
  externalId: varchar("externalId", { length: 64 }).unique(), // CSV VehicleID
  registration: varchar("registration", { length: 20 }),
  vin: varchar("vin", { length: 50 }),
  title: text("title"),
  make: varchar("make", { length: 100 }),
  model: varchar("model", { length: 100 }),
  variant: text("variant"),
  vehicleType: varchar("vehicleType", { length: 50 }),
  category: varchar("category", { length: 50 }),
  year: integer("year"),
  fuelType: varchar("fuelType", { length: 50 }),
  colour: varchar("colour", { length: 50 }),
  mileage: integer("mileage"),
  transmission: varchar("transmission", { length: 50 }),
  owners: integer("owners"),
  price: numeric("price", { precision: 10, scale: 2 }),
  vatStatus: varchar("vatStatus", { length: 50 }),
  status: varchar("status", { length: 50 }),
  daysInStock: integer("daysInStock"),
  stockNumber: varchar("stockNumber", { length: 50 }),
  registrationDate: timestamp("registrationDate", { mode: "date" }),
  imageUrl: text("imageUrl"),
  websiteUrl: text("websiteUrl"),
  motExpiryDate: timestamp("motExpiryDate", { mode: "date" }),
  taxStatus: varchar("taxStatus", { length: 20 }),
  taxDueDate: timestamp("taxDueDate", { mode: "date" }),
  motTaxChecked: timestamp("motTaxChecked", { mode: "date" }),
  priceIndicator: varchar("priceIndicator", { length: 30 }),
  pricePosition: varchar("pricePosition", { length: 20 }),
  retailValuation: numeric("retailValuation", { precision: 10, scale: 2 }),
  adminFee: numeric("adminFee", { precision: 10, scale: 2 }),
  performanceRating: varchar("performanceRating", { length: 30 }),
  views7d: integer("views7d"),
  searches7d: integer("searches7d"),
  checkStatus: varchar("checkStatus", { length: 30 }),
  checkIssues: varchar("checkIssues", { length: 255 }),
  atAdvertStatus: varchar("atAdvertStatus", { length: 30 }),
  bodyType: varchar("bodyType", { length: 50 }),
  doors: integer("doors"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  regIdx: index("sales_stock_reg_idx").on(table.registration),
}));

export type SalesStock = typeof salesStock.$inferSelect;

/**
 * ── Expenditure reconciliation (bank + Barclaycard cashbook) ──────────────
 * Additive tables for the Finance / Profit & Cashbook feature. Bank + card
 * transactions are stored signed (money out = negative, in = positive) and
 * resolve to a category via the transactionLabels cascade (counterparty ->
 * category), with an optional per-row override. Categories carry a P&L
 * `section` so the reconciliation can roll up to Gross / Operating profit.
 */
export const expenditureCategories = pgTable("expenditureCategories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  section: varchar("section", { length: 20 }).$type<"receipts" | "cogs" | "cartrade" | "overheads" | "taxes" | "financing">().notNull(),
  sortOrder: integer("sortOrder").notNull().default(0),
  isContra: integer("isContra").notNull().default(0), // 1 = transfer/settlement, excluded from P&L
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  sectionIdx: index("expenditure_categories_section_idx").on(table.section),
}));

export type ExpenditureCategory = typeof expenditureCategories.$inferSelect;

/** Cascade map: a payee/merchant (normalised key) -> category. Set once, applies to all its transactions. */
export const transactionLabels = pgTable("transactionLabels", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 8 }).$type<"bank" | "card">().notNull(),
  counterpartyKey: varchar("counterpartyKey", { length: 200 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  note: text("note"),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  keyIdx: uniqueIndex("transaction_labels_source_key_idx").on(table.source, table.counterpartyKey),
}));

export type TransactionLabel = typeof transactionLabels.$inferSelect;

/** Individual bank (Barclays) and card (Barclaycard) transactions. */
export const bankTransactions = pgTable("bankTransactions", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 8 }).$type<"bank" | "card">().notNull(),
  txnDate: timestamp("txnDate", { mode: "date" }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // signed: out = negative
  direction: varchar("direction", { length: 4 }).$type<"IN" | "OUT">().notNull(),
  counterparty: varchar("counterparty", { length: 255 }), // raw payee/merchant for display
  counterpartyKey: varchar("counterpartyKey", { length: 200 }), // normalised, joins to transactionLabels
  memo: text("memo"),
  cardHolder: varchar("cardHolder", { length: 120 }), // card only
  bankCategoryHint: varchar("bankCategoryHint", { length: 120 }), // Barclaycard's own category / bank subcategory
  subcategory: varchar("subcategory", { length: 120 }),
  categoryOverride: varchar("categoryOverride", { length: 80 }), // per-row manual override
  dedupeKey: varchar("dedupeKey", { length: 64 }).notNull().unique(), // hash(source|date|amount|memo) to block re-import dupes
  importBatch: varchar("importBatch", { length: 40 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, (table) => ({
  dateIdx: index("bank_transactions_date_idx").on(table.txnDate),
  sourceIdx: index("bank_transactions_source_idx").on(table.source),
  keyIdx: index("bank_transactions_counterparty_key_idx").on(table.counterpartyKey),
}));

export type BankTransaction = typeof bankTransactions.$inferSelect;
export type InsertBankTransaction = typeof bankTransactions.$inferInsert;
