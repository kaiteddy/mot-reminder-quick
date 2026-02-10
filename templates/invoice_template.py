"""
ELI MOTORS LIMITED - Invoice PDF Template
With proper multi-page flow — header redrawn on every new page.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, black
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle, Paragraph
from reportlab.lib.styles import ParagraphStyle
from eli_helpers import (
    HEADER_BG, BORDER_COLOR,
    find_image, draw_company_header, draw_customer_and_doc,
    check_page_break, vehicle_table_style, data_table_style_commands,
    build_vehicle_data, VEHICLE_COL_WIDTHS_RATIOS, tc_text
)


def _full_header(c, data, w, h, left_margin, right_margin, page_width):
    """Redraw full header + customer + invoice details. Returns y."""
    top = draw_company_header(c, data, w, h, left_margin, right_margin)
    inv = data['invoice']
    details = [
        ("Invoice Date:", inv.get('invoice_date', '')),
        ("Account No:", inv.get('account_no', '')),
        ("Order Ref:", inv.get('order_ref', '')),
        ("Date of Work", inv.get('date_of_work', '')),
        ("Payment Date:", inv.get('payment_date', '')),
        ("Payment Method:", inv.get('payment_method', '')),
    ]
    return draw_customer_and_doc(c, data, top, left_margin, right_margin,
                                'Invoice', inv['number'], details)


def _page_break(c, y, needed, data, w, h, lm, rm, pw):
    return check_page_break(c, y, needed, data, w, h, lm, rm, pw,
                            redraw_header_fn=_full_header)


def generate_invoice(output_path, data):
    w, h = A4
    c = canvas.Canvas(output_path, pagesize=A4)
    left_margin = 30
    right_margin = w - 30
    page_width = right_margin - left_margin

    # ── Header ────────────────────────────────────────────────
    y = _full_header(c, data, w, h, left_margin, right_margin, page_width)

    # ── Vehicle Table ─────────────────────────────────────────
    col_widths = [page_width * r for r in VEHICLE_COL_WIDTHS_RATIOS]
    vt = Table(build_vehicle_data(data['vehicle']), colWidths=col_widths)
    vt.setStyle(vehicle_table_style())
    _, vt_h = vt.wrap(page_width, 200)
    y = _page_break(c, y, vt_h, data, w, h, left_margin, right_margin, page_width)
    vt.drawOn(c, left_margin, y - vt_h)
    y -= vt_h

    # ── GAP between vehicle section and work description ──────
    y -= 30

    # ── Work Description ──────────────────────────────────────
    if data.get('work_title'):
        y = _page_break(c, y, 20, data, w, h, left_margin, right_margin, page_width)
        c.setFont("Helvetica-Bold", 10)
        title = data['work_title']
        tw = c.stringWidth(title, "Helvetica-Bold", 10)
        c.drawString(left_margin, y, title)
        c.setLineWidth(0.5)
        c.line(left_margin, y - 2, left_margin + tw, y - 2)
        y -= 16

    c.setFont("Helvetica", 9)
    for item in data.get('work_items', []):
        y = _page_break(c, y, 14, data, w, h, left_margin, right_margin, page_width)
        c.drawString(left_margin, y, f"- {item}")
        y -= 13

    y -= 10

    # ── MOT Table (optional) ──────────────────────────────────
    if data.get('mot'):
        mot_cw = [page_width * 0.72, page_width * 0.14, page_width * 0.14]
        mot_rows = [['MOT', 'Qty', 'Status']]
        for item in data['mot']:
            mot_rows.append([item['description'], str(item.get('qty', '')), str(item.get('status', ''))])
        mt = Table(mot_rows, colWidths=mot_cw)
        style = data_table_style_commands()
        # Override alignment for MOT: center cols 1+2 in data rows
        style_copy = list(style)
        style_copy[6] = ('ALIGN', (1, 1), (-1, -1), 'CENTER')
        mt.setStyle(TableStyle(style_copy))
        _, mt_h = mt.wrap(page_width, 200)
        y = _page_break(c, y, mt_h, data, w, h, left_margin, right_margin, page_width)
        mt.drawOn(c, left_margin, y - mt_h)
        y = y - mt_h - 8

    # ── Labour Table ──────────────────────────────────────────
    lcw = [page_width * r for r in [0.52, 0.10, 0.14, 0.10, 0.14]]
    labour_rows = [['Labour', 'Qty', 'Unit', 'D', 'Sub Total']]
    for item in data.get('labour', []):
        labour_rows.append([
            item['description'], str(item.get('qty', '')),
            f"{item['unit']:.2f}" if item.get('unit') else '',
            str(item.get('d', '')),
            f"{item['subtotal']:.2f}" if item.get('subtotal') else ''
        ])
    lt = Table(labour_rows, colWidths=lcw)
    lt.setStyle(TableStyle(data_table_style_commands()))
    _, lt_h = lt.wrap(page_width, 200)
    y = _page_break(c, y, lt_h, data, w, h, left_margin, right_margin, page_width)
    lt.drawOn(c, left_margin, y - lt_h)
    y = y - lt_h - 8

    # ── Parts Table ───────────────────────────────────────────
    parts_rows = [['Parts', 'Qty', 'Unit', 'D', 'Sub Total']]
    for item in data.get('parts', []):
        parts_rows.append([
            item['description'], str(item.get('qty', '')),
            f"{item['unit']:.2f}" if item.get('unit') else '',
            str(item.get('d', '')),
            f"{item['subtotal']:.2f}" if item.get('subtotal') else ''
        ])
    pt = Table(parts_rows, colWidths=lcw)
    pt.setStyle(TableStyle(data_table_style_commands()))
    _, pt_h = pt.wrap(page_width, 300)
    y = _page_break(c, y, pt_h, data, w, h, left_margin, right_margin, page_width)
    pt.drawOn(c, left_margin, y - pt_h)
    y = y - pt_h - 15

    # ── T&C + Totals Footer ───────────────────────────────────
    totals = data.get('totals', {})
    totals_rows = [
        ['Labour', f"{totals.get('labour', 0):.2f}"],
        ['Parts', f"{totals.get('parts', 0):.2f}"],
        ['SubTotal', f"{totals.get('subtotal', 0):.2f}"],
        [f"VAT ({totals.get('vat_rate', 20)}%)", f"{totals.get('vat', 0):.2f}"],
    ]
    if totals.get('mot') is not None:
        totals_rows.append(['MOT', f"{totals['mot']:.2f}"])
    totals_rows.append(['Total', f"{totals.get('total', 0):.2f}"])
    if totals.get('balance') is not None:
        totals_rows.append(['Balance', f"{totals['balance']:.2f}"])

    total_idx = len(totals_rows) - 1
    if totals.get('balance') is not None:
        total_idx = len(totals_rows) - 2

    tcw = [page_width * 0.20, page_width * 0.15]
    tt = Table(totals_rows, colWidths=tcw)
    tt.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTNAME', (0, 2), (-1, 2), 'Helvetica-Bold'),
        ('FONTNAME', (0, total_idx), (-1, total_idx), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('BACKGROUND', (0, total_idx), (-1, total_idx), HexColor('#e8e8e8')),
    ]))
    _, tt_h = tt.wrap(page_width * 0.35, 200)

    tc_para = Paragraph(tc_text(), ParagraphStyle('tc', fontName='Helvetica', fontSize=7, leading=9))
    _, tc_h = tc_para.wrap(page_width * 0.50, 200)
    footer_h = max(tt_h, tc_h + 15)

    y = _page_break(c, y, footer_h, data, w, h, left_margin, right_margin, page_width)
    tc_para.drawOn(c, left_margin, y - tc_h)
    c.setFont("Helvetica", 7)
    c.drawString(left_margin, y - tc_h - 12, "Signed ________________    Date ________________")
    tt.drawOn(c, right_margin - page_width * 0.35, y - tt_h)

    c.save()
    print(f"Invoice PDF saved to: {output_path}")


if __name__ == "__main__":
    sample_data = {
        'company': {
            'name': 'ELI MOTORS LIMITED',
            'address_line1': '49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP',
            'phone': '020 8203 6449, Sales 07950 250970',
            'website': 'www.elimotors.co.uk',
            'vat': '330 9339 65',
        },
        'customer': {
            'name': 'Hendon United Synagogue',
            'address_lines': ['18 Raleigh Close', 'Hendon', 'London', 'NW4 2TA'],
            'mobile': '07977202780',
        },
        'invoice': {
            'number': '89973',
            'invoice_date': '',
            'account_no': 'HEN025',
            'order_ref': '',
            'date_of_work': '04/02/2026',
            'payment_date': '',
            'payment_method': '',
        },
        'vehicle': {
            'reg': 'ST67 WKY', 'make': 'Hyundai', 'model': 'Ioniq Premium Se Hev',
            'chassis': 'Kmhc851cvju066654', 'mileage': '76720',
            'engine_no': 'G4LEHU531668', 'engine_code': 'G4LE', 'engine_cc': 1580,
            'date_reg': '14/02/2018', 'colour': 'Blue',
        },
        'work_title': 'Carried Out A Small Service',
        'work_items': [
            'Replaced Engine Oil And Filter.',
            'Topped Up All Under Bonnet Levels.',
            'Checked External Lighting Operation.',
            "Checked Front And Rear Brake Condition. Adjusted Tyre Pressure's.",
            'Carried Out Road Test (See Report For Any Defects Found).',
        ],
        'mot': [
            {'description': 'Carry Out Mot Test', 'qty': 1, 'status': ''},
        ],
        'labour': [
            {'description': '', 'qty': 1, 'unit': 140.00, 'd': '', 'subtotal': 140.00},
        ],
        'parts': [
            {'description': 'Engine Oil', 'qty': 4, 'unit': 11.95, 'd': '', 'subtotal': 47.80},
            {'description': 'Oilfilter', 'qty': 1, 'unit': 10.90, 'd': '', 'subtotal': 10.90},
            {'description': 'Sundries + Ppe +Solvent', 'qty': 1, 'unit': 4.50, 'd': '', 'subtotal': 4.50},
            {'description': 'Seal', 'qty': 1, 'unit': 1.75, 'd': '', 'subtotal': 1.75},
        ],
        'totals': {
            'labour': 140.00, 'parts': 64.95, 'subtotal': 204.95,
            'vat_rate': 20, 'vat': 40.99, 'mot': 45.00,
            'total': 290.94, 'balance': 290.94,
        },
    }
    generate_invoice("/home/claude/invoice_output.pdf", sample_data)
