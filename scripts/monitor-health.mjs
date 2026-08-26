// Nightly data-quality monitor for the GA4 <-> web-app sync.
//
// Emails ONE plain-English summary ONLY when something needs a human, and now includes a
// per-record DETAIL TABLE for each issue so you can find and fix each one (invoice number, reg,
// customer, amounts — and for mis-matches the web value vs the GA4 value side by side).
//
// Issues checked:
//   • the nightly sync failed              (GA4_SYNC_RC != 0)
//   • the same GA4 invoice number on >1 record
//   • a duplicate web invoice the auto-retire couldn't clear (a payment is attached)
//   • a web invoice whose GA4 number points at a DIFFERENT populated invoice (reg/total mismatch)
//   • recently-issued invoices with labour but no work description (a CSV export fills these)
//   • the paid UKVD account balance is below £20 (dry = lookups silently lose VIN/colour)
// A clean night sends nothing.
//
// All checks are READ-ONLY. Reuses the app's own SMTP config (appSettings -> smtp_settings),
// so there are no new credentials. Runs as the final step of ga4-sync/ga4-autosync.sh, which
// passes the sync exit code in GA4_SYNC_RC. Duplicate/mismatch rules mirror
// scripts/retire-superseded-web-invoices.ts (the source of truth for what counts as a duplicate).
//
//   node scripts/monitor-health.mjs             # check; email if any issue found
//   node scripts/monitor-health.mjs --dry-run   # check; PRINT the full detail, send nothing
//   MONITOR_TO=you@example.com node scripts/monitor-health.mjs   # override recipient
//   MONITOR_DESC_WINDOW_DAYS=180 node scripts/monitor-health.mjs # widen the missing-description window
import pg from "pg";
import nodemailer from "nodemailer";

const DRY = process.argv.includes("--dry-run");
const SYNC_RC = Number(process.env.GA4_SYNC_RC ?? "0");
const DESC_WINDOW_DAYS = Number(process.env.MONITOR_DESC_WINDOW_DAYS || 90);
const CAP = 50; // max rows shown per issue in the email (with an "…and N more" note)
const REG = (col) => `regexp_replace(upper(coalesce(${col},'')),'[^A-Z0-9]','','g')`; // reg normaliser
const money = (v) => (v == null ? "—" : `£${Number(v).toFixed(2)}`);
const dstr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const S = (v) => (v == null || v === "" ? "—" : String(v));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
await c.connect();

// 1. the same GA4 invoice number landed on more than one record (should always be 0)
const dupRows = (await c.query(`
  SELECT h."ga4Number" AS num, h.id, h.registration AS reg, h."totalGross" AS total, h."docNo" AS docno,
         CASE WHEN h."externalId" LIKE 'WEB-%' THEN 'web app' ELSE 'GA4' END AS source
  FROM "serviceHistory" h
  JOIN (
    SELECT "ga4Number" FROM "serviceHistory"
    WHERE "ga4Number" IS NOT NULL AND btrim("ga4Number") <> '' AND "docType"='SI'
    GROUP BY "ga4Number" HAVING count(*) > 1
  ) d ON d."ga4Number" = h."ga4Number"
  WHERE h."docType"='SI'
  ORDER BY h."ga4Number", h.id`)).rows;

// 2. web copy of a GA4 invoice that auto-retire could NOT remove (a payment is attached to it)
const dupsWithPayment = (await c.query(`
  SELECT w.id AS webid, w.registration AS reg, w."ga4Number" AS num, w."totalGross" AS total,
         w."customerName" AS customer,
         (SELECT count(*) FROM payments p WHERE p."documentId" = w.id)::int AS payments
  FROM "serviceHistory" w
  JOIN "serviceHistory" g
    ON g."docType"='SI' AND (g."externalId" NOT LIKE 'WEB-%' OR g."externalId" IS NULL)
   AND g."docNo" = w."ga4Number"
   AND ${REG("w.registration")} = ${REG("g.registration")}
   AND abs(coalesce(w."totalGross",0) - coalesce(g."totalGross",0)) < 0.02
  WHERE w."docType"='SI' AND w."externalId" LIKE 'WEB-%' AND w."ga4Number" IS NOT NULL
    AND EXISTS (SELECT 1 FROM payments p WHERE p."documentId" = w.id)
  ORDER BY w.id`)).rows;

