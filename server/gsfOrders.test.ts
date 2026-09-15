import { describe, it, expect } from "vitest";
import { mapGsfOrder } from "./routers/gsf";

/**
 * Mapping a GSF trade order.
 *
 * The field names below are not invented: they are the response shape observed from
 * `POST /orders/api/recent` in a captured browser session on the trade portal. Signing in needs
 * live credentials, so this is the part that can be held still without them -- and it is where the
 * mistakes would live.
 */
const RAW = {
  type: "order",
  documentNumber: "GS1234567",
  inits: "AR",
  purchaseOrderNumber: "AB12CDE",
  orderTotal: 53.46,
  orderTotalVat: 10.69,
  orderedAt: "2026-09-10T09:52:44.000Z",
  deliveryStatus: "Delivered",
  deliveryUpdates: [
    { status: "Picked", createdAt: "2026-09-10T10:02:00.000Z", comments: "" },
    { status: "Delivered", createdAt: "2026-09-10T13:40:00.000Z", comments: "Left at reception" },
  ],
  lines: [
    { sku: "GSF123456", description: "Oil Filter", quantity: 4, price: 8.88, quotePrice: 9.5, invoice: "INV001", credit: null },
    { sku: "GSF999999", description: "Air Filter", quantity: 1, price: 17.94, quotePrice: 17.94, invoice: "INV001", credit: "CRD77" },
  ],
  messageToBranch: "",
  origin: "web",
  account: "WVZ00000",
  displayDate: "10/09/2026",
};

describe("mapGsfOrder", () => {
  const m = mapGsfOrder(RAW);

  it("keys the order on GSF's document number", () => {
    expect(m.orderRef).toBe("GS1234567");
    expect(m.supplier).toBe("gsf");
  });

  it("keeps the purchase-order reference, which is the only route to a job", () => {
    // GSF orders carry no registration field. If anyone types the reg at order time it lands here
    // and the order can match itself to a job; if not, it has to be attached by hand.
    expect(m.purchaseOrderNumber).toBe("AB12CDE");
  });

  it("adds VAT for gross rather than reading orderTotal as gross", () => {
    // orderTotal is the goods value and orderTotalVat the VAT on it. Treating orderTotal as gross
    // would understate every cost by the VAT and overstate every margin by the same.
    expect(m.netTotal).toBe(53.46);
    expect(m.grossTotal).toBe(64.15);
  });

  it("does not invent a gross total when the VAT is missing", () => {
    expect(mapGsfOrder({ ...RAW, orderTotalVat: undefined }).grossTotal).toBeNull();
  });

  it("reads the part lines with codes, quantities and unit cost", () => {
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0]).toMatchObject({ code: "GSF123456", name: "Oil Filter", quantity: 4, unitCost: 8.88 });
  });

  it("keeps the per-line credit, which says what has already gone back", () => {
    expect(m.parts[0].credit).toBeNull();
    expect(m.parts[1].credit).toBe("CRD77");
  });

  it("keeps quotePrice out of cost", () => {
    // quotePrice is what was quoted, price is what was charged. Costing off the quote would record
    // a number the invoice never carried.
    expect(m.parts[0].unitCost).toBe(8.88);
    expect(m.parts[0].unitCost).not.toBe(RAW.lines[0].quotePrice);
  });

  it("carries the delivery history, not just the latest status", () => {
    expect(m.status).toBe("Delivered");
    expect(m.deliveryUpdates).toHaveLength(2);
    expect(m.deliveryUpdates[1]).toMatchObject({ status: "Delivered", comments: "Left at reception" });
  });

  it("survives an order with nothing on it", () => {
    const empty = mapGsfOrder({});
    expect(empty.parts).toEqual([]);
    expect(empty.deliveryUpdates).toEqual([]);
    expect(empty.orderRef).toBeNull();
    expect(empty.grossTotal).toBeNull();
  });
});
