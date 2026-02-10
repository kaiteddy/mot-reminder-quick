"""
ELI MOTORS LIMITED - Estimate PDF Template
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
    """Redraw full header + customer + estimate details. Returns y."""
    top = draw_company_header(c, data, w, h, left_margin, right_margin)
    est = data['estimate']
    details = [
        ("Estimate Date:", est['date']),
        ("Account No:", est['account_no']),
        ("Order Ref:", est.get('order_ref', '')),
        ("Estimate Valid to:", est['valid_to']),
    ]
    return draw_customer_and_doc(c, data, top, left_margin, right_margin,
                                'Estimate', est['number'], details)


def _page_break(c, y, needed, data, w, h, lm, rm, pw):
    return check_page_break(c, y, needed, data, w, h, lm, rm, pw,
                            redraw_header_fn=_full_header)


def generate_estimate(output_path, data):
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

    # ── Car Diagram ───────────────────────────────────────────
    diagram_path = find_image('car_diagram.png')
    if diagram_path:
        dw = page_width * 0.48
        dh = dw * (274.0 / 355.0)
        y -= 6
        y = _page_break(c, y, dh, data, w, h, left_margin, right_margin, page_width)
        c.drawImage(diagram_path, left_margin, y - dh,
                    width=dw, height=dh, preserveAspectRatio=True, anchor='sw')
        y -= dh

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
        c.drawString(left_margin, y, f"•   {item}")
        y -= 13

    y -= 10

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
        ['Estimate Total', f"{totals.get('total', 0):.2f}"],
    ]
    tcw = [page_width * 0.20, page_width * 0.15]
    tt = Table(totals_rows, colWidths=tcw)
    tt.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTNAME', (0, 2), (-1, 2), 'Helvetica-Bold'),
        ('FONTNAME', (0, 4), (-1, 4), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('BACKGROUND', (0, 4), (-1, 4), HexColor('#e8e8e8')),
    ]))
    _, tt_h = tt.wrap(page_width * 0.35, 200)

    tc_para = Paragraph(tc_text(), ParagraphStyle('tc', fontName='Helvetica', fontSize=7, leading=9))
    _, tc_h = tc_para.wrap(page_width * 0.55, 200)
    footer_h = max(tt_h, tc_h + 15)

    y = _page_break(c, y, footer_h, data, w, h, left_margin, right_margin, page_width)
    tc_para.drawOn(c, left_margin, y - tc_h)
    c.setFont("Helvetica", 7)
    c.drawString(left_margin, y - tc_h - 12, "Signed ________________    Date ________________")
    tt.drawOn(c, right_margin - page_width * 0.35, y - tt_h)

    c.save()
    print(f"Estimate PDF saved to: {output_path}")


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
            'name': 'Mr Sassoon',
            'address_lines': ['5 Holmbrook Drive', 'London', 'NW42LT'],
            'tel': '02082025738',
        },
        'estimate': {
            'number': 6036,
            'date': '05/01/2026',
            'account_no': 'SAS010',
            'order_ref': '',
            'valid_to': '04/02/2026',
        },
        'vehicle': {
            'reg': 'LD13 KLO', 'make': 'Ford', 'model': 'Focus Zetec',
            'chassis': 'Wf0kxxgcbkdp46303', 'mileage': '',
            'engine_no': 'DP46303', 'engine_code': 'PNDA', 'engine_cc': 1596,
            'date_reg': '20/06/2013', 'colour': 'Black',
        },
        'work_title': 'Investigate Loss Of Power Steering + Estimate',
        'work_items': [
            'Investigated Reported Loss Of Power Steering Following Impact',
            'Confirmed Power Steering Pipe Had Snapped Due To The Force Of The Collision',
            'Replaced Power Steering Fluid Container',
            'Refilled System With Correct Oil And Checked For Leaks',
            'Removed Damaged Rear Bumper Assembly',
            'Drilled Out Reverse Parking Sensors From Old Bumper And Transferred To New Bumper',
            'Supplied And Fitted New Rear Bumper Assembly (Pre-Painted From Manufacturer – No Paint Required)',
            'Replaced Rear Bumper Lower Skirting',
            'Replaced Rear Bumper Enforcer',
            'Replaced Rear Bumper Corner Brackets (Nearside And Offside)',
            'Replaced Offside Rear Fog Lamp',
            'Reassembled Rear Bumper And All Listed Components',
            'Checked Sensor Operation, Alignment, And Fixings',
            'Final Inspection And Functionality Checks Completed',
        ],
        'labour': [
            {'description': 'Body Work Labour', 'qty': 1, 'unit': 280.00, 'd': '', 'subtotal': 280.00},
        ],
        'parts': [
            {'description': 'Rear Bumper Assembly', 'qty': 1, 'unit': 480.98, 'd': '', 'subtotal': 480.98},
            {'description': 'Lower Bumper Skirting', 'qty': 1, 'unit': 98.76, 'd': '', 'subtotal': 98.76},
            {'description': 'Offside Rear Fog Lamp', 'qty': 1, 'unit': 18.58, 'd': '', 'subtotal': 18.58},
            {'description': 'Rear Bumper Corner Brackets Nearside And Offside', 'qty': 2, 'unit': 37.44, 'd': '', 'subtotal': 74.88},
            {'description': 'Power Steering Container', 'qty': 1, 'unit': 36.13, 'd': '', 'subtotal': 36.13},
            {'description': '5/30 Oil', 'qty': 1, 'unit': 15.89, 'd': '', 'subtotal': 15.89},
            {'description': 'Rear Bumper Enforcer', 'qty': 1, 'unit': 128.09, 'd': '', 'subtotal': 128.09},
            {'description': 'Valet To Prepare Vehicle', 'qty': 1, 'unit': 25.00, 'd': '', 'subtotal': 25.00},
        ],
        'totals': {
            'labour': 280.00, 'parts': 878.31, 'subtotal': 1158.31,
            'vat_rate': 20, 'vat': 231.68, 'total': 1389.99,
        },
    }
    generate_estimate("/home/claude/estimate_output.pdf", sample_data)
