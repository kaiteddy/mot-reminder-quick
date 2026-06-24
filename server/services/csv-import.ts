import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import { cleanPhoneField } from '../utils/phoneUtils';

export interface GA4Customer {
  _ID?: string;
  nameTitle?: string;
  nameForename?: string;
  nameSurname?: string;
  nameCompany?: string;
  contactEmail?: string;
  contactMobile?: string;
  contactTelephone?: string;
  addressHouseNo?: string;
  addressRoad?: string;
  addressTown?: string;
  addressPostCode?: string;
  addressCounty?: string;
  Notes?: string;
  // Alternate headers for different export formats
  Forename?: string;
  Surname?: string;
  Telephone?: string;
}

export interface GA4Vehicle {
  _ID: string;
  _ID_Customer: string;
  Registration: string;
  Make?: string;
  Model?: string;
  Colour?: string;
  FuelType?: string;
  DateofReg?: string;
  VIN?: string;
  EngineCC?: string;
  Notes?: string;
  Notes_Reminders?: string;
  MOTExpiry?: string;
  // Joined Customer Fields (from Enhanced Exports)
  Forename?: string;
  Surname?: string;
  Mobile?: string;
  Email?: string;
  "ID Vehicle"?: string;
  "ID Customer"?: string;
  "Engine CC"?: string;
  "VIN "?: string;
  "Owner Forename"?: string;
  "Owner Surname"?: string;
  "Owner Mobile"?: string;
  "Owner Email"?: string;
  "Owner Telephone"?: string;
  "Owner Postcode"?: string;
  "Date of Manufacture"?: string;
  Telephone?: string;
  PostCode?: string;
}

export interface GA4Reminder {
  _ID: string;
  _ID_Template: string;
  _ID_Vehicle: string;
  DueDate: string;
  actioned_Email?: string;
  actioned_Print?: string;
  actioned_SMS?: string;
  actionedDate_Email?: string;
  actionedDate_Print?: string;
  actionedDate_SMS?: string;
}

export interface GA4ReminderTemplate {
  _ID: string;
  Type: string;
}

/**
 * Parse CSV file with ISO-8859-1 encoding (Garage Assistant 4 format)
 */
export function parseCSV<T>(csvData: Buffer | string): T[] {
  try {
    // Convert from ISO-8859-1 to UTF-8 if needed
    const utf8Data = Buffer.isBuffer(csvData)
      ? iconv.decode(csvData, 'ISO-8859-1')
      : csvData;

    const records = parse(utf8Data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });

    return records as T[];
  } catch (error: any) {
    throw new Error(`CSV parsing error: ${error.message}`);
  }
}

/**
 * Map GA4 reminder template ID to reminder type
 */
export function mapReminderType(templateId: string, templates: GA4ReminderTemplate[]): "MOT" | "Service" | "Cambelt" | "Other" {
  const template = templates.find(t => t._ID === templateId);
  const type = template?.Type?.toUpperCase() || "OTHER";

  if (type === "MOT") return "MOT";
  if (type === "SERVICE") return "Service";
  if (type === "CAMBELT") return "Cambelt";
  return "Other";
}

/**
 * Parse GA4 date format (DD/MM/YYYY) to Date object
 */
export function parseGA4Date(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim() === '') return null;

  // Handle DD/MM/YYYY format
  const parts = dateStr.trim().split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    const year = parseInt(parts[2], 10);

    // Validate date components
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (day < 1 || day > 31) return null;
    if (month < 0 || month > 11) return null;
    if (year < 1900 || year > 2100) return null;

    // Create date and validate it's valid
    const date = new Date(year, month, day);
    if (isNaN(date.getTime())) return null;

    // Check if the date components match (handles invalid dates like Feb 31)
    if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
      return null;
    }

    return date;
  }

  return null;
}

/**
 * Determine if reminder was actioned (sent)
 */
export function isReminderActioned(reminder: GA4Reminder): boolean {
  return reminder.actioned_Email === "1" ||
    reminder.actioned_Print === "1" ||
    reminder.actioned_SMS === "1";
}

/**
 * Get the actioned date and method for a reminder
 */
export function getReminderActionedInfo(reminder: GA4Reminder): { date: Date | null; method: string | null } {
  if (reminder.actioned_Email === "1" && reminder.actionedDate_Email) {
    return { date: parseGA4Date(reminder.actionedDate_Email), method: "email" };
  }
  if (reminder.actioned_Print === "1" && reminder.actionedDate_Print) {
    return { date: parseGA4Date(reminder.actionedDate_Print), method: "print" };
  }
  if (reminder.actioned_SMS === "1" && reminder.actionedDate_SMS) {
    return { date: parseGA4Date(reminder.actionedDate_SMS), method: "sms" };
  }
  return { date: null, method: null };
}

// ---------------------------------------------------------------------------
// GA4 Documents (Estimates / Job Sheets / Invoices / Credit Notes)
// Columns produced by GA4 → Admin → General CSV Exports → Documents.
// Field map derived in DOCUMENTS_IMPORT_ANALYSIS.md. Headers use spaces, so we
// read defensively by label with fallbacks (GA4 export variants differ slightly).
// ---------------------------------------------------------------------------
export interface GA4Document {
  [key: string]: string | undefined;
}

