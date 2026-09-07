/** Pure tests for shared/address — the shapes customer addresses actually arrive in. */
import { describe, it, expect } from "vitest";
import { splitAddress, tidyAddressLine, joinAddress } from "../shared/address";

describe("tidyAddressLine", () => {
  it("collapses runs of spaces and empty comma segments", () => {
    expect(tidyAddressLine("12 Temple Fortune    Finchley Road, London")).toBe("12 Temple Fortune Finchley Road, London");
    expect(tidyAddressLine("32 Bridgewater  Gardens, , Edgware")).toBe("32 Bridgewater Gardens, Edgware");
    expect(tidyAddressLine("  ,Hendon ,London, ")).toBe("Hendon, London");
  });
});

describe("splitAddress", () => {
  it("GA4 import shape: number at the start, runs of spaces", () => {
    expect(splitAddress("12 Temple Fortune    Finchley Road, London", "NW11 6XH")).toMatchObject({
      houseNo: "12", road: "Temple Fortune Finchley Road", locality: "", town: "London", county: "", postcode: "",
    });
    expect(splitAddress("70 Greenacres  Harden Road, Finchley, London")).toMatchObject({ houseNo: "70", road: "Greenacres Harden Road", locality: "Finchley", town: "London" });
  });

  it("web-created shape: the number is its own comma segment", () => {
    expect(splitAddress("90, Windermere Avenue, London")).toMatchObject({ houseNo: "90", road: "Windermere Avenue", town: "London" });
    expect(splitAddress("191, Wigston Lane, Leicester, Leicestershire, LE2 8DJ")).toMatchObject({
      houseNo: "191", road: "Wigston Lane", locality: "", town: "Leicester", county: "Leicestershire", postcode: "LE2 8DJ",
    });
  });

  it("numbered building then numbered street keeps the street number with the road", () => {
    expect(splitAddress("5 Acacia Court, 1  Brent Green, London")).toMatchObject({ houseNo: "5 Acacia Court", road: "1 Brent Green", town: "London" });
    expect(splitAddress("1 Fitzjohns House, 46 Fitzjohns Avenue, London")).toMatchObject({ houseNo: "1 Fitzjohns House", road: "46 Fitzjohns Avenue", town: "London" });
  });

  it("flats, repeated numbers and repeated segments", () => {
    expect(splitAddress("Flat 24 71f  Drayton Park, London")).toMatchObject({ houseNo: "Flat 24", road: "71f Drayton Park", town: "London" });
    expect(splitAddress("79 79  Bridge Lane, Golders Green, London")).toMatchObject({ houseNo: "79", road: "Bridge Lane", locality: "Golders Green", town: "London" });
    expect(splitAddress("35, Beechwood Avenue, London, London, N3 3AU")).toMatchObject({ houseNo: "35", road: "Beechwood Avenue", locality: "", town: "London", postcode: "N3 3AU" });
    expect(splitAddress("51  Flat 1 Finchley Lane, Flat 1, Hendon, London")).toMatchObject({ houseNo: "51", road: "Flat 1 Finchley Lane", locality: "Hendon", town: "London" });
  });

  it("lifts a trailing postcode out and never repeats a known one as a line", () => {
    expect(splitAddress("11, Alexandra Road, Hendon, London, NW42SB").postcode).toBe("NW4 2SB");
    expect(splitAddress("30 Green Walk, Hendon, London, NW4 2AJ", "NW4 2AJ")).toMatchObject({ town: "London", county: "", postcode: "NW4 2AJ" });
  });

  it("a building followed by its street stays on the address line", () => {
    expect(splitAddress("Winsford Court, Tenterden Grove")).toMatchObject({ houseNo: "", road: "Winsford Court, Tenterden Grove", town: "" });
    expect(splitAddress("Vincent Court, Bell Lane, Hendon, London")).toMatchObject({ road: "Vincent Court, Bell Lane", locality: "Hendon", town: "London" });
    expect(splitAddress("Flat 3 Winsford Court, 11 Tenterden Grove, London")).toMatchObject({ houseNo: "Flat 3 Winsford Court", road: "11 Tenterden Grove", town: "London" });
  });

  it("no house number: the first segment is the road", () => {
    expect(splitAddress("Lathom Lodge   Sandy Lane, Northwood")).toMatchObject({ houseNo: "", road: "Lathom Lodge Sandy Lane", town: "Northwood" });
  });

  it("shouts become names", () => {
    expect(splitAddress("48 BRENT STREET BURNHAM COURT, HENDON").road).toBe("Brent Street Burnham Court");
  });

  it("joins back to the customer-record line", () => {
    expect(joinAddress({ houseNo: "12", road: "Finchley Road", locality: "Hendon", town: "London" })).toBe("12 Finchley Road, Hendon, London");
    expect(joinAddress(splitAddress("12 Temple Fortune    Finchley Road, London"))).toBe("12 Temple Fortune Finchley Road, London");
  });
});
