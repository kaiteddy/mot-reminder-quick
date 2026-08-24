/**
 * Warn when an MOT is being invoiced long after the test was actually carried out.
 *
 * Eight MOTs done in May, June and July were billed in one catch-up session on 12 August. Every
 * invoice was stamped 12 August, so the sales landed in the wrong month and August's MOT count
 * was eight too high. The DVSA knows when each test really happened, so ask it before issuing.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { serviceHistory, serviceLineItems } from "../../drizzle/schema";
import { getMOTHistory } from "../motApi";

/** Days apart before it is worth interrupting someone. A test is often billed a day or two later. */
const TOLERANCE_DAYS = 7;

export type MotDateCheck = {
  status: "ok" | "mismatch" | "no-test" | "not-applicable";
  message: string | null;
  testDate: string | null;       // YYYY-MM-DD of the closest DVSA test
  testResult: string | null;     // PASSED / FAILED
  daysApart: number | null;
  suggestedIssueDate: string | null;
};

export async function checkMotDate(documentId: number, issueDate?: string): Promise<MotDateCheck> {
  const none: MotDateCheck = { status: "not-applicable", message: null, testDate: null, testResult: null, daysApart: null, suggestedIssueDate: null };
  const db = await getDb();
  if (!db) return none;

  const doc = (await db.select({
    registration: serviceHistory.registration,
    dateIssued: serviceHistory.dateIssued,
  }).from(serviceHistory).where(eq(serviceHistory.id, documentId)).limit(1))[0];
  if (!doc?.registration) return none;

  // Only worth checking when an MOT is actually being charged.
  const motLine = (await db.select({ id: serviceLineItems.id })
    .from(serviceLineItems)
    .where(eq(serviceLineItems.documentId, documentId)).limit(50))
    .length > 0
    && (await db.select({ itemType: serviceLineItems.itemType })
      .from(serviceLineItems).where(eq(serviceLineItems.documentId, documentId)))
      .some((l) => l.itemType === "MOT");
  if (!motLine) return none;

  const target = issueDate && /^\d{4}-\d{2}-\d{2}$/.test(issueDate)
    ? new Date(issueDate + "T12:00:00")
    : (doc.dateIssued ? new Date(doc.dateIssued) : new Date());

  let history: any = null;
  try {
    history = await getMOTHistory(String(doc.registration));
  } catch {
    // The check is an assist, never a gate — a DVSA outage must not block issuing an invoice.
    return { ...none, status: "no-test", message: "Couldn't reach the DVSA to check the MOT date." };
  }
  const tests = (history?.motTests || [])
    .map((t: any) => ({ ...t, dt: new Date(t.completedDate) }))
    .filter((t: any) => !isNaN(t.dt.getTime()))
    .sort((a: any, b: any) => Math.abs(a.dt.getTime() - target.getTime()) - Math.abs(b.dt.getTime() - target.getTime()));

  if (!tests.length) {
    return { ...none, status: "no-test", message: "The DVSA has no MOT test recorded for this vehicle." };
  }

  const t = tests[0];
  const iso = t.dt.toISOString().slice(0, 10);
  const days = Math.round((target.getTime() - t.dt.getTime()) / 86_400_000);
  if (Math.abs(days) <= TOLERANCE_DAYS) {
    return { status: "ok", message: null, testDate: iso, testResult: t.testResult ?? null, daysApart: days, suggestedIssueDate: null };
  }
  return {
    status: "mismatch",
    message: `The DVSA records this MOT on ${iso} — ${Math.abs(days)} days ${days > 0 ? "before" : "after"} the date you're issuing. Issuing it today would put the sale in the wrong month.`,
    testDate: iso,
    testResult: t.testResult ?? null,
    daysApart: days,
    suggestedIssueDate: iso,
  };
}
