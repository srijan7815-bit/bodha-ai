#!/usr/bin/env python3
"""
BODHA — the project document, in black and white.

The engine: page template, type, tables, boxes and the vector diagrams. The words
live in report_content.py, so the layout can be tuned without touching the prose.

Everything here is grayscale on purpose: no colour is used anywhere, so a
photocopy of this file is indistinguishable from the original.

    python3 make-report.py        # → BODHA-Project-Document.pdf
"""

import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, Image, KeepTogether,
                                ListFlowable, ListItem, PageTemplate, Paragraph, Spacer,
                                Table, TableStyle)
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon, Circle

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
FONTS = os.path.join(ASSETS, 'fonts')

PAGE_W, PAGE_H = A4                     # 595 × 842 pt
MARGIN_L, MARGIN_R = 62, 58
MARGIN_T, MARGIN_B = 54, 54

# ── the only colours in this document: black, white, and greys between them ──
INK = colors.HexColor('#111111')        # headings, rules, figures
BODY = colors.HexColor('#1C1C1C')       # body text
SOFT = colors.HexColor('#5A5A5A')       # captions, secondary text
FAINT = colors.HexColor('#8A8A8A')      # page numbers, hairline labels
RULE = colors.HexColor('#C9C9C9')       # hairlines
FILL = colors.HexColor('#F0F0F0')       # table headers, panels
FILL_2 = colors.HexColor('#FAFAFA')     # zebra rows
BLACK = colors.black
WHITE = colors.white

# ── type: Source Serif 4, the face the app itself is set in ─────────────────


