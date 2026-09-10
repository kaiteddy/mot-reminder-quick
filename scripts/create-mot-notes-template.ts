/**
 * Create the vehicle_ready_mot_notes WhatsApp template in Twilio and submit it for approval.
 *
 *   npx tsx scripts/create-mot-notes-template.ts            # DRY RUN — prints exactly what would be submitted
 *   npx tsx scripts/create-mot-notes-template.ts --go       # creates it in Twilio and asks WhatsApp to approve it
 *   npx tsx scripts/create-mot-notes-template.ts --status   # approval status of the template by this name
 *
 * Why a new template rather than an edit: an approved WhatsApp template can't be changed, and the
 * approved vehicle_ready has no slot for a note — it carries only the first name and the vehicle.
 *
 * The body is built from the very functions the app sends with (generateCarReadyMessage and
 * shared/carReadyMessage.ts), so the WhatsApp message and the SMS text cannot drift apart. That
 * holds while the companyName / companyPhone app settings stay unset, as they are today — the
 * approved vehicle_ready body already bakes in the defaults.
 *
 * Once WhatsApp approves it, point the app at it by setting the app setting
 * carReadyMotTemplateSid to the HX... SID this prints. Until then, a car-ready message carrying an
 * MOT note goes as plain text, which the app already handles.
 */
import "dotenv/config";
import { generateCarReadyMessage } from "../server/smsService";
import { MOT_NOTE_MAX, insertAfterReadySentence, motNoteBlock } from "../shared/carReadyMessage";

const NAME = "vehicle_ready_mot_notes";
const LANGUAGE = "en_GB";      // as vehicle_ready
const CATEGORY = "UTILITY";    // as vehicle_ready: tied to a job the customer booked

const body = insertAfterReadySentence(
  generateCarReadyMessage({ customerName: "{{1}}", registration: "", vehicle: "{{2}}" }),
  motNoteBlock("{{3}}"),
);
// WhatsApp reviews templates against their sample values, so these read like a real send.
const variables: Record<string, string> = {
  "1": "Sam",
  "2": "FORD Focus AB12CDE",
  "3": "It passed, but both rear tyres have tread getting close to the legal limit, so they are worth replacing in the next few weeks.",
};

// What WhatsApp rejects on sight, checked before anything is sent.
const problems = [
  /^\{\{/.test(body) && "the body starts with a variable",
  /\}\}$/.test(body) && "the body ends with a variable",
  /\}\}\s*\{\{/.test(body) && "two variables side by side",
  JSON.stringify([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])) !== JSON.stringify(["1", "2", "3"]) && "variables not numbered 1, 2, 3 in order",
  variables["3"].length > MOT_NOTE_MAX && "the sample note is over the limit",
  Object.values(variables).some((v) => /[\r\n]/.test(v)) && "a sample value contains a newline",
].filter(Boolean);
if (problems.length) throw new Error(`WhatsApp would reject this template: ${problems.join("; ")}`);

const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
if (!accountSid || !authToken) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set");
const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

async function api(method: "GET" | "POST", url: string, json?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function templatesByName() {
  const found: any[] = [];
  let url: string | null = "https://content.twilio.com/v1/ContentAndApprovals?PageSize=100";
  while (url) {
    const page = await api("GET", url);
    found.push(...(page.contents || []).filter((c: any) => c.friendly_name === NAME));
    url = page.meta?.next_page_url || null;
  }
  return found;
}

const mode = process.argv.includes("--go") ? "go" : process.argv.includes("--status") ? "status" : "dry";

if (mode === "status") {
  const found = await templatesByName();
  if (!found.length) console.log(`no template named ${NAME} yet`);
  for (const c of found) {
    const a = c.approval_requests || {};
    console.log(`${c.sid}  whatsapp=${a.status || "unsubmitted"}  category=${a.category || "-"}${a.rejection_reason ? `  rejected: ${a.rejection_reason}` : ""}`);
  }
  process.exit(0);
}

console.log(`name:      ${NAME}\nlanguage:  ${LANGUAGE}\ncategory:  ${CATEGORY}\n\nbody (${body.length} characters):\n${body}\n\nsample values:`);
for (const [k, v] of Object.entries(variables)) console.log(`  {{${k}}} = ${v}`);

if (mode === "dry") {
  console.log("\nDRY RUN — nothing created. Re-run with --go to create it in Twilio and submit it to WhatsApp.");
  process.exit(0);
}

const already = await templatesByName();
if (already.length) {
  // Never create a second copy: two templates by one name is how the account got copy_motreminder.
  console.log(`\n${NAME} already exists: ${already.map((c) => c.sid).join(", ")} — nothing created. Use --status.`);
  process.exit(1);
}

const content = await api("POST", "https://content.twilio.com/v1/Content", {
  friendly_name: NAME, language: LANGUAGE, variables, types: { "twilio/text": { body } },
});
console.log(`\ncreated ${content.sid}`);
const approval = await api("POST", `https://content.twilio.com/v1/Content/${content.sid}/ApprovalRequests/whatsapp`, { name: NAME, category: CATEGORY });
console.log(`submitted to WhatsApp: status=${approval.status || "?"}`);
console.log(`\nWhen --status shows approved, set the app setting carReadyMotTemplateSid to "${content.sid}".`);
process.exit(0);
