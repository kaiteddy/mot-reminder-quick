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

    const result = { ok: true, live, date: today, found: appts.length, sent: 0, skipped: [] as any[], wouldSend: [] as any[] };

    for (const a of appts) {
      const phone = (a.phone || "").trim();
      if (!phone) { result.skipped.push({ id: a.id, reg: a.registration, why: "no phone" }); continue; }
      if (a.optedOut) { result.skipped.push({ id: a.id, reg: a.registration, why: "opted out" }); continue; }

      const car = [a.make, a.model].filter(Boolean).join(" ") || "your vehicle";
      const at = a.startTime ? ` at ${a.startTime}` : "";
      const firstName = String(a.customerName || "").replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, "").split(" ")[0] || "there";
      const message = `Hi ${firstName}, a reminder that your ${car} (${a.registration}) is booked in for its MOT at ELI Motors today${at}. If you need to rearrange just reply. Thanks, ELI Motors.`;

      if (!live) { result.wouldSend.push({ id: a.id, reg: a.registration, to: phone, message }); continue; }

      const r = await sendSMS({ to: phone, message });
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
