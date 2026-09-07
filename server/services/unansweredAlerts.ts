/**
 * Unanswered-message escalation.
 *
 * A customer's reply arriving is not the failure mode — it lands in the database every time.
 * The failure mode is nobody answering it: the push banner is missed, the thread gets marked
 * "read" just by being opened, and the customer waits (Ms Eva, 3 September 2026: "Monday
 * morning", never answered). So this watches for inbound messages that have had NO staff reply
 * for longer than the configured wait and nags — push, text and email — repeating on a timer
 * until someone replies in the app or presses "No reply needed" on the thread.
 *
 * "Answered" means a staff message went to that customer AFTER their message: a Conversations
 * reply (freeform / freeform-sms) or a car-ready notice. Automated MOT reminders don't count;
 * neither does the webhook's instant "we'll get back to you" auto-acknowledgement.
 *
 * The clock runs in the garage's working hours: a message that lands at 9pm is due for an
 * answer `afterMinutes` after opening time, not at 9:30pm, and nothing is sent outside hours.
 *
 * The real deadline, though, is WhatsApp's: a free-form reply is only accepted within 24 hours
 * of the customer's LAST message (after that Twilio refuses with 63016 and the app falls back to
 * a paid text). Staff replying does not extend it. So every alert says how long is left on the
 * window, and a separate "window closing" warning fires `windowWarnMinutes` before it shuts —
 * ignoring the repeat timer and the alert ceiling, and placed at the last working moment before
 * the close when the window would shut overnight or on a Sunday.
 *
 * Settings live in appSettings under "unanswered_alerts" so they change without a redeploy.
 */

export type UnansweredAlertSettings = {
  enabled: boolean;
  /** Minutes (within working hours) a message may wait before the first alert. */
  afterMinutes: number;
  /** Minutes between repeat alerts for the same message. */
  repeatMinutes: number;
  /** Stop nagging about one message after this many alerts. */
  maxAlerts: number;
  /** Working hours, UK wall clock, "HH:MM". */
  openTime: string;
  closeTime: string;
  /** ISO weekdays that count: 1 = Monday … 7 = Sunday. */
  days: number[];
  /** Text this number (E.164). Blank = no text. */
  phone: string;
  /** Email this address. Blank = no email. */
  email: string;
  /** Only look this far back — older threads are history, not a queue. */
  lookbackDays: number;
  /** Warn this many minutes before the 24-hour WhatsApp reply window closes. 0 = off. */
  windowWarnMinutes: number;
};

/** Meta's customer-service window: free-form WhatsApp replies are accepted this long after the customer's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 3600_000;

export const DEFAULT_SETTINGS: UnansweredAlertSettings = {
  enabled: true,
  afterMinutes: 30,
  repeatMinutes: 60,
  maxAlerts: 6,
  openTime: "08:00",
  closeTime: "18:00",
  days: [1, 2, 3, 4, 5, 6],
  phone: "",
  email: "",
  lookbackDays: 7,
  windowWarnMinutes: 120,
};

const SETTINGS_KEY = "unanswered_alerts";

export async function getUnansweredAlertSettings(): Promise<UnansweredAlertSettings> {
  const { getAppSetting } = await import("../db");
  const s = ((await getAppSetting(SETTINGS_KEY)) as Partial<UnansweredAlertSettings> | null) || {};
  return { ...DEFAULT_SETTINGS, ...s, days: Array.isArray(s.days) && s.days.length ? s.days : DEFAULT_SETTINGS.days };
}

export async function saveUnansweredAlertSettings(s: UnansweredAlertSettings) {
  const { setAppSetting } = await import("../db");
  await setAppSetting(SETTINGS_KEY, s);
}

/**
 * Messages the customer is not waiting on an answer to. STOP/START are auto-acknowledged by the
 * webhook and actioned there; Confirm/Cancel/Reschedule are reminder button taps that the
 * webhook answers itself and records against the appointment.
 */
const AUTO_HANDLED = /^(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|confirm|confirmed|cancel booking|reschedule|rearrange)\.?$/i;

