/**
 * SMTP email sending — connects directly to the user's email provider's SMTP
 * server (same model as GA4). Config stored in appSettings under "smtp_settings".
 */
import nodemailer from "nodemailer";

export interface SmtpSettings {
  fromAddress?: string;
  fromName?: string;
  copyTo?: string;
  host?: string;
  port?: number;
  secure?: boolean;     // SSL/TLS
  authMethod?: string;  // LOGIN / PLAIN / etc.
  user?: string;
  pass?: string;
  timeout?: number;     // seconds
}

export async function getEmailSettings(): Promise<SmtpSettings> {
  const { getAppSetting } = await import("../db");
  return ((await getAppSetting("smtp_settings")) as any) || {};
}

/** Save settings; preserves the stored password if the UI submits a blank one. */
export async function saveEmailSettings(settings: SmtpSettings) {
  const { saveAppSetting } = await import("../db");
  const existing = await getEmailSettings();
  const merged: SmtpSettings = { ...existing, ...settings };
  if (!settings.pass) merged.pass = existing.pass;
  await saveAppSetting("smtp_settings", merged as any);
  return { success: true };
}

function buildTransport(s: SmtpSettings) {
  const port = Number(s.port) || 587;
  return nodemailer.createTransport({
    host: s.host,
    port,
    secure: port === 465,                         // 465 = implicit TLS
    requireTLS: port === 587 && (s.secure ?? true), // 587 = STARTTLS
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    connectionTimeout: (Number(s.timeout) || 60) * 1000,
  });
}

export async function testEmailConnection() {
  const s = await getEmailSettings();
  if (!s.host) throw new Error("SMTP server is not configured.");
  await buildTransport(s).verify();
  return { success: true };
}

/** Email a document (PDF attached) to a recipient via the configured SMTP server. */
export async function sendDocumentEmail(opts: { docId: number; to: string; cc?: string; subject?: string; message?: string }) {
  const s = await getEmailSettings();
  if (!s.host || !s.user) throw new Error("Email is not set up. Configure SMTP in Email Settings first.");
  if (!opts.to || !opts.to.includes("@")) throw new Error("A valid recipient email address is required.");

  const { getRichPDF } = await import("../db");
  const pdf: any = await getRichPDF(opts.docId);
  const from = s.fromName ? `"${s.fromName}" <${s.fromAddress || s.user}>` : (s.fromAddress || s.user);
  const docName = pdf.filename.replace(/\.pdf$/i, "");
  const body = opts.message || `Please find your ${docName} attached.`;

  const info = await buildTransport(s).sendMail({
    from,
    to: opts.to,
    cc: [opts.cc, s.copyTo].filter(Boolean).join(",") || undefined,
    subject: opts.subject || `${docName} — ELI Motors Limited`,
    text: `${body}\n\nKind regards,\nELI Motors Limited\n020 8203 6449 · www.elimotors.co.uk`,
    html: `<p>${body.replace(/\n/g, "<br>")}</p><p>Kind regards,<br><strong>ELI Motors Limited</strong><br>020 8203 6449 · <a href="https://www.elimotors.co.uk">www.elimotors.co.uk</a></p>`,
    attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.content, "base64"), contentType: "application/pdf" }],
  });
  return { success: true, messageId: info.messageId };
}
