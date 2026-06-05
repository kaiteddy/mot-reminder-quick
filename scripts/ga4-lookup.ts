/**
 * GA4 backup LOOKUP — read-only, instant "is this in GA4 right now?" check.
 *
 *   npx tsx scripts/ga4-lookup.ts "GD73 KUC"        # search a reg
 *   npx tsx scripts/ga4-lookup.ts "Tessler"         # search a surname
 *   npx tsx scripts/ga4-lookup.ts "07949302522"     # search a phone
 *   npx tsx scripts/ga4-lookup.ts "NW4" --raw       # show every raw field
 *   npx tsx scripts/ga4-lookup.ts "GD73 KUC" --backup="/path/to/Backup-x.GA4"
 *
 * Reads the LATEST GA4 backup (a zip containing GA4_UserData.fmp12), XOR-decodes the
 * obfuscated text (0x5A) and pulls out the matching records. It NEVER writes anything —
 * not to GA4, not to the web DB. Pure read. A fresh backup is seconds old, so this is the
 * fast way to answer "did a customer/vehicle just get entered in GA4?" without a CSV export.
 *
 * How it works: GA4's .fmp12 stores each field as a chunk `06 <field-id> <len> <value>`,
 * with the value bytes XOR'd by 0x5A. The framing is intact, so we can extract exact field
 * values reliably (verified against known records).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const args = process.argv.slice(2);
const RAW = args.includes("--raw");
const backupArg = args.find((a) => a.startsWith("--backup="))?.slice(9);
const term = args.filter((a) => !a.startsWith("--")).join(" ").trim();

if (!term) {
  console.error('Usage: npx tsx scripts/ga4-lookup.ts "<reg | name | phone | postcode>" [--raw] [--backup=PATH]');
  process.exit(1);
}

const BACKUP_DIR = path.join(os.homedir(), "Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/GA4 Backups");
const CACHE_DIR = path.join(os.tmpdir(), "ga4-lookup-cache");

// ---- locate the newest backup ----
function latestBackup(): string {
  if (backupArg) return backupArg;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.toLowerCase().endsWith(".ga4"));
  if (!files.length) { console.error(`No .GA4 backups in ${BACKUP_DIR}`); process.exit(1); }
  const newest = files
    .map((f) => ({ f, m: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
  return path.join(BACKUP_DIR, newest.f);
}

// ---- extract the fmp12 (cached by backup size so we only unzip once) ----
function extractFmp(backup: string): string {
  const sz = fs.statSync(backup).size;
  const out = path.join(CACHE_DIR, `${path.basename(backup)}.${sz}.fmp12`);
  if (fs.existsSync(out) && fs.statSync(out).size > 1_000_000) return out;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // member is GA4_UserData.fmp12; stream it out of the zip
  const buf = execFileSync("unzip", ["-p", backup, "GA4_UserData.fmp12"], { maxBuffer: 1 << 30 });
  fs.writeFileSync(out, buf);
  return out;
}

// ---- XOR helpers ----
const decode = (b: Buffer): string => {
  const o = Buffer.allocUnsafe(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b[i] ^ 0x5a;
  return o.toString("latin1");
};
const encode = (s: string): Buffer => {
  const b = Buffer.from(s, "latin1");
  for (let i = 0; i < b.length; i++) b[i] ^= 0x5a;
  return b;
};

// ---- find all occurrences of an (already XOR-encoded) needle ----
function findAll(hay: Buffer, needle: Buffer): number[] {
  const out: number[] = [];
  let i = hay.indexOf(needle, 0);
  while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + 1); }
  return out;
}

// ---- parse the `06 <fid> <len> <value>` chunks in a window around a hit ----
type Field = { fid: number; val: string };
function parseWindow(buf: Buffer, center: number): Field[] {
  const start = Math.max(0, center - 300);
  const end = Math.min(buf.length, center + 680);
  const out: Field[] = [];
  let p = start;
  while (p < end - 3) {
    if (buf[p] === 0x06) {
      const fid = buf[p + 1];
      const len = buf[p + 2];
      if (len > 0 && len < 200 && p + 3 + len <= end) {
        const raw = buf.subarray(p + 3, p + 3 + len);
        const val = decode(raw);
        // keep printable text only (drops binary index/id chunks)
        if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(val) && !/^Z+/.test(val)) {
          out.push({ fid, val: val.replace(/\x0b/g, " ").trim() });
          p += 3 + len;
          continue;
        }
      }
    }
    p++;
  }
  return out;
}

// ---- turn a field list into a friendly record ----
const RE = {
  reg: /^[A-Z]{2}\d{2}[A-Z]{3}$|^[A-Z]\d{1,3}[A-Z]{3}$|^[A-Z]{3}\d{1,3}[A-Z]?$/,
  date: /^\d{2}\/\d{2}\/\d{4}/,
  vin: /^[A-HJ-NPR-Z0-9]{11,17}$/,
  name: /^(Mr|Mrs|Miss|Ms|Dr|Sir|Lady|Messrs)\.?\s+[A-Za-z]/i,
  hex32: /^[0-9A-F]{32}$/,
  colour: /^[A-Za-z][A-Za-z /-]{1,18}$/,
};
const MAKES = /^(Audi|BMW|Ford|Vauxhall|Toyota|Honda|Hyundai|Kia|Nissan|Mercedes|Mercedes-Benz|Volkswagen|VW|Volvo|Peugeot|Renault|Citroen|Citroën|Mazda|Mitsubishi|Lexus|Land Rover|Range Rover|Jaguar|Mini|Fiat|Seat|Skoda|Suzuki|Subaru|Porsche|Tesla|Jeep|Dacia|Chevrolet|Chrysler|Smart|Alfa Romeo|Bentley|Maserati|DS|Abarth|Aston Martin|Ferrari|Lamborghini|Rolls-Royce)$/i;

const normReg = (r: string) => {
  const m = r.toUpperCase().replace(/\s+/g, "");
  return m.length === 7 ? `${m.slice(0, 4)} ${m.slice(4)}` : m;
};
const isPhone = (v: string) => /^[\d ]+$/.test(v) && v.replace(/\D/g, "").length >= 7 && (/^0/.test(v) || v.includes(" "));

function classify(fields: Field[]): { kind: string; lines: [string, string][]; title: string; key: string } | null {
  const vals = Array.from(new Set(fields.map((f) => f.val).filter((v) => v && !RE.hex32.test(v))));
  const pick = (test: (v: string) => boolean) => vals.filter(test);

  const regs = pick((v) => RE.reg.test(v.toUpperCase().replace(/\s/g, "")) && v.replace(/\s/g, "").length <= 7);
  const dates = pick((v) => RE.date.test(v));
  const vins = pick((v) => RE.vin.test(v) && /[A-Z]/.test(v) && /\d/.test(v));
  const names = pick((v) => RE.name.test(v) && v.length < 50 && !/Tel|Mob/i.test(v)).sort((a, b) => b.length - a.length);
  const makes = pick((v) => MAKES.test(v));
  const addrs = pick((v) => v.includes(",") && v.length > 18).sort((a, b) => b.length - a.length);
  const phones = pick(isPhone);
  const looksVehicle = makes.length > 0 || vins.length > 0 || fields.some((f) => [3, 4, 19, 20].includes(f.fid));

  const lines: [string, string][] = [];
  const add = (k: string, v?: string | null) => { if (v) lines.push([k, v]); };

  if (looksVehicle && regs.length) {
    const make = fields.find((f) => f.fid === 3 && RE.colour.test(f.val))?.val || makes[0];
    const model = fields.find((f) => f.fid === 4 && /[A-Za-z]/.test(f.val))?.val;
    const colour = fields.find((f) => f.fid === 19 && RE.colour.test(f.val))?.val;
    const fuel = fields.find((f) => f.fid === 20 && RE.colour.test(f.val))?.val;
    const cc = pick((v) => /^\d{3,4}$/.test(v) && +v >= 600 && +v <= 6500)[0];
    const reg = normReg(regs[0]);
    add("Registration", reg);
    add("Make / Model", [make, model].filter(Boolean).join(" ") || null);
    add("VIN", vins.find((v) => v.length >= 11));
    add("Colour", colour);
    add("Fuel", fuel);
    add("Engine CC", cc);
    add("Date reg.", dates.find((d) => /\b(19|20)\d\d\b/.test(d) && !/:/.test(d)));
    if (lines.length < 2) return null; // reg only = index stub, skip
    return { kind: "Vehicle", key: `V:${reg}`, title: `${reg}  ${[make, model].filter(Boolean).join(" ")}`.trim(), lines };
  }

  // customer-ish — need a name, address or real phone to be worth showing
  const name = names[0];
  const addr = addrs[0];
  if (!name && !addr && !phones.length) return null;
  add("Name", name);
  add("Address", addr);
  if (phones.length) add("Phone", Array.from(new Set(phones)).join("  /  "));
  add("Customer since", dates.find((d) => /:/.test(d)) || dates[0]);
  return { kind: "Customer", key: `C:${(name || "").toLowerCase()}|${(addr || "").slice(0, 24).toLowerCase()}`, title: name || addr || phones[0] || "(record)", lines };
}

// ---- main ----
const backup = latestBackup();
const stat = fs.statSync(backup);
console.log(`\n🔎  GA4 lookup: "${term}"`);
console.log(`📦  backup: ${path.basename(backup)}  (${(stat.size / 1e6).toFixed(0)} MB, ${stat.mtime.toLocaleString("en-GB")})\n`);

const fmp = extractFmp(backup);
const buf = fs.readFileSync(fmp);

// build search variants: as typed, uppercased, reg with/without space
const variants = new Set<string>([term, term.toUpperCase()]);
if (/^[a-z0-9]{2,4}\s?[a-z0-9]{3}$/i.test(term)) {
  variants.add(term.toUpperCase().replace(/\s+/g, ""));
  const m = term.toUpperCase().replace(/\s+/g, "");
  if (m.length === 7) variants.add(`${m.slice(0, 4)} ${m.slice(4)}`); // GD73KUC -> GD73 KUC
}

// collect hits across variants, then cluster nearby hits into single records
const hits: number[] = [];
for (const v of variants) for (const h of findAll(buf, encode(v))) hits.push(h);
hits.sort((a, b) => a - b);

if (!hits.length) {
  console.log("No match in the latest backup.\n");
  process.exit(0);
}

const clusters: number[] = [];
for (const h of hits) if (!clusters.length || h - clusters[clusters.length - 1] > 700) clusters.push(h);

// parse every cluster, keep the RICHEST record per dedup key
type Rec = NonNullable<ReturnType<typeof classify>> & { fields: Field[] };
const byKey = new Map<string, Rec>();
for (const c of clusters) {
  const fields = parseWindow(buf, c);
  if (!fields.length) continue;
  const rec = classify(fields);
  if (!rec) continue;
  const prev = byKey.get(rec.key);
  if (!prev || rec.lines.length > prev.lines.length) byKey.set(rec.key, { ...rec, fields });
}

let recs = Array.from(byKey.values());
// drop fragments whose every shown value already appears in a richer record of the same kind
recs = recs.filter((a) => {
  const av = a.lines.map((l) => l[1]);
  return !recs.some((b) => b !== a && b.kind === a.kind && b.lines.length > a.lines.length &&
    av.every((v) => b.lines.some((l) => l[1].includes(v) || v.includes(l[1]))));
});
const vehicles = recs.filter((r) => r.kind === "Vehicle");
const customers = recs.filter((r) => r.kind === "Customer");

function show(group: Rec[], heading: string) {
  if (!group.length) return;
  console.log(`${heading} (${group.length})`);
  for (const rec of group.slice(0, 12)) {
    console.log(`── ${rec.title} ${"─".repeat(Math.max(2, 50 - rec.title.length))}`);
    for (const [k, v] of rec.lines) console.log(`   ${k.padEnd(16)} ${v}`);
    if (RAW) for (const f of rec.fields) if (f.val.length > 1 && !RE.hex32.test(f.val)) console.log(`   · [${String(f.fid).padStart(3)}] ${f.val}`);
    console.log();
  }
  if (group.length > 12) console.log(`   …and ${group.length - 12} more.\n`);
}

if (!recs.length) {
  console.log("Match bytes found, but no readable customer/vehicle record nearby.\n");
} else {
  show(customers, "👤 CUSTOMERS");
  show(vehicles, "🚗 VEHICLES");
  console.log(`${recs.length} record${recs.length === 1 ? "" : "s"} in the live backup (${path.basename(backup)}).\n`);
}
process.exit(0);
