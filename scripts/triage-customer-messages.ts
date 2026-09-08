/**
 * Work out, for messages already in the system, whether each one actually needs a reply.
 *
 *   npx tsx scripts/triage-customer-messages.ts          # DRY RUN — reports, writes nothing
 *   npx tsx scripts/triage-customer-messages.ts --go     # apply
 *   DAYS=365 npx tsx scripts/triage-customer-messages.ts --go
 *
 * New messages are triaged as they arrive (server/webhooks/twilio.ts). This is the catch-up for
 * everything already stored, so the unanswered-message alerts stop chasing "Thank you".
 *
 * The rules answer most of them for nothing. Anything the rules cannot place goes to the model,
 * which costs a fraction of a penny each — AI_LIMIT caps how many, and whatever is left simply
 * stays untriaged and keeps being chased, which is the safe direction to fail in.
 */
import "dotenv/config";
import { Client } from "pg";
import { triageByRule, triageMessage } from "../server/services/replyTriage";

const GO = process.argv.includes("--go");
const DAYS = Number(process.env.DAYS || 120);
const AI_LIMIT = Number(process.env.AI_LIMIT || 60);

async function main() {
  const url = process.env.DATABASE_URL_NEON || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NEON is not set");
  const db = new Client({ connectionString: url });
  await db.connect();

  const { rows } = await db.query(
    `SELECT id, "messageBody", "mediaUrls", "receivedAt"
       FROM "customerMessages"
      WHERE "replyNeeded" IS NULL
        AND "receivedAt" > now() - ($1 || ' days')::interval
      ORDER BY "receivedAt" DESC`,
    [String(DAYS)],
  );

  const counts: Record<string, number> = {};
  let needs = 0, aiUsed = 0, written = 0;

  for (const m of rows) {
    const hasMedia = Array.isArray(m.mediaUrls) ? m.mediaUrls.length > 0 : !!m.mediaUrls;
    let t = triageByRule(m.messageBody, hasMedia);
    if (!t) {
      if (aiUsed >= AI_LIMIT) continue;      // leave it untriaged: it keeps being chased
      aiUsed++;
      t = await triageMessage({ body: m.messageBody, hasMedia });
    }
    counts[t.kind] = (counts[t.kind] || 0) + 1;
    if (t.needsReply) needs++;
    if (!GO) continue;
    await db.query(
      `UPDATE "customerMessages" SET "replyNeeded" = $2, "triageKind" = $3, "triageReason" = $4 WHERE id = $1`,
      [m.id, t.needsReply ? 1 : 0, t.kind, t.reason],
    );
    written++;
  }

  console.log(`\n===== TRIAGE CUSTOMER MESSAGES ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"} =====`);
  console.log(`Untriaged messages in the last ${DAYS} days: ${rows.length}`);
  console.log(`Judged: ${Object.values(counts).reduce((a, b) => a + b, 0)} (${aiUsed} needed the model), of which ${needs} need a reply`);
  console.log(`By kind: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  if (GO) console.log(`Written: ${written}`);
  else if (rows.length) console.log(`\nDry run only — re-run with --go to write.`);
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