// 3. web invoice whose GA4 number matches a POPULATED GA4 invoice but reg/total do NOT — a genuine
//    mis-stamp. Empty GA4 shells (£0 + blank reg — a reserved/written-back number not yet filled in
//    on the GA4 side) are excluded: they're mid-pipeline and resolve on their own.
const wrongMatches = (await c.query(`
  SELECT w.id AS webid, w.registration AS webreg, w."totalGross" AS webtotal, w."customerName" AS webcust,
         g."docNo" AS ga4no, g.registration AS ga4reg, g."totalGross" AS ga4total, g."customerName" AS ga4cust
  FROM "serviceHistory" w
  JOIN "serviceHistory" g
    ON g."docType"='SI' AND (g."externalId" NOT LIKE 'WEB-%' OR g."externalId" IS NULL)
   AND g."docNo" = w."ga4Number"
  WHERE w."docType"='SI' AND w."externalId" LIKE 'WEB-%' AND w."ga4Number" IS NOT NULL
    AND (coalesce(g."totalGross",0) <> 0 OR btrim(coalesce(g.registration,'')) <> '')  -- GA4 side populated
    AND ( ${REG("w.registration")} <> ${REG("g.registration")}
          OR abs(coalesce(w."totalGross",0) - coalesce(g."totalGross",0)) >= 0.02 )
  ORDER BY w.id`)).rows;

// 4. recently-issued GA4 invoices WITH labour but NO work description (a CSV export fills these).
//    Scoped to labour-bearing invoices so parts-only / MOT-only docs (often legitimately blank) don't
//    raise false alarms. The write-up itself lives in GA4 / on the linked job sheet.
const missingDesc = (await c.query(`
  SELECT "docNo" AS invoice, registration AS reg, "customerName" AS customer,
         "dateIssued" AS issued, "totalGross" AS total, "subLabourGross" AS labour,
         "origJobSheetNo" AS jobsheet
  FROM "serviceHistory"
  WHERE "docType"='SI' AND ("externalId" NOT LIKE 'WEB-%' OR "externalId" IS NULL)
    AND coalesce("subLabourGross",0) > 0
    AND (description IS NULL OR btrim(description) = '')
    AND "dateIssued" >= now() - ($1 || ' days')::interval
  ORDER BY "dateIssued" DESC`, [DESC_WINDOW_DAYS])).rows;

// 5. the paid UKVD account is running dry. Every UKVD response embeds the live account balance,
//    so read it off the most recently stored payloads — the MINIMUM of the last few, because a
//    re-saved months-old payload can carry a stale (higher) balance and mask a genuinely low one
//    (seen 24/08/2026: a June response reporting £147.90 was re-saved into an August row).
const UKVD_MIN_GBP = Number(process.env.UKVD_BALANCE_MIN_GBP || 20);
const ukvdReadings = (await c.query(`
  SELECT registration AS reg, "swsLastUpdated" AS at,
         ("comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance')::numeric AS balance
  FROM vehicles
  WHERE "comprehensiveTechnicalData"->'ukvd'->'raw'->'BillingInformation'->>'AccountBalance' IS NOT NULL
    AND "swsLastUpdated" IS NOT NULL
  ORDER BY "swsLastUpdated" DESC
  LIMIT 5`)).rows;
const ukvdLow = ukvdReadings.length ? Math.min(...ukvdReadings.map((r) => Number(r.balance))) : null;

