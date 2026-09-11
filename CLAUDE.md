# ELI Motors — MOT Reminder / Garage Web App

Web rebuild of **Garage Assistant 4 (GA4, FileMaker)** for ELI Motors. Owner: adam@elimotors.co.uk.
One-way mirror of GA4 data + WhatsApp MOT reminders + job sheets/estimates + parts lookups.

## Stack
- React 19 + Vite + tRPC v11 + Express + Drizzle ORM. Deployed on **Vercel** (auto-deploys on push to `main`).
- **Package manager is `pnpm`** (v10). Do NOT use `npm install` — it crashes on the pnpm `node_modules`. Use `pnpm add <pkg>`.

## Run it locally
```bash
cd ~/mot-reminder-quick
pnpm install          # only if node_modules is missing
pnpm dev              # starts the app at http://localhost:3000
```
Requires `.env` in the project root (gitignored — already present on Adam's machine). It holds the
DB URL, Twilio, DVLA/DVSA, Autodata, postcode and AI keys. **Never commit secrets / `.env`.**

Other scripts: `pnpm build` (prod build), `pnpm check` (typecheck = `tsc --noEmit`), `pnpm test` (vitest).
Run one-off scripts with `node_modules/.bin/tsx scripts/<name>.ts`.

## Database — Neon Postgres (London)
- Live DB is **Neon Postgres**, region London (`aws-eu-west-2`), project `garagemanagerpro`. Migrated off
  the old US TiDB/MySQL on 2026-06-16 (~4× faster from the UK).
- Connection: `server/db.ts` `getDb()` prefers `DATABASE_URL_NEON`, else `DATABASE_URL`. Driver is `pg`
  (node-postgres) via `drizzle-orm/node-postgres`. Schema: `drizzle/schema.ts` (pg-core).
- The old MySQL `DATABASE_URL` is a leftover; Neon is authoritative.

## Git workflow
Active branch is **`neon-postgres`**; `main` tracks it. To ship:
```bash
git add -A && git commit -q -m "..." \
&& git push -q origin neon-postgres \
&& git push -q origin neon-postgres:main \
&& git branch -f main neon-postgres
```
Pushing to `main` triggers the Vercel deploy.

## Key integrations
- **Twilio WhatsApp** reminders. Credentials (Account SID, Auth Token, sender number) live in `.env` and the
  Twilio console — auth = Account SID + Auth Token (a 32-char token, NOT an `SK` API key). Templates need Meta
  approval. **Do not keep changing the Twilio credentials** — it breaks auth and needs a redeploy to re-test.
- **Day-of MOT reminders**: Vercel cron `0 7 * * *` → `GET /api/cron/mot-day-reminders` (`server/routes/cron.ts`).
  Live since 2026-06-18. Enable flag `MOT_DAY_REMINDERS=on` (delete the env var to pause). Inbound +
  status webhooks: `/api/webhooks/twilio` and `/api/webhooks/twilio/status`.
- **GA4 sync** (one-way GA4 → web): `scripts/sync-ga4.ts`, reads the Google Drive CSV export. NEVER write
  back to GA4.
- DVLA/DVSA vehicle lookups, Autodata deep-link (`vehicles.autodataMid`), Euro Car Parts (Omnipart) +
  PartSouq parts buttons on the job sheet, IdealPostcodes address lookup (server-side key only).
- **SWS Solutions (HaynesPro reseller)** technical data lookups: `server/sws.ts`. Credentials read from
  `SWS_API_KEY` / `SWS_AUTH_HEADER` env vars, falling back to the old hardcoded values if unset — set these
  in `.env` to rotate the key without a code change.

## Protected rules (checked before every build)
`pnpm build` first runs `vitest run --config vitest.guards.config.ts` — pure tests plus the tripwires in
`server/guards/`. A broken rule stops the build, so Vercel does not deploy it. Fix the code, not the tripwire;
change a tripwire only when Adam changes the rule. Each came from a real fault found on 11/09/2026:
- **Who can be reminded** is decided only by `shared/reminderEligibility.ts` (opted out, trade account, reminders
  switched off). The server's send checks and the MOT Reminders page's list and counts all use it. Add a new
  reason there — never as a separate check in one page or procedure (the page once listed 230 cars Send refused).
- **Refreshing a car's MOT** records DVLA's whole answer (tax, "Updated", DVLA status) through
  `server/services/motRefresh.ts` / `dvlaRecord.ts`. Never save only an MOT date; `updateVehicleMOTExpiryDate` is for
  a manually booked date (`bookMOT`) and nothing else.
- **Long checks from a page** go in small batches with visible progress: `bulkVerifyMOT` takes at most 25 plates,
  `MOTRefreshButtonLive` sends 8 at a time. Never one request for a whole list (it times out on Vercel).
- **Plate search** compares `normRegKey()` on both sides — plates are stored both "GY65 FBK" and "GY65FBK".
- **Paid UKVD lookups** only through `server/ukvd.ts`, which saves every answer so none is bought twice.
- **Data Costs panel** matches months as `to_char(...)` text in SQL, never dates parsed in Node.
- **First-MOT dates** come from DVSA (`server/services/firstMotReminders.ts`), never from `dateOfRegistration`.
- **Tests never touch the live database**: DB tests need the sandbox `TEST_DATABASE_URL`; anything in the build
  gate must need no database at all.

## House rules
- One-way mirror only — never push changes back into GA4.
- Never commit `.env` or any secret. `IDEALPOSTCODES_API_KEY` and other keys stay server-side.
- `customers.id = 8` is the "Cash Sales" walk-in account — exclude from reminders and dedup.
- Outstanding housekeeping: rotate the DB/Twilio creds that were pasted in chat; retire the old US TiDB.