/** Parse a GA4 money string ("1,234.56", "£1,234.56", "(12.00)") to a number, or null. */
export function parseGA4Money(value: string | undefined | null): number | null {
  if (value == null) return null;
  let s = String(value).trim();
  if (s === "" || s === "-") return null;
  const negative = /^\(.*\)$/.test(s); // accounting-style negatives
  s = s.replace(/[()£$,\s]/g, "");
  if (s === "") return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Map a GA4 document type code to our normalized type.
 * Real GA4 codes (from Documents.csv `docType`): SI=Sales Invoice, ES=Estimate,
 * JS=Job Sheet, CR=Credit Note, XS=Insurance Excess, PA=Payment on Account,
 * VS=Vehicle Sale, VP=Vehicle Purchase.
 */
export function mapDocType(
  docType: string | undefined,
): "Invoice" | "Estimate" | "JobSheet" | "CreditNote" | "Excess" | "PaymentOnAccount" | "VehicleSale" | "VehiclePurchase" | "Other" {
  const t = (docType || "").trim().toUpperCase();
  switch (t) {
    case "SI": return "Invoice";
    case "ES": return "Estimate";
    case "JS": return "JobSheet";
    case "CR": return "CreditNote";
    case "XS": return "Excess";
    case "PA": return "PaymentOnAccount";
    case "VS": return "VehicleSale";
    case "VP": return "VehiclePurchase";
    default: return "Other";
  }
}

/**
 * Map a GA4 line-item type code (LineItems.csv `itemType`) to a label.
 * 1 = Labour, 2 = Part, 3 = Other/Sundry.
 */
export function mapLineItemType(itemType: string | undefined): "Labour" | "Part" | "Other" {
  switch ((itemType || "").trim()) {
    case "1": return "Labour";
    case "2": return "Part";
    default: return "Other";
  }
}

/** Read a field from a GA4 row by trying several candidate header labels. */
export function pick(row: GA4Document, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v != null) {
      const s = String(v).trim();
      // GA4 exports sometimes carry the literal text "null"/"NULL" for empty cells — treat as blank
      // so it never lands in the record as a real value (and the lookup can backfill it).
      if (s !== "" && !/^null$/i.test(s)) return s;
    }
  }
  return undefined;
}

/** Pick the type-specific document number from GA4's per-type number columns. */
export function pickDocNumber(row: GA4Document): string | undefined {
  return pick(
    row,
    "docNumber_Invoice",
    "docNumber_Jobsheet",
    "docNumber_Estimate",
    "docNumber_Credit",
    "Doc No",
  );
}

/**
 * Map a parsed GA4 Documents.csv row (internal field names) to a serviceHistory
 * insert shape. Links to vehicle/customer happen in the import router via the
 * externalId maps. Labeled-export fallbacks kept for the other export variant.
 */
