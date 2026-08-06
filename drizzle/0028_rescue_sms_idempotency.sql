-- Idempotency for the WhatsApp -> SMS rescue.
-- Additive only; applied manually to Neon.
--
-- Twilio fires a status callback for several transitions and retries them, so the same failed
-- message is reported more than once — the first live rescues sent 4 of 5 texts twice, one of
-- them delivered twice to the customer. A check-then-send can't fix that: the callbacks arrive
-- about a second apart and both pass the check before either writes.
--
-- This makes the claim atomic. The rescue log row carries templateUsed = 'rescue-sms:<original
-- message sid>', and the second callback's INSERT simply loses to the unique index.

CREATE UNIQUE INDEX IF NOT EXISTS "reminder_logs_rescue_marker_uniq"
  ON "reminderLogs" ("templateUsed")
  WHERE "templateUsed" LIKE 'rescue-sms:%';
