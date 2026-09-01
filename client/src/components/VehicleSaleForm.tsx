/**
 * Used Car Sales Invoice — an exact replica of ELI Motors' pre-printed two-part form
 * (VAT (Cars) Order 1972 S.I. No. 1970), editable in place.
 *
 * The form you type on IS the form that prints: one DOM, drawn in the source artwork's own
 * 2409 × 3438 unit space and scaled to whatever width the container gives it (`cqw`), which is
 * exactly 210mm when printing. Static artwork, rules and printed labels live in an <svg> layer
 * transcribed 1:1 from the supplied template; the fill-in blanks are real <input>s laid over it
 * at the same coordinates, so what is on screen is what lands on paper.
 *
 * Page 1 is the white original (editable). Page 2 is the pale-yellow seller's copy — the same
 * inputs rendered read-only from the same state, so the two can never drift apart.
 */
import { useLayoutEffect, useRef, useState } from "react";

// Artwork/coordinate space of the source form.
const W = 2409;
const H = 3438;
// The sheet is A4 but the artwork's own ratio is a hair narrower, so the source template stretches
// it horizontally (preserveAspectRatio="none"). Horizontal and vertical units therefore differ.
const A4_RATIO = 297 / 210;

export type VehicleSaleValues = Record<string, string>;

/** Which way round the pre-printed form is being used: selling a car out, or buying one in. */
export type DocKind = "sale" | "purchase";

/**
 * Type-ahead attached to a single blank. The form owns the anchoring and the dropdown; the
 * caller owns what is being searched, so the sheet stays ignorant of customers.
 */
export type SuggestProps = {
  items: { id: number; label: string; sub?: string }[];
  onPick: (id: number) => void;
  loading?: boolean;
  emptyHint?: string;
};

/** Seller block — pre-printed on the real form, so fixed here too. */
const SELLER = {
  name: "ELI MOTORS LTD",
  address: "49 VICTORIA ROAD LONDON, HENDON, NW4 2RP",
  telephone: "0208 203 6449",
  email: "ELI@ELIMOTORS.CO.UK",
  vat: "330 9339 65",
};

type FieldDef = {
  key: string;
  x: number;          // template x (left edge, or right edge when anchor is "end")
  y: number;          // template text baseline
  size: number;       // template font-size in artwork units
  width: number;      // template data-max-width
  anchor?: "end";
  lineHeight?: number; // set for the multi-line blocks
  rows?: number;
  title: string;      // tooltip / aria-label — the printed caption beside the blank
  /**
   * Money rows are split by the pre-printed colon: pounds to its left, pence on the short rule to
   * its right (the form is written "4500 : —"). One value is still stored — "1,000.50" — and the
   * two boxes are just the two halves of it.
   */
  pence?: { x: number; width: number };
};

