"""
ELI MOTORS LIMITED - Job Sheet PDF Template
With proper multi-page flow — header redrawn on every new page.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle
from eli_helpers import (
    HEADER_BG, HEADER_TEXT, BORDER_COLOR,
    find_image, check_page_break, vehicle_table_style,
    build_vehicle_data, VEHICLE_COL_WIDTHS_RATIOS, tc_text
)


def _draw_js_header(c, data, w, h, left_margin, right_margin, page_width):
    """Draw job sheet header. Returns y position."""
    top = h - 25

    c.setFont("Helvetica-Bold", 20)
    c.drawCentredString(w / 2, top, "Job Sheet")

    y = top - 28
    c.setFont("Helvetica", 10)
    c.drawString(left_margin, y, data['customer']['name'])
    for line in data['customer']['address_lines']:
        y -= 14
        c.drawString(left_margin, y, line)
    if data['customer'].get('mobile'):
        y -= 14
        c.drawString(left_margin, y, f"Mobile: {data['customer']['mobile']}")

    doc = data['doc']
    doc_x = 340
    doc_y = top - 28

    c.setFont("Helvetica-Bold", 12)
    c.drawString(doc_x, doc_y, "Doc Reference")
    c.drawRightString(right_margin, doc_y, doc['reference'])

    c.setFont("Helvetica", 9)
    details = [
        ("Account No:", doc['account_no']),
        ("Order Ref:", doc.get('order_ref', '')),
        ("Receive Date:", doc['receive_date']),
        ("Due Date:", doc['due_date']),
        ("Status:", doc.get('status', '')),
        ("Technician:", doc.get('technician', '')),
    ]
    detail_y = doc_y - 14
    for label, value in details:
        c.drawString(doc_x, detail_y, label)
        c.drawRightString(right_margin, detail_y, str(value))
        detail_y -= 13

    # Checkboxes
    cb_y = detail_y - 8
    c.setFont("Helvetica", 9)
    cb_x = doc_x + 40
    c.rect(cb_x, cb_y - 2, 10, 10)
    c.drawString(cb_x + 14, cb_y, "In Progress")
    cb_x2 = right_margin - 80
    c.rect(cb_x2, cb_y - 2, 10, 10)
    c.drawString(cb_x2 + 14, cb_y, "Completed")

    return cb_y - 25


def _page_break(c, y, needed, data, w, h, lm, rm, pw):
    return check_page_break(c, y, needed, data, w, h, lm, rm, pw,
                            redraw_header_fn=_draw_js_header)


def generate_job_sheet(output_path, data):
    w, h = A4
    c = canvas.Canvas(output_path, pagesize=A4)
    left_margin = 30
    right_margin = w - 30
    page_width = right_margin - left_margin

    # ── Header ────────────────────────────────────────────────
    y = _draw_js_header(c, data, w, h, left_margin, right_margin, page_width)

    # ── Vehicle Table ─────────────────────────────────────────
    col_widths = [page_width * r for r in VEHICLE_COL_WIDTHS_RATIOS]
    vt = Table(build_vehicle_data(data['vehicle']), colWidths=col_widths)
    vt.setStyle(vehicle_table_style())
    _, vt_h = vt.wrap(page_width, 200)
    y = _page_break(c, y, vt_h, data, w, h, left_margin, right_margin, page_width)
    vt.drawOn(c, left_margin, y - vt_h)
    y = y - vt_h

    # ── GAP between vehicle section and work description ──────
    y -= 30

    # ── Work Description ──────────────────────────────────────
    c.setFont("Helvetica", 9)
    for line in data.get('work_description', []):
        y = _page_break(c, y, 14, data, w, h, left_margin, right_margin, page_width)
        c.drawString(left_margin, y, line)
        y -= 13

    y -= 2

    if data.get('oil_specs'):
        for spec in data['oil_specs']:
            y = _page_break(c, y, 14, data, w, h, left_margin, right_margin, page_width)
            line = f"All Temperatures    {spec.get('viscosity', '')}    {spec.get('fiat_ref', '')}    {spec.get('category', '')}"
            c.drawString(left_margin, y, line)
            y -= 13

    y -= 4

    # ── Labour Table ──────────────────────────────────────────
    num_labour = data.get('labour_rows', 5)
    lcw = [page_width * 0.64, page_width * 0.12, page_width * 0.12, page_width * 0.12]
    labour_data = [['Labour', 'Tech', 'Qty', 'Done']]
    for _ in range(num_labour):
        labour_data.append(['', '', '', ''])

    lt = Table(labour_data, colWidths=lcw, rowHeights=[20] + [22] * num_labour)
    lt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('ALIGN', (0, 1), (-1, -1), 'CENTER'),
        ('ALIGN', (0, 1), (0, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
    ]))
    _, lt_h = lt.wrap(page_width, 300)
    y = _page_break(c, y, lt_h, data, w, h, left_margin, right_margin, page_width)
    lt.drawOn(c, left_margin, y - lt_h)
    y = y - lt_h - 8

    # ── Parts Table ───────────────────────────────────────────
    num_parts = data.get('parts_rows', 5)
    pcw = [page_width * 0.64, page_width * 0.24, page_width * 0.12]
    parts_data = [['Parts', 'Part No.', 'Done']]
    for _ in range(num_parts):
        parts_data.append(['', '', ''])

    pt = Table(parts_data, colWidths=pcw, rowHeights=[20] + [22] * num_parts)
    pt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('ALIGN', (0, 1), (-1, -1), 'CENTER'),
        ('ALIGN', (0, 1), (0, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
    ]))
    _, pt_h = pt.wrap(page_width, 300)
    y = _page_break(c, y, pt_h, data, w, h, left_margin, right_margin, page_width)
    pt.drawOn(c, left_margin, y - pt_h)
    y = y - pt_h - 6

    # ── Car Diagram ───────────────────────────────────────────
    diagram_path = find_image('car_diagram.png')
    if diagram_path:
        dw = page_width * 0.28
        dh = dw * (274.0 / 355.0)
        y = _page_break(c, y, dh + 80, data, w, h, left_margin, right_margin, page_width)
        c.drawImage(diagram_path, left_margin, y - dh,
                    width=dw, height=dh, preserveAspectRatio=True, anchor='sw')
        y -= dh + 6

    # ── T&C / Disclaimer ──────────────────────────────────────
    tc_lines = [
        "I agree to pay for all work and parts required for the repairs described above at your",
        "retail charge. It is understood that any estimate given is provisional and all repairs are",
        "undertaken on a cash basis unless prior arrangements for credit have been approved.",
        "Any additional work found to be necessary must be authorised by myself prior to",
        "commencement.  All goods shall remain the property of the seller until paid for in full.",
        "I have read and accept your terms and conditions.",
    ]
    tc_block_h = len(tc_lines) * 9 + 25  # lines + bold line + signed
    y = _page_break(c, y, tc_block_h, data, w, h, left_margin, right_margin, page_width)

    c.setFont("Helvetica", 7)
    for line in tc_lines:
        c.drawString(left_margin, y, line)
        y -= 9

    c.setFont("Helvetica-Bold", 7)
    c.drawString(left_margin, y, "Nothing herein is designed to nor will it affect a customers statutory rights")
    y -= 12
    c.setFont("Helvetica", 7.5)
    c.drawString(left_margin, y, "Signed ________________          Date ________________")

    c.save()
    print(f"Job Sheet PDF saved to: {output_path}")


if __name__ == "__main__":
    sample_data = {
        'customer': {
            'name': 'Mr Marc Ressel',
            'address_lines': ['13 Inglis Way', 'London', 'NW7 1FJ'],
            'mobile': '07376200273',
        },
        'doc': {
            'reference': 'JS 92379',
            'account_no': 'RES002',
            'order_ref': '',
            'receive_date': '10/02/2026',
            'due_date': '10/02/2026',
            'status': '~',
            'technician': '',
        },
        'vehicle': {
            'reg': 'YM14 NFL', 'make': 'Fiat', 'model': '500 Lounge Dualogic',
            'chassis': 'Zfa3120000j231253', 'mileage': '',
            'engine_no': '0905801', 'engine_code': '169A4000', 'engine_cc': 1242,
            'date_reg': '01/08/2014', 'colour': 'Black',
        },
        'work_description': [
            'Carry Out Mot', '', 'Carry Out Small Service', '', '2.9 Litres',
        ],
        'oil_specs': [
            {'viscosity': '-Vinjb97403=5w-40', 'fiat_ref': 'Fiat 9.55535-S2,', 'category': 'Sm/C3'},
            {'viscosity': 'Vinjb97404-=0w-20', 'fiat_ref': 'Fiat 9.55535-Dm1,', 'category': 'Sm/C5'},
        ],
        'labour_rows': 5,
        'parts_rows': 5,
    }
    generate_job_sheet("/home/claude/jobsheet_output.pdf", sample_data)
