/**
 * Reading the technical data service's workshop answers. Every fixture is cut from the real
 * answers for a 2014 Ford Fiesta (HJ14AJX) and a 2016 Audi Q7 (AU16WOX) on 10/09/2026.
 */
import { describe, it, expect } from "vitest";
import {
  buildWorkshopData, parseAdjustments, parseFuseLocations, parseDiagnosticPort,
  parseEngineLocations, parseDrawings, cleanText, workshopIsEmpty, matchingRows, entryCount,
} from "../shared/workshopData";

const wrap = (inner: any) => [{ TechnicalData: inner }];
const item = (name: string, value: string | null = null, unit: string | null = null, subs: any[] = [], extra: any = {}) =>
  ({ imageName: null, name, order: 0, remark: null, status: null, unit, value, subAdjustments: subs.length ? { item: subs.length === 1 ? subs[0] : subs } : null, ...extra });

describe("parseAdjustments", () => {
  const fiesta = wrap({ ExtAdjustment: [
    item("Brakes", null, null, [
      item("Front disc brakes"),
      item("Disc diameter, front", "258.0", "(mm)", [item("Disc thickness, front", "23.0", "(mm)"), item("Disc thickness, front, minimum", "21.0", "(mm)")]),
      item("Brake pad thickness, front, minimum", "1.5", "(mm)"),
    ]),
    item("Engine (specifications)", null, null, [
      item("Oil pressure", "> 1.0/800", "(bar/rpm)", [], { remark: "Engine oil temperature at least 80 °C" }),
      item("Drive belt layout", null, null, [], { imageName: "https://www.haynespro-assets.com/workshop/images/12329.svgz" }),
    ]),
    item("Empty group"),
  ] });

  it("keeps headings, values, units without brackets, and how deep each row sits", () => {
    const [brakes] = parseAdjustments(fiesta);
    expect(brakes.name).toBe("Brakes");
    expect(brakes.rows.map((r) => [r.label, r.value, r.unit, r.depth])).toEqual([
      ["Front disc brakes", null, null, 0],
      ["Disc diameter, front", "258.0", "mm", 0],
      ["Disc thickness, front", "23.0", "mm", 1],
      ["Disc thickness, front, minimum", "21.0", "mm", 1],
      ["Brake pad thickness, front, minimum", "1.5", "mm", 0],
    ]);
  });

  it("carries notes and diagrams, and drops a group with nothing in it", () => {
    const groups = parseAdjustments(fiesta);
    expect(groups.map((g) => g.name)).toEqual(["Brakes", "Engine (specifications)"]);
    const engine = groups[1].rows;
    expect(engine[0].note).toBe("Engine oil temperature at least 80 °C");
    expect(engine[1].image).toBe("https://www.haynespro-assets.com/workshop/images/12329.svgz");
  });

  it("reads a list that arrived as a single object", () => {
    const one = wrap({ ExtAdjustment: item("Cooling system", null, null, [item("Cap pressure", "1.4 - 1.6", "(bar)")]) });
    expect(parseAdjustments(one)[0].rows[0]).toMatchObject({ label: "Cap pressure", value: "1.4 - 1.6", unit: "bar" });
  });
});

describe("parseFuseLocations", () => {
  const box = wrap({ ExtLocationSystem: [{
    description: "Fuse and relay box in engine compartment", id: "304000009",
    itemsLocationMimeDataName: "https://www.haynespro-assets.com/workshop/images/304000088.svgz",
    systemLocationMimeDataName: "None", order: "0", side: "0",
    items: { item: [
      { description: "Left-hand drive is shown; no additional information is available for right-hand drive", location: "1", type: "loc", value: 0 },
      { description: "ESP control unit<br>ABS control unit<br>(30A also used)", location: "1", type: "fux", value: 40 },
      { description: "Not used", location: "10", type: "fux", value: 0 },
      { description: "Left headlight", location: "12", type: "fus", value: 10 },
      { description: "Starter relay 1<br>Or<br>Daylight running lights relay", location: "R1", type: "rel", value: 0 },
    ] },
  }] });

  it("names each fuse, its amps and what it protects, and keeps the box map", () => {
    const [b] = parseFuseLocations(box);
    expect(b.name).toBe("Fuse and relay box in engine compartment");
    expect(b.mapImage).toBe("https://www.haynespro-assets.com/workshop/images/304000088.svgz");
    expect(b.whereImage).toBeNull();
    expect(b.notes).toEqual(["Left-hand drive is shown; no additional information is available for right-hand drive"]);
    expect(b.items).toEqual([
      { ref: "1", amps: 40, what: "ESP control unit / ABS control unit / (30A also used)", kind: "maxi fuse" },
      { ref: "10", amps: null, what: "Not used", kind: "maxi fuse" },
      { ref: "12", amps: 10, what: "Left headlight", kind: "fuse" },
      { ref: "R1", amps: null, what: "Starter relay 1 / Or / Daylight running lights relay", kind: "relay" },
    ]);
  });
});

