/**
 * Tripwires for the reminder problems fixed on 11/09/2026. They run at the start of every build
 * (vitest.guards.config.ts via `pnpm build`), so a change that brings one back does not deploy.
 * Each failure says what went wrong last time and where the rule lives. See CLAUDE.md,
 * "Protected rules". No database: rules and source text only.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { reminderBlocks, reminderBlockMessage, isRemindable } from "../../shared/reminderEligibility";
import { normRegKey } from "../../shared/vehicleIdentity";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") sourceFiles(rel, out); }
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Source with comments removed, so a rule mentioned in a comment doesn't count as the rule being used. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** How many times `call(` appears in real code. */
const callsIn = (source: string, call: string) => code(source).split(`${call}(`).length - 1;

/** The text of one exported function, up to the next top-level export. */
function exportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("who can be reminded: one rule, shared by the server and the MOT Reminders page", () => {
  it("names every reason a car can't be reminded", () => {
    expect(reminderBlocks({})).toEqual([]);
    expect(isRemindable({ customerOptedOut: 0, customerTrade: 0, remindersOff: 0 })).toBe(true);
    expect(reminderBlocks({ customerOptedOut: 1 })).toEqual(["opted_out"]);
    expect(reminderBlocks({ customerTrade: 1 })).toEqual(["trade"]);
    expect(reminderBlocks({ remindersOff: 1 })).toEqual(["reminders_off"]);
    expect(reminderBlocks({ customerOptedOut: true, customerTrade: 1, remindersOff: 1 })).toEqual(["opted_out", "trade", "reminders_off"]);
  });

  it("tells staff why, in the words Send has always used", () => {
    expect(reminderBlockMessage({ customerName: "Mrs Melissa" }, "trade")).toBe("Mrs Melissa is a trade account - per-vehicle reminders are switched off for them.");
    expect(reminderBlockMessage({ registration: "GY65 FBK", remindersOffReason: "No work since 2016" }, "reminders_off"))
      .toBe("Reminders are switched off for GY65 FBK — No work since 2016. Turn them back on from the vehicle page to send.");
  });

  it("is what the send checks use, so nothing the page lists is refused on send", () => {
    expect(callsIn(read("server/routers.ts"), "reminderBlocks"), "reminders.sendWhatsApp and the failed-send retry must both check shared/reminderEligibility.ts").toBeGreaterThanOrEqual(2);
  });

  it("is what the MOT Reminders page uses for its list and its counts", () => {
    const home = code(read("client/src/pages/Home.tsx"));
    const why = "On 11/09/2026 the page kept its own rule and listed 230 cars Send refused. Filter AND count with reminderBlocks().";
    expect(home, `${why} (the list)`).toMatch(/filteredAndSortedVehicles = useMemo\([\s\S]{0,300}reminderBlocks\(/);
    expect(home, `${why} (the counts)`).toMatch(/const counted = [^;]*reminderBlocks\(/);
  });

  it("keeps the follow-up list's database query to cars that can be reminded", () => {
    const fn = exportedFunction(read("server/db.ts"), "getVehiclesWithCustomersForReminders");
    expect(fn, "getVehiclesWithCustomersForReminders not found in server/db.ts").not.toBe("");
    expect(fn).toContain("remindersOff");
    expect(fn).toContain("noVehicleReminders");
  });
});

describe("refreshing a car's MOT records everything, in batches the page can show", () => {
  it("never saves an MOT date on its own outside a manually booked date", () => {
    const callers = sourceFiles("server").concat(sourceFiles("scripts"))
      .filter((f) => read(f).includes("updateVehicleMOTExpiryDate(") && !read(f).includes("export async function updateVehicleMOTExpiryDate"));
    const calls = callers.flatMap((f) => read(f).split("\n").filter((l) => l.includes("updateVehicleMOTExpiryDate(")).map((l) => `${f}: ${l.trim()}`));
    expect(calls, "Refresh Visible once saved only the MOT date, so tax, 'Updated' and DVLA's answer never moved (11/09/2026). Record the whole answer with server/services/motRefresh.ts or dvlaRecord.ts; updateVehicleMOTExpiryDate is only for bookMOT.").toHaveLength(1);
    expect(calls[0]).toContain("input.motDate");
  });

  it("caps a refresh request at 25 plates, and the page sends no more than that", () => {
    expect(read("server/routers.ts"), "bulkVerifyMOT once took every visible car in one request: nothing showed for a minute and 2,524 cars would time out.")
      .toMatch(/bulkVerifyMOT:[\s\S]{0,400}registrations: z\.array\(z\.string\(\)\)\.max\(25\)/);
    const batch = Number(read("client/src/components/MOTRefreshButtonLive.tsx").match(/const BATCH_SIZE = (\d+)/)?.[1]);
    expect(batch, "MOTRefreshButtonLive must send plates in batches of at most 25").toBeGreaterThan(0);
    expect(batch).toBeLessThanOrEqual(25);
  });
});

describe("plate search ignores spaces", () => {
  it("matches a plate typed or stored either way", () => {
    expect(normRegKey("GY65 FBK").includes(normRegKey("gy65fbk"))).toBe(true);
    expect(normRegKey("GY65FBK").includes(normRegKey("GY65 FBK"))).toBe(true);
    expect(normRegKey("GY65 FBK").includes(normRegKey("GY65"))).toBe(true);
  });

  it("is how every page compares a typed search with a registration", () => {
    const offenders = sourceFiles("client/src").flatMap((f) =>
      read(f).split("\n").map((line, i) => ({ f, i: i + 1, line }))
        .filter(({ line }) => /registration/.test(line) && /\.(toLowerCase|toUpperCase)\(\)/.test(line) && line.includes(".includes(")
          && !/normRegKey|replace\(/.test(line))
        .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`));
    expect(offenders, "Searching 'GY65 FBK' found nothing because the plate was compared as raw text (11/09/2026). Compare normRegKey() on both sides.").toEqual([]);
  });
});

describe("paid lookups and the costs panel", () => {
  it("calls UKVD only through server/ukvd.ts, which saves every answer so none is bought twice", () => {
    const direct = sourceFiles("server").concat(sourceFiles("client/src"), sourceFiles("shared"))
      .filter((f) => f !== path.join("server", "ukvd.ts") && read(f).includes("vehicledataglobal.com"));
    expect(direct, "The MOT check once bought the same 14p lookup again on every search. Go through fetchUKVDData / fetchTyreDetailsUKVD.").toEqual([]);
  });

  it("matches cost months as text, never as parsed dates", () => {
    const diagnostics = read("server/routers/diagnostics.ts");
    expect(diagnostics, "Parsing date_trunc text in Node's time zone made every row of the Data Costs panel £0.00 on UK time.").not.toContain("new Date(row.m)");
    expect(diagnostics).toContain("to_char(");
  });
});
