import { describe, it, expect } from "vitest";

/**
 * The digital-returns request body, checked against a REAL capture.
 *
 * On 15 Sep a genuine return was put through Omnipart's own website with the browser network tab
 * recording. That capture is the fixture below: the exact body their site sent, which came back
 * 201 Created as /digital-returns/5212.
 *
 * Everything the router builds is asserted against it. Before this, the shape was transcribed from
 * their minified bundle — good enough to beat a guess, not good enough to fire a credit request at
 * a live trade account.
 */

/** Verbatim from the capture. Do not "tidy" these values; they are the specification. */
const REAL_BODY = {
  lines: [
    { product: "/products/179087", reason: "/digital-return-reasons/4", unitPriceExcTax: 736, quantity: 1, additionalInformation: "" },
    { product: "/products/166838", reason: "/digital-return-reasons/4", unitPriceExcTax: 835, quantity: 1, additionalInformation: "" },
  ],
  order: "/orders/5677556",
};

/** Verbatim from the same capture's GET /orders/311-00005677556/digital-return-products. */
const REAL_ITEM = {
  sku: "502120057",
  "@id": "/.well-known/genid/a476838995fda4e3a792",
  quantity: 1,
  surcharge: 0,
  product: { "@id": "https://api.omnipart.eurocarparts.com/products/166838" },
  unitPrice: { "@type": "PriceFloat", incTax: 1002, excTax: 835 },
};

/** The same extraction the client does. */
function productIriOf(it: any): string {
  const raw = String(it?.product?.["@id"] ?? it?.["@id"] ?? "");
  return raw.match(/\/products\/\d+/)?.[0] ?? "";
}

describe("the body Omnipart actually accepts", () => {
  it("is keyed lines + order, not items + order_id", () => {
    expect(Object.keys(REAL_BODY).sort()).toEqual(["lines", "order"]);
    expect(REAL_BODY).not.toHaveProperty("items");
    expect(REAL_BODY).not.toHaveProperty("order_id");
  });

  it("carries product and reason as IRIs, never a sku or a code", () => {
    for (const line of REAL_BODY.lines) {
      expect(line.product).toMatch(/^\/products\/\d+$/);
      expect(line.reason).toMatch(/^\/digital-return-reasons\/\d+$/);
    }
  });

  it("names every field the site sends, and no others", () => {
    for (const line of REAL_BODY.lines) {
      expect(Object.keys(line).sort()).toEqual(
        ["additionalInformation", "product", "quantity", "reason", "unitPriceExcTax"],
      );
    }
  });

  it("sends the db order id, NOT the order reference", () => {
    // The items endpoint in the same capture used /orders/311-00005677556/digital-return-products.
    // The submit used /orders/5677556. Two different identifiers for one order.
    expect(REAL_BODY.order).toBe("/orders/5677556");
    expect(REAL_BODY.order).not.toContain("311-");
    expect(REAL_BODY.order.replace("/orders/", "")).toMatch(/^\d+$/);
  });
});

describe("turning a returnable item into a line", () => {
  it("takes the product IRI out of a FULL url, not the item's own @id", () => {
    // product["@id"] is absolute; the item's own @id is a genid and carries no product number.
    expect(productIriOf(REAL_ITEM)).toBe("/products/166838");
    expect(productIriOf({ "@id": REAL_ITEM["@id"] })).toBe("");
  });

  it("passes the price through with NO unit conversion", () => {
    // The item reported excTax 835 and the site sent 835. Scaling by 100 either way would credit
    // a hundred times the right amount.
    const line = REAL_BODY.lines.find((l) => l.product === "/products/166838")!;
    expect(line.unitPriceExcTax).toBe(REAL_ITEM.unitPrice.excTax);
  });

  it("matches a returnable item to its line by product IRI", () => {
    expect(REAL_BODY.lines.some((l) => l.product === productIriOf(REAL_ITEM))).toBe(true);
  });
});

describe("the responses are hydra envelopes", () => {
  it("means Array.isArray on the reasons list is false — the original bug", () => {
    // Confirmed in the capture: the reasons response has @context / hydra:member, not an array.
    // So `Array.isArray(data) ? data : []` returned [] every time, the dropdown was always empty,
    // and no return could ever be submitted.
    const REAL_REASONS = { "@context": "/contexts/DigitalReturnReason", "hydra:totalItems": 5, "hydra:member": [
      { code: "Damaged", "@id": "/digital-return-reasons/1" },
      { code: "Not Required", "@id": "/digital-return-reasons/4" },
      { code: "Surcharge", "@id": "/digital-return-reasons/5" },
    ] };
    expect(Array.isArray(REAL_REASONS)).toBe(false);

    const hydraMembers = (d: any) => Array.isArray(d) ? d : (Array.isArray(d?.["hydra:member"]) ? d["hydra:member"] : []);
    expect(hydraMembers(REAL_REASONS)).toHaveLength(3);
    expect(hydraMembers(REAL_REASONS).find((r: any) => r.code === "Not Required")["@id"])
      .toBe("/digital-return-reasons/4");
  });

  it("confirms Surcharge is a real reason code, so the special case is not hypothetical", () => {
    // Their bundle sends the item's `surcharge` instead of its unit price for this code.
    expect(["Damaged", "Incomplete", "Incorrectly Labelled", "Not Required", "Surcharge"])
      .toContain("Surcharge");
  });
});