// --- assemble issues, each with a detail table ---
const issues = [];
if (SYNC_RC !== 0)
  issues.push({
    summary: `The nightly GA4 sync FAILED tonight (exit code ${SYNC_RC}). The web-app data may be stale — check the VM is running and GA4 has backed up, then re-run the sync.`,
  });
if (dupRows.length) {
  const nums = new Set(dupRows.map((r) => r.num)).size;
  issues.push({
    summary: `${nums} GA4 invoice number(s) appear on more than one record — two copies of the same invoice; one should be removed.`,
    columns: ["GA4 no.", "Record #", "Source", "Reg", "Total"],
    rows: dupRows.map((r) => [S(r.num), S(r.id), S(r.source), S(r.reg), money(r.total)]),
  });
}
if (dupsWithPayment.length)
  issues.push({
    summary: `${dupsWithPayment.length} duplicate web invoice(s) could NOT be auto-removed because a payment is attached. Re-point each payment onto the GA4 invoice, then they clear on the next sync.`,
    columns: ["Web rec #", "Reg", "Customer", "Total", "GA4 no.", "Payments"],
    rows: dupsWithPayment.map((r) => [S(r.webid), S(r.reg), S(r.customer), money(r.total), S(r.num), S(r.payments)]),
  });
if (wrongMatches.length)
  issues.push({
    summary: `${wrongMatches.length} web invoice(s) carry a GA4 number that points at a DIFFERENT invoice (reg or total don't match) — check whether the number was mis-typed. Web value vs GA4 value shown side by side:`,
    columns: ["Web rec #", "Web reg", "Web total", "Web customer", "→ GA4 no.", "GA4 reg", "GA4 total", "GA4 customer"],
    rows: wrongMatches.map((r) => [S(r.webid), S(r.webreg), money(r.webtotal), S(r.webcust), S(r.ga4no), S(r.ga4reg), money(r.ga4total), S(r.ga4cust)]),
  });
if (missingDesc.length)
  issues.push({
    summary: `${missingDesc.length} invoice(s) issued in the last ${DESC_WINDOW_DAYS} days have labour work but no description in the web app. The write-up lives in GA4 (on the job sheet shown). Do a GA4 CSV export (File → Export), then run ./scripts/update-descriptions.sh to pull them in.`,
    columns: ["Invoice", "Reg", "Customer", "Issued", "Total", "Labour", "Job sheet"],
    rows: missingDesc.map((r) => [S(r.invoice), S(r.reg), S(r.customer), dstr(r.issued), money(r.total), money(r.labour), S(r.jobsheet)]),
  });
if (ukvdLow != null && ukvdLow < UKVD_MIN_GBP)
  issues.push({
    summary: `The UKVD vehicle-data account is down to ${money(ukvdLow)} — below the £${UKVD_MIN_GBP} warning level (a lookup costs 14p). Top it up at vehicledataglobal.com. When it ran dry in April 2026, lookups did NOT fail — they silently came back with no VIN or colour. Latest balance readings:`,
    columns: ["Date", "From lookup of", "Balance"],
    rows: ukvdReadings.map((r) => [dstr(r.at), S(r.reg), money(r.balance)]),
  });

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

if (issues.length === 0) {
  console.log(`[monitor] ${stamp} — all clear (sync rc=${SYNC_RC}, 0 issues). No email sent.`);
  await c.end();
  process.exit(0);
}