describe("parseDiagnosticPort", () => {
  it("reads one location or several", () => {
    expect(parseDiagnosticPort(wrap({ ExtEobdLocation: { location: "Left-hand drive is shown", mimeDataName: "https://www.haynespro-assets.com/workshop/images/61147.svgz" } })))
      .toEqual([{ note: "Left-hand drive is shown", image: "https://www.haynespro-assets.com/workshop/images/61147.svgz" }]);
    expect(parseDiagnosticPort(wrap({ ExtEobdLocation: [
      { location: "RHD", mimeDataName: "https://www.haynespro-assets.com/workshop/images/319032006.svgz" },
      { location: "LHD", mimeDataName: "https://www.haynespro-assets.com/workshop/images/62183.svgz" },
    ] })).map((p) => p.note)).toEqual(["RHD", "LHD"]);
  });
});

describe("parseEngineLocations", () => {
  it("lists the parts shown on each picture", () => {
    const [loc] = parseEngineLocations(wrap({ ExtLocationSystem: [{
      description: "Engine, Accelerator pedal position sensor, Fuel pump with level sensor",
      itemsLocationMimeDataName: "https://www.haynespro-assets.com/workshop/images/310002555.svgz", systemLocationMimeDataName: "None",
      items: { item: [
        { description: "Engine (Front view)", location: "1", type: "sys", value: 0 },
        { description: "Fuel pump with level sensor", location: "3", type: "mmp", value: 0 },
      ] },
    }] }));
    expect(loc.image).toBe("https://www.haynespro-assets.com/workshop/images/310002555.svgz");
    expect(loc.parts).toEqual([{ ref: "1", name: "Engine (Front view)" }, { ref: "3", name: "Fuel pump with level sensor" }]);
  });
});

describe("parseDrawings", () => {
  it("keeps every drawing that has a picture, nested or not", () => {
    const groups = parseDrawings(wrap({ ExtDrawing: [
      { description: "Engine", mimeDataName: null, subDrawings: { item: { description: "Engine/gearbox mounts", mimeDataName: "https://www.haynespro-assets.com/workshop/images/319015983.svgz?typeOfdrawing=tdrawing&language=en" } } },
      { description: "Brake system : General data", mimeDataName: null, subDrawings: { item: [
        { description: "ABS, hydraulic unit", mimeDataName: "https://www.haynespro-assets.com/workshop/images/319011372.svgz" },
        { description: "Master cylinder", mimeDataName: "None" },
      ] } },
      { description: "No pictures here", mimeDataName: null, subDrawings: null },
    ] }));
    expect(groups.map((g) => [g.name, g.drawings.map((d) => d.title)])).toEqual([
      ["Engine", ["Engine/gearbox mounts"]],
      ["Brake system : General data", ["ABS, hydraulic unit"]],
    ]);
  });
});

describe("buildWorkshopData", () => {
  it("records which groups came back empty, so an empty answer is stored and never bought again", () => {
    const w = buildWorkshopData({ adjustments: "", fuses: "[]", diagnosticPort: undefined, locations: "not json", drawings: null }, new Date("2026-09-10T12:00:00Z"));
    expect(workshopIsEmpty(w)).toBe(true);
    expect(w.fetchedAt).toBe("2026-09-10T12:00:00.000Z");
    expect(w.empty).toEqual(["Adjustments and torque settings", "Fuse boxes", "Diagnostic port", "Part locations", "Drawings"]);
  });

  it("accepts the raw text exactly as the service returns it", () => {
    const text = JSON.stringify(wrap({ ExtEobdLocation: { location: "Under the dashboard", mimeDataName: "https://www.haynespro-assets.com/workshop/images/1.svgz" } }));
    const w = buildWorkshopData({ diagnosticPort: text });
    expect(w.diagnosticPort).toHaveLength(1);
    expect(w.empty).not.toContain("Diagnostic port");
    expect(workshopIsEmpty(w)).toBe(false);
  });
});

describe("cleanText", () => {
  it("never shows the service's placeholder words", () => {
    expect(cleanText("None")).toBeNull();
    expect(cleanText("  ")).toBeNull();
    expect(cleanText("a<br/>b")).toBe("a / b");
  });
});

describe("matchingRows", () => {
  const row = (label: string, depth: number, value: string | null = null, unit: string | null = null) => ({ label, depth, value, unit, note: null, image: null });
  // As the Audi Q7's torque settings arrive: headings carry no figure, the figures sit beneath them.
  const torque = [
    row("Wheels and tyres", 0),
    row("Wheel bolts", 1),
    row("Stage 1", 2, "90", "Nm"),
    row("Stage 2", 2, "180", "°"),
    row("Front seat", 0, "50", "Nm"),
  ];

  it("shows a matching heading together with its figures", () => {
    expect(matchingRows(torque, "wheel bolt").map((r) => r.label)).toEqual(["Wheels and tyres", "Wheel bolts", "Stage 1", "Stage 2"]);
  });

  it("shows the headings above a matching figure, so a number always says what it is for", () => {
    expect(matchingRows(torque, "180").map((r) => r.label)).toEqual(["Wheels and tyres", "Wheel bolts", "Stage 2"]);
  });

  it("shows everything with no search, and nothing that does not match", () => {
    expect(matchingRows(torque, "  ")).toHaveLength(5);
    expect(matchingRows(torque, "handbrake")).toEqual([]);
  });

  it("counts figures, diagrams and notes but not bare headings", () => {
    expect(entryCount(torque)).toBe(3);
  });
});
