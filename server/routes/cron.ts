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

    // Go-live date (user request): never send reminders before this UK date.
    const START_DATE = "2026-06-18";
    if (today < START_DATE) {
      return res.json({ ok: true, live, date: today, found: 0, sent: 0, note: `reminders start ${START_DATE} — nothing sent before then` });
    }

    const appts = await getMotAppointmentsForReminder(today);

    // Approved WhatsApp templates (Utility), same 5 vars (1=name 2=make/model 3=reg 4=date 5=time).
    // MOT-only says "...for its MOT..."; the service variant says "...for its MOT and a service...".
    const MOT_TEMPLATE = "HX57564b5848889be843bfa6ee1c05eddc"; // copy_of_mot_day_reminder (approved)
    const SERVICE_TEMPLATE = "HX0a3c2c703d7405abebce29909cc2c363"; // mot_service_day_reminder (approved 2026-06-18)
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

    const result = { ok: true, live, channel: "whatsapp", date: today, found: appts.length, sent: 0, skipped: [] as any[], wouldSend: [] as any[] };

    for (const a of appts) {
      const phone = (a.phone || "").trim();
      if (!phone) { result.skipped.push({ id: a.id, reg: a.registration, why: "no phone" }); continue; }
      if (a.optedOut) { result.skipped.push({ id: a.id, reg: a.registration, why: "opted out" }); continue; }

      // Booking type drives the wording: a service-inclusive booking uses the service template.
      const isService = /service/i.test(a.serviceType || "");
      const templateSid = isService ? SERVICE_TEMPLATE : MOT_TEMPLATE;
      const workPhrase = isService ? "its MOT and a service" : "its MOT";

      const timeLabel = fmtTime(a.startTime) || "your booked time";
      const car = [a.make, a.model].filter(Boolean).join(" ") || "your vehicle";
      const firstName = String(a.customerName || "").replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, "").split(" ")[0] || "there";
      // template vars: 1=name, 2=make/model, 3=reg, 4=date, 5=time (wording lives in the template body)
      const vars = { "1": firstName, "2": car, "3": String(a.registration || ""), "4": dateLabel, "5": timeLabel };
      const fallback = `Hi ${firstName}, a reminder that your ${car} (${a.registration}) is booked in for ${workPhrase} at ELI Motors on ${dateLabel} at ${timeLabel}. If you need to rearrange just reply. Thanks, ELI Motors.`;

      if (!live) { result.wouldSend.push({ id: a.id, reg: a.registration, to: phone, serviceType: a.serviceType, template: templateSid, vars, preview: fallback }); continue; }

      const r = await sendSMS({ to: phone, useTemplate: true, templateSid, templateVariables: vars, fallbackMessage: fallback });
      if (r.success) { await markAppointmentReminded(a.id, r.messageId); result.sent++; }
      else { result.skipped.push({ id: a.id, reg: a.registration, why: r.error || "send failed" }); }
    }

    console.log(`[CRON mot-day-reminders] ${live ? "LIVE" : "DRY RUN"} ${today}: found ${result.found}, sent ${result.sent}, would-send ${result.wouldSend.length}, skipped ${result.skipped.length}`);
    return res.json(result);
  } catch (err: any) {
    console.error("[CRON mot-day-reminders] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GA4 pool health check — the safety net the pool code always assumed but never had.
 * When a web invoice is issued it claims a reserved GA4 number and stamps it instantly; the actual
 * GA4 draft is meant to be filled+issued afterwards. If that fill never happens, the invoice shows
 * as Issued (with a GA4 number) in the web app but is only a blank shell in GA4 — and nothing flagged
 * it. This daily check turns that silent failure into a visible worklist.
 *
 * READ-ONLY: it never writes to the pool or documents. It reports:
 *  - stuck claims: reserved numbers claimed > GA4_POOL_MAX_AGE_HOURS ago (default 24) with no real
 *    GA4 invoice of that number yet (these need creating in GA4);
 *  - low pool: available numbers running out (the other failure mode — issues then get a null number).
 *
 * Optional alert: if GA4_POOL_ALERT_PHONE is set, texts a one-line summary there when anything is
 * stuck. No phone set = log-only (safe default, matches mot-day-reminders' dry-run ethos).
 *
 * Auth: same CRON_SECRET bearer as the other crons (Vercel Cron sends it automatically).
 */
cronRouter.get("/ga4-pool-check", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const { getStuckGa4Claims, getPoolStatus } = await import("../db");
    const maxAge = Number(process.env.GA4_POOL_MAX_AGE_HOURS || 24);
    const lowMark = Number(process.env.GA4_POOL_LOW_MARK || 3);

    const pool = await getPoolStatus();
    const stuck = await getStuckGa4Claims(maxAge);

    if (stuck.length) {
      const summary = stuck
        .map((s) => `${s.ga4Number}${s.registration ? `/${s.registration}` : ""}${s.totalGross ? ` £${s.totalGross}` : ""} (${s.ageHours}h)`)
        .join(", ");
      console.warn(`[CRON ga4-pool-check] ⚠ ${stuck.length} reserved GA4 number(s) claimed but not created in GA4 — ${summary}`);
    } else {
      console.log(`[CRON ga4-pool-check] ok — pool ${JSON.stringify(pool)}, no stuck claims (>${maxAge}h)`);
    }
    if (pool.available <= lowMark) {
      console.warn(`[CRON ga4-pool-check] ⚠ pool low: only ${pool.available} number(s) available — replenish (create blank GA4 drafts + addPoolNumbers) so new invoices don't issue with a null number`);
    }

    // Optional proactive alert (off unless GA4_POOL_ALERT_PHONE is set).
    const alertPhone = (process.env.GA4_POOL_ALERT_PHONE || "").trim();
    let alerted = false;
    if (alertPhone && (stuck.length || pool.available <= lowMark)) {
      const { sendSMS } = await import("../smsService");
      const lines = stuck.slice(0, 8).map((s) => `${s.ga4Number} ${s.registration || "?"} £${s.totalGross || "0"} (${s.ageHours}h)`).join("\n");
      const parts: string[] = [];
      if (stuck.length) parts.push(`GA4 pool: ${stuck.length} invoice(s) issued in the web app but NOT created in GA4:\n${lines}${stuck.length > 8 ? `\n+${stuck.length - 8} more` : ""}`);
      if (pool.available <= lowMark) parts.push(`Pool low: ${pool.available} numbers left — replenish.`);
      const r = await sendSMS({ to: alertPhone, message: parts.join("\n\n") });
      alerted = !!r.success;
    }

    return res.json({ ok: true, pool, maxAgeHours: maxAge, stuckCount: stuck.length, poolLow: pool.available <= lowMark, alerted, stuck });
  } catch (err: any) {
    console.error("[CRON ga4-pool-check] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