export function isAutoHandledBody(body: string | null | undefined, hasMedia: boolean): boolean {
  const t = (body || "").trim();
  if (!t) return !hasMedia; // a blank message with no attachment is nothing to answer
  return AUTO_HANDLED.test(t);
}

// ---------------------------------------------------------------------------------------------
// Working-hours arithmetic (UK wall clock, whatever the server's zone is)
// ---------------------------------------------------------------------------------------------

type Clock = { openTime: string; closeTime: string; days: number[] };

const UK_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** The UK wall-clock reading of an instant, as a pseudo-UTC Date (so Date.UTC arithmetic works). */
function ukWall(t: Date): Date {
  const p: Record<string, string> = {};
  for (const part of UK_FMT.formatToParts(t)) p[part.type] = part.value;
  const hour = Number(p.hour) % 24; // "24" appears for midnight in some ICU builds
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second)));
}

/** Convert a pseudo-UTC UK wall-clock Date back to a real instant. */
function fromUkWall(wall: Date, near: Date): Date {
  const offset = ukWall(near).getTime() - near.getTime();
  return new Date(wall.getTime() - offset);
}

function hm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** ISO weekday (1 = Mon … 7 = Sun) of a pseudo-UTC wall-clock Date. */
function isoDay(wall: Date): number {
  const d = wall.getUTCDay();
  return d === 0 ? 7 : d;
}

export function isWithinHours(t: Date, clock: Clock): boolean {
  const wall = ukWall(t);
  const open = hm(clock.openTime), close = hm(clock.closeTime);
  if (Number.isNaN(open) || Number.isNaN(close)) return true;
  if (!clock.days.includes(isoDay(wall))) return false;
  const mins = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  return mins >= open && mins < close;
}

/** The instant the working clock next runs from `t` — `t` itself if already within hours. */
export function nextOpening(t: Date, clock: Clock): Date {
  if (isWithinHours(t, clock)) return t;
  const open = hm(clock.openTime), close = hm(clock.closeTime);
  if (Number.isNaN(open) || Number.isNaN(close) || !clock.days.length) return t;
  const wall = ukWall(t);
  // Try today (if before opening), then up to 14 following days.
  for (let i = 0; i < 15; i++) {
    const day = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + i, 0, 0, 0));
    if (!clock.days.includes(isoDay(day))) continue;
    const candidate = new Date(day.getTime() + open * 60_000);
    if (candidate.getTime() > wall.getTime()) return fromUkWall(candidate, t);
  }
  return t;
}

/** The last working instant at or before `t` — `t` itself if within hours, else the previous close of business. */
export function previousClose(t: Date, clock: Clock): Date {
  if (isWithinHours(t, clock)) return t;
  const open = hm(clock.openTime), close = hm(clock.closeTime);
  if (Number.isNaN(open) || Number.isNaN(close) || !clock.days.length) return t;
  const wall = ukWall(t);
  for (let i = 0; i < 15; i++) {
    const day = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - i, 0, 0, 0));
    if (!clock.days.includes(isoDay(day))) continue;
    const candidate = new Date(day.getTime() + close * 60_000);
    if (candidate.getTime() <= wall.getTime()) return fromUkWall(candidate, t);
  }
  return t;
}

/**
 * Working minutes elapsed between two instants — walks day by day, only counting the open
 * stretch of each. Good enough at the minute level, which is all the alerting needs.
 */
export function workingMinutesBetween(from: Date, to: Date, clock: Clock): number {
  if (to <= from) return 0;
  const open = hm(clock.openTime), close = hm(clock.closeTime);
  if (Number.isNaN(open) || Number.isNaN(close)) return Math.floor((to.getTime() - from.getTime()) / 60_000);
  const a = ukWall(from), b = ukWall(to);
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() + i, 0, 0, 0));
    if (day.getTime() > b.getTime()) break;
    if (!clock.days.includes(isoDay(day))) continue;
    const dayOpen = day.getTime() + open * 60_000;
    const dayClose = day.getTime() + close * 60_000;
    const start = Math.max(dayOpen, a.getTime());
    const end = Math.min(dayClose, b.getTime());
    if (end > start) total += (end - start) / 60_000;
  }
  return Math.floor(total);
}