def register_fonts():
    faces = {
        'SS': 'SourceSerif4-Regular.ttf',
        'SS-It': 'SourceSerif4-Italic.ttf',
        'SS-Semi': 'SourceSerif4-Semibold.ttf',
        'SS-Bold': 'SourceSerif4-Bold.ttf',
    }
    for name, filename in faces.items():
        pdfmetrics.registerFont(TTFont(name, os.path.join(FONTS, filename)))
    pdfmetrics.registerFont(TTFont('Mono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))
    pdfmetrics.registerFont(TTFont('Mono-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'))
    pdfmetrics.registerFontFamily('SS', normal='SS', bold='SS-Bold', italic='SS-It', boldItalic='SS-Bold')


# ── leading is a knob: the whole document breathes or tightens from here ────
LEAD = 14.8


def styles(lead=LEAD):
    return {
        'body': ParagraphStyle('body', fontName='SS', fontSize=10.2, leading=lead,
                               textColor=BODY, alignment=TA_LEFT, spaceAfter=6.6),
        'lead': ParagraphStyle('lead', fontName='SS', fontSize=11.2, leading=lead + 3,
                               textColor=BODY, spaceAfter=8),
        'small': ParagraphStyle('small', fontName='SS', fontSize=9.1, leading=lead - 3,
                                textColor=SOFT),
        'h1': ParagraphStyle('h1', fontName='SS-Bold', fontSize=15.2, leading=18.6,
                             textColor=INK, spaceBefore=2, spaceAfter=6),
        'h2': ParagraphStyle('h2', fontName='SS-Semi', fontSize=11.4, leading=14.6,
                             textColor=INK, spaceBefore=10, spaceAfter=4),
        'h3': ParagraphStyle('h3', fontName='SS-Semi', fontSize=10.2, leading=13.6,
                             textColor=INK, spaceBefore=7, spaceAfter=2),
        'caption': ParagraphStyle('caption', fontName='SS', fontSize=8.5, leading=11.4,
                                  textColor=SOFT, spaceBefore=4, spaceAfter=9),
        'bullet': ParagraphStyle('bullet', fontName='SS', fontSize=10.2, leading=lead,
                                 textColor=BODY, spaceAfter=4),
        'cell': ParagraphStyle('cell', fontName='SS', fontSize=9, leading=12.2, textColor=BODY),
        'cellhead': ParagraphStyle('cellhead', fontName='SS-Semi', fontSize=9, leading=12.2,
                                   textColor=INK),
        'code': ParagraphStyle('code', fontName='Mono', fontSize=8.4, leading=12,
                               textColor=INK, backColor=FILL, borderPadding=6, spaceAfter=8),
        'quote': ParagraphStyle('quote', fontName='SS-It', fontSize=10, leading=lead + 1.6,
                                textColor=INK, spaceAfter=0),
        'toc': ParagraphStyle('toc', fontName='SS', fontSize=10.4, leading=16.4, textColor=BODY),
        'tocnum': ParagraphStyle('tocnum', fontName='SS-Semi', fontSize=10.4, leading=16.4,
                                 textColor=INK),
        'cover_title': ParagraphStyle('cover_title', fontName='SS-Bold', fontSize=40, leading=44,
                                      textColor=INK, spaceAfter=6),
        'cover_sub': ParagraphStyle('cover_sub', fontName='SS', fontSize=13.4, leading=18.6,
                                    textColor=SOFT),
        'meta_label': ParagraphStyle('meta_label', fontName='SS', fontSize=7.6, leading=11,
                                     textColor=FAINT),
        'meta_value': ParagraphStyle('meta_value', fontName='SS', fontSize=9.4, leading=13,
                                     textColor=BODY),
    }


# ── geometry and assets ─────────────────────────────────────────────────────


# A full-page reproduction has to leave room for its caption.
MAX_FIGURE_HEIGHT = PAGE_H - MARGIN_T - MARGIN_B - 96


def content_width():
    return PAGE_W - MARGIN_L - MARGIN_R


def asset(name):
    return os.path.join(ASSETS, name)


def asset_size(name):
    """Pixel size of an asset, so images keep their proportions."""
    from PIL import Image as PILImage
    with PILImage.open(asset(name)) as im:
        return im.size


# ── small flowables ─────────────────────────────────────────────────────────


class Mark(Flowable):
    """An invisible bookmark that records the page a section starts on."""

    def __init__(self, key, store):
        super().__init__()
        self.key, self.store = key, store

    def wrap(self, availWidth, availHeight):
        return 0, 0

    def draw(self):
        self.store[self.key] = self.canv.getPageNumber()


def right_style(styles):
    return ParagraphStyle('right', parent=styles['toc'], alignment=2, textColor=FAINT)



class Rule(Flowable):
    """A hairline, the only ornament this document needs."""

    def __init__(self, width=None, thickness=0.6, colour=RULE, space_before=2, space_after=8):
        super().__init__()
        self.width = width
        self.thickness = thickness
        self.colour = colour
        self.space_before = space_before
        self.space_after = space_after

    def wrap(self, availWidth, availHeight):
        self._w = self.width or availWidth
        return self._w, self.thickness + self.space_before + self.space_after

    def draw(self):
        self.canv.setStrokeColor(self.colour)
        self.canv.setLineWidth(self.thickness)
        y = self.space_after + self.thickness / 2
        self.canv.line(0, y, self._w, y)


class Band(Flowable):
    """A solid block of ink with white text — the document's one loud gesture."""

    def __init__(self, width, height, fill=INK):
        super().__init__()
        self.width, self.height, self.fill = width, height, fill

    def wrap(self, availWidth, availHeight):
        return self.width, self.height

    def draw(self):
        self.canv.setFillColor(self.fill)
        self.canv.rect(0, 0, self.width, self.height, stroke=0, fill=1)


def section_title(number, title, styles, rule=True):
    """A numbered section heading, set the way the app sets a heading."""
    from reportlab.platypus import Paragraph as P
    head = P(f'<font color="#8A8A8A">{number}</font>&nbsp;&nbsp;{title}', styles['h1'])
    if not rule:
        return [head]
    return [head, Rule(thickness=0.9, colour=INK, space_before=0, space_after=10)]


def bullets(items, styles, style_key='bullet'):
    return ListFlowable(
        [ListItem(Paragraph(t, styles[style_key]), leftIndent=15)
         for t in items],
        bulletType='bullet', bulletFontName='SS', bulletFontSize=7.2,
        bulletChar='\u2022', start='\u2022', leftIndent=15, bulletOffsetY=-0.4,
        spaceAfter=5, spaceBefore=0)


def table(rows, widths, styles, header=True, align_right=None, zebra=True, size=9.1):
    """A quiet table: hairlines, a grey header, no boxes."""
    data = []
    for i, row in enumerate(rows):
        cells = []
        for j, cell in enumerate(row):
            if isinstance(cell, str):
                key = 'cellhead' if (header and i == 0) else 'cell'
                cells.append(Paragraph(cell, styles[key]))
            else:
                cells.append(cell)
        data.append(cells)

    commands = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4.2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4.2),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, RULE),
        ('LINEBELOW', (0, -1), (-1, -1), 0.9, INK),
        ('LINEABOVE', (0, 0), (-1, 0), 0.9, INK),
    ]
    if header:
        commands.append(('BACKGROUND', (0, 0), (-1, 0), FILL))
    if zebra:
        for i in range(1, len(data)):
            if i % 2 == 0:
                commands.append(('BACKGROUND', (0, i), (-1, i), FILL_2))
    if align_right:
        for col in align_right:
            commands.append(('ALIGN', (col, 0), (col, -1), 'RIGHT'))
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    t.setStyle(TableStyle(commands))
    return t


