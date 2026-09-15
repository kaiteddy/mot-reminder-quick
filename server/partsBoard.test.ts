/**
 * The Parts Orders board's reading of an order. Every case here is a status the live board actually
 * carries (15/09/2026): GSF Delivered / Pending / Cancelled, eBay Confirmed / In transit / Out for
 * delivery / Delivered, and ECP's "Preparing your order" family. Dates are built in local time, so the
 * results don't depend on the machine's time zone.
 */
import { describe, it, expect } from "vitest";
import {
  bucketOf, isDelivered, isFinalStatus, needsChasing, orderStage, orderedLabel, statusIsStale,
} from "../shared/partsBoard";

const now = new Date(2026, 8, 15, 14, 0);          // Tue 15 Sep 2026, 14:00
const at = (m: number, d: number, h = 10, min = 0, y = 2026) => new Date(y, m - 1, d, h, min);

describe("isDelivered", () => {
  it("never mistakes 'Out for delivery' for delivered", () => {
    expect(isDelivered("Delivered")).toBe(true);
    expect(isDelivered("Out for delivery")).toBe(false);
    expect(isDelivered("Delivery attempted")).toBe(false);
  });

  it("counts a cancelled order as finished", () => {
    expect(isFinalStatus("Cancelled")).toBe(true);
    expect(isFinalStatus("Pending")).toBe(false);
  });
});

describe("orderStage", () => {
  it("puts every live status into one of the four steps", () => {
    expect(orderStage("Delivered")).toBe("delivered");
    expect(orderStage("Cancelled")).toBe("cancelled");
    expect(orderStage("Out for delivery")).toBe("on_the_way");
    expect(orderStage("In transit")).toBe("on_the_way");
    expect(orderStage("Ready for dispatch")).toBe("on_the_way");
    expect(orderStage("Confirmed")).toBe("ordered");
    expect(orderStage("Pending")).toBe("ordered");
    expect(orderStage("Preparing your order")).toBe("ordered");
    expect(orderStage(null)).toBe("ordered");
  });
});

describe("needsChasing", () => {
  it("chases an order that hadn't arrived by 18:00 on the day it was ordered", () => {
    expect(needsChasing({ status: "Pending", orderDate: at(9, 14, 9) }, now)).toBe(true);
  });

  it("not before 18:00 on the day itself", () => {
    expect(needsChasing({ status: "Pending", orderDate: at(9, 15, 9) }, now)).toBe(false);
  });

  it("never chases a cancelled or delivered order", () => {
    expect(needsChasing({ status: "Cancelled", orderDate: at(9, 14, 9) }, now)).toBe(false);
    expect(needsChasing({ status: "Delivered", orderDate: at(9, 14, 9) }, now)).toBe(false);
  });

  it("stops chasing after a week: a months-old 'Pending' is stale, not urgent", () => {
    expect(needsChasing({ status: "Pending", orderDate: at(9, 4, 9) }, now)).toBe(false);
    expect(needsChasing({ status: "Pending", orderDate: at(6, 29, 9) }, now)).toBe(false);
  });

  it("needs a date to judge", () => {
    expect(needsChasing({ status: "Pending", orderDate: null }, now)).toBe(false);
  });
});

describe("statusIsStale", () => {
  it("an eBay order still 'Out for delivery' after months is stale", () => {
    expect(statusIsStale({ status: "Out for delivery", orderDate: at(3, 24, 10, 0, 2025) }, now)).toBe(true);
  });

  it("a recent one, or a finished one, is not", () => {
    expect(statusIsStale({ status: "Out for delivery", orderDate: at(9, 12) }, now)).toBe(false);
    expect(statusIsStale({ status: "Delivered", orderDate: at(3, 24, 10, 0, 2025) }, now)).toBe(false);
  });
});

describe("orderedLabel", () => {
  it("says when, in the words the workshop uses", () => {
    expect(orderedLabel(at(9, 15, 11, 58), now)).toBe("Today 11:58");
    expect(orderedLabel(at(9, 14, 16, 2), now)).toBe("Yesterday 16:02");
    expect(orderedLabel(at(9, 11, 9), now)).toBe("Fri 11 Sep");
    expect(orderedLabel(at(6, 26), now)).toBe("26 Jun");
    expect(orderedLabel(at(3, 24, 10, 0, 2025), now)).toBe("24 Mar 2025");
  });

  it("leaves the time off a date that has none", () => {
    expect(orderedLabel(at(9, 15, 0, 0), now)).toBe("Today");
    expect(orderedLabel(null, now)).toBe("—");
  });
});

describe("bucketOf", () => {
  it("files an order under the right heading, and anything past 30 days as Older", () => {
    expect(bucketOf(at(9, 15), now)).toBe("Today");
    expect(bucketOf(at(9, 14), now)).toBe("Yesterday");
    expect(bucketOf(at(9, 9), now)).toBe("Earlier this week");
    expect(bucketOf(at(9, 2), now)).toBe("Last week");
    expect(bucketOf(at(8, 20), now)).toBe("Earlier this month");
    expect(bucketOf(at(8, 10), now)).toBe("Older");
    expect(bucketOf(null, now)).toBe("Older");
  });
});
