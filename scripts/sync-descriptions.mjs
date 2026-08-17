// Sync GA4 document work-narratives into the web app — DESCRIPTION ONLY.
//
// GA4's nightly BINARY backup (used by the automatic sync) does not contain the
// "Labour Description" write-up; only a manual GA4 CSV export does. This tool
// reads Document_Extras.csv from that export and updates serviceHistory.description
// to match. It touches nothing else, and is idempotent — safe to run after every
// export. Uses the exact same clean/normalise rules as scripts/sync-ga4.ts, so the
// two never disagree.
//
//   ./scripts/update-descriptions.sh                 # one-command (applies)
//   node scripts/sync-descriptions.mjs               # DRY RUN (reports, writes nothing)
//   node scripts/sync-descriptions.mjs --go          # apply
//   GA4_EXPORTS="/path/to/Data Exports" node scripts/sync-descriptions.mjs --go
import fs from "fs";
import path from "path";
import pg from "pg";
import { parse } from "csv-parse/sync";

const GO = process.argv.includes("--go");
const EXP = process.env.GA4_EXPORTS || "/Volumes/[C] Win11Manual.hidden/GA4 User Data/Data Exports";
const norm = (s) => String(s ?? "").trim();
const clean = (s) => (s == null ? null : String(s).replace(/\x0B/g, "\n").replace(/\r/g, "").trim()); // GA4 line separator -> \n

const file = path.join(EXP, "Document_Extras.csv");
if (!fs.existsSync(file)) {
  console.error(`Document_Extras.csv not found under GA4_EXPORTS:\n  ${EXP}\nDo a GA4 CSV export first (or set GA4_EXPORTS to the export folder).`);
  process.exit(1);
}
const rows = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true });
const map = new Map();
for (const e of rows) {
  const desc = clean([e["Labour Description"], e["docNotes"]].filter(Boolean).join("\n"))?.slice(0, 65000) || "";
  const id = norm(e["_ID"]);
  if (id && desc) map.set(id, desc);
}
console.log(`Document_Extras.csv: ${rows.length} rows read, ${map.size} carry a narrative`);
if (map.size === 0) { console.error("No narratives found — is this the right export folder?"); process.exit(1); }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_NEON || process.env.DATABASE_URL });
await c.connect();
await c.query(`DROP TABLE IF EXISTS _desc`); // pooled backends can retain a temp table from a prior run
await c.query(`CREATE TEMP TABLE _desc (external_id text, description text)`);
const entries = [...map.entries()];
for (let i = 0; i < entries.length; i += 1000) {
  const batch = entries.slice(i, i + 1000);
  const vals = [], params = [];
  batch.forEach(([id, d], j) => { vals.push(`($${j * 2 + 1},$${j * 2 + 2})`); params.push(id, d); });
  await c.query(`INSERT INTO _desc(external_id, description) VALUES ${vals.join(",")}`, params);
}
// Only GA4-origin docs (web docs keep their own text). Compare TRIMMED text — same
// as the main sync's eq() — so we only rewrite genuine content changes, not cosmetic
// leading/trailing whitespace left by an older import (which would be pure churn).
const NRM = (col) => `btrim(coalesce(${col},''), E' \\t\\n\\r\\x0B\\f')`;
const WHERE = `h."externalId"=t.external_id AND h."externalId" NOT LIKE 'WEB-%' AND ${NRM('h.description')} IS DISTINCT FROM ${NRM('t.description')}`;
const { rows: pre } = await c.query(`SELECT count(*) n FROM "serviceHistory" h JOIN _desc t ON h."externalId"=t.external_id WHERE ${WHERE}`);
const willChange = Number(pre[0].n);
if (!GO) {
  console.log(`DRY RUN: ${willChange} description(s) would be updated. Re-run with --go (or ./scripts/update-descriptions.sh) to apply.`);
  await c.end();
  process.exit(0);
}
const upd = await c.query(`UPDATE "serviceHistory" h SET description=t.description FROM _desc t WHERE ${WHERE}`);
console.log(`✓ updated ${upd.rowCount} document description(s).`);
await c.end();