def panel(flowables, width, fill=FILL_2, bar=True, pad=10):
    """A bordered panel with an ink bar down the left — used for notes and quotes."""
    inner = Table([[flowables]], colWidths=[width - 2 * pad])
    inner.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0),
                               ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                               ('TOPPADDING', (0, 0), (-1, -1), 0),
                               ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    frame = Table([['', inner]], colWidths=[2.4 if bar else 0, width - (2.4 if bar else 0)])
    frame.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), INK if bar else fill),
        ('BACKGROUND', (1, 0), (1, 0), fill),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), pad),
        ('TOPPADDING', (0, 0), (-1, -1), pad - 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), pad - 2),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEAFTER', (1, 0), (1, 0), 0.4, RULE),
        ('LINEBELOW', (1, 0), (1, 0), 0.4, RULE),
        ('LINEABOVE', (1, 0), (1, 0), 0.4, RULE),
    ]))
    return frame


def figure(drawing, caption, styles, width=None):
    """A diagram plus its caption, kept together on one page."""
    return KeepTogether([drawing, Paragraph(caption, styles['caption'])])


# ── vector diagrams ─────────────────────────────────────────────────────────


def diagram_pipeline(width=470):
    """Ask and upload → retrieve → reason and check → answer with sources."""
    steps = [
        ('1', 'Ask and upload', 'The student asks a question and can\nattach a chapter, an article or a\nphotograph of a scanned page.'),
        ('2', 'Retrieve evidence', 'BODHA searches its IKS library, the\nweb, and the student\u2019s own\ndocuments — OCR runs on scans.'),
        ('3', 'Reason and check', 'The model weighs the evidence, can\nrun code to check a calculation, and\nsays when sources disagree.'),
        ('4', 'Answer with sources', 'The reply cites each key statement,\nso any line can be opened and read\nat its source.'),
    ]
    d = Drawing(width, 138)
    gap = 9
    box_w = (width - gap * 3) / 4
    for i, (n, title, text) in enumerate(steps):
        x = i * (box_w + gap)
        d.add(Rect(x, 0, box_w, 138, fillColor=WHITE, strokeColor=RULE, strokeWidth=0.5))
        d.add(Rect(x, 111, box_w, 27, fillColor=FILL, strokeColor=None))
        d.add(String(x + 8, 120.5, n, fontName='SS-Bold', fontSize=12.4, fillColor=INK))
        d.add(String(x + 22, 121.5, title, fontName='SS-Semi', fontSize=8.3, fillColor=INK))
        for j, line in enumerate(text.split('\n')):
            d.add(String(x + 9, 94 - j * 11, line, fontName='SS', fontSize=7.4, fillColor=BODY))
        if i < 3:
            ax = x + box_w + 1.5
            d.add(Polygon([ax, 65, ax + 6, 68.5, ax, 72], fillColor=INK, strokeColor=None))
    return d