// ---------------------------------------------------------------------------------------------
// Deciding who is overdue — pure, so it can be tested without a database
// ---------------------------------------------------------------------------------------------

export type WaitingRow = {
  messageId: number;
  customerId: number;
  customerName: string;
  customerPhone: string;
  registration: string | null;
  body: string | null;
  hasMedia: boolean;
  receivedAt: Date;
  repliedAt: Date | null;
  handledAt: Date | null;
  escalatedAt: Date | null;
  escalationCount: number;
  /** When the "WhatsApp window closing" warning went out for this message. */
  windowWarnedAt: Date | null;
};

export type Verdict = {
  /** Still awaiting a staff reply (regardless of whether an alert is due right now). */
  waiting: boolean;
  /** An alert should go out on this run. */
  alertNow: boolean;
  /** Why it is going out: overdue on the working-hours clock, or the WhatsApp window is about to shut. */
  alertKind: "due" | "window" | null;
  /** Working minutes the customer has been waiting. */
  waitingMinutes: number;
  /** When the 24-hour WhatsApp reply window shuts (last inbound + 24h). */
  windowClosesAt: Date;
  /** Minutes left on that window; 0 once it has closed. */
  windowMinutesLeft: number;
  reason: string;
};

export function evaluate(row: WaitingRow, s: UnansweredAlertSettings, now: Date): Verdict {
  const windowClosesAt = new Date(row.receivedAt.getTime() + WHATSAPP_WINDOW_MS);
  const windowMinutesLeft = Math.max(0, Math.floor((windowClosesAt.getTime() - now.getTime()) / 60_000));
  const none = (reason: string): Verdict =>
    ({ waiting: false, alertNow: false, alertKind: null, waitingMinutes: 0, windowClosesAt, windowMinutesLeft, reason });
  if (row.repliedAt && row.repliedAt > row.receivedAt) return none("replied");
  if (row.handledAt && row.handledAt >= row.receivedAt) return none("marked handled");
  if (isAutoHandledBody(row.body, row.hasMedia)) return none("auto-handled keyword");

  const clock = { openTime: s.openTime, closeTime: s.closeTime, days: s.days };
  const waitingMinutes = workingMinutesBetween(row.receivedAt, now, clock);
  const waiting: Verdict = { waiting: true, alertNow: false, alertKind: null, waitingMinutes, windowClosesAt, windowMinutesLeft, reason: "" };

  if (!s.enabled) return { ...waiting, reason: "alerts off" };
  if (!isWithinHours(now, clock)) return { ...waiting, reason: "outside working hours" };

  // The WhatsApp window shutting is a harder deadline than the working-hours clock, so it gets
  // its own warning that ignores the grace period, the repeat timer and the ceiling. If the
  // window closes overnight or on a Sunday, the warning is placed before the last close of
  // business instead — after that there is no working moment left to answer on WhatsApp.
  if (s.windowWarnMinutes > 0 && !row.windowWarnedAt && windowMinutesLeft > 0) {
    const lastChance = previousClose(windowClosesAt, clock);
    const warnAt = lastChance.getTime() - s.windowWarnMinutes * 60_000;
    if (now.getTime() >= warnAt) {
      return { ...waiting, alertNow: true, alertKind: "window", reason: `WhatsApp window closes in ${formatWait(windowMinutesLeft)}` };
    }
  }

  if (waitingMinutes < s.afterMinutes) return { ...waiting, reason: `only ${waitingMinutes}m so far` };
  if (row.escalationCount >= s.maxAlerts) return { ...waiting, reason: `already alerted ${row.escalationCount}×` };
  if (row.escalatedAt) {
    const sinceLast = (now.getTime() - row.escalatedAt.getTime()) / 60_000;
    if (sinceLast < s.repeatMinutes) return { ...waiting, reason: `alerted ${Math.floor(sinceLast)}m ago` };
  }
  return { ...waiting, alertNow: true, alertKind: "due", reason: row.escalationCount ? `repeat #${row.escalationCount + 1}` : "first alert" };
}

