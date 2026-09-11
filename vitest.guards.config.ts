import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Tests that need no database, run at the start of every `pnpm build` — so on Vercel a change that
 * breaks one of them never deploys. The tripwires in server/guards/ hold the fixes of 11/09/2026 in
 * place (see CLAUDE.md, "Protected rules"); the rest are the pure rule tests they sit on.
 *
 * No setupFiles: nothing here may touch a database. A test that needs one belongs in the main
 * vitest.config.ts, which runs against the sandbox branch only.
 */
const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/guards/**/*.test.ts",
      "server/dvlaRecord.test.ts",
      "server/firstMotReminders.test.ts",
      "server/motRefreshFor.test.ts",
      "server/ukvdSavedAnswers.test.ts",
      "server/ukvd.status.test.ts",
      "server/offRoadCarReminders.test.ts",
      "server/staleCarReminders.test.ts",
      "server/mileage.test.ts",
      "server/workshopData.test.ts",
    ],
  },
});
