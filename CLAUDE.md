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

## House rules
- One-way mirror only — never push changes back into GA4.
- Never commit `.env` or any secret. `IDEALPOSTCODES_API_KEY` and other keys stay server-side.
- `customers.id = 8` is the "Cash Sales" walk-in account — exclude from reminders and dedup.
- Outstanding housekeeping: rotate the DB/Twilio creds that were pasted in chat; retire the old US TiDB.
