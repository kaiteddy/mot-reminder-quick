"""
ELI MOTORS LIMITED - Shared PDF helpers
Common header drawing, page-break logic, table styles, and image lookup.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, black, white
from reportlab.platypus import Table, TableStyle
import os

# ── Colours ───────────────────────────────────────────────────
HEADER_BG = HexColor('#d9d9d9')
HEADER_TEXT = black
BORDER_COLOR = HexColor('#cccccc')

BOTTOM_MARGIN = 40  # points from page bottom


def find_image(name):
    """Locate an image file across common paths."""
    for p in [name,
              os.path.join(os.path.dirname(__file__), name),
              f'/home/claude/{name}',
              f'/mnt/user-data/uploads/{name}',
              f'/mnt/user-data/outputs/{name}']:
        if os.path.exists(p):
            return p
    return None


def draw_company_header(c, data, w, h, left_margin, right_margin):
    """Draw company name, address, and logo. Returns top-of-content y."""
    top = h - 25
    c.setFont("Helvetica-Bold", 18)
    c.drawString(left_margin, top, data['company']['name'])

    c.setFont("Helvetica", 8)
    y = top - 16
    c.drawString(left_margin, y, data['company']['address_line1'])
    y -= 11
    c.drawString(left_margin, y, data['company']['phone'])
    y -= 11
    c.drawString(left_margin, y, data['company']['website'])
    y -= 11
    c.drawString(left_margin, y, f"VAT {data['company']['vat']}")

    logo_path = find_image('eli_logo_white.png')
    if logo_path:
        logo_w = 120
        logo_h = logo_w * (865.0 / 1930.0)
        c.drawImage(logo_path, right_margin - logo_w, top - logo_h + 15,
                    width=logo_w, height=logo_h, preserveAspectRatio=True)

    c.setFillColor(black)
    return top


def draw_customer_and_doc(c, data, top, left_margin, right_margin,
                          doc_title, doc_number, detail_lines):
    """Draw customer info (left) and document details (right). Returns y."""
    y = top - 80
    c.setFont("Helvetica", 10)
    c.drawString(left_margin + 30, y, data['customer']['name'])
    for line in data['customer']['address_lines']:
        y -= 14
        c.drawString(left_margin + 30, y, line)
    for key in ('tel', 'mobile', 'phone'):
        if data['customer'].get(key):
            y -= 14
            label = 'Mobile' if key == 'mobile' else 'Tel'
            c.drawString(left_margin + 30, y, f"{label}: {data['customer'][key]}")

    doc_x = 340
    doc_y = top - 75
    c.setFont("Helvetica-Bold", 16)
    c.drawString(doc_x, doc_y, doc_title)
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(right_margin, doc_y, str(doc_number))

    c.setFont("Helvetica", 9)
    detail_y = doc_y - 16
    for label, value in detail_lines:
        c.drawString(doc_x, detail_y, label)
        c.drawRightString(right_margin, detail_y, str(value))
        detail_y -= 13

    c.setFillColor(black)
    return top - 170


def check_page_break(c, y, needed, data, w, h, left_margin, right_margin, page_width,
                     redraw_header_fn=None):
    """Start a new page if not enough room. Returns new y position."""
    if y - needed < BOTTOM_MARGIN:
        c.showPage()
        if redraw_header_fn:
            y = redraw_header_fn(c, data, w, h, left_margin, right_margin, page_width)
        else:
            y = h - 50
    return y


def vehicle_table_style():
    return TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
        ('BACKGROUND', (0, 2), (-1, 2), HEADER_BG),
        ('TEXTCOLOR', (0, 2), (-1, 2), HEADER_TEXT),
        ('BACKGROUND', (0, 1), (-1, 1), white),
        ('BACKGROUND', (0, 3), (-1, 3), white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 2), (-1, 2), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica'),
        ('FONTNAME', (0, 3), (-1, 3), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
    ])


def data_table_style_commands():
    return [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HEADER_TEXT),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('ALIGN', (1, 1), (-1, -1), 'RIGHT'),
        ('ALIGN', (0, 1), (0, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
    ]


def build_vehicle_data(v):
    return [
        ['Registration', 'Make', 'Model', 'Chassis Number', 'Mileage'],
        [v['reg'], v['make'], v['model'], v['chassis'], str(v.get('mileage', ''))],
        ['Engine No', 'Engine Code', 'Engine CC', 'Date Reg', 'Colour'],
        [v['engine_no'], v['engine_code'], str(v['engine_cc']), v['date_reg'], v['colour']],
    ]


VEHICLE_COL_WIDTHS_RATIOS = [0.18, 0.15, 0.22, 0.28, 0.17]


def tc_text():
    return (
        "I agree to pay for all work and parts required for the repairs described above at your "
        "retail charge. It is understood that any estimate given is provisional and all repairs are "
        "undertaken on a cash basis unless prior arrangements for credit have been approved. "
        "Any additional work found to be necessary must be authorised by myself prior to "
        "commencement. All goods shall remain the property of the seller until paid for in full. "
        "I have read and accept your terms and conditions.<br/>"
        "<b>Nothing herein is designed to nor will it affect a customers statutory rights</b>"
    )
