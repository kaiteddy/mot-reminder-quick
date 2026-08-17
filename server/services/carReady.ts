/**
 * "Your car is ready to collect" — the message the workshop sends when a job is finished.
 *
 * Kept separate from the reminder flows in smsService because this one is triggered by hand from
 * a job sheet rather than by the nightly sweep, and it is the only message we send that is not
 * chasing the customer for something.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb, getAppSetting } from "../db";
import { customers, serviceHistory, vehicles } from "../../drizzle/schema";
import { generateCarReadyMessage, sendCarReadyMessage, isOwnNumber } from "../smsService";

/** The Twilio ContentSid of the approved "car ready" WhatsApp template, once there is one. */
export const CAR_READY_TEMPLATE_KEY = "carReadyTemplateSid";

async function loadDoc(docId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = await db
    .select({
      id: serviceHistory.id,
      docNo: serviceHistory.docNo,
      registration: serviceHistory.registration,
      customerName: serviceHistory.customerName,
      custTitle: serviceHistory.custTitle,
      custForename: serviceHistory.custForename,
      custSurname: serviceHistory.custSurname,
      custMobile: serviceHistory.custMobile,
      custTelephone: serviceHistory.custTelephone,
      customerId: serviceHistory.customerId,
      fallbackName: customers.name,
      fallbackPhone: customers.phone,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(serviceHistory)
    .leftJoin(customers, eq(customers.id, serviceHistory.customerId))
    .leftJoin(vehicles, eq(vehicles.id, serviceHistory.vehicleId))
    .where(eq(serviceHistory.id, docId))
    .limit(1)
    .then((r) => r[0]);
  if (!row) throw new Error("Document not found");
  return row;
}

/** appSettings values come back loosely typed; every setting we want here is a plain string. */
const asText = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || null;
};

/** Prefer the mobile — this is a text, and a landline can't receive one. */
function pickPhone(row: any): string {
  return String(row.custMobile || row.fallbackPhone || row.custTelephone || "").trim();
}

function pickName(row: any): string {
  const parts = [row.custForename, row.custSurname].filter(Boolean).join(" ").trim();
  return (row.customerName || parts || row.fallbackName || "").trim();
}

export async function getCarReadyPreview(docId: number) {
  const row = await loadDoc(docId);
  const [companyName, phone, templateSid] = (await Promise.all([
    getAppSetting("companyName"),
    getAppSetting("companyPhone"),
    getAppSetting(CAR_READY_TEMPLATE_KEY),
  ])).map(asText);
  const to = pickPhone(row);
  const customerName = pickName(row);
  const vehicle = [row.make, row.model].filter(Boolean).join(" ").trim();

  return {
    docId,
    docNo: row.docNo,
    to,
    customerName,
    registration: row.registration || "",
    vehicle,
    message: generateCarReadyMessage({
      customerName,
      registration: row.registration || "",
      vehicle,
      companyName,
      phone,
    }),
    // Surfaced so the dialog can say why it can't send, rather than failing on the click.
    canSend: !!to && !isOwnNumber(to),
    reason: !to
      ? "No mobile number on this customer"
      : isOwnNumber(to)
        ? "That number is one of ours — check the customer record"
        : null,
    usingTemplate: !!templateSid,
  };
}

export async function sendCarReady(params: { docId: number; to: string; message: string }) {
  const row = await loadDoc(params.docId);
  const to = params.to.trim();
  // Re-checked here, not just in the dialog: the number is editable before sending, and texting
  // our own line would look to the customer like nothing happened.
  if (isOwnNumber(to)) throw new Error("That number is one of ours — the customer wouldn't get it");

  const templateSid = asText(await getAppSetting(CAR_READY_TEMPLATE_KEY));
  const result = await sendCarReadyMessage({
    to,
    customerName: pickName(row),
    registration: row.registration || "",
    vehicle: [row.make, row.model].filter(Boolean).join(" ").trim(),
    message: params.message,
    templateSid,
  });
  if (!result.success) throw new Error(result.error || "Message failed to send");
  return { success: true as const, to, sid: (result as any).messageSid ?? null };
}
