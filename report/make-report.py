#!/usr/bin/env python3
"""
BODHA — build the project document.

    python3 make-report.py            # → /home/user/BODHA-Project-Document.pdf

Three passes of work, in order:

1. The assets: the बोध wordmark, drawn with real Devanagari shaping, and the
   three photographed pages of the submitted document, cropped, straightened to
   grayscale and brightened for print.
2. A first build of the whole document, purely to learn which page each section
   landed on and how many pages there are.
3. The real build, with those page numbers printed in the contents.

Reportlab is the only dependency, and nothing here uses colour: every value in
this document is black, white, or a grey between them.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont, ImageOps

import report_content
import report_kit as K

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
UPLOADS = '/home/user/uploads'
OUT = '/home/user/BODHA-Project-Document.pdf'

# where the paper of each photographed page sits inside the photograph, as a
# fraction of the frame: (left, top, right, bottom). Written out rather than
# detected, so a wrong crop is a visible one-line fix and not a mystery.
CROPS = {
    'doc-1.png': (0.00, 0.075, 1.00, 0.86),
    'doc-2.png': (0.00, 0.135, 1.00, 0.86),
    'doc-3.png': (0.00, 0.115, 1.00, 0.86),
}


def prepare_wordmark():
    """बोध, ink on transparent, cropped tight — the one drawn mark in the document."""
    out = os.path.join(ASSETS, 'wordmark.png')
    font_path = '/home/user/bodha-ai/desktop/fonts/NotoSerifDevanagari'
    if not os.path.exists(font_path):
        font_path = '/home/user/bodha-ai/android/fonts/NotoSerifDevanagari'
    size = 900
    image = Image.new('RGBA', (size * 2, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(font_path, size, layout_engine=ImageFont.Layout.RAQM)
    box = draw.textbbox((0, 0), 'बोध', font=font)
    draw.text((40 - box[0], (size - (box[3] - box[1])) / 2 - box[1]), 'बोध', font=font,
              fill=(17, 17, 17, 255))
    image = image.crop((0, 0, box[2] - box[0] + 80, size))
    image = ImageOps.pad(image, (image.width, image.height)) if False else image
    image.save(out)
    print(f'  wordmark → {out} {image.size}')


def prepare_document_pages():
    files = sorted(os.listdir(UPLOADS))
    for index, name in enumerate(files, start=1):
        target = f'doc-{index}.png'
        source = Image.open(os.path.join(UPLOADS, name))
        if source.mode != 'RGB':
            source = source.convert('RGB')
        w, h = source.size
        left, top, right, bottom = CROPS[target]
        page = source.crop((int(w * left), int(h * top), int(w * right), int(h * bottom)))
        page = ImageOps.grayscale(page)
        page = ImageOps.autocontrast(page, cutoff=1)
        # A touch of brightness and contrast, so the print is legible after photocopying.
        page = page.point(lambda value: min(255, int(value * 1.18 + 6)))
        target_width = 1300
        page = page.resize((target_width, int(page.height * target_width / page.width)), Image.LANCZOS)
        page.save(os.path.join(ASSETS, target))
        print(f'  {name} → {target} {page.size}')


def build(path, total_pages=0, marks=None, toc_numbers=False):
    styles = K.styles()
    doc = K.Doc(path,
                title='BODHA — An Evidence-Grounded AI Research Copilot for Student Inquiry in Indian Knowledge Systems',
                author='Srijan Singh and Parv Mishra',
                total_pages=total_pages)
    story = report_content.build(styles, K, marks=marks, toc_numbers=toc_numbers)
    doc.build(story)
    return doc.page


def main():
    K.register_fonts()

    if not os.path.exists(os.path.join(ASSETS, 'doc-1.png')) or '--assets' in sys.argv:
        print('preparing assets')
        prepare_wordmark()
        prepare_document_pages()

    print('pass 1 — learning the page numbers')
    marks = {}
    pages = build('/tmp/bodha-pass1.pdf', marks=marks, toc_numbers=False)
    print(f'  {pages} pages; sections: ' + ', '.join(f'{k}={v}' for k, v in marks.items()))

    print('pass 2 — printing them')
    pages = build(OUT, total_pages=pages, marks=marks, toc_numbers=True)
    print(f'  ✓ {OUT} — {pages} pages, {os.path.getsize(OUT) // 1024} KB, '
          f'sha256 {subprocess.run(["sha256sum", OUT], capture_output=True, text=True).stdout.split()[0][:16]}…')


if __name__ == '__main__':
    main()