export function mapGA4Document(row: GA4Document) {
  const m = pick(row, "vehMileage", "Mileage");
  return {
    externalId: pick(row, "_ID", "ID"),
    customerExternalId: pick(row, "_ID_Customer", "ID Customer"),
    vehicleExternalId: pick(row, "_ID_Vehicle", "ID Vehicle"),
    docType: mapDocType(pick(row, "docType", "Doc Type")),
    docTypeRaw: pick(row, "docType", "Doc Type"),
    docNo: pickDocNumber(row),
    docStatus: pick(row, "docUserStatus", "docStatus", "DocStatus"),
    department: pick(row, "docDepartment", "Department"),
    orderRef: pick(row, "docOrderRef", "OrderReference"),
    registration: pick(row, "vehRegistration", "Registration"),
    mileage: m ? parseInt(m.replace(/[,\s]/g, ""), 10) || null : null,
    dateCreated: parseGA4Date(pick(row, "docDate_Created", "Date Created") || ""),
    dateIssued: parseGA4Date(pick(row, "docDate_Issued", "Date Issued") || ""),
    datePaid: parseGA4Date(pick(row, "docDate_Paid", "Date Paid") || ""),
    totalNet: parseGA4Money(pick(row, "us_TotalNET", "Total Net")),
    totalTax: parseGA4Money(pick(row, "us_TotalTAX", "Total Tax")),
    totalGross: parseGA4Money(pick(row, "us_TotalGROSS", "Total Gross")),
    totalReceipts: parseGA4Money(pick(row, "us_TotalReceipts", "Total Receipts")),
    balance: parseGA4Money(pick(row, "us_Balance", "Total Balance", "Balance")),
    subPartsNet: parseGA4Money(pick(row, "us_SubTotal_PartsNET", "Sub Parts Net")),
    subPartsTax: parseGA4Money(pick(row, "us_SubTotal_PartsTAX", "Sub Parts Tax")),
    subPartsGross: parseGA4Money(pick(row, "us_SubTotal_PartsGROSS", "Sub Parts Gross")),
    subLabourNet: parseGA4Money(pick(row, "us_SubTotal_LabourNET", "Sub Labour Net")),
    subLabourTax: parseGA4Money(pick(row, "us_SubTotal_LabourTAX", "Sub Labour Tax")),
    subLabourGross: parseGA4Money(pick(row, "us_SubTotal_LabourGROSS", "Sub Labour Gross")),
    subMotNet: parseGA4Money(pick(row, "motSubTotal_NET", "Sub MOT Net")),
    subMotTax: parseGA4Money(pick(row, "motSubTotal_TAX", "Sub MOT Tax")),
    subMotGross: parseGA4Money(pick(row, "motSubTotal_GROSS", "Sub MOT Gross")),
    // Document-snapshot customer/staff/mot fields for GA4 parity view
    accountNumber: pick(row, "custAccountNumber"),
    accountHeld: pick(row, "custAccountHeld"),
    company: pick(row, "custName_Company"),
    custHouseNo: pick(row, "custAddress_HouseNo"),
    custRoad: pick(row, "custAddress_Road"),
    custLocality: pick(row, "custAddress_Locality"),
    custTown: pick(row, "custAddress_Town"),
    custCounty: pick(row, "custAddress_County"),
    custPostcode: pick(row, "custAddress_PostCode"),
    custTelephone: pick(row, "custCont_Telephone"),
    custMobile: pick(row, "custCont_Mobile"),
    staffSalesPerson: pick(row, "staffSalesPerson"),
    staffTechnician: pick(row, "staffTechnician"),
    staffRoadTester: pick(row, "staffRoadTester"),
    staffMotTester: pick(row, "staffMOTTester"),
    motClass: pick(row, "motClass"),
    motStatus: pick(row, "motStatus"),
    origJobSheet: pick(row, "docNumber_Orig_JS"),
    excessNet: parseGA4Money(pick(row, "excessNET")),
    excessTax: parseGA4Money(pick(row, "excessTax")),
    excessGross: parseGA4Money(pick(row, "excessGross")),
    terms: pick(row, "docTermsandConditions"),
  };
}

/**
 * Map a parsed GA4 LineItems.csv row to a serviceLineItems insert shape.
 * `documentExternalId` links back to the parent Documents._ID.
 */
export function mapGA4LineItem(row: GA4Document) {
  return {
    externalId: pick(row, "_ID"),
    documentExternalId: pick(row, "_ID_Document"),
    stockExternalId: pick(row, "_ID_Stock"),
    itemType: mapLineItemType(pick(row, "itemType")),
    description: pick(row, "itemDescription"),
    partNumber: pick(row, "itemPartNumber"),
    nominalCode: pick(row, "itemNominalCode"),
    quantity: parseGA4Money(pick(row, "itemQuantity")),
    unitPrice: parseGA4Money(pick(row, "itemUnitPrice")),
    subNet: parseGA4Money(pick(row, "itemSub_Net")),
    taxAmount: parseGA4Money(pick(row, "itemSub_Tax")),
    subGross: parseGA4Money(pick(row, "itemSub_Gross")),
    vatRate: parseGA4Money(pick(row, "itemTaxRate")),
    discount: parseGA4Money(pick(row, "itemDiscount_Total", "itemDiscount")),
    technician: pick(row, "technician"),
  };
}

/**
 * Build full customer name from GA4 fields
 */
export function buildCustomerName(customer: GA4Customer): string {
  const parts = [
    customer.nameTitle,
    customer.nameForename || customer.Forename,
    customer.nameSurname || customer.Surname,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return customer.nameCompany || 'Unknown Customer';
}

/**
 * Build full address from GA4 fields
 */
export function buildAddress(customer: GA4Customer): string {
  const parts = [
    customer.addressHouseNo,
    customer.addressRoad,
    customer.addressTown,
    customer.addressCounty,
  ].filter(Boolean);

  return parts.join(', ');
}

/**
 * Get phone number (prefer mobile over landline)
 * Now with validation and normalization
 */
export function getPhoneNumber(customer: GA4Customer): string | null {
  // Try mobile first
  if (customer.contactMobile) {
    const { phone } = cleanPhoneField(customer.contactMobile);
    if (phone) return phone;
  }

  // Fall back to landline (or alternate Telephone header)
  const landline = customer.contactTelephone || customer.Telephone;
  if (landline) {
    const { phone } = cleanPhoneField(landline);
    if (phone) return phone;
  }

  return null;
}

/**
 * Extract email from customer data, including from phone fields
 */
export function getCustomerEmail(customer: GA4Customer): string | null {
  // First check the email field
  if (customer.contactEmail && customer.contactEmail.includes('@')) {
    return customer.contactEmail;
  }

  // Check if email is mixed in mobile field
  if (customer.contactMobile) {
    const { email } = cleanPhoneField(customer.contactMobile);
    if (email) return email;
  }

  const landline = customer.contactTelephone || customer.Telephone;
  if (landline) {
    const { email } = cleanPhoneField(landline);
    if (email) return email;
  }

  return null;
}
