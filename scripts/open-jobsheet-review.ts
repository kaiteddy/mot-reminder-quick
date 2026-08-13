/**
 * A printed sheet for going through the open job cards by hand.
 *
 * These are the ones nothing in the data can settle: opened, never priced, and no invoice for
 * that car since. Whether each is a live job, a customer who declined, or one that was simply
 * forgotten is knowledge that only Adam has — so the job here is to lay them out clearly with
 * room to write, not to guess.
 *
 * Ordered oldest first, because age is the best proxy for "this is never coming back".
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "scripts", "open-job-cards-review.pdf");

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  // Unpriced, older than a fortnight, and with no invoice raised for that car since — the ones
  // that need a human. Cars that WERE invoiced afterwards are excluded: those are already answered.
  const rows: any = await db.execute(sql`
    SELECT s.id, s."docNo", s.registration reg, s."dateCreated" raw,
           to_char(s."dateCreated",'DD/MM/YYYY') dt,
           COALESCE(NULLIF(s."customerName",''), c.name) cust,
           COALESCE(s."custTelephone", s."custMobile", c.phone) tel,
           v.make, v.model,
           s.description descr,
           (now()::date - s."dateCreated"::date) age
    FROM "serviceHistory" s
    LEFT JOIN customers c ON c.id = s."customerId"
    LEFT JOIN vehicles v ON v.id = s."vehicleId"
    WHERE s."docType" = 'JS'
      AND s."dateCreated" < now() - interval '14 days'
      AND COALESCE(s."totalGross",0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM "serviceHistory" i
        WHERE i."docType" IN ('SI','XS')
          AND REPLACE(UPPER(i.registration),' ','') = REPLACE(UPPER(s.registration),' ','')
          AND i."dateCreated" >= s."dateCreated" - interval '2 days')
    ORDER BY s."dateCreated"`);

  mkdirSync(join(process.cwd(), "scripts"), { recursive: true });
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  doc.pipe(createWriteStream(OUT));

  const PW = doc.page.width, M = 36, CW = PW - M * 2;
  const BLUE = "#0a2342", GREY = "#6b7280", LINE = "#d1d5db";
  let page = 1;

  const header = () => {
    doc.font("Helvetica-Bold").fontSize(15).fillColor(BLUE).text("Open Job Cards — for review", M, M);
    doc.font("Helvetica").fontSize(9).fillColor(GREY)
      .text(`${rows.rows.length} job cards opened over a fortnight ago, never priced, and with no invoice raised for that car since.`, M, M + 20, { width: CW });
    doc.text(`Printed ${new Date().toLocaleDateString("en-GB")}   ·   ELI MOTORS LTD`, M, M + 32);
    doc.save().strokeColor(BLUE).lineWidth(1.2).moveTo(M, M + 48).lineTo(PW - M, M + 48).stroke().restore();
    // Column captions for the tick boxes, so the sheet explains itself at the counter.
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GREY);
    doc.text("CLOSE", PW - M - 132, M + 54, { width: 40, align: "center" });
    doc.text("INVOICE", PW - M - 90, M + 54, { width: 44, align: "center" });
    doc.text("CHASE", PW - M - 44, M + 54, { width: 40, align: "center" });
    return M + 66;
  };

  const footer = () => {
    doc.font("Helvetica").fontSize(7).fillColor("#9ca3af")
      .text(`Page ${page}`, M, doc.page.height - 26, { width: CW, align: "center", lineBreak: false });
  };

  let y = header();

  for (const r of rows.rows) {
    const car = [r.make, r.model].filter(Boolean).join(" ");
    const work = String(r.descr || "").replace(/\*\*/g, "").replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").trim()
      || "(nothing written on the card)";

    doc.font("Helvetica").fontSize(8.5);
    const workH = doc.heightOfString(work, { width: CW - 150 - 44 });
    // The make/model caption sits BELOW the work text, so the row has to allow for it too —
    // without it, a long write-up pushed the model line into the next card's registration.
    const carH = car ? 10 : 0;
    const rowH = Math.max(34, Math.ceil(workH) + carH + 24);

    if (y + rowH > doc.page.height - 40) { footer(); doc.addPage(); page++; y = header(); }

    // Age first — it's the thing that decides most of these.
    doc.font("Helvetica-Bold").fontSize(9).fillColor(BLUE)
      .text(`${r.docNo}`, M, y, { width: 42, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1f2937")
      .text(String(r.reg || "—"), M + 44, y, { width: 66, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(GREY)
      .text(`${r.dt}  ·  ${r.age} days open`, M + 112, y + 1, { width: 110, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor("#1f2937")
      .text([r.cust, r.tel].filter(Boolean).join("  ·  ") || "—", M + 224, y + 1, { width: CW - 224 - 140, lineBreak: false });

    doc.font("Helvetica").fontSize(8.5).fillColor("#374151")
      .text(work, M + 44, y + 14, { width: CW - 150 - 44 });
    if (car) doc.font("Helvetica").fontSize(7.5).fillColor("#9ca3af").text(car, M + 44, y + 14 + workH + 1, { width: 200, lineBreak: false });

    // Three boxes to tick, and a line to write on.
    for (let i = 0; i < 3; i++) {
      doc.save().roundedRect(PW - M - 122 + i * 44, y + 1, 11, 11, 2).strokeColor("#9ca3af").lineWidth(0.8).stroke().restore();
    }
    doc.save().strokeColor("#e5e7eb").lineWidth(0.5)
      .moveTo(PW - M - 132, y + 22).lineTo(PW - M, y + 22).stroke().restore();

    doc.save().strokeColor(LINE).lineWidth(0.4).moveTo(M, y + rowH - 5).lineTo(PW - M, y + rowH - 5).stroke().restore();
    y += rowH;
  }

  footer();
  doc.end();
  await new Promise((res) => setTimeout(res, 600));
  console.log(`WROTE ${OUT}  (${rows.rows.length} job cards, ${page} page${page === 1 ? "" : "s"})`);
  process.exit(0);
}

main();