// --- renderers (aligned monospace for terminal/text email; HTML table for the email body) ---
function textTable(cols, rows) {
  if (!cols) return "";
  const shown = rows.slice(0, CAP);
  const w = cols.map((c2, i) => Math.max(c2.length, ...shown.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((v, i) => String(v).padEnd(w[i])).join("  ");
  const sep = w.map((n) => "-".repeat(n)).join("  ");
  const more = rows.length > CAP ? `\n  …and ${rows.length - CAP} more` : "";
  return "\n  " + line(cols) + "\n  " + sep + "\n" + shown.map((r) => "  " + line(r)).join("\n") + more;
}
function htmlTable(cols, rows) {
  if (!cols) return "";
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const th = cols.map((c2) => `<th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc;font-size:13px">${esc(c2)}</th>`).join("");
  const trs = rows.slice(0, CAP).map((r, i) =>
    `<tr style="background:${i % 2 ? "#f6f6f6" : "#fff"}">${r.map((v) => `<td style="padding:4px 10px;font-size:13px;white-space:nowrap">${esc(v)}</td>`).join("")}</tr>`
  ).join("");
  const more = rows.length > CAP ? `<p style="font-size:12px;color:#666;margin:4px 0">…and ${rows.length - CAP} more</p>` : "";
  return `<table style="border-collapse:collapse;margin:6px 0 14px">${`<tr>${th}</tr>`}${trs}</table>${more}`;
}

const intro = "The nightly GA4 ↔ web-app check found the following. Each item lists the exact records so you can find and fix them; nothing here changed your data automatically.";

// log to ga4-sync.log (with detail) so it's captured even if the email can't go out
console.log(`[monitor] ${stamp} — ${issues.length} issue(s) found:`);
issues.forEach((it, i) => {
  console.log(`\n  ${i + 1}. ${it.summary}`);
  if (it.columns) console.log(textTable(it.columns, it.rows));
});

const subject = `GA4 sync — ${issues.length} issue${issues.length > 1 ? "s" : ""} need${issues.length > 1 ? "" : "s"} attention (${stamp})`;
const textBody =
  `${intro}\n\n` +
  issues.map((it, i) => `${i + 1}. ${it.summary}${it.columns ? textTable(it.columns, it.rows) + "\n" : ""}`).join("\n") +
  `\n— Automated check from the GA4 sync. You only get this email when there's something to look at.`;
const htmlBody =
  `<p>${intro}</p>` +
  issues.map((it, i) => `<p style="margin:14px 0 2px"><strong>${i + 1}. ${it.summary.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</strong></p>${it.columns ? htmlTable(it.columns, it.rows) : ""}`).join("") +
  `<p style="color:#666;font-size:12px">Automated check from the GA4 sync. You only get this email when there's something to look at.</p>`;

const smtp = (await c.query(`SELECT value FROM "appSettings" WHERE "keyName"='smtp_settings'`)).rows[0]?.value || {};
const to = process.env.MONITOR_TO || smtp.copyTo || smtp.fromAddress || smtp.user;
await c.end();

if (DRY) {
  console.log(`\n----- DRY RUN: would email -----\nTo: ${to || "(no recipient configured)"}\nSubject: ${subject}\n\n${textBody}\n-------------------------------`);
  process.exit(0);
}

if (!smtp.host || !smtp.user) {
  console.log(`[monitor] SMTP is not configured (appSettings.smtp_settings) — issues logged above but NO email sent.`);
  process.exit(0);
}
if (!to || !String(to).includes("@")) {
  console.log(`[monitor] No valid recipient (set MONITOR_TO or smtp copyTo/fromAddress) — issues logged above but NO email sent.`);
  process.exit(0);
}

try {
  const port = Number(smtp.port) || 587;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: port === 465,
    requireTLS: port === 587 && (smtp.secure ?? true),
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: (Number(smtp.timeout) || 60) * 1000,
  });
  const from = smtp.fromName ? `"${smtp.fromName}" <${smtp.fromAddress || smtp.user}>` : smtp.fromAddress || smtp.user;
  const info = await transport.sendMail({ from, to, subject, text: textBody, html: htmlBody });
  console.log(`[monitor] emailed ${to} (messageId ${info.messageId}).`);
} catch (e) {
  console.log(`[monitor] WARN: email send failed (${e?.message || e}) — issues are logged above.`);
}
process.exit(0);
