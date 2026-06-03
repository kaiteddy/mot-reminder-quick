/**
 * Print-ready ELI Motors document (Estimate / Job Sheet / Invoice) — a faithful
 * replica of the GA4 printed layout, driven from a saved document's data.
 * Rendered off-screen and printed via react-to-print.
 */
const TYPE_TITLE: Record<string, string> = {
  SI: "Invoice", ES: "Estimate", JS: "Job Sheet", CR: "Credit Note",
  XS: "Excess", PA: "Payment", VS: "Vehicle Sale", VP: "Vehicle Purchase",
};
const COMPANY = {
  name: "ELI MOTORS LIMITED",
  address: "49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP",
  phone: "020 8203 6449, Sales 07950 250970",
  web: "www.elimotors.co.uk",
  vat: "330 9339 65",
};

const gbp = (v: any) => (v == null || v === "" ? "0.00" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const d = (x: any) => (x ? new Date(x).toLocaleDateString("en-GB") : "");

export default function PrintableDocument({ doc, vehicle, customer, lineItems = [] }: { doc: any; vehicle?: any; customer?: any; lineItems?: any[] }) {
  if (!doc) return null;
  const title = TYPE_TITLE[doc.docType] || "Job Sheet";
  const isEstimate = doc.docType === "ES";
  const isInvoice = doc.docType === "SI" || doc.docType === "CR";
  const isJobSheet = doc.docType === "JS";

  const labour = lineItems.filter((i) => i.itemType === "Labour");
  const parts = lineItems.filter((i) => i.itemType === "Part");
  const advisories = lineItems.filter((i) => i.itemType === "Other");

  const addressLines = [doc.custHouseNo && doc.custRoad ? `${doc.custHouseNo} ${doc.custRoad}` : doc.custRoad, doc.custLocality, doc.custTown, doc.custCounty]
    .filter(Boolean);
  if (addressLines.length === 0 && customer?.address) addressLines.push(...String(customer.address).split(",").map((s: string) => s.trim()).filter(Boolean));
  const postcode = doc.custPostcode || customer?.postcode;
  const phone = doc.custMobile || doc.custTelephone || customer?.phone;
  const custName = doc.customerName || customer?.name || "";

  const subLabour = Number(doc.subLabourNet) || labour.reduce((a, i) => a + (Number(i.subNet) || 0), 0);
  const subParts = Number(doc.subPartsNet) || parts.reduce((a, i) => a + (Number(i.subNet) || 0), 0);
  const subMot = Number(doc.subMotGross) || 0;
  const hasMot = subMot > 0 || !!doc.motStatus || !!doc.motClass;

  const ItemTable = ({ heading, rows }: { heading: string; rows: any[] }) => (
    <table className="lines">
      <thead><tr><th className="l">{heading}</th><th className="c w-q">Qty</th><th className="r w-u">Unit</th><th className="c w-d">D</th><th className="r w-s">Sub Total</th></tr></thead>
      <tbody>
        {rows.map((i, idx) => (
          <tr key={idx}>
            <td>{[i.partNumber, i.description].filter(Boolean).join(" — ") || "—"}</td>
            <td className="c">{i.quantity ?? ""}</td>
            <td className="r">{gbp(i.unitPrice)}</td>
            <td className="c">{i.discount ? gbp(i.discount) : ""}</td>
            <td className="r">{gbp(i.subNet)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="eli-doc">
      <style>{`
        .eli-doc { width: 210mm; min-height: 297mm; box-sizing: border-box; padding: 12mm 13mm; background:#fff; color:#1a1a1a;
          font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
        .eli-doc * { box-sizing: border-box; }
        .hdr { display:flex; justify-content:space-between; align-items:flex-start; }
        .hdr h1 { font-size: 27px; font-weight: 800; margin:0 0 8px; letter-spacing:-0.5px; }
        .hdr p { margin:1px 0; font-size:11px; }
        .hdr .vat { margin-top:3px; }
        .hdr img { height: 78px; width:auto; }
        .cd { display:flex; justify-content:space-between; margin-top: 30px; }
        .cust { padding-left: 40px; font-size: 12px; line-height: 1.45; }
        .cust .nm { font-weight: 700; }
        .doc { width: 300px; }
        .doc .t { display:flex; justify-content:space-between; align-items:baseline; }
        .doc .t .ti { font-size: 19px; font-weight: 800; }
        .doc .t .no { font-size: 19px; font-weight: 800; }
        .doc .row { display:flex; justify-content:space-between; font-size:12px; line-height:1.55; }
        .doc .row .v { font-weight:600; }
        table { width:100%; border-collapse: collapse; }
        .veh { margin-top: 22px; }
        .veh th { background:#e9ebee; color:#5a6470; font-weight:500; border:1px solid #d4d7db; padding:5px; text-align:center; font-size:11px; }
        .veh td { border:1px solid #d4d7db; padding:5px; text-align:center; font-size:12px; }
        .veh td.big { font-size:14px; font-weight:800; }
        .diag { display:flex; gap:10px; margin-top:16px; }
        .diag .car { width:210px; border:1px solid #e2e4e7; display:flex; align-items:center; justify-content:center; padding:8px; }
        .diag .notes { flex:1; border:1px solid #e2e4e7; position:relative; }
        .diag .notes span { position:absolute; top:8px; right:12px; color:#cbd0d6; font-size:18px; }
        .desc { margin-top:18px; }
        .desc .h { font-weight:700; margin-top:10px; }
        .desc ul { margin:4px 0 4px 4px; padding-left:14px; }
        .desc li { margin:1px 0; }
        .lines { margin-top:16px; }
        .lines th { background:#e9ebee; color:#5a6470; font-weight:500; border-top:1px solid #d4d7db; border-bottom:1px solid #d4d7db; padding:5px 7px; font-size:11px; }
        .lines th.l, .lines td.l { text-align:left; }
        .lines th.c, .lines td.c { text-align:center; }
        .lines th.r, .lines td.r { text-align:right; }
        .lines td { padding:4px 7px; border-bottom:1px solid #eef0f2; font-size:11px; }
        .w-q{width:50px} .w-u{width:80px} .w-d{width:50px} .w-s{width:90px}
        .mot th { background:#e9ebee; color:#5a6470; font-weight:500; border-top:1px solid #d4d7db; border-bottom:1px solid #d4d7db; padding:5px 7px; }
        .mot td { padding:4px 7px; border-bottom:1px solid #eef0f2; }
        .totals { display:flex; justify-content:flex-end; margin-top:22px; }
        .totals .box { width: 290px; }
        .totals .r { display:flex; justify-content:space-between; padding:4px 8px; font-size:12px; }
        .totals .r .v { border:1px solid #e2e4e7; min-width:110px; text-align:right; padding:1px 6px; margin-left:8px; }
        .totals .b { font-weight:800; background:#f7f8fa; }
        .ftr { border-top:1px solid #e2e4e7; margin-top:40px; padding-top:6px; font-size:9px; color:#9aa1a9; text-align:center; }
        @media print { @page { size: A4; margin: 0; } body { margin:0; } }
      `}</style>

      {/* header */}
      <div className="hdr">
        <div className="company">
          <h1>{COMPANY.name}</h1>
          <p>{COMPANY.address}</p>
          <p>{COMPANY.phone}</p>
          <p>{COMPANY.web}</p>
          <p className="vat" style={{ fontWeight: 700 }}>VAT {COMPANY.vat}</p>
        </div>
        <img src="/logo.png" alt="ELI Motors" />
      </div>

      {/* customer + doc meta */}
      <div className="cd">
        <div className="cust">
          {custName && <div className="nm">{custName}</div>}
          {addressLines.map((l, i) => <div key={i}>{l}</div>)}
          {postcode && <div>{postcode}</div>}
          {phone && <div style={{ marginTop: 8 }}>{doc.custMobile ? "Mobile: " : "Tel: "}{phone}</div>}
        </div>
        <div className="doc">
          <div className="t"><span className="ti">{title}</span><span className="no">{doc.docNo}</span></div>
          <div style={{ height: 10 }} />
          <div className="row"><span>{title} Date:</span><span className="v">{d(doc.dateIssued || doc.dateCreated)}</span></div>
          <div className="row"><span>Account No:</span><span className="v">{doc.accountNumber || ""}</span></div>
          <div className="row"><span>Order Ref:</span><span className="v">{doc.orderRef || ""}</span></div>
          {isEstimate && <div className="row"><span>Estimate Valid to:</span><span className="v">{doc.dateCreated ? d(new Date(new Date(doc.dateCreated).getTime() + 30 * 864e5)) : ""}</span></div>}
          {isInvoice && <>
            <div className="row"><span>Date of Work:</span><span className="v">{d(doc.dateCreated)}</span></div>
            <div className="row"><span>Payment Date:</span><span className="v">{d(doc.datePaid)}</span></div>
            <div className="row"><span>Payment Method:</span><span className="v">{doc.paymentMethods || ""}</span></div>
          </>}
        </div>
      </div>

      {/* vehicle table */}
      <table className="veh">
        <thead><tr><th>Registration</th><th>Make</th><th>Model</th><th>Chassis Number</th><th>Mileage</th></tr></thead>
        <tbody>
          <tr>
            <td className="big">{vehicle?.registration || doc.registration || "-"}</td>
            <td>{vehicle?.make || "-"}</td>
            <td>{vehicle?.model || "-"}</td>
            <td style={{ fontSize: 10 }}>{vehicle?.vin || "-"}</td>
            <td className="big">{doc.mileage ? Number(doc.mileage).toLocaleString("en-GB") : "0"}</td>
          </tr>
          <tr><th>Engine No</th><th>Engine Code</th><th>Engine CC</th><th>Date Reg</th><th>Colour</th></tr>
          <tr>
            <td>{vehicle?.engineNo || "-"}</td><td>{vehicle?.engineCode || "-"}</td><td>{vehicle?.engineCC || "-"}</td>
            <td>{d(vehicle?.dateOfRegistration) || "-"}</td><td>{vehicle?.colour || "-"}</td>
          </tr>
        </tbody>
      </table>

      {/* car diagram + notes (estimate / job sheet) */}
      {(isEstimate || isJobSheet) && (
        <div className="diag">
          <div className="car">
            <svg width="180" height="110" viewBox="0 0 180 110">
              <rect x="35" y="18" width="110" height="74" rx="34" fill="none" stroke="#3a3f45" strokeWidth="2" />
              <line x1="60" y1="30" x2="120" y2="30" stroke="#3a3f45" strokeWidth="1.5" />
              <line x1="60" y1="80" x2="120" y2="80" stroke="#3a3f45" strokeWidth="1.5" />
              {[[35, 28], [145, 28], [35, 82], [145, 82]].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="11" fill="#fff" stroke="#1a1a1a" strokeWidth="4" />
              ))}
            </svg>
          </div>
          <div className="notes"><span>Notes</span></div>
        </div>
      )}

      {/* description */}
      {doc.description && (
        <div className="desc">
          {String(doc.description).split("\n").reduce((acc: any[], line: string, i: number) => {
            const t = line.trim();
            if (t.startsWith("-") || t.startsWith("•")) {
              const last = acc[acc.length - 1];
              if (last?.type === "ul") last.items.push(t.replace(/^[-•]\s*/, ""));
              else acc.push({ type: "ul", items: [t.replace(/^[-•]\s*/, "")] });
            } else if (t) acc.push({ type: "h", text: t });
            return acc;
          }, []).map((b: any, i: number) => b.type === "h"
            ? <div className="h" key={i}>{b.text}</div>
            : <ul key={i}>{b.items.map((it: string, j: number) => <li key={j}>{it}</li>)}</ul>)}
        </div>
      )}

      {/* MOT */}
      {hasMot && (
        <table className="mot lines">
          <thead><tr><th className="l">MOT</th><th className="c w-q">Qty</th><th className="r w-s">Status</th></tr></thead>
          <tbody><tr><td>Carry Out MOT Test{doc.motClass ? ` (${doc.motClass})` : ""}</td><td className="c">1</td><td className="r">{doc.motStatus || ""}</td></tr></tbody>
        </table>
      )}

      {labour.length > 0 && <ItemTable heading="Labour" rows={labour} />}
      {parts.length > 0 && <ItemTable heading="Parts" rows={parts} />}
      {advisories.length > 0 && (
        <div className="desc"><div className="h">Advisories</div><ul>{advisories.map((a, i) => <li key={i}>{a.description}</li>)}</ul></div>
      )}

      {/* totals */}
      <div className="totals">
        <div className="box">
          {subLabour > 0 && <div className="r"><span>Labour</span><span className="v">{gbp(subLabour)}</span></div>}
          {subParts > 0 && <div className="r"><span>Parts</span><span className="v">{gbp(subParts)}</span></div>}
          <div className="r b"><span>SubTotal</span><span className="v">{gbp(doc.totalNet)}</span></div>
          {subMot > 0 && <div className="r"><span>MOT</span><span className="v">{gbp(subMot)}</span></div>}
          <div className="r"><span>VAT (20%)</span><span className="v">{gbp(doc.totalTax)}</span></div>
          <div className="r b"><span>Total</span><span className="v">{gbp(doc.totalGross)}</span></div>
          <div className="r b"><span>Balance</span><span className="v">{gbp(doc.balance ?? doc.totalGross)}</span></div>
        </div>
      </div>

      <div className="ftr">Thank you for your business · {COMPANY.name} · {COMPANY.web}</div>
    </div>
  );
}
