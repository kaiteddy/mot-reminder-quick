import fs from "fs";
import crypto from "crypto";
import { Pool } from "pg";

const GO = process.argv.includes("--go");
const FROM = "2026-06-27"; // strictly after DB card coverage (through 26 Jun); excludes already-present rows
const files = [2,3,4,5,6,7].map(n => `/Users/service/Downloads/Barclaycard_Business (UK)-${n}.csv`);

function splitCsv(l){const o=[];let c="",q=false;for(let i=0;i<l.length;i++){const x=l[i];if(q){if(x==='"'){if(l[i+1]==='"'){c+='"';i++;}else q=false;}else c+=x;}else{if(x==='"')q=true;else if(x===","){o.push(c);c="";}else c+=x;}}o.push(c);return o;}
const money=s=>{const v=parseFloat((s||"").replace(/[£,\s]/g,""));return isNaN(v)?0:v;};
const norm=s=>(s||"").replace(/\s+/g," ").trim().toUpperCase();
const sha=(...p)=>crypto.createHash("sha1").update(p.join("|")).digest("hex");

const seen=new Set(); const rows=[];
for(const f of files) for(const line of fs.readFileSync(f,"utf8").split(/\r?\n/).slice(1)){
  if(!line.trim())continue; const p=splitCsv(line); if(p.length<7)continue;
  const dm=p[0].trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(!dm)continue;
  const iso=`${dm[3]}-${dm[2]}-${dm[1]}`; if(iso<FROM)continue;
  const desc=p[1].trim();
  if(norm(desc).startsWith("THANK YOU"))continue; // monthly settlement = contra (booked on the bank side)
  const amount=money(p[6])>0?money(p[6]):-money(p[5]);
  const k=`${iso}|${amount.toFixed(2)}|${norm(desc)}`; if(seen.has(k))continue; seen.add(k);
  rows.push({iso,desc,hint:p[3].trim(),amount});
}

const env={};for(const l of fs.readFileSync(new URL("../.env",import.meta.url),"utf8").split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"");}
const pool=new Pool({connectionString:env.DATABASE_URL_NEON||env.DATABASE_URL,max:2,ssl:{rejectUnauthorized:true}});

const ex=(await pool.query(`
  SELECT DISTINCT ON (t."counterpartyKey") t."counterpartyKey" key, t."counterparty" cp, l."category" label
  FROM "bankTransactions" t
  LEFT JOIN "transactionLabels" l ON l."source"='card' AND l."counterpartyKey"=t."counterpartyKey"
  WHERE t."source"='card' AND t."counterpartyKey" IS NOT NULL AND t."counterpartyKey"<>''
  ORDER BY t."counterpartyKey", (l."category" IS NOT NULL) DESC`)).rows;
const labelMap=Object.fromEntries((await pool.query(`SELECT "counterpartyKey" k,"category" c FROM "transactionLabels" WHERE "source"='card'`)).rows.map(r=>[r.k,r.c]));

// per-row category overrides for brand-new AI tools / merchants with no recurring card key
const OVERRIDE=[
  ["XERO",        "Software & IT"],
  ["WWW ARTLIST", "Software & IT"],
  ["HIGGSFIELD",  "KaisarK Innovations (inter-co)"],
  ["MESHY",       "KaisarK Innovations (inter-co)"],
  ["KLINGAI",     "KaisarK Innovations (inter-co)"],
  ["X CORP",      "KaisarK Innovations (inter-co)"],
  ["AMAZON",      "Cost of sales — parts & consumables"],
  ["EBAY",        "Cost of sales — parts & consumables"],
  ["SHELL",       "Fuel"],
];
const overrideFor=d=>{const n=norm(d);for(const[p,c]of OVERRIDE)if(n.startsWith(p))return c;return null;};

// leading-word matcher: match on run>=2, or when the existing key is fully consumed by the desc's leading words
function match(desc){
  const dw=norm(desc).split(" ");
  let best=null,bestLen=0,ambiguous=false;
  for(const e of ex){
    const ew=norm(e.cp).split(" ");
    let n=0; while(n<dw.length && n<ew.length && dw[n]===ew[n]) n++;
    if(n>=2 || (n>=1 && n===ew.length)){
      if(n>bestLen){best=e;bestLen=n;ambiguous=false;}
      else if(n===bestLen && best && e.key!==best.key && (e.label||null)!==(best.label||null)) ambiguous=true;
    }
  }
  return ambiguous?null:(best?{...best,runLen:bestLen}:null);
}

const batch="import-newfmt-card-2026-07";
let inserted=0; const report=[];
for(const r of rows){
  const ovr=overrideFor(r.desc);
  const m=match(r.desc);
  const counterpartyKey=(m?m.key:norm(r.desc).split(" ").slice(0,3).join(" ")).slice(0,200);
  const counterparty=(m?m.cp:r.desc).slice(0,255);
  const resolved=ovr||labelMap[counterpartyKey]||(m&&m.label)||"**OTHER**";
  const direction=r.amount>0?"IN":"OUT";
  const dedupeKey=sha("card",r.iso,r.amount.toFixed(2),norm(r.desc).slice(0,80));
  report.push({date:r.iso,amt:r.amount.toFixed(2),desc:r.desc.slice(0,30),key:counterpartyKey.slice(0,22),label:(ovr?"[ovr] ":"")+resolved});
  if(GO){
    const res=await pool.query(`
      INSERT INTO "bankTransactions" ("source","txnDate","amount","direction","counterparty","counterpartyKey","memo","cardHolder","bankCategoryHint","subcategory","categoryOverride","dedupeKey","importBatch")
      VALUES ('card',$1,$2,$3,$4,$5,$6,'Adam Rutstein','','',$7,$8,$9)
      ON CONFLICT ("dedupeKey") DO NOTHING RETURNING id`,
      [new Date(r.iso+"T00:00:00"),r.amount.toFixed(2),direction,counterparty,counterpartyKey,r.desc,ovr||null,dedupeKey,batch]);
    if(res.rows.length) inserted++;
  }
}
console.log(`${GO?"IMPORT":"DRY RUN"} — ${rows.length} new card rows (>= ${FROM}, settlement excluded)\n`);
console.log("date        amount     description                     → key                     category");
for(const r of report) console.log(`${r.date}  ${r.amt.padStart(9)}  ${r.desc.padEnd(30)}  ${r.key.padEnd(22)}  ${r.label}`);
const others=report.filter(r=>r.label==="**OTHER**");
console.log(`\nmatched/overridden→category: ${report.length-others.length}/${report.length}   OTHER: ${others.length}`);
if(GO) console.log(`\nINSERTED: ${inserted}  (skipped dup: ${rows.length-inserted})`);
await pool.end();