def diagram_architecture(width=470):
    """Three bands: what the student holds, what BODHA's server does, what it calls."""
    d = Drawing(width, 250)
    label_x = 8

    def band(y, h, title, sub, left_items, right_items=None):
        d.add(Rect(0, y, width, h, fillColor=WHITE, strokeColor=RULE, strokeWidth=0.5))
        d.add(Rect(0, y + h - 22, width, 22, fillColor=FILL, strokeColor=None))
        d.add(String(label_x, y + h - 15.5, title, fontName='SS-Semi', fontSize=9, fillColor=INK))
        if sub:
            d.add(String(label_x + 130, y + h - 15.5, sub, fontName='SS', fontSize=7.8, fillColor=SOFT))
        items = left_items if right_items is None else left_items + right_items
        cols = 3
        for i, item in enumerate(items):
            col, row = i % cols, i // cols
            cx = 14 + col * ((width - 28) / cols)
            cy = y + h - 44 - row * 30
            d.add(String(cx, cy + 10, item[0], fontName='SS-Semi', fontSize=7.8, fillColor=INK))
            for j, line in enumerate(item[1].split('\n')):
                d.add(String(cx, cy - j * 9.6, line, fontName='SS', fontSize=7, fillColor=BODY))

    band(174, 76, 'The student\u2019s device — light',
         'a phone, a laptop, or a browser tab',
         [('Phone (Android)', 'The window, the microphone, the file\npicker, and Downloads.'),
          ('Windows app', 'The same, in a desktop window with\na menu and remembered layout.'),
          ('Browser', 'Nothing to install; the same BODHA.')])

    d.add(Polygon([width / 2 - 5, 168, width / 2 + 5, 168, width / 2, 158], fillColor=INK, strokeColor=None))
    d.add(Polygon([width / 2 - 5, 152, width / 2 + 5, 152, width / 2, 162], fillColor=INK, strokeColor=None))
    d.add(String(width / 2 + 10, 158, 'HTTPS', fontName='SS', fontSize=7, fillColor=SOFT))

    band(58, 100, 'BODHA\u2019s server — heavy',
         'Next.js on Vercel · the same one for every screen',
         [('Retrieval', 'BM25 search over 15 IKS works,\n6,525 passages, with [n] citations.'),
          ('Reasoning', 'The model chain, with fallbacks\nand a watchdog that checks health.'),
          ('Reading', 'OCR for scans and photographs;\nweb and GitHub reading.'),
          ('Sandbox', 'Code runs in an isolated cloud\nsandbox, never on the device.'),
          ('Documents', 'PDF, Word and Excel are built\non the server and sent finished.'),
          ('History', 'Chats, documents and the library,\nper account, in the cloud.')])

    d.add(Polygon([width / 2 - 5, 52, width / 2 + 5, 52, width / 2, 42], fillColor=INK, strokeColor=None))
    d.add(Polygon([width / 2 - 5, 36, width / 2 + 5, 36, width / 2, 46], fillColor=INK, strokeColor=None))

    band(0, 34, 'Outside services', 'called from the server, never from the student\u2019s device',
         [('NVIDIA NIM', 'the reasoning models'),
          ('Fish Audio', 'the reading voice'),
          ('E2B · Tavily', 'sandbox and web search')])
    return d


def diagram_chain(width=470):
    """The model chain and what happens when one link fails."""
    d = Drawing(width, 96)
    names = [('Kimi K2.6', 'first choice'), ('GLM 5.3 Flash', 'fast fallback'),
             ('Nemotron 3 Super', 'third'), ('GPT-OSS 20B', 'last resort')]
    gap = 8
    w = (width - gap * 3) / 4
    for i, (name, note) in enumerate(names):
        x = i * (w + gap)
        d.add(Rect(x, 42, w, 40, fillColor=WHITE, strokeColor=RULE, strokeWidth=0.5))
        d.add(Rect(x, 42, w, 3, fillColor=INK, strokeColor=None))
        d.add(String(x + 8, 64, name, fontName='SS-Semi', fontSize=8.4, fillColor=INK))
        d.add(String(x + 8, 52, note, fontName='SS', fontSize=7.2, fillColor=SOFT))
        if i < 3:
            d.add(Line(x + w + 1, 62, x + w + gap - 1, 62, strokeColor=FAINT, strokeWidth=0.6))
    d.add(String(0, 30, 'If a model is slow, rate-limited or down, the next one answers — the watchdog records what happened and the reply is never held hostage by one provider.',
                 fontName='SS', fontSize=7.4, fillColor=BODY))
    d.add(Rect(0, 0, width, 22, fillColor=FILL, strokeColor=None))
    d.add(String(8, 7.5, 'The student sees one answer, one voice and one place their work lives, whichever link in the chain supplied it.',
                 fontName='SS-Semi', fontSize=7.6, fillColor=INK))
    return d