const FIELDS: FieldDef[] = [
  // transaction block, top right
  // x is 15 units past the rule's start, as every other blank on the form is. The template put
  // this one at 130, leaving a 10mm run of dots before the invoice number.
  { key: "invoiceNumber", x: 1360, y: 529, size: 42, width: 980, title: "No." },
  { key: "transactionDate", x: 1670, y: 597, size: 42, width: 700, title: "Date of transaction" },
  { key: "stockNumber", x: 1450, y: 659, size: 42, width: 915, title: "Stock No" },
  { key: "dayBookFolio", x: 1525, y: 721, size: 42, width: 840, title: "Day Book Folio" },
  { key: "salesman", x: 1450, y: 783, size: 42, width: 915, title: "Salesman" },
  { key: "purchaserStockNumber", x: 1720, y: 845, size: 42, width: 650, title: "Purchaser's Stock No" },
  { key: "purchaserDayBookFolio", x: 1690, y: 907, size: 42, width: 680, title: "Purchaser's Day Book Folio" },

  // purchaser block, left
  { key: "purchaserName", x: 400, y: 1126, size: 42, width: 795, title: "Purchaser's Name" },
  // Line pitch matches the spacing of the three printed rules (1218/1290/1362), not the source
  // template's 67 — at 67 each successive line crept 5 units further off its rule.
  { key: "purchaserAddress", x: 200, y: 1209, size: 36, width: 1170, lineHeight: 72, rows: 3, title: "Purchaser's Address" },
  // Shares the third address rule with the postcode, which never needs more than its left-hand
  // end. Listed AFTER the address so it paints over that textarea's tail and stays clickable.
  { key: "purchaserEmail", x: 755, y: 1353, size: 32, width: 440, title: "Purchaser's Email" },
  { key: "purchaserTelephone", x: 575, y: 1409, size: 36, width: 620, title: "Telephone" },

  // vehicle sold
  { key: "grossPrice", x: 2190, y: 1528, size: 50, width: 175, anchor: "end", pence: { x: 2375, width: 115 }, title: "Gross price (inclusive of V.A.T.)" },
  { key: "vehicleMake", x: 185, y: 1604, size: 42, width: 1005, title: "Make" },
  { key: "vehicleType", x: 170, y: 1681, size: 42, width: 1020, title: "Type" },
  { key: "registrationNumber", x: 260, y: 1758, size: 42, width: 930, title: "Reg'n. No" },
  { key: "chassisNumber", x: 275, y: 1835, size: 36, width: 915, title: "Chassis No" },
  { key: "engineNumber", x: 400, y: 1912, size: 36, width: 790, title: "Engine No." },
  { key: "firstRegisteredUK", x: 465, y: 1989, size: 42, width: 725, title: "First Reg'd. in U.K." },
  // Likewise pitched to its rules (2285/2360/2435) rather than the template's 70.
  { key: "lastOwnerDetails", x: 43, y: 2276, size: 36, width: 1150, lineHeight: 75, rows: 3, title: "Name & Address of last Owner or Keeper" },

  // money, right-hand column
  { key: "lessLicenceValue", x: 2190, y: 1609, size: 36, width: 255, anchor: "end", pence: { x: 2375, width: 115 }, title: "Less value of veh. exc. licence" },
  { key: "partExchangeAllowance", x: 2190, y: 1842, size: 36, width: 255, anchor: "end", pence: { x: 2375, width: 115 }, title: "All'ce on part exchange" },
  { key: "deposit", x: 2190, y: 2004, size: 36, width: 255, anchor: "end", pence: { x: 2375, width: 115 }, title: "Deposit (non refundable)" },
  { key: "balance", x: 2190, y: 2097, size: 50, width: 255, anchor: "end", pence: { x: 2375, width: 115 }, title: "Balance" },
  { key: "settlementNotes", x: 1290, y: 2355, size: 36, width: 1030, title: "To be settled by" },
  { key: "mileage", x: 1465, y: 2424, size: 42, width: 900, title: "Mileage" },

  // goods taken in part exchange
  { key: "partExchangeMake", x: 165, y: 2621, size: 36, width: 610, title: "Part exchange — Make" },
  { key: "partExchangeRegistration", x: 1065, y: 2621, size: 36, width: 555, title: "Part exchange — Reg'n. No" },
  { key: "partExchangeEngine", x: 2055, y: 2621, size: 36, width: 310, title: "Part exchange — Engine No." },
  { key: "partExchangeType", x: 160, y: 2719, size: 36, width: 615, title: "Part exchange — Type" },
  { key: "partExchangeChassis", x: 1095, y: 2719, size: 36, width: 525, title: "Part exchange — Chassis No" },
  { key: "partExchangeFirstRegisteredUK", x: 2105, y: 2719, size: 36, width: 260, title: "Part exchange — First Reg'd. in U.K" },

  // certificates
  { key: "sellerCertificateDate", x: 895, y: 3094, size: 36, width: 300, title: "Seller's certificate — Date" },
  { key: "sellerCertificateAddress", x: 190, y: 3169, size: 36, width: 1000, title: "Seller's certificate — Address" },
  { key: "buyerCertificateDate", x: 1405, y: 3169, size: 36, width: 960, title: "Buyer's certificate — Date" },
];

export const VEHICLE_SALE_FIELD_KEYS = FIELDS.map((f) => f.key);

/**
 * Baseline maths. An SVG <text y="B"> sits its baseline on B; an HTML box of height L with
 * matching line-height puts its first baseline at L/2 + 0.3465·fontSize below its top (Arial
 * ascent 0.905em, descent 0.212em). Solving for top keeps every blank sitting on its rule.
 *
 * Note the font-size term is carried through to CSS rather than folded into a constant here:
 * a blank that shrinks to fit would otherwise lift its text clear of the rule, which is what
 * made the filled form look uneven from field to field.
 */
const BASELINE_K = 0.3465;

/**
 * The supplied template floats every value 9 units ABOVE its rule, while the printed caption
 * beside it sits 7 units BELOW that rule — so a filled-in value hung a third of a line clear of
 * its own label and the whole form read as misaligned. Dropping values onto their rule closes
 * that 16-unit gap: text now sits on the writing line, level with the caption, the way it would
 * if it had been typed on the paper form.
 */
const VALUE_DROP = 9;

const lineOf = (f: FieldDef) => f.lineHeight ?? f.size * 1.55;
const boxHeight = (f: FieldDef) => lineOf(f) * (f.rows ?? 1);
const leftFor = (f: FieldDef) => (f.anchor === "end" ? f.x - f.width : f.x);
/** Distance from the sheet's top to the blank's top, minus the font-size-dependent part. */
const topBase = (f: FieldDef) => f.y + VALUE_DROP - lineOf(f) / 2;

/** Smallest the source template lets a value shrink to, in artwork units. */
const MIN_SIZE = 22;

