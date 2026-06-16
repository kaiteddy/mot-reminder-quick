import { Router } from "express";

export const cronRouter = Router();

/**
 * Day-of MOT reminders. Designed to be hit by a Vercel Cron (see vercel.json) once each morning.
 *
 * SAFE BY DEFAULT: only actually sends when MOT_DAY_REMINDERS === "on". Otherwise it runs a DRY
 * RUN — it finds today's bookings and reports exactly what it WOULD send, but messages nobody.
 * Respects opt-outs and a per-appointment reminderSentAt flag (so a customer is texted at most once).
 *
 * Auth: if CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this
 * automatically). With no secret set (local dev) it's open.
 */
cronRouter.get("/mot-day-reminders", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const live = process.env.MOT_DAY_REMINDERS === "on";
  try {
    const { getMotAppointmentsForReminder, markAppointmentReminded } = await import("../db");
    const { sendSMS } = await import("../smsService");

    // "today" in the workshop's local (UK) day, regardless of the server's UTC clock
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
    const appts = await getMotAppointmentsForReminder(today);

    // Approved WhatsApp template "notifications_appointment_reminder_template" (vars: date, time).
    // Body: "Your appointment is coming up on {{date}} at {{time}}..." with Confirm/Cancel buttons.
    const TEMPLATE_SID = "HXfe7e2ae7e9b9d581d6862406b4fbeb23";
    const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London",
    });
    const fmtTime = (t?: string | null) => {
      const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
      if (!m) return t || "";
      let h = Number(m[1]); const min = m[2]; const ap = h < 12 ? "am" : "pm";
      h = h % 12 || 12;
      return `${h}:${min}${ap}`;
    };

    const result = { ok: true, live, channel: "whatsapp", template: TEMPLATE_SID, date: today, found: appts.length, sent: 0, skipped: [] as any[], wouldSend: [] as any[] };

    for (const a of appts) {
      const phone = (a.phone || "").trim();
      if (!phone) { result.skipped.push({ id: a.id, reg: a.registration, why: "no phone" }); continue; }
      if (a.optedOut) { result.skipped.push({ id: a.id, reg: a.registration, why: "opted out" }); continue; }

      const timeLabel = fmtTime(a.startTime) || "your booked time";
      const vars = { date: dateLabel, time: timeLabel };
      const car = [a.make, a.model].filter(Boolean).join(" ") || "your vehicle";
      const fallback = `Hi, a reminder that your ${car} (${a.registration}) is booked in for its MOT at ELI Motors on ${dateLabel} at ${timeLabel}. If you need to rearrange just reply. Thanks, ELI Motors.`;

      if (!live) { result.wouldSend.push({ id: a.id, reg: a.registration, to: phone, vars, preview: fallback }); continue; }

      const r = await sendSMS({ to: phone, useTemplate: true, templateSid: TEMPLATE_SID, templateVariables: vars, fallbackMessage: fallback });
      if (r.success) { await markAppointmentReminded(a.id); result.sent++; }
      else { result.skipped.push({ id: a.id, reg: a.registration, why: r.error || "send failed" }); }
    }

    console.log(`[CRON mot-day-reminders] ${live ? "LIVE" : "DRY RUN"} ${today}: found ${result.found}, sent ${result.sent}, would-send ${result.wouldSend.length}, skipped ${result.skipped.length}`);
    return res.json(result);
  } catch (err: any) {
    console.error("[CRON mot-day-reminders] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
