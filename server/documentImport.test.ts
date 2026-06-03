import { describe, it, expect } from "vitest";
import {
  parseGA4Money,
  mapDocType,
  mapLineItemType,
  mapGA4Document,
  mapGA4LineItem,
  parseGA4Date,
} from "./services/csv-import";

describe("parseGA4Money", () => {
  it("parses plain and thousands-separated values", () => {
    expect(parseGA4Money("1234.56")).toBe(1234.56);
    expect(parseGA4Money("1,234.56")).toBe(1234.56);
    expect(parseGA4Money("£1,234.56")).toBe(1234.56);
  });
  it("handles accounting-style negatives and blanks", () => {
    expect(parseGA4Money("(12.00)")).toBe(-12);
    expect(parseGA4Money("")).toBeNull();
    expect(parseGA4Money("-")).toBeNull();
    expect(parseGA4Money(undefined)).toBeNull();
  });
});

describe("mapDocType", () => {
  it("maps real GA4 docType codes to normalized types", () => {
    expect(mapDocType("SI")).toBe("Invoice");
    expect(mapDocType("ES")).toBe("Estimate");
    expect(mapDocType("JS")).toBe("JobSheet");
    expect(mapDocType("CR")).toBe("CreditNote");
    expect(mapDocType("XS")).toBe("Excess");
    expect(mapDocType("PA")).toBe("PaymentOnAccount");
    expect(mapDocType("")).toBe("Other");
  });
});

describe("mapLineItemType", () => {
  it("maps numeric itemType codes", () => {
    expect(mapLineItemType("1")).toBe("Labour");
    expect(mapLineItemType("2")).toBe("Part");
    expect(mapLineItemType("3")).toBe("Other");
  });
});

describe("mapGA4Document", () => {
  it("maps a real Documents.csv row (internal field names) to serviceHistory shape", () => {
    const row = {
      _ID: "GZLM884LRLRJOIQC74JTT8",
      _ID_Customer: "OOTOSBT1OS8WC0HI6WZW",
      _ID_Vehicle: "26164C269A48F648AD24C117EE059E13",
      docType: "SI",
      docNumber_Invoice: "60231",
      docNumber_Jobsheet: "",
      docUserStatus: "Issued",
      vehRegistration: "VU53DBZ",
      vehMileage: "45393",
      docDate_Issued: "07/04/2011",
      us_TotalNET: "721.52",
      us_TotalTAX: "136.30",
      us_TotalGROSS: "857.82",
      us_Balance: "0.00",
      us_TotalReceipts: "857.82",
      us_SubTotal_LabourNET: "307.00",
      us_SubTotal_PartsNET: "368.52",
    };
    const d = mapGA4Document(row);
    expect(d.externalId).toBe("GZLM884LRLRJOIQC74JTT8");
    expect(d.customerExternalId).toBe("OOTOSBT1OS8WC0HI6WZW");
    expect(d.docType).toBe("Invoice");
    expect(d.docNo).toBe("60231"); // coalesced from per-type number columns
    expect(d.docStatus).toBe("Issued");
    expect(d.registration).toBe("VU53DBZ");
    expect(d.mileage).toBe(45393);
    expect(d.totalGross).toBe(857.82);
    expect(d.totalReceipts).toBe(857.82);
    expect(d.subLabourNet).toBe(307);
    expect(d.balance).toBe(0);
    expect(d.dateIssued).toEqual(parseGA4Date("07/04/2011"));
  });
});

describe("mapGA4LineItem", () => {
  it("maps a real LineItems.csv row to serviceLineItems shape", () => {
    const row = {
      _ID: "B8D4108DD2F179469CB52E90F677A542",
      _ID_Document: "OOTOSBT1OR6UL7IFFTYA",
      itemType: "1",
      itemQuantity: "4.5",
      itemUnitPrice: "63",
      itemSub_Net: "283.50",
      itemSub_Tax: "56.7",
      itemSub_Gross: "340.20",
      itemTaxRate: "20",
      itemNominalCode: "4000",
    };
    const li = mapGA4LineItem(row);
    expect(li.externalId).toBe("B8D4108DD2F179469CB52E90F677A542");
    expect(li.documentExternalId).toBe("OOTOSBT1OR6UL7IFFTYA");
    expect(li.itemType).toBe("Labour");
    expect(li.quantity).toBe(4.5);
    expect(li.subNet).toBe(283.5);
    expect(li.vatRate).toBe(20);
    expect(li.nominalCode).toBe("4000");
  });
});
