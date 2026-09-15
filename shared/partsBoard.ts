/**
 * How the Parts Orders board reads an order: whether it has finished, whether it needs chasing, whether
 * its status has gone stale, and how to say when it was ordered. Pure, so the server (which flags orders
 * to chase for the board and the vehicle page) and the board itself read an order the same way.
 *
 * Why these rules exist (live data, 15/09/2026):
 *   - GSF reports "Cancelled", and the board chased those as undelivered: 4 of its "6 need chasing" were
 *     cancelled orders, and the other 2 were "Pending" orders from 29 Jun and 4 Sep.
 *   - eBay orders come from the order emails and the delivery email is rarely captured, so 245 of 246
 *     never reach "Delivered" — orders from March 2025 still said "Out for delivery". A status nothing
 *     has updated for weeks is shown as exactly that, not as a live delivery.
 *   - "Out for delivery" contains "deliver", so every `.includes("deliver")` check counted it as delivered.
 */

const DAY = 86_400_000;

/** Chase an order only while it is this new: older than a week, a chase flag is noise, not news. */
export const CHASE_WITHIN_DAYS = 7;
/** A status not updated for this long is stale. */
export const STALE_AFTER_DAYS = 14;
/** The board opens on this many days; anything older sits behind "Show older". */
export const RECENT_DAYS = 30;

export type OrderStage = "ordered" | "on_the_way" | "delivered" | "cancelled";

type Dated = { status?: string | null; orderDate?: string | Date | null };

/** Delivered — and only delivered: "Out for delivery" is still on its way. */
export function isDelivered(status?: string | null): boolean {
  return /\bdelivered\b/i.test(String(status || ""));
}

export function isCancelled(status?: string | null): boolean {
  return /cancel/i.test(String(status || ""));
}

/** A status that will not change again. */
export function isFinalStatus(status?: string | null): boolean {
  return isDelivered(status) || isCancelled(status) || /\b(collected|refunded|returned)\b/i.test(String(status || ""));
}

/** Where an order has got to, in the four steps the board shows. */
export function orderStage(status?: string | null): OrderStage {
  const s = String(status || "").toLowerCase();
  if (isCancelled(s)) return "cancelled";
  if (isDelivered(s) || /\bcollected\b/.test(s)) return "delivered";
  if (/dispatch|transit|out for|ready|shipped|posted|with courier/.test(s)) return "on_the_way";
  return "ordered";   // confirmed, pending, preparing, picking & packing, processing — or no status yet
}

export function daysSince(date?: string | Date | null, now = new Date()): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? null : Math.max(0, (now.getTime() - t) / DAY);
}

/**
 * Worth chasing: not finished, not arrived by 18:00 on the day it was ordered, and ordered within the
 * last week. A cancelled order is finished; a months-old "Pending" is shown as stale instead.
 */
export function needsChasing(o: Dated, now = new Date()): boolean {
  if (!o.orderDate || isFinalStatus(o.status)) return false;
  const od = new Date(o.orderDate);
  if (Number.isNaN(od.getTime())) return false;
  const endOfOrderDay = new Date(od.getFullYear(), od.getMonth(), od.getDate(), 18).getTime();
  return now.getTime() > endOfOrderDay && (daysSince(od, now) ?? 0) <= CHASE_WITHIN_DAYS;
}

/** Not finished, yet nothing newer than a fortnight ago: the supplier's last word is out of date. */
export function statusIsStale(o: Dated, now = new Date()): boolean {
  if (isFinalStatus(o.status)) return false;
  const age = daysSince(o.orderDate, now);
  return age != null && age > STALE_AFTER_DAYS;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar days between the order and today (0 = today). */
function calendarDaysAgo(d: Date, now: Date): number {
  return Math.round((dayStart(now) - dayStart(d)) / DAY);
}

/** "Today 11:58", "Yesterday 16:02", "Thu 11 Sep", "26 Jun", "24 Mar 2025". A date with no time shows none. */
export function orderedLabel(date?: string | Date | null, now = new Date()): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  const ago = calendarDaysAgo(d, now);
  const time = d.getHours() || d.getMinutes() ? ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
  if (ago <= 0) return `Today${time}`;
  if (ago === 1) return `Yesterday${time}`;
  if (ago < 7) return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear()
    ? `${d.getDate()} ${MONTH[d.getMonth()]}`
    : `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`;
}

export const BUCKETS = ["Today", "Yesterday", "Earlier this week", "Last week", "Earlier this month", "Older"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Which heading an order sits under. "Older" is past RECENT_DAYS, and the board keeps it folded away. */
export function bucketOf(date?: string | Date | null, now = new Date()): Bucket {
  if (!date) return "Older";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "Older";
  const ago = calendarDaysAgo(d, now);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago <= 6) return "Earlier this week";
  if (ago <= 13) return "Last week";
  if (ago <= RECENT_DAYS) return "Earlier this month";
  return "Older";
}