def diagram_citation(width=470):
    """What an evidence-grounded answer looks like: claims, markers, sources."""
    d = Drawing(width, 172)
    d.add(Rect(0, 96, width, 76, fillColor=FILL_2, strokeColor=RULE, strokeWidth=0.5))
    d.add(String(10, 158, 'BODHA', fontName='SS-Bold', fontSize=8.6, fillColor=INK))
    d.add(String(52, 158, 'answered from the shelf, not from memory', fontName='SS', fontSize=7.6, fillColor=SOFT))
    lines = [
        'Kautilya treats irrigation and water storage as a duty of the state: land that is',
        'watered is worth more, and a ruler who neglects a tank loses more than the harvest [1].',
        'The same reasoning appears in the Laws of Manu, where a neighbour who breaks a',
        'water channel is answerable for the loss [2]. Modern studies of johads and stepwells',
        'describe the same logic in hydrological terms: storage spreads the monsoon over the',
        'year instead of letting it run off [3].',
    ]
    for j, line in enumerate(lines):
        d.add(String(10, 144 - j * 9.6, line, fontName='SS', fontSize=7.2, fillColor=BODY))

    d.add(String(10, 84, 'Sources', fontName='SS-Semi', fontSize=7.6, fillColor=INK))
    sources = [
        ('[1]', 'Arthashastra', 'Kautilya, Book II and III — water works, tanks and irrigation duties.'),
        ('[2]', 'The Laws of Manu', 'Manu, Chapter IX — obligations and penalties around water courses.'),
        ('[3]', 'Current research', 'Web search for johad and stepwell hydrology, read at the source.'),
    ]
    for i, (n, work, note) in enumerate(sources):
        y = 66 - i * 22
        d.add(Rect(0, y, width, 20, fillColor=WHITE, strokeColor=RULE, strokeWidth=0.4))
        d.add(String(8, y + 7, n, fontName='SS-Bold', fontSize=7.6, fillColor=INK))
        d.add(String(28, y + 7, work, fontName='SS-Semi', fontSize=7.4, fillColor=INK))
        d.add(String(120, y + 7, note, fontName='SS', fontSize=7.2, fillColor=BODY))
    return d


def diagram_split(width=470):
    """Where the work happens, side by side."""
    d = Drawing(width, 150)
    half = (width - 14) / 2
    for i, (title, sub, items, dark) in enumerate([
        ('On the server — heavy', 'the same server for every screen',
         ['The model chain and its fallbacks', 'BM25 retrieval over 6,525 IKS passages',
          'OCR for scanned pages and photographs', 'Web and GitHub reading',
          'An isolated code sandbox', 'Building PDF, Word and Excel files',
          'Every chat, document and shelf entry'], True),
        ('On the device — light', 'a phone, a laptop, or a browser tab',
         ['The window and the layout', 'The microphone and the speakers',
          'The file picker', 'The screen and the reading column',
          'Putting a finished file into Downloads', 'Remembering the window',
          'Nothing else: no model, no index, no database'], False)]):
        x = i * (half + 14)
        d.add(Rect(x, 0, half, 150, fillColor=FILL_2 if not dark else WHITE,
                   strokeColor=RULE, strokeWidth=0.5))
        d.add(Rect(x, 124, half, 26, fillColor=INK if dark else FILL, strokeColor=None))
        d.add(String(x + 10, 133, title, fontName='SS-Semi', fontSize=9,
                     fillColor=WHITE if dark else INK))
        d.add(String(x + 10, 112, sub, fontName='SS-It', fontSize=7.4, fillColor=SOFT))
        for j, item in enumerate(items):
            d.add(String(x + 10, 98 - j * 12.6, '— ' + item, fontName='SS', fontSize=7.6, fillColor=BODY))
    return d


