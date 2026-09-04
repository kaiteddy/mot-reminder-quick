/**
 * Keeping the stock list in step with the website.
 *
 * The forecourt is advertised through CarDealer5 (dealers.cardealer5.co.uk), which publishes
 * elimotors.co.uk. Until now the two were joined by hand: someone exported a CSV out of the
 * dealer admin and ran scripts/import-sales-stock.ts. Between exports the app drifts — cars go
 * live on the site and never appear here, prices are cut on the site and stay stale here.
 *
 * The dealer admin needs a login, but the PUBLIC site carries everything we need in a
 * machine-readable form: every vehicle page emits a schema.org `Vehicle` block, and CarDealer5
 * puts the REGISTRATION in its `vehicleIdentificationNumber` field. So the sync needs no
 * credentials at all — it reads the same pages a customer sees.
 *
 * The one rule that matters: THE WEBSITE IS NOT THE WHOLE STOCK LIST. Cars in prep, cars held
 * back, trade cars and part-exchanges are legitimately in stock and not advertised. So a car
 * that isn't on the site is never deleted, never marked sold and never altered — it is only
 * reported, and `lastSeenOnline` records when it was last advertised. The sync adds and updates;
 * it never removes.
 *
 * Locally-owned columns are equally off limits: status, soldAt/soldPrice, vin, engineNo,
 * ukvdChecked and the DVLA MOT/tax block all stay as they are. What the website owns is what the
 * website advertises — price, mileage, spec, photo.
 */

const SITE = (process.env.WEBSITE_STOCK_URL || "https://www.elimotors.co.uk").replace(/\/+$/, "");
const PAGE_SIZE = 15;   // CarDealer5's own page size; the loop stops when a page adds nothing
const MAX_PAGES = 20;   // a stop so a change in the pagination contract can't spin forever
const CONCURRENCY = 5;  // detail pages fetched at once — polite, and finishes inside a cron's timeout

export type OnlineCar = {
  externalId: string;
  url: string;
  registration: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  bodyType: string | null;
  colour: string | null;
  fuelType: string | null;
  transmission: string | null;
  doors: number | null;
  owners: number | null;
  mileage: number | null;
  price: number | null;
  year: number | null;
  registrationDate: Date | null;
  imageUrl: string | null;
  /** schema.org availability — "InStock", "SoldOut", "OutOfStock"… */
  availability: string | null;
  /** The site's own badge on the card: on_forecourt / sold / reserved / "" */
  listingStatus: string | null;
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) EliMotors-StockSync/1.0";

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Registration or VIN? CarDealer5 uses one field for both; a VIN is 17 characters, a plate isn't. */
function splitRegOrVin(raw: unknown): { registration: string | null; vin: string | null } {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return { registration: null, vin: null };
  if (s.length === 17) return { registration: null, vin: s };
  if (s.length >= 2 && s.length <= 8) return { registration: s, vin: null };
  return { registration: null, vin: null };
}

