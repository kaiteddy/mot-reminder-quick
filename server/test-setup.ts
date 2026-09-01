/**
 * Vitest global guard — every test run passes through here before any suite loads.
 *
 * This project has NO dev database: the app, scripts and Vercel all share live Neon prod.
 * On 28/08/2026 a plain `vitest` run wiped the production customerMessages table (restored
 * from the Twilio log). Tests therefore run ONLY against a disposable sandbox branch:
 *
 *   - `TEST_DATABASE_URL` in .env points at a Neon branch (a copy-on-write clone of prod).
 *     Nothing else ever connects to it; everything written there stays there.
 *   - Without it, or past the branch's best-before date, tests REFUSE to run at all —
 *     they never fall back to the live DATABASE_URL.
 *   - Rotation: mint a fresh branch (Neon MCP create_branch on project wispy-lake-94196757,
 *     then get_connection_string), update TEST_DATABASE_URL and SANDBOX_BEST_BEFORE below,
 *     and delete the old branch. Takes under a minute; any Claude session can do it.
 */
import { config } from "dotenv";

config();

const SANDBOX_BEST_BEFORE = "2026-09-08"; // rotate the branch and bump this date together

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ""; } };

const testUrl = process.env.TEST_DATABASE_URL || "";
// getDb PREFERS DATABASE_URL_NEON and falls back to DATABASE_URL — the guard must override
// BOTH, and must treat either as "the live database" when comparing hosts. (The first version
// of this file overrode only DATABASE_URL; a test run sailed straight past it into prod.)
const liveUrls = [process.env.DATABASE_URL_NEON, process.env.DATABASE_URL].filter(Boolean) as string[];

if (!testUrl) {
  throw new Error(
    "Tests refused: TEST_DATABASE_URL is not set, and tests never run against the live database. " +
    "Add the sandbox connection string to .env (see server/test-setup.ts for how to mint one).",
  );
}

for (const liveUrl of liveUrls) {
  if (testUrl === liveUrl || (hostOf(testUrl) && hostOf(testUrl) === hostOf(liveUrl))) {
    throw new Error(
      "Tests refused: TEST_DATABASE_URL points at the LIVE database host. " +
      "It must be a disposable Neon branch, never the production endpoint.",
    );
  }
}

if (new Date() > new Date(`${SANDBOX_BEST_BEFORE}T23:59:59Z`)) {
  throw new Error(
    `Tests refused: the sandbox branch expired ${SANDBOX_BEST_BEFORE}. ` +
    "Mint a fresh Neon branch, update TEST_DATABASE_URL and SANDBOX_BEST_BEFORE, delete the old branch.",
  );
}

// From here on, everything the tests touch is the sandbox — override every URL getDb consults.
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_NEON = testUrl;
process.env.VITEST_DB_IS_DISPOSABLE = "1";