/** "WhatsApp window closes in 2h 5m (17:12)" or "WhatsApp window closed — reply goes by text". */
export function windowStatus(v: Pick<Verdict, "windowClosesAt" | "windowMinutesLeft">): string {
  if (v.windowMinutesLeft <= 0) return "WhatsApp window closed — reply goes by text";
  const at = v.windowClosesAt.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  return `WhatsApp window closes in ${formatWait(v.windowMinutesLeft)} (${at})`;
}

export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 10) return `${h}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${h}h`;
}

// ---------------------------------------------------------------------------------------------
// Database side
// ---------------------------------------------------------------------------------------------

/**
 * The most recent inbound message per customer (within the lookback), with the time of any
 * staff reply that followed it. One row per customer — a thread is the unit that waits.
 */
export async function loadLatestInbound(lookbackDays: number): Promise<WaitingRow[]> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return [];
  const days = Math.max(1, Math.min(60, Math.floor(lookbackDays || 7)));
  const res: any = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (m."customerId")
             m.id, m."customerId", m."receivedAt", m."messageBody", m."mediaUrls",
             m."handledAt", m."escalatedAt", m."escalationCount", m."windowWarnedAt",
             c.name AS "customerName", c.phone AS "customerPhone"
        FROM "customerMessages" m
        JOIN customers c ON c.id = m."customerId"
       WHERE m."customerId" IS NOT NULL
         AND m."receivedAt" > now() - (${days}::int * interval '1 day')
       ORDER BY m."customerId", m."receivedAt" DESC
    )
    SELECT l.*,
           (SELECT v.registration FROM vehicles v WHERE v."customerId" = l."customerId" ORDER BY v.id DESC LIMIT 1) AS registration,
           (SELECT max(r."sentAt") FROM "reminderLogs" r
             WHERE r."sentAt" > l."receivedAt"
               AND (r."customerId" = l."customerId"
                    OR regexp_replace(regexp_replace(COALESCE(r.recipient,''), '[^0-9]', '', 'g'), '^(44|0)', '')
                     = regexp_replace(regexp_replace(COALESCE(l."customerPhone",''), '[^0-9]', '', 'g'), '^(44|0)', ''))
               AND (r."templateUsed" IN ('freeform', 'freeform-sms', 'vehicle_ready')
                    OR r."messageType" IN ('Other', 'car_ready'))) AS "repliedAt"
      FROM latest l
     ORDER BY l."receivedAt" ASC`);
  const rows: any[] = res?.rows ?? res ?? [];
  const asDate = (v: any) => (v == null ? null : new Date(v));
  return rows.map((r) => ({
    messageId: Number(r.id),
    customerId: Number(r.customerId),
    customerName: r.customerName || "Unknown",
    customerPhone: r.customerPhone || "",
    registration: r.registration || null,
    body: r.messageBody ?? null,
    hasMedia: Array.isArray(r.mediaUrls) ? r.mediaUrls.length > 0 : !!r.mediaUrls,
    receivedAt: new Date(r.receivedAt),
    repliedAt: asDate(r.repliedAt),
    handledAt: asDate(r.handledAt),
    escalatedAt: asDate(r.escalatedAt),
    escalationCount: Number(r.escalationCount || 0),
    windowWarnedAt: asDate(r.windowWarnedAt),
  }));
}

export type WaitingThread = WaitingRow & { verdict: Verdict };

/** Every thread still waiting on a reply, newest wait first. Feeds the Conversations chips. */
export async function listWaiting(now = new Date()): Promise<WaitingThread[]> {
  const s = await getUnansweredAlertSettings();
  const rows = await loadLatestInbound(s.lookbackDays);
  return rows
    .map((r) => ({ ...r, verdict: evaluate(r, s, now) }))
    .filter((r) => r.verdict.waiting)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

/** Staff dealt with this customer off-app (phoned them, saw them) — stop the clock. */
export async function markCustomerHandled(customerId: number): Promise<number> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return 0;
  const res: any = await db.execute(sql`
    UPDATE "customerMessages" SET "handledAt" = now()
     WHERE "customerId" = ${customerId} AND "handledAt" IS NULL AND "receivedAt" <= now()`);
  return Number(res?.rowCount ?? 0);
}

function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "https://mot-reminder-quick.vercel.app").replace(/\/$/, "");
}

function oneLine(t: WaitingThread): string {
  const body = (t.body || (t.hasMedia ? "[Photo]" : "")).replace(/\s+/g, " ").trim();
  const reg = t.registration ? ` (${t.registration})` : "";
  const snippet = body.length > 60 ? `${body.slice(0, 59)}…` : body;
  return `${t.customerName}${reg}: "${snippet}" — waiting ${formatWait(t.verdict.waitingMinutes)}; ${windowStatus(t.verdict)}`;
}

export type Dispatch = { push: number; sms: boolean; email: boolean; errors: string[] };

/** Send one combined alert about everything that is due. Never throws. */
export async function dispatchAlert(due: WaitingThread[], s: UnansweredAlertSettings, opts?: { test?: boolean }): Promise<Dispatch> {
  const out: Dispatch = { push: 0, sms: false, email: false, errors: [] };
  if (!due.length) return out;

  const base = appBaseUrl();
  const first = due[0];
  const link = due.length === 1 ? `${base}/conversations?customer=${first.customerId}` : `${base}/conversations`;
  const closing = due.filter((t) => t.verdict.alertKind === "window");
  const title = closing.length && due.length === 1
    ? `WhatsApp window closing: ${first.customerName}${first.registration ? ` (${first.registration})` : ""}`
    : due.length === 1
      ? `Unanswered: ${first.customerName}${first.registration ? ` (${first.registration})` : ""}`
      : closing.length
        ? `${due.length} customers waiting — ${closing.length} WhatsApp window${closing.length === 1 ? "" : "s"} closing`
        : `${due.length} customers waiting for a reply`;
  const lines = due.map(oneLine);
  const prefix = opts?.test ? "[TEST] " : "";

  // Push — lands on the lock screen of every phone that installed the app.
  try {
    const { pushToAll } = await import("./pushNotifications");
    const r = await pushToAll({
      title: prefix + title,
      body: due.length === 1
        ? `"${(first.body || "[Photo]").slice(0, 100)}" — no reply for ${formatWait(first.verdict.waitingMinutes)}. ${windowStatus(first.verdict)}`
        : lines.slice(0, 3).join("\n"),
      url: link.replace(base, ""),
      tag: "unanswered-messages",
    });
    out.push = r.sent;
  } catch (e: any) { out.errors.push(`push: ${e?.message}`); }

  // Text — the backstop that needs no app and no data connection.
  if (s.phone) {
    try {
      const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
      const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
      const { getAppSetting } = await import("../db");
      const staff: any = (await getAppSetting("staff_alerts")) || {};
      const from = (staff.fromNumber || process.env.TWILIO_SMS_NUMBER || "").trim();
      if (!accountSid || !authToken || !from) {
        out.errors.push("sms: no Twilio SMS sender configured (Email Settings ▸ Text messages ▸ Send texts from)");
      } else {
        const head = `${prefix}ELI: ${due.length === 1 ? "customer" : `${due.length} customers`} waiting for a reply.`;
        const room = 300 - head.length - link.length - 4;
        let detail = lines.join(" | ");
        if (detail.length > room) detail = `${detail.slice(0, Math.max(0, room - 1))}…`;
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: s.phone, From: from, Body: `${head} ${detail} ${link}` }),
        });
        if (res.ok) out.sms = true;
        else out.errors.push(`sms: Twilio ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
      }
    } catch (e: any) { out.errors.push(`sms: ${e?.message}`); }
  }

  // Email — the durable record, and the one that survives a phone left in the car.
  if (s.email) {
    try {
      const { sendPlainEmail } = await import("./email");
      const html = `<p>${due.length === 1 ? "A customer message has" : `${due.length} customer messages have`} had no reply${opts?.test ? " (this is a test)" : ""}:</p>
<ul>${due.map((t) => `<li><a href="${base}/conversations?customer=${t.customerId}">${escapeHtml(t.customerName)}${t.registration ? ` (${escapeHtml(t.registration)})` : ""}</a> — <em>${escapeHtml((t.body || (t.hasMedia ? "[Photo]" : "")).slice(0, 200))}</em><br><small>received ${t.receivedAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}, waiting ${formatWait(t.verdict.waitingMinutes)} of working time — <strong>${escapeHtml(windowStatus(t.verdict))}</strong></small></li>`).join("")}</ul>
<p>Reply in the app, or open the thread and press <strong>No reply needed</strong> if it has been dealt with by phone. These alerts repeat every ${s.repeatMinutes} minutes until then.</p>`;
      await sendPlainEmail({
        to: s.email,
        subject: `${prefix}${title} — ELI Motors`,
        text: `${lines.join("\n")}\n\n${link}`,
        html,
      });
      out.email = true;
    } catch (e: any) { out.errors.push(`email: ${e?.message}`); }
  }

  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Record that an alert went out for these messages. Uses the query builder's inArray — a JS
 * array interpolated into sql`` becomes a ($1, $2, …) record, which Postgres refuses to cast
 * to int[] (the first live run sent the push, then died here and would have re-alerted every
 * ten minutes).
 */