const num = (x: unknown): number | null => {
  const n = Number(String(x ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && String(x ?? "").trim() !== "" ? n : null;
};
const toDate = (x: unknown): Date | null => {
  if (!x) return null;
  const d = new Date(String(x));
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Every vehicle currently advertised, in listing order.
 *
 * The listing pages give the id, the card's status badge and the detail URL; the detail page's
 * JSON-LD gives the facts. Scraping the cards themselves would mean parsing the site's markup,
 * which is a theme and changes; the JSON-LD is emitted by the platform for Google and doesn't.
 */
export async function fetchOnlineStock(): Promise<OnlineCar[]> {
  const found = new Map<string, { url: string; listingStatus: string | null }>();
  const ids: string[] = [];   // listing order, and the repo's tsconfig can't spread a Map iterator
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await getText(`${SITE}/page/used/cars/${page * PAGE_SIZE}/0/0/0/`);
    const before = found.size;
    // Each card is a `list-box-wrapper … <status>` div wrapping links to /details/…/<id>/.
    for (const card of html.split("list-box-wrapper").slice(1)) {
      const status = /grid-4-row\s+([a-z_]+)/.exec(card)?.[1] ?? null;
      const link = /href="(https?:\/\/[^"]*\/details\/[^"]*?\/(\d{5,})\/)"/.exec(card);
      if (link && !found.has(link[2])) { found.set(link[2], { url: link[1], listingStatus: status }); ids.push(link[2]); }
    }
    if (found.size === before) break; // a page that adds nothing is the end of the list
  }

  const out: OnlineCar[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = await Promise.all(ids.slice(i, i + CONCURRENCY).map(async (id) => {
      const { url, listingStatus } = found.get(id)!;
      try { return parseVehiclePage(await getText(url), id, url, listingStatus); } catch { return null; }
    }));
    for (const c of batch) if (c) out.push(c);
  }
  return out;
}

/** Pull the schema.org Vehicle block out of a vehicle page. */
export function parseVehiclePage(html: string, externalId: string, url: string, listingStatus: string | null): OnlineCar | null {
  let v: any = null;
  const blocks = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
  for (let m = blocks.exec(html); m; m = blocks.exec(html)) {
    try {
      const j = JSON.parse(m[1].trim());
      const type = Array.isArray(j?.["@type"]) ? j["@type"] : [j?.["@type"]];
      if (type.indexOf("Vehicle") >= 0 || type.indexOf("Car") >= 0) { v = j; break; }
    } catch { /* a block that isn't valid JSON isn't the one we want */ }
  }
  if (!v) return null;

  const { registration, vin } = splitRegOrVin(v.vehicleIdentificationNumber);
  const regDate = toDate(v.productionDate) ?? toDate(v.releaseDate) ?? toDate(v.dateVehicleFirstRegistered);
  return {
    externalId, url, registration, vin,
    make: (v.brand?.name || v.manufacturer?.name || "").toUpperCase() || null,
    model: String(v.model ?? "").toUpperCase() || null,
    variant: v.vehicleConfiguration || null,
    bodyType: v.bodyType || null,
    colour: String(v.color ?? "").toUpperCase() || null,
    fuelType: v.fuelType || null,
    transmission: v.vehicleTransmission || null,
    doors: num(v.numberOfDoors),
    owners: num(v.numberOfPreviousOwners),
    mileage: num(v.mileageFromOdometer?.value ?? v.mileageFromOdometer),
    price: num(v.offers?.price ?? v.offers?.priceSpecification?.price),
    year: regDate ? regDate.getFullYear() : num(v.modelDate) ?? num(v.vehicleModelDate),
    registrationDate: regDate,
    imageUrl: (Array.isArray(v.image) ? v.image[0] : v.image) || null,
    availability: String(v.offers?.availability ?? "").split("/").pop() || null,
    listingStatus,
  };
}

export type StockSyncReport = {
  applied: boolean;
  online: number;
  /** Advertised cars that were already ours and needed nothing. */
  unchanged: number;
  /** Advertised cars whose details we brought up to date. */
  updated: { id: number; registration: string | null; changes: Record<string, { from: any; to: any }> }[];
  /** Advertised cars the stock list had never heard of. */
  added: { id: number | null; externalId: string; registration: string | null; title: string; price: number | null }[];
  /** Ours, but not on the website — LEFT ALONE. In prep, held back, or quietly sold. */
  notAdvertised: { id: number; registration: string | null; status: string | null; lastSeenOnline: Date | null }[];
  /** Advertised, yet our status says otherwise (IN PREP on a car the site is selling). Reported
   *  only: status is ours, and "in prep" can mean the car is spoken for. */
  statusDisagrees: { id: number; registration: string | null; status: string | null }[];
  /** Advertised cars whose registration the site didn't carry — matched on nothing, so skipped. */
  skipped: { externalId: string; url: string; why: string }[];
  errors: string[];
};

const normReg = (r: unknown) => String(r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Is the advert's value actually different from ours?
 *
 * Case and spacing don't count. The website writes "Black" where the old CSV wrote "BLACK" and
 * "Petrol" where a hand-entered row says "PETROL"; treating those as changes would rewrite most
 * of the table on every run and bury the differences that matter — a price cut, a new photo —
 * in cosmetic noise.
 */
function differs(from: any, to: any): boolean {
  if (from == null || from === "") return true;
  if (typeof to === "number" || from instanceof Date || to instanceof Date) {
    if (from instanceof Date || to instanceof Date) return +new Date(from) !== +new Date(to as any);
    return Number(from) !== Number(to);
  }
  const a = String(from).trim(), b = String(to).trim();
  const numeric = /^-?\d*\.?\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) !== Number(b);   // "12520.00" vs "12520"
  return a.toLowerCase().replace(/\s+/g, " ") !== b.toLowerCase().replace(/\s+/g, " ");
}
const title = (c: OnlineCar) => [c.make, c.model, c.variant, c.year].filter(Boolean).join(" ").toUpperCase();

/**
 * Reconcile salesStock against the website.
 *
 * Matching runs id-first, registration-second. The second pass is what closes the real gap: a car
 * entered here by hand while it was in prep has no CarDealer5 id, and when it goes live the sync
 * adopts the website's id onto that row instead of creating a duplicate.
 *
 * Dry by default — pass { apply: true } to write.
 */
export async function syncWebsiteStock(opts?: { apply?: boolean }): Promise<StockSyncReport> {
  const apply = !!opts?.apply;
  const { getDb } = await import("../db");
  const { salesStock } = await import("../../drizzle/schema");
  const { eq, sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const report: StockSyncReport = {
    applied: apply, online: 0, unchanged: 0, updated: [], added: [], notAdvertised: [], statusDisagrees: [], skipped: [], errors: [],
  };

  const online = await fetchOnlineStock();
  report.online = online.length;
  if (!online.length) {
    // Never treat "the site returned nothing" as "the forecourt is empty" — that is what a
    // failed fetch looks like, and acting on it would blank the stock list.
    report.errors.push("the website returned no vehicles — treating as a fetch failure, nothing changed");
    return report;
  }

  const rows: any[] = (await db.execute(sql`SELECT * FROM "salesStock"`) as any).rows ?? [];
  const byExternalId = new Map<string, any>();
  const byReg = new Map<string, any>();
  for (const r of rows) {
    if (r.externalId) byExternalId.set(String(r.externalId), r);
    if (r.registration) byReg.set(normReg(r.registration), r);
  }

  const seen = new Set<number>();
  const now = new Date();

  for (const car of online) {
    let match = byExternalId.get(car.externalId) ?? (car.registration ? byReg.get(car.registration) : null);
    // Two adverts must never land on one stock row. That happens when a car is re-listed under a
    // new CarDealer5 id while the old row still carries the old one — and writing the second
    // car's price and photo over the first is precisely the kind of silent identity swap that
    // took a week to find last time. Leave the row alone and say which two adverts collided.
    if (match && seen.has(match.id)) {
      report.skipped.push({ externalId: car.externalId, url: car.url, why: `${car.registration || "this advert"} matches stock #${match.id}, already taken by another advert` });
      match = null;
      continue;
    }

    if (!match) {
      if (!car.registration) { report.skipped.push({ externalId: car.externalId, url: car.url, why: "the advert carries no registration" }); continue; }
      report.added.push({ id: null, externalId: car.externalId, registration: car.registration, title: title(car), price: car.price });
      if (apply) {
        const ins: any = (await db.insert(salesStock).values({
          externalId: car.externalId, registration: car.registration, vin: car.vin,
          title: title(car), make: car.make, model: car.model, variant: car.variant, bodyType: car.bodyType,
          vehicleType: "CAR", year: car.year, fuelType: car.fuelType, colour: car.colour, mileage: car.mileage,
          transmission: car.transmission, owners: car.owners, doors: car.doors,
          price: car.price == null ? null : String(car.price),
          status: "ON FORECOURT", registrationDate: car.registrationDate,
          imageUrl: car.imageUrl, websiteUrl: car.url, lastSeenOnline: now,
        } as any).returning({ id: salesStock.id })) as any;
        const id = Array.isArray(ins) ? ins[0]?.id : ins?.rows?.[0]?.id;
        report.added[report.added.length - 1].id = id ?? null;
        if (id) seen.add(id);
      }
      continue;
    }

    seen.add(match.id);
    // The site is selling it; our list says it isn't for sale yet. Say so — don't rewrite it.
    if (match.status && !/^on forecourt$/i.test(match.status))
      report.statusDisagrees.push({ id: match.id, registration: match.registration, status: match.status });

    // What the advert owns, always refreshed. What we own — status, sold, VIN/engine number,
    // the DVLA MOT/tax block, the purchase deal — is never in this list.
    const wants: Record<string, any> = {
      price: car.price == null ? null : String(car.price),
      mileage: car.mileage, colour: car.colour, fuelType: car.fuelType, transmission: car.transmission,
      variant: car.variant, bodyType: car.bodyType, doors: car.doors, owners: car.owners,
      imageUrl: car.imageUrl, websiteUrl: car.url,
    };
    // Blanks we can fill from the advert but must not overwrite: our own value came from DVLA or
    // a paid lookup and is at least as good.
    for (const [col, value] of [["make", car.make], ["model", car.model], ["title", title(car)],
      ["year", car.year], ["registrationDate", car.registrationDate], ["vin", car.vin]] as const) {
      if (value != null && value !== "" && (match[col] == null || match[col] === "")) wants[col] = value;
    }
    // A car entered by hand before it went live adopts the website's id and its own registration.
    if (!match.externalId) wants.externalId = car.externalId;
    if (!match.registration && car.registration) wants.registration = car.registration;

    const changes: Record<string, { from: any; to: any }> = {};
    for (const [col, to] of Object.entries(wants)) {
      if (to == null || to === "") continue;                       // the advert dropping a field is not news
      const from = match[col];
      if (!differs(from, to)) continue;
      changes[col] = { from, to };
    }

    if (Object.keys(changes).length) {
      report.updated.push({ id: match.id, registration: match.registration, changes });
      if (apply) {
        const set: any = { lastSeenOnline: now };
        for (const [col, c] of Object.entries(changes)) set[col] = c.to;
        await db.update(salesStock).set(set).where(eq(salesStock.id, match.id));
      }
    } else {
      report.unchanged++;
      if (apply) await db.update(salesStock).set({ lastSeenOnline: now } as any).where(eq(salesStock.id, match.id));
    }
  }

  // Everything else stays exactly as it is. This list is the whole point of the feature: it is
  // how you see, without deleting anything, which stock cars the website isn't showing.
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    report.notAdvertised.push({ id: r.id, registration: r.registration, status: r.status, lastSeenOnline: r.lastSeenOnline ?? null });
  }

  return report;
}