/** Shared probe: how wide a string is per 1px of font size, measured by real layout. */
const REF_PX = 100;
let probe: HTMLSpanElement | null = null;
function widthPerPx(text: string, family: string, weight: string) {
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:pre;padding:0;border:0;margin:0";
    document.body.appendChild(probe);
  }
  probe.style.fontFamily = family;
  probe.style.fontWeight = weight;
  probe.style.fontSize = `${REF_PX}px`;
  probe.textContent = text;
  return probe.getBoundingClientRect().width / REF_PX;
}

/**
 * Long values shrink to fit their blank rather than overflowing, as the source template does.
 *
 * The ratio is derived purely in artwork units — text width per em against the blank's fixed
 * unit width — so it does not depend on how wide the sheet happens to be rendered. Measuring
 * against live pixel widths made the ratio jump about whenever the sheet was resized.
 */
function useShrinkToFit(
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  def: FieldDef,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!value) { el.style.removeProperty("--vs-shrink"); return; }
    const cs = getComputedStyle(el);
    const longest = value.split("\n").reduce((a, b) => (b.length > a.length ? b : a), "");
    const neededUnits = widthPerPx(longest, cs.fontFamily, String(cs.fontWeight)) * def.size;
    if (neededUnits <= def.width) { el.style.removeProperty("--vs-shrink"); return; }
    const ratio = Math.max(MIN_SIZE / def.size, def.width / neededUnits);
    el.style.setProperty("--vs-shrink", String(ratio));
  }, [ref, value, def]);
}

