/**
 * "Your car is ready to collect" — the message the workshop sends when a job is finished — and the
 * MOT update, which tells the customer what the car's MOT found and asks what they would like done.
 *
 * Kept separate from the reminder flows in smsService because these are triggered by hand from a
 * job sheet or invoice rather than by the nightly sweep, and neither chases the customer for a booking.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb, getAppSetting } from "../db";
import { customers, serviceHistory, vehicles } from "../../drizzle/schema";
import { generateCarReadyMessage, generateMotUpdateMessage, sendCarReadyMessage, sendMotUpdateMessage, isOwnNumber } from "../smsService";
import { type CarTextKind, carReadyRoute, cleanMotNote, motUpdateRoute, withMotNote } from "../../shared/carReadyMessage";
import { createReminderLog } from "../db";

/** The Twilio ContentSid of the approved "car ready" WhatsApp template, once there is one. */
export const CAR_READY_TEMPLATE_KEY = "carReadyTemplateSid";

/**
 * The ContentSid of the approved "car ready + notes from its MOT" template (vehicle_ready_mot_notes),
 * once WhatsApp approves one. Until then a message carrying an MOT note goes as plain text, because
 * the plain vehicle_ready template has nowhere to put it.
 */
export const CAR_READY_MOT_TEMPLATE_KEY = "carReadyMotTemplateSid";

/**
 * The ContentSid of the approved MOT update template (scripts/create-mot-update-template.ts), once
 * WhatsApp approves one. Until then an MOT update goes as plain text.
 */
export const MOT_UPDATE_TEMPLATE_KEY = "motUpdateTemplateSid";

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
      vehicleId: serviceHistory.vehicleId,
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

export async function getCarReadyPreview(docId: number, kind: CarTextKind = "ready") {
  const row = await loadDoc(docId);
  const [companyName, phone, templateSid, motTemplateSid, updateTemplateSid] = (await Promise.all([
    getAppSetting("companyName"),
    getAppSetting("companyPhone"),
    getAppSetting(CAR_READY_TEMPLATE_KEY),
    getAppSetting(CAR_READY_MOT_TEMPLATE_KEY),
    getAppSetting(MOT_UPDATE_TEMPLATE_KEY),
  ])).map(asText);
  const to = pickPhone(row);
  const customerName = pickName(row);
  const vehicle = [row.make, row.model].filter(Boolean).join(" ").trim();
  const wording = { customerName, registration: row.registration || "", vehicle, companyName, phone };

  return {
    docId,
    docNo: row.docNo,
    to,
    customerName,
    registration: row.registration || "",
    vehicle,
    message: kind === "mot_update" ? generateMotUpdateMessage(wording) : generateCarReadyMessage(wording),
    // Surfaced so the dialog can say why it can't send, rather than failing on the click.
    canSend: !!to && !isOwnNumber(to),
    reason: !to
      ? "No mobile number on this customer"
      : isOwnNumber(to)
        ? "That number is one of ours — check the customer record"
        : null,
    usingTemplate: !!templateSid,
    notesTemplate: !!motTemplateSid,
    updateTemplate: !!updateTemplateSid,
  };
}

export async function sendCarReady(params: { docId: number; to: string; message: string; motNote?: string | null }) {
  const row = await loadDoc(params.docId);
  const to = params.to.trim();
  // Re-checked here, not just in the dialog: the number is editable before sending, and texting
  // our own line would look to the customer like nothing happened.
  if (isOwnNumber(to)) throw new Error("That number is one of ours — the customer wouldn't get it");

  const [templateSid, motTemplateSid] = (await Promise.all([
    getAppSetting(CAR_READY_TEMPLATE_KEY),
    getAppSetting(CAR_READY_MOT_TEMPLATE_KEY),
  ])).map(asText);
  // Cleaned here as well as in the dialog: this is the last stop before Twilio, which refuses a
  // template variable over 256 characters or with a newline in it.
  const motNote = cleanMotNote(params.motNote) || null;
  const message = withMotNote(params.message, motNote);
  const route = carReadyRoute({ hasNote: !!motNote, readyTemplate: !!templateSid, notesTemplate: !!motTemplateSid });
  const result = await sendCarReadyMessage({
    to,
    customerName: pickName(row),
    registration: row.registration || "",
    vehicle: [row.make, row.model].filter(Boolean).join(" ").trim(),
    message,
    templateSid,
    motNote,
    motTemplateSid,
  });
  if (!result.success) throw new Error(result.error || "Message failed to send");

  const sid = (result as any).messageId ?? null;
  await logSent(row, { to, messageType: "car_ready", messageSid: sid, templateUsed: route.channel === "template" ? route.template : null, message });
  return { success: true as const, to, sid };
}

/**
 * Tell the customer what the car's MOT found and ask what they would like done — from the job
 * sheet, before anything is invoiced. The note is the update, so one never goes out without it.
 */
export async function sendMotUpdate(params: { docId: number; to: string; message: string; motNote: string }) {
  const row = await loadDoc(params.docId);
  const to = params.to.trim();
  // Re-checked here for the same reasons as in sendCarReady.
  if (isOwnNumber(to)) throw new Error("That number is one of ours — the customer wouldn't get it");
  const motNote = cleanMotNote(params.motNote);
  if (!motNote) throw new Error("Write the note on what its MOT found first — the note is the update");

  const templateSid = asText(await getAppSetting(MOT_UPDATE_TEMPLATE_KEY));
  const message = withMotNote(params.message, motNote, "mot_update");
  const route = motUpdateRoute({ updateTemplate: !!templateSid });
  const result = await sendMotUpdateMessage({
    to,
    customerName: pickName(row),
    registration: row.registration || "",
    vehicle: [row.make, row.model].filter(Boolean).join(" ").trim(),
    message,
    motNote,
    templateSid,
  });
  if (!result.success) throw new Error(result.error || "Message failed to send");

  const sid = (result as any).messageId ?? null;
  await logSent(row, { to, messageType: "mot_update", messageSid: sid, templateUsed: route.channel === "template" ? route.template : null, message });
  return { success: true as const, to, sid };
}

/**
 * Record a sent text against the customer. A conversation thread is built from reminderLogs (what we
 * sent) plus customerMessages (what they sent back); without this the customer's reply arrives in
 * Conversations with nothing before it, and no way to see what we told them or when. Logging must
 * never lose a message that has already gone out, so a failure here is reported and swallowed
 * rather than thrown.
 */
async function logSent(
  row: Awaited<ReturnType<typeof loadDoc>>,
  sent: { to: string; messageType: "car_ready" | "mot_update"; messageSid: string | null; templateUsed: string | null; message: string },
) {
  try {
    await createReminderLog({
      customerId: row.customerId ?? null,
      vehicleId: row.vehicleId ?? null,
      messageType: sent.messageType,
      recipient: sent.to,
      messageSid: sent.messageSid,
      status: "sent",
      templateUsed: sent.templateUsed,
      customerName: pickName(row),
      registration: row.registration || null,
      // The whole text, note included, so Conversations shows what the customer actually read.
      messageContent: sent.message,
      sentAt: new Date(),
    } as any);
  } catch (e: any) {
    console.error(`[carReady] ${sent.messageType} sent but failed to log:`, e?.message);
  }
}
