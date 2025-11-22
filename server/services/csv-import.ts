import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';

export interface GA4Customer {
  _ID: string;
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

/**
 * Build full customer name from GA4 fields
 */
export function buildCustomerName(customer: GA4Customer): string {
  const parts = [
    customer.nameTitle,
    customer.nameForename,
    customer.nameSurname,
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
 */
export function getPhoneNumber(customer: GA4Customer): string | null {
  // Clean phone numbers - extract first number if multiple
  const cleanPhone = (phone?: string) => {
    if (!phone) return null;
    // Extract first phone number (before any text)
    const match = phone.match(/^(\d[\d\s]+)/);
    return match ? match[1].replace(/\s/g, '') : phone.replace(/\s/g, '');
  };
  
  const mobile = cleanPhone(customer.contactMobile);
  const telephone = cleanPhone(customer.contactTelephone);
  
  return mobile || telephone || null;
}