export async function stampEscalated(messageIds: number[], now = new Date(), windowWarnedIds: number[] = []): Promise<void> {
  if (!messageIds.length) return;
  const { getDb } = await import("../db");
  const { customerMessages } = await import("../../drizzle/schema");
  const { inArray, sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return;
  await db.update(customerMessages)
    .set({ escalatedAt: now, escalationCount: sql`${customerMessages.escalationCount} + 1` })
    .where(inArray(customerMessages.id, messageIds));
  if (windowWarnedIds.length) {
    await db.update(customerMessages).set({ windowWarnedAt: now }).where(inArray(customerMessages.id, windowWarnedIds));
  }
}

export type RunSummary = {
  ranAt: string;
  enabled: boolean;
  withinHours: boolean;
  waiting: Array<{ customerId: number; customerName: string; registration: string | null; waitingMinutes: number; alertNow: boolean; reason: string; windowMinutesLeft: number; windowClosesAt: string }>;
  alerted: number;
  dispatch: Dispatch | null;
  dryRun: boolean;
};

/**
 * One scheduled pass: find who is due an alert, send ONE combined notification, stamp the rows.
 * Stamps AFTER a successful send on at least one channel, so a dead SMTP/Twilio doesn't
 * silently burn the alert budget.
 */
export async function runUnansweredCheck(opts?: { dryRun?: boolean; now?: Date }): Promise<RunSummary> {
  const now = opts?.now ?? new Date();
  const s = await getUnansweredAlertSettings();
  const rows = await loadLatestInbound(s.lookbackDays);
  const evaluated = rows.map((r) => ({ ...r, verdict: evaluate(r, s, now) })).filter((r) => r.verdict.waiting);
  const due = evaluated.filter((r) => r.verdict.alertNow);

  const summary: RunSummary = {
    ranAt: now.toISOString(),
    enabled: s.enabled,
    withinHours: isWithinHours(now, s),
    waiting: evaluated.map((r) => ({
      customerId: r.customerId, customerName: r.customerName, registration: r.registration,
      waitingMinutes: r.verdict.waitingMinutes, alertNow: r.verdict.alertNow, reason: r.verdict.reason,
      windowMinutesLeft: r.verdict.windowMinutesLeft, windowClosesAt: r.verdict.windowClosesAt.toISOString(),
    })),
    alerted: 0,
    dispatch: null,
    dryRun: !!opts?.dryRun,
  };
  if (!due.length || opts?.dryRun) return summary;

  const d = await dispatchAlert(due, s);
  summary.dispatch = d;
  const delivered = d.push > 0 || d.sms || d.email;
  if (!delivered) {
    console.error(`[Unanswered] ${due.length} due but nothing delivered: ${d.errors.join("; ")}`);
    return summary;
  }

  await stampEscalated(due.map((r) => r.messageId), now, due.filter((r) => r.verdict.alertKind === "window").map((r) => r.messageId));
  summary.alerted = due.length;
  console.log(`[Unanswered] alerted about ${due.length}: ${due.map(oneLine).join(" | ")} (push ${d.push}, sms ${d.sms}, email ${d.email})`);
  return summary;
}
