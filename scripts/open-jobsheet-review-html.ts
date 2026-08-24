/**
 * The same 27 open job cards as the printed sheet, but as a single HTML file that can be
 * filled in and handed straight back.
 *
 * The point is the round trip: a paper sheet has to be re-typed before anything can act on it,
 * so this one keeps the decisions as data. Tick a decision, add a note, and "Copy for Claude"
 * puts a compact summary on the clipboard — paste it into the chat and the decisions can be
 * applied directly.
 *
 * Self-contained: the rows are baked in, so it works offline with no server and no network.
 * Answers save to localStorage as they're made, because 27 cards is more than one sitting and
 * losing the lot to a closed tab would be miserable.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "scripts", "open-job-cards-review.html");
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  const rows: any = await db.execute(sql`
    SELECT s.id, s."docNo", s.registration reg, to_char(s."dateCreated",'DD/MM/YYYY') dt,
           COALESCE(NULLIF(s."customerName",''), c.name) cust,
           COALESCE(s."custTelephone", s."custMobile", c.phone) tel,
           v.make, v.model, s.description descr,
           (now()::date - s."dateCreated"::date) age
    FROM "serviceHistory" s
    LEFT JOIN customers c ON c.id = s."customerId"
    LEFT JOIN vehicles v ON v.id = s."vehicleId"
    WHERE s."docType" = 'JS'
      AND s."dateCreated" < now() - interval '14 days'
      AND COALESCE(s."totalGross",0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM "serviceHistory" i
        WHERE i."docType" IN ('SI','XS')
          AND REPLACE(UPPER(i.registration),' ','') = REPLACE(UPPER(s.registration),' ','')
          AND i."dateCreated" >= s."dateCreated" - interval '2 days')
    ORDER BY s."dateCreated"`);

  const cards = rows.rows.map((r: any) => {
    const work = String(r.descr || "").replace(/\*\*/g, "").replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").trim();
    return `
    <article class="card" data-doc="${esc(r.docNo)}">
      <div class="top">
        <div class="ids">
          <span class="doc">${esc(r.docNo)}</span>
          <span class="reg">${esc(r.reg || "—")}</span>
          <span class="age" title="Opened ${esc(r.dt)}">${r.age} days open</span>
        </div>
        <div class="who">${esc([r.cust, r.tel].filter(Boolean).join(" · ") || "no customer on the card")}</div>
      </div>
      <p class="work">${esc(work || "(nothing written on the card)")}</p>
      ${[r.make, r.model].filter(Boolean).length ? `<p class="car">${esc([r.make, r.model].filter(Boolean).join(" "))}</p>` : ""}
      <div class="actions">
        <label class="opt delete"><input type="radio" name="d-${esc(r.docNo)}" value="delete"><span>Delete — no record needed</span></label>
        <label class="opt record"><input type="radio" name="d-${esc(r.docNo)}" value="record"><span>Issue blank — keep the visit on record</span></label>
        <label class="opt invoice"><input type="radio" name="d-${esc(r.docNo)}" value="invoice"><span>Invoice it</span></label>
        <label class="opt chase"><input type="radio" name="d-${esc(r.docNo)}" value="chase"><span>Still live / chase</span></label>
      </div>
      <input class="note" type="text" placeholder="Note (what to charge, who to ring, anything I should know)…" data-doc="${esc(r.docNo)}">
    </article>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open Job Cards — review</title>
<style>
  :root { --line:#e2e8f0; --ink:#0f172a; --dim:#64748b; --blue:#0a2342; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; color:var(--ink); background:#f8fafc; padding-bottom:96px; }
  header { background:var(--blue); color:#fff; padding:18px 20px; }
  header h1 { margin:0; font-size:19px; }
  header p { margin:4px 0 0; font-size:13px; opacity:.85; }
  main { max-width:920px; margin:16px auto; padding:0 12px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
  .card.done { border-color:#86efac; background:#f6fef9; }
  .top { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:baseline; justify-content:space-between; }
  .ids { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .doc { font-weight:700; color:var(--blue); }
  .reg { font-weight:700; background:#fde047; padding:1px 7px; border-radius:4px; letter-spacing:.5px; }
  .age { font-size:12px; color:#b45309; font-weight:600; }
  .who { font-size:13px; color:var(--dim); }
  .work { margin:8px 0 2px; font-size:14px; }
  .car { margin:0; font-size:12px; color:#94a3b8; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 8px; }
  .opt { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); border-radius:999px; padding:5px 12px; font-size:13px; cursor:pointer; background:#fff; }
  .opt:hover { background:#f1f5f9; }
  .opt input { margin:0; }
  .opt.delete:has(input:checked)  { background:#fef2f2; border-color:#f87171; font-weight:600; }
  .opt.record:has(input:checked)  { background:#f1f5f9; border-color:#94a3b8; font-weight:600; }
  .opt.invoice:has(input:checked) { background:#ecfdf5; border-color:#34d399; font-weight:600; }
  .opt.chase:has(input:checked)   { background:#fff7ed; border-color:#fb923c; font-weight:600; }
  .note { width:100%; border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; font-family:inherit; }
  .note:focus { outline:none; border-color:#818cf8; }
  footer { position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:1px solid var(--line); padding:10px 16px; display:flex; gap:10px; align-items:center; justify-content:center; flex-wrap:wrap; box-shadow:0 -2px 10px rgba(0,0,0,.06); }
  .count { font-size:14px; font-weight:600; margin-right:auto; }
  button { font:inherit; font-weight:600; border-radius:8px; padding:9px 16px; border:1px solid var(--line); background:#fff; cursor:pointer; }
  button.primary { background:var(--blue); color:#fff; border-color:var(--blue); }
  button:disabled { opacity:.45; cursor:default; }
  .hint { font-size:12px; color:var(--dim); }
  @media print { footer, .actions, .note { display:none } body { background:#fff } }
</style></head>
<body>
<header>
  <h1>Open Job Cards — review</h1>
  <p>${rows.rows.length} cards opened over a fortnight ago, never priced, and with no invoice for that car since. Tick a decision, add a note if it helps, then press <strong>Copy for Claude</strong> and paste it into the chat.</p>
  <p style="margin-top:6px;font-size:12px;opacity:.8"><strong>Delete</strong> bins the card entirely. <strong>Issue blank</strong> raises a £0 invoice instead, so the visit still shows on the customer's history — use it where you want the record even though there's nothing to charge.</p>
</header>
<main>${cards}</main>
<footer>
  <span class="count" id="count"></span>
  <span class="hint" id="saved">Answers save as you go</span>
  <button id="download">Download</button>
  <button class="primary" id="copy">Copy for Claude</button>
</footer>
<script>
  var KEY = "eli.openJobCards.v1";
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { state = {}; }

  function cardFor(doc) { return document.querySelector('.card[data-doc="' + doc + '"]'); }

  function restore() {
    Object.keys(state).forEach(function (doc) {
      var s = state[doc] || {};
      if (s.decision) {
        var r = document.querySelector('input[name="d-' + doc + '"][value="' + s.decision + '"]');
        if (r) r.checked = true;
      }
      var n = document.querySelector('.note[data-doc="' + doc + '"]');
      if (n && s.note) n.value = s.note;
      var c = cardFor(doc); if (c && s.decision) c.classList.add("done");
    });
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
    var done = Object.keys(state).filter(function (d) { return state[d] && state[d].decision; }).length;
    var total = document.querySelectorAll(".card").length;
    document.getElementById("count").textContent = done + " of " + total + " decided";
    document.getElementById("copy").disabled = done === 0;
    document.getElementById("download").disabled = done === 0;
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.type !== "radio" || t.name.indexOf("d-") !== 0) return;
    var doc = t.name.slice(2);
    state[doc] = state[doc] || {};
    state[doc].decision = t.value;
    var c = cardFor(doc); if (c) c.classList.add("done");
    save();
  });

  document.addEventListener("input", function (e) {
    if (!e.target.classList || !e.target.classList.contains("note")) return;
    var doc = e.target.getAttribute("data-doc");
    state[doc] = state[doc] || {};
    state[doc].note = e.target.value;
    save();
  });

  // A compact, pasteable summary — grouped by decision so it reads as instructions, not a dump.
  function summary() {
    var groups = { delete: [], record: [], invoice: [], chase: [] };
    document.querySelectorAll(".card").forEach(function (card) {
      var doc = card.getAttribute("data-doc");
      var s = state[doc]; if (!s || !s.decision) return;
      var reg = (card.querySelector(".reg") || {}).textContent || "";
      groups[s.decision].push(doc + " " + reg.trim() + (s.note ? "  — " + s.note : ""));
    });
    var out = ["OPEN JOB CARD DECISIONS"];
    var labels = {
      delete: "DELETE (nothing to bill, no record kept)",
      record: "ISSUE BLANK (£0 invoice, keeps the visit on record)",
      invoice: "INVOICE",
      chase: "STILL LIVE / CHASE"
    };
    ["delete", "record", "invoice", "chase"].forEach(function (k) {
      if (!groups[k].length) return;
      out.push("", labels[k] + " (" + groups[k].length + "):");
      groups[k].forEach(function (l) { out.push("  " + l); });
    });
    var undecided = [];
    document.querySelectorAll(".card").forEach(function (card) {
      var doc = card.getAttribute("data-doc");
      if (!state[doc] || !state[doc].decision) undecided.push(doc);
    });
    if (undecided.length) out.push("", "NOT YET DECIDED (" + undecided.length + "): " + undecided.join(", "));
    return out.join("\\n");
  }

  document.getElementById("copy").addEventListener("click", function () {
    var text = summary();
    function done() {
      var b = document.getElementById("copy");
      b.textContent = "Copied — paste it into the chat";
      setTimeout(function () { b.textContent = "Copy for Claude"; }, 2500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this:", text); });
    } else { window.prompt("Copy this:", text); }
  });

  document.getElementById("download").addEventListener("click", function () {
    var blob = new Blob([summary()], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "job-card-decisions.txt";
    a.click();
  });

  restore(); save();
</script>
</body></html>`;

  writeFileSync(OUT, html);
  console.log(`WROTE ${OUT}  (${rows.rows.length} job cards)`);
  process.exit(0);
}

main();