function Blank({
  def, value, onChange, readOnly, suggest,
}: {
  def: FieldDef;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  suggest?: SuggestProps;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  useShrinkToFit(ref, value, def);

  // The base size is published as a custom property, NOT as `font-size` directly, so the shrink
  // effect can scale it via --vs-shrink without overwriting it. `top` subtracts the same
  // font-size-dependent term the line box adds, which pins the text's baseline to the blank's
  // rule whatever size it ends up at.
  const style = {
    position: "absolute",
    left: `calc(${leftFor(def)} * var(--ux))`,
    top: `calc(${topBase(def)} * var(--uy) - ${BASELINE_K} * var(--vs-fs) * var(--vs-shrink, 1))`,
    width: `calc(${def.width} * var(--ux))`,
    height: `calc(${boxHeight(def)} * var(--uy))`,
    "--vs-fs": `calc(${def.size} * var(--uy))`,
    lineHeight: `calc(${lineOf(def)} * var(--uy))`,
    textAlign: def.anchor === "end" ? "right" : "left",
    fontWeight: def.size === 50 ? 600 : 500,
  } as React.CSSProperties;

  const common = {
    ref: ref as any,
    className: "vs-blank",
    style,
    value,
    title: def.title,
    "aria-label": def.title,
    spellCheck: false,
    readOnly,
    tabIndex: readOnly ? -1 : undefined,
    "aria-hidden": readOnly ? true : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { onChange?.(e.target.value); if (suggest) setOpen(true); },
    onFocus: suggest ? () => setOpen(true) : undefined,
    // A value too long even at the minimum size is clipped by its blank, so scroll it back to
    // the start on the way out — otherwise the field would print from wherever the caret was.
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.target.scrollLeft = 0;
      if (suggest) setTimeout(() => setOpen(false), 120); // let a click on the list land first
    },
  };

  // wrap="off" keeps each typed line on its own printed rule — a soft wrap would slide the
  // rest of the address down onto the next rule and out of alignment.
  const field = def.rows
    ? <textarea {...common} rows={def.rows} wrap="off" />
    : <input {...common} type="text" autoComplete="off" />;

  if (!suggest || readOnly) return field;

  const showList = open && (suggest.loading || suggest.items.length > 0 || suggest.emptyHint);
  return (
    <>
      {field}
      {showList && (
        <div
          className="vs-suggest"
          style={{
            left: `calc(${leftFor(def)} * var(--ux))`,
            top: `calc(${topBase(def) + boxHeight(def)} * var(--uy))`,
            minWidth: `calc(${def.width} * var(--ux))`,
          }}
          onMouseDown={(e) => e.preventDefault()}  // keep focus so onBlur doesn't close us first
        >
          {suggest.loading && <div className="vs-suggest-note">Searching…</div>}
          {!suggest.loading && suggest.items.length === 0 && suggest.emptyHint && (
            <div className="vs-suggest-note">{suggest.emptyHint}</div>
          )}
          {suggest.items.map((it) => (
            <button key={it.id} type="button" className="vs-suggest-item"
              onClick={() => { suggest.onPick(it.id); setOpen(false); ref.current?.blur(); }}>
              <span className="vs-suggest-main">{it.label}</span>
              {it.sub && <span className="vs-suggest-sub">{it.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** The pre-printed artwork: branding, rules, captions and the fixed seller block. */
/**
 * The two name blocks swap round on a purchase. Buying a customer's car makes them the seller and
 * ELI the purchaser, so leaving the printed pad's wording would label both parties "seller" — the
 * correction Adam has been making by hand on invoice 6000.
 */
function Artwork({ kind, docKind = "sale" }: { kind: "white" | "yellow"; docKind?: DocKind }) {
  const theirs = docKind === "purchase" ? "Seller's Name" : "Purchaser's Name";
  const ours = docKind === "purchase" ? "Purchaser's Name" : "Seller's Name";
  const suffix = kind === "yellow" ? "yellow" : "white";
  return (
    <svg className="vs-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <image href={`/vehicle-sale/header-${suffix}.jpg`} x="0" y="0" width="2409" height="475" preserveAspectRatio="none" />
      <image href={`/vehicle-sale/badges-${suffix}.jpg`} x="20" y="485" width="1120" height="530" preserveAspectRatio="none" />

      {/* transaction details */}
      <text className="print-label" x="1225" y="545">No.</text>
      <line className="field-line" x1="1345" y1="538" x2="2380" y2="538" />
      <text className="print-label" x="1225" y="613">Date of transaction</text>
      <line className="field-line" x1="1655" y1="606" x2="2380" y2="606" />
      <text className="print-label" x="1225" y="675">Stock No</text>
      <line className="field-line" x1="1435" y1="668" x2="2380" y2="668" />
      <text className="print-label" x="1225" y="737">Day Book Fo</text>
      <line className="field-line" x1="1510" y1="730" x2="2380" y2="730" />
      <text className="print-label" x="1225" y="799">Salesman</text>
      <line className="field-line" x1="1435" y1="792" x2="2380" y2="792" />
      <text className="print-label" x="1225" y="861">Purchaser's Stock No</text>
      <line className="field-line" x1="1705" y1="854" x2="2380" y2="854" />
      <text className="print-label" x="1390" y="923">Day Book Fo</text>
      <line className="field-line" x1="1675" y1="916" x2="2380" y2="916" />

      {/* warranty statement */}
      <text className="small" x="24" y="1052">"All vehicles sold, come with a 6 months warranty. If you require more information please do let us know. This does not effect your statutory rights"</text>
      <line className="major-line" x1="18" y1="1074" x2="2390" y2="1074" />

      {/* purchaser */}
      <text className="print-label" x="22" y="1142">{theirs}</text>
      <line className="field-line" x1="385" y1="1135" x2="1205" y2="1135" />
      <text className="print-label" x="22" y="1225">Address</text>
      <line className="field-line" x1="185" y1="1218" x2="1205" y2="1218" />
      <line className="field-line" x1="22" y1="1290" x2="1205" y2="1290" />
      <line className="field-line" x1="22" y1="1362" x2="1205" y2="1362" />
      {/* Not on the printed pad. The postcode only ever uses the left of this rule, so the
          customer's email goes on the rest of it rather than costing the form a whole line. */}
      {/* Baseline matches the address text on this rule, not the +7 the other captions use — they
          sit to the LEFT of their rule, whereas this one is mid-line and the rule would strike
          through it. */}
      <text className="print-label" x="600" y="1353">Email</text>
      <text className="print-label" x="350" y="1425">Telephone</text>
      <line className="field-line" x1="560" y1="1418" x2="1205" y2="1418" />

      {/* seller — pre-printed, not editable */}
      <text className="print-label" x="1260" y="1142">{ours}</text>
      <line className="field-line" x1="1515" y1="1135" x2="2380" y2="1135" />
      <text className="fixed-value" x="1608" y="1126">{SELLER.name}</text>
      <text className="print-label" x="1260" y="1225">Address</text>
      <line className="field-line" x1="1420" y1="1218" x2="2380" y2="1218" />
      <text className="fixed-value" x="1450" y="1209">{SELLER.address}</text>
      <text className="print-label" x="1260" y="1300">TEL:</text>
      <line className="field-line" x1="1375" y1="1293" x2="1725" y2="1293" />
      <text className="fixed-value" x="1400" y="1284">{SELLER.telephone}</text>
      <text className="print-label" x="1760" y="1300">EMAIL:</text>
      <line className="field-line" x1="1915" y1="1293" x2="2380" y2="1293" />
      <text className="fixed-value" x="1935" y="1284">{SELLER.email}</text>
      <text className="print-label" x="1260" y="1410">V.A.T Reg'n. No.</text>
      <text className="tiny" x="1598" y="1410">(if any)</text>
      <line className="field-line" x1="1695" y1="1403" x2="2380" y2="1403" />
      <text className="fixed-value" x="1710" y="1394">{SELLER.vat}</text>

      <line className="major-line" x1="18" y1="1460" x2="2390" y2="1460" />

      {/* vehicle sold */}
      <text className="section-title" x="22" y="1545">PARTICULARS OF VEHICLE SOLD, at the Gross Price of</text>
      <text className="print-label" fontStyle="italic" x="1290" y="1545">(inclusive of V.A.T.)</text>
      <text className="section-title" x="1960" y="1545">£</text>
      <line className="solid-field-line" x1="2015" y1="1538" x2="2380" y2="1538" />
      {/* pounds/pence separator, as on every other money row of the printed form */}
      <text className="print-label" x="2220" y="1545">:</text>

      <text className="print-label" x="22" y="1620">Make</text>
      <line className="field-line" x1="170" y1="1613" x2="1205" y2="1613" />
      <text className="print-label" x="22" y="1697">Type</text>
      <line className="field-line" x1="155" y1="1690" x2="1205" y2="1690" />
      <text className="print-label" x="22" y="1774">Reg'n. No</text>
      <line className="field-line" x1="245" y1="1767" x2="1205" y2="1767" />
      <text className="print-label" x="22" y="1851">Chassis No</text>
      <line className="field-line" x1="260" y1="1844" x2="1205" y2="1844" />
      <text className="print-label" x="22" y="1928">Engine No.</text>
      <text className="tiny" x="263" y="1928">(if any)</text>
      <line className="field-line" x1="385" y1="1921" x2="1205" y2="1921" />
      <text className="print-label" x="22" y="2005">First Reg'd. in U.K.</text>
      <line className="field-line" x1="450" y1="1998" x2="1205" y2="1998" />

      <text className="print-label" textAnchor="middle" x="615" y="2082">Name &amp; Address of last Owner or Keeper,</text>
      <text className="small" textAnchor="middle" x="615" y="2137">as recorded in the vehicle registration book</text>
      <text className="small" textAnchor="middle" x="615" y="2188">(if different to Seller above)</text>
      <line className="field-line" x1="28" y1="2285" x2="1205" y2="2285" />
      <line className="field-line" x1="28" y1="2360" x2="1205" y2="2360" />
      <line className="field-line" x1="28" y1="2435" x2="1205" y2="2435" />

      {/* financial calculation */}
      <text className="print-label" x="1275" y="1625">LESS VALUE OF VEH. EXC. LICENCE</text>
      <text className="small" x="1650" y="1680">(if to be surrendered)</text>
      <text className="print-label" x="2220" y="1625">:</text>
      <line className="solid-field-line" x1="2260" y1="1618" x2="2380" y2="1618" />

      <text className="print-label" x="1315" y="1858">"</text>
      <text className="print-label" x="1390" y="1858">ALL'CE ON PART EXCHANGE</text>
      <text className="print-label" x="2220" y="1858">:</text>
      <line className="solid-field-line" x1="2260" y1="1851" x2="2380" y2="1851" />

      <text className="print-label" x="1315" y="2020">"</text>
      <text className="print-label" x="1390" y="2020">DEPOSIT (NON REFUNDABLE)</text>
      <text className="print-label" x="2220" y="2020">:</text>
      <line className="solid-field-line" x1="2260" y1="2013" x2="2380" y2="2013" />

      <text className="print-label" x="1285" y="2114">BALANCE</text>
      <text className="print-label" x="1535" y="2114">..</text>
      <text className="print-label" x="1650" y="2114">..</text>
      <text className="print-label" x="1765" y="2114">..</text>
      <text className="print-label" x="2220" y="2114">:</text>
      <line className="solid-field-line" x1="1930" y1="2107" x2="2380" y2="2107" />

      <text className="print-label" x="1285" y="2250">To be settled by:-</text>
      <text className="print-label" x="1285" y="2305">(a) CASH, before collection of vehicle</text>

      <text className="section-title" x="1260" y="2440">MILEAGE</text>
      <line className="field-line" x1="1450" y1="2433" x2="2380" y2="2433" />

      {/* part exchange */}
      <text className="section-title" x="24" y="2535">DESCRIPTION OF GOODS TAKEN IN PART EXCHANGE</text>
      <text className="print-label" x="24" y="2637">Make</text>
      <line className="field-line" x1="150" y1="2630" x2="790" y2="2630" />
      <text className="print-label" x="820" y="2637">REG'N. No</text>
      <line className="field-line" x1="1050" y1="2630" x2="1635" y2="2630" />
      <text className="print-label" x="1665" y="2637">ENGINE No.</text>
      <text className="tiny" x="1915" y="2637">(if any)</text>
      <line className="field-line" x1="2040" y1="2630" x2="2380" y2="2630" />
      <text className="print-label" x="24" y="2735">TYPE</text>
      <line className="field-line" x1="145" y1="2728" x2="790" y2="2728" />
      <text className="print-label" x="820" y="2735">CHASSIS No</text>
      <line className="field-line" x1="1080" y1="2728" x2="1635" y2="2728" />
      <text className="print-label" x="1665" y="2735">FIRST REG'D. IN U.K</text>
      <line className="field-line" x1="2090" y1="2728" x2="2380" y2="2728" />

      {/* certificates */}
      <text className="certificate-title" textAnchor="middle" x="610" y="2855">SELLER'S CERTIFICATE</text>
      <text className="legal" x="28" y="2930">I/We certify that I/we am/are the Seller/s of the above-mentioned</text>
      <text className="legal" x="28" y="2978">vehicle at the stated price. Input tax deduction has not been and will</text>
      <text className="legal" x="28" y="3026">not be claimed by me/us in respect of the car sold on this invoice.</text>
      <text className="legal" x="28" y="3110" fontStyle="italic">Signature</text>
      <line className="signature-line" x1="180" y1="3103" x2="740" y2="3103" />
      <text className="legal" x="770" y="3110" fontStyle="italic">Date</text>
      <line className="signature-line" x1="880" y1="3103" x2="1205" y2="3103" />
      <text className="legal" x="28" y="3185" fontStyle="italic">Address</text>
      <line className="signature-line" x1="175" y1="3178" x2="1205" y2="3178" />
      <line className="signature-line" x1="28" y1="3240" x2="1205" y2="3240" />

      <text className="certificate-title" textAnchor="middle" x="1880" y="2855">BUYER'S CERTIFICATE</text>
      <text className="legal" x="1290" y="2948">I/we certify that I/We am/are the buyer/s of the above-mentioned vehicle</text>
      <text className="legal" x="1290" y="2996">at the stated price.</text>
      <text className="legal" x="1290" y="3110" fontStyle="italic">Signature</text>
      <line className="signature-line" x1="1455" y1="3103" x2="2380" y2="3103" />
      <text className="legal" x="1290" y="3185" fontStyle="italic">Date</text>
      <line className="signature-line" x1="1390" y1="3178" x2="2380" y2="3178" />

      <text className="legal" textAnchor="middle" x="1205" y="3305">
        <tspan fontWeight="800">IMPORTANT:</tspan> The copy invoice should be separately signed and dated by Seller and Purchaser.
      </text>
      <FooterBand />
    </svg>
  );
}

/**
 * Footer band, drawn rather than scanned. The supplied `footer-*.jpg` strip was cropped through
 * the band AND through the address text on it, so "49 VICTORIA ROAD…" printed with its lower
 * third sliced off and the pixels simply weren't in the file to recover. Redrawn from the strip's
 * own measured geometry (arrow tip x≈1241, orange #F4513A, blue #4A5F9A) and set in the same
 * condensed face as the form's captions, so it is legible and stays crisp at print resolution.
 */
const FOOTER_Y = 3364;
const FOOTER_H = H - FOOTER_Y;
function FooterBand() {
  const y = FOOTER_Y;
  return (
    <g className="vs-footer">
      <rect x="0" y={y} width={W} height={FOOTER_H} fill="#4A5F9A" />
      {/* orange half, ending in the rightward arrow the original band has */}
      <polygon points={`0,${y} 1202,${y} 1249,${y + 50} 1222,${y + FOOTER_H} 0,${y + FOOTER_H}`} fill="#F4513A" />
      <text className="footer-text" x="40" y={y + 64} textLength="970" lengthAdjust="spacingAndGlyphs">
        49 VICTORIA ROAD HENDON LONDON NW4 2RP
      </text>
      <text className="footer-text" x="1290" y={y + 64} textLength="1078" lengthAdjust="spacingAndGlyphs">
        TEL : 0208 203 6449 EMAIL : ELI@ELIMOTORS.CO.UK
      </text>
    </g>
  );
}

/** A signature drawn or uploaded elsewhere, laid into its box on the certificate. */
function Signature({ src, box }: { src?: string; box: { x: number; y: number; w: number; h: number } }) {
  if (!src) return null;
  return (
    <img
      className="vs-signature"
      src={src}
      alt=""
      style={{
        position: "absolute",
        left: `calc(${box.x} * var(--ux))`,
        top: `calc(${box.y} * var(--uy))`,
        width: `calc(${box.w} * var(--ux))`,
        height: `calc(${box.h} * var(--uy))`,
      }}
    />
  );
}

/**
 * Buying a car in uses the same pre-printed form as selling one, and on a purchase the
 * "Name & Address of last Owner or Keeper" block has nothing to say — the person signing IS the
 * last keeper. It gets crossed out and marked PURCHASE by hand (see invoice 6185); this does the
 * same in print, so the block can't be filled in by mistake either.
 */
function PurchaseStamp() {
  const def = FIELDS.find((f) => f.key === "lastOwnerDetails")!;
  const h = lineOf(def) * (def.rows ?? 1);
  return (
    <div
      className="vs-purchase-stamp"
      style={{
        left: `calc(${def.x - 13} * var(--ux))`,
        top: `calc(${topBase(def)} * var(--uy))`,
        width: `calc(${def.width + 26} * var(--ux))`,
        height: `calc(${h} * var(--uy))`,
        fontSize: `calc(58 * var(--uy))`,
      }}
    >
      PURCHASE
    </div>
  );
}

/**
 * "1,000.50" -> ["1,000", "50"]. Splits on the LAST separator so thousands commas — and a value
 * typed with the form's own colon, "1000:50" — both come apart correctly.
 */
function splitMoney(v: string): [string, string] {
  const s = String(v ?? "").trim();
  const m = s.match(/^(.*)[.:](\d{0,2})$/);
  return m ? [m[1], m[2]] : [s, ""];
}
/** Pence are only appended when there are some, so "1000" stays "1000" rather than "1000.". */
function joinMoney(pounds: string, pence: string): string {
  const p = pounds.trim(), c = pence.trim();
  return c ? `${p}.${c}` : p;
}

/**
 * A money row, written across the pre-printed colon: pounds on the left, pence on the short rule
 * to the right. Both halves edit the one stored value, so nothing downstream sees two fields.
 */
function MoneyBlank({
  def, value, onChange, readOnly,
}: {
  def: FieldDef; value: string; onChange?: (v: string) => void; readOnly?: boolean;
}) {
  const [pounds, pence] = splitMoney(value);
  const penceDef: FieldDef = {
    ...def, x: def.pence!.x, width: def.pence!.width, anchor: "end",
    title: `${def.title} — pence`, pence: undefined,
  };
  return (
    <>
      <Blank def={def} value={pounds} readOnly={readOnly}
        onChange={onChange && ((v) => onChange(joinMoney(v, pence)))} />
      <Blank def={penceDef} value={pence} readOnly={readOnly}
        onChange={onChange && ((v) => onChange(joinMoney(pounds, v)))} />
    </>
  );
}

function Page({
  kind, values, onChange, suggestFor, suggest, docKind = "sale",
}: {
  kind: "white" | "yellow";
  values: VehicleSaleValues;
  onChange?: (key: string, v: string) => void;
  suggestFor?: string;
  suggest?: SuggestProps;
  docKind?: DocKind;
}) {
  const readOnly = kind === "yellow";
  const purchase = docKind === "purchase";
  return (
    <div className="vs-page" data-kind={kind}>
      <Artwork kind={kind} docKind={docKind} />
      {FIELDS
        .filter((f) => !(purchase && f.key === "lastOwnerDetails"))
        // On a purchase the other party is the seller, so the labels on their block follow the
        // printed captions rather than still reading "Purchaser's".
        .map((f) => (purchase && f.title.startsWith("Purchaser's")
          ? { ...f, title: f.title.replace("Purchaser's", "Seller's") }
          : f))
        .map((f) => (
        f.pence ? (
          <MoneyBlank
            key={f.key}
            def={f}
            value={values[f.key] ?? ""}
            onChange={readOnly ? undefined : (v) => onChange?.(f.key, v)}
            readOnly={readOnly}
          />
        ) : (
          <Blank
            key={f.key}
            def={f}
            value={values[f.key] ?? ""}
            onChange={readOnly ? undefined : (v) => onChange?.(f.key, v)}
            readOnly={readOnly}
            suggest={!readOnly && f.key === suggestFor ? suggest : undefined}
          />
        )
      ))}
      {purchase && <PurchaseStamp />}
      <Signature src={values.sellerSignature} box={{ x: 185, y: 3025, w: 545, h: 95 }} />
      <Signature src={values.buyerSignature} box={{ x: 1460, y: 3025, w: 900, h: 95 }} />
    </div>
  );
}

export default function VehicleSaleForm({
  values, onChange, suggestFor, suggest, docKind = "sale",
}: {
  values: VehicleSaleValues;
  onChange?: (key: string, v: string) => void;
  /** Field key to attach a type-ahead to (e.g. "purchaserName"). */
  suggestFor?: string;
  suggest?: SuggestProps;
  /** 'purchase' strikes out the last-owner block — see PurchaseStamp. */
  docKind?: DocKind;
}) {
  // No resize handling: every blank's geometry and its shrink ratio are expressed in artwork
  // units, so the whole sheet is scale-invariant and nothing needs re-measuring when it resizes.
  return (
    <div className="vs-shell">
      <style>{`
        .vs-shell {
          container-type: inline-size;
          width: 100%;
          max-width: 210mm;
          margin: 0 auto;
          /* One artwork unit, horizontally and vertically. The sheet is exactly as wide as its
             container and A4-proportioned, so 100cqw is 210mm on paper. */
          --ux: calc(100cqw / ${W});
          --uy: calc(100cqw * ${A4_RATIO} / ${H});
        }
        .vs-page {
          position: relative;
          width: calc(${W} * var(--ux));
          height: calc(${H} * var(--uy));
          background: #fff;
          overflow: hidden;
          box-shadow: 0 2px 16px rgba(0,0,0,.22);
          margin-bottom: 16px;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .vs-page[data-kind="yellow"] { background: #fafbbb; }
        .vs-art { position: absolute; inset: 0; width: 100%; height: 100%; }

        .vs-art .print-label, .vs-art .small, .vs-art .tiny,
        .vs-art .section-title, .vs-art .certificate-title, .vs-art .legal, .vs-art .fixed-value {
          fill: #202020;
          font-family: "Liberation Sans Narrow", "Arial Narrow", "Roboto Condensed", Arial, sans-serif;
        }
        .vs-art .print-label { font-size: 43px; font-weight: 700; }
        .vs-art .fixed-value { font-size: 35px; font-weight: 700; }
        .vs-art .small { font-size: 33px; font-weight: 700; }
        .vs-art .tiny { font-size: 27px; font-weight: 700; }
        .vs-art .section-title { font-size: 45px; font-weight: 800; }
        .vs-art .certificate-title { font-size: 40px; font-weight: 800; text-decoration: underline; }
        .vs-art .legal { font-size: 31px; font-weight: 700; }
        .vs-art .major-line { stroke: #2b2b2b; stroke-width: 4; }
        .vs-art .field-line { stroke: #333; stroke-width: 2.6; stroke-dasharray: 2 8; stroke-linecap: round; }
        .vs-art .solid-field-line { stroke: #333; stroke-width: 2.6; }
        .vs-art .signature-line { stroke: #333; stroke-width: 2.2; stroke-dasharray: 2 7; stroke-linecap: round; }
        .vs-art .footer-text {
          fill: #fff; font-size: 77px; font-weight: 700; letter-spacing: 1px;
          font-family: "Liberation Sans Narrow", "Arial Narrow", "Roboto Condensed", Arial, sans-serif;
        }

        .vs-blank {
          margin: 0; padding: 0; border: 0; outline: 0; resize: none; overflow: hidden;
          background: transparent; color: #111;
          font-family: Arial, Helvetica, sans-serif;
          font-size: calc(var(--vs-fs) * var(--vs-shrink, 1));
          white-space: pre;
          border-radius: calc(6 * var(--uy));
        }
        .vs-blank:not([readonly]):hover { background: rgba(99,102,241,.07); }
        .vs-blank:focus { background: rgba(99,102,241,.13); }
        .vs-signature { object-fit: contain; object-position: center; }

        /* PURCHASE across the last-owner block. Prints as well as shows: the grey has to survive
           on paper, which is why it carries print-color-adjust like the coloured bands do. */
        .vs-purchase-stamp {
          position: absolute;
          display: flex; align-items: center; justify-content: center;
          background: rgba(15,23,42,.07);
          border: calc(3 * var(--uy)) solid rgba(15,23,42,.35);
          border-radius: calc(8 * var(--uy));
          color: #4b5563;
          font-family: "Liberation Sans Narrow", "Arial Narrow", "Roboto Condensed", Arial, sans-serif;
          font-weight: 800; letter-spacing: .22em; text-indent: .22em;
          user-select: none; pointer-events: none;
          print-color-adjust: exact; -webkit-print-color-adjust: exact;
        }

        /* Type-ahead — screen affordance only, never printed. Sized in px, not artwork units,
           so it stays legible however small the sheet is rendered. */
        .vs-suggest {
          position: absolute; z-index: 20; max-height: 240px; overflow-y: auto;
          background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
          box-shadow: 0 8px 24px rgba(15,23,42,.16); padding: 4px; font-family: system-ui, sans-serif;
        }
        .vs-suggest-note { padding: 6px 8px; font-size: 12px; color: #64748b; }
        .vs-suggest-item {
          display: block; width: 100%; text-align: left; border: 0; background: transparent;
          padding: 5px 8px; border-radius: 4px; cursor: pointer;
        }
        .vs-suggest-item:hover { background: #f1f5f9; }
        .vs-suggest-main { display: block; font-size: 13px; font-weight: 600; color: #1e293b; }
        .vs-suggest-sub { display: block; font-size: 11px; color: #64748b; }

        @media print {
          /* Exact A4, edge to edge. Both dimensions are pinned rather than left to the aspect
             ratio: 3438/2409 is 1.42714..., very slightly taller than A4's 1.41421, so a sheet
             sized only by width came out ~2.7mm too tall and lost its bottom edge. Setting the
             height explicitly squares that off and fills the paper exactly.
             Needs "borderless" or "scale to fit: none/100%" in the print dialog — a printer
             without borderless will still clip its own few mm, which no CSS can change. */
          @page { size: A4 portrait; margin: 0; }
          .vs-shell {
            width: 210mm; max-width: none; margin: 0;
            --ux: calc(210mm / 2409);
            --uy: calc(297mm / 3438);
          }
          .vs-page {
            box-shadow: none; margin: 0;
            width: 210mm; height: 297mm;
            break-after: page; page-break-after: always;
          }
          .vs-page:last-child { break-after: auto; page-break-after: auto; }
          .vs-blank, .vs-blank:hover, .vs-blank:focus { background: transparent !important; }
          .vs-suggest { display: none !important; }
        }
      `}</style>
      <Page kind="white" values={values} onChange={onChange} suggestFor={suggestFor} suggest={suggest} docKind={docKind} />
      <Page kind="yellow" values={values} docKind={docKind} />
    </div>
  );
}