def diagram_works(width=470):
    """The shelf, as one horizontal strip of bars."""
    works = [('Arthashastra', 632), ('Rigveda', 632), ('Sushruta', 632), ('Ramayana', 632),
             ('Mahabharata I', 632), ('Vedanta', 525), ('Manu', 505), ('Colebrooke', 499),
             ('Surya Siddhanta', 465), ('Sarva-Darshana', 411), ('Hitopadesha', 403),
             ('Thirukkural', 261), ('Yoga Sutras', 144), ('Gita', 76), ('Upanishads', 76)]
    d = Drawing(width, 152)
    left = 108
    bar_max = width - left - 34
    row_h = 9.2
    for i, (name, count) in enumerate(works):
        y = 142 - i * row_h
        d.add(String(left - 8, y, name, fontName='SS', fontSize=6.9, fillColor=BODY,
                     textAnchor='end'))
        d.add(Rect(left, y - 0.5, bar_max * (count / 632.0), 5.4, fillColor=INK, strokeColor=None))
        d.add(String(left + bar_max + 4, y, str(count), fontName='SS', fontSize=6.9, fillColor=SOFT))
    d.add(String(left, 0, 'passages indexed, by work', fontName='SS-It', fontSize=7, fillColor=SOFT))
    return d


# ── the page itself ─────────────────────────────────────────────────────────


class Doc(BaseDocTemplate):
    def __init__(self, filename, title, author, total_pages=0, **kw):
        super().__init__(filename, pagesize=A4,
                         leftMargin=MARGIN_L, rightMargin=MARGIN_R,
                         topMargin=MARGIN_T, bottomMargin=MARGIN_B,
                         title=title, author=author,
                         subject='NCSC 2026-27 — Application of Indian Knowledge Systems for Sustainability',
                         creator='BODHA', **kw)
        self.total_pages = total_pages
        frame = Frame(MARGIN_L, MARGIN_B, self.width, self.height, id='body',
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id='cover', frames=[frame], onPage=self.cover_page),
            PageTemplate(id='plain', frames=[frame], onPage=self.inner_page),
        ])

    # the cover carries its own mark and needs no running head
    def cover_page(self, canv, doc):
        canv.saveState()
        canv.setFillColor(INK)
        canv.rect(0, PAGE_H - 96, PAGE_W, 96, stroke=0, fill=1)
        canv.setFillColor(WHITE)
        canv.setFont('SS', 8.4)
        canv.drawString(MARGIN_L, PAGE_H - 40, 'NCSC 2026-27')
        canv.drawString(MARGIN_L + 96, PAGE_H - 40, '|')
        canv.drawString(MARGIN_L + 106, PAGE_H - 40, 'PROJECT DOCUMENT')
        canv.setFont('SS-It', 8.4)
        canv.drawRightString(PAGE_W - MARGIN_R, PAGE_H - 40, 'बोध')
        canv.restoreState()

    def inner_page(self, canv, doc):
        canv.saveState()
        canv.setStrokeColor(RULE)
        canv.setLineWidth(0.5)
        canv.line(MARGIN_L, PAGE_H - 40, PAGE_W - MARGIN_R, PAGE_H - 40)
        canv.setFont('SS', 8)
        canv.setFillColor(FAINT)
        canv.drawString(MARGIN_L, PAGE_H - 34, 'BODHA · बोध — an evidence-grounded research copilot for Indian Knowledge Systems')
        canv.drawRightString(PAGE_W - MARGIN_R, PAGE_H - 34, 'NCSC 2026-27')

        canv.line(MARGIN_L, 44, PAGE_W - MARGIN_R, 44)
        canv.setFont('SS', 8.2)
        canv.drawString(MARGIN_L, 31, 'Srijan Singh and Parv Mishra · PM SHRI Kendriya Vidyalaya Kanpur Cantt')
        page = doc.page
        total = doc.total_pages
        canv.drawRightString(PAGE_W - MARGIN_R, 31,
                             f'Page {page}' + (f' of {total}' if total else ''))
        canv.restoreState()
