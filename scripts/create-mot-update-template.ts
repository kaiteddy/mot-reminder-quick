/**
 * Create the MOT update WhatsApp template in Twilio and submit it for approval.
 *
 *   npx tsx scripts/create-mot-update-template.ts            # DRY RUN — prints exactly what would be submitted
 *   npx tsx scripts/create-mot-update-template.ts --go       # creates it in Twilio and asks WhatsApp to approve it
 *   npx tsx scripts/create-mot-update-template.ts --status   # approval status of the template by this name
 *
 * The MOT update is what a job sheet sends when the car's MOT needs the customer to decide what
 * happens next — usually a fail. It can't go through the car-ready templates: those tell the
 * customer the car is ready to collect, which is exactly what a failed car isn't.
 *
 * The body is built from the very functions the app sends with (generateMotUpdateMessage and
 * shared/carReadyMessage.ts), so the WhatsApp message and the SMS text cannot drift apart. That
 * holds while the companyName / companyPhone app settings stay unset, as they are today.
 *
 * Like car_ready_mot_notes_call it carries a "Call us" button. Once WhatsApp approves it, point the
 * app at it by setting the app setting motUpdateTemplateSid to the HX... SID this prints. Until
 * then an MOT update goes as plain text, which the app already handles.
 */
import "dotenv/config";
import { generateMotUpdateMessage } from "../server/smsService";
import { MOT_NOTE_MAX, insertAfterLeadSentence, motNoteBlock } from "../shared/carReadyMessage";

const NAME = "mot_update_call";
const LANGUAGE = "en_GB";      // as the car-ready templates
const CATEGORY = "UTILITY";    // as the car-ready templates: about a job the customer booked
// The same button as the approved car_ready_mot_notes_call.
const CALL_US = { type: "PHONE_NUMBER", title: "Call us", phone: "+442082036449" };

const body = insertAfterLeadSentence(
  generateMotUpdateMessage({ customerName: "{{1}}", registration: "", vehicle: "{{2}}" }),
  motNoteBlock("{{3}}", "mot_update"),
  "mot_update",
);
// WhatsApp reviews templates against their sample values, so these read like a real send.
const variables: Record<string, string> = {
  "1": "Sam",
  "2": "FORD Focus AB12CDE",
  "3": "It failed because the front left tyre tread is below the legal limit, so it has to be replaced for the car to pass. The rear brake pads are getting thin, so they are worth replacing in the next few months.",
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

function twilioAuth(): string {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!accountSid || !authToken) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set");
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function api(method: "GET" | "POST", url: string, json?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: twilioAuth(), ...(json ? { "Content-Type": "application/json" } : {}) },
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

console.log(`name:      ${NAME}\nlanguage:  ${LANGUAGE}\ncategory:  ${CATEGORY}\nbutton:    ${CALL_US.title} (${CALL_US.phone})\n\nbody (${body.length} characters):\n${body}\n\nsample values:`);
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
  friendly_name: NAME, language: LANGUAGE, variables, types: { "twilio/call-to-action": { body, actions: [CALL_US] } },
});
console.log(`\ncreated ${content.sid}`);
const approval = await api("POST", `https://content.twilio.com/v1/Content/${content.sid}/ApprovalRequests/whatsapp`, { name: NAME, category: CATEGORY });
console.log(`submitted to WhatsApp: status=${approval.status || "?"}`);
console.log(`\nWhen --status shows approved, set the app setting motUpdateTemplateSid to "${content.sid}".`);
process.exit(0);
