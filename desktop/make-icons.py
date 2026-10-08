#!/usr/bin/env python3
"""
BODHA's desktop icon — बोध, drawn rather than downloaded.

The same idea as the Android launcher icon: the wordmark set in a real Devanagari
face with proper shaping (Raqm), on the app's own paper, as a rounded square so it
sits correctly among Windows' icons. Writes the PNGs the window uses and the
multi-size .ico that the installer and the shortcuts use.

    python3 make-icons.py      # → icons/bodha-256.png, bodha-512.png, bodha.ico
"""

from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, 'fonts', 'NotoSerifDevanagari')
if not os.path.exists(FONT):  # the Android folder keeps the same face
    FONT = os.path.join(HERE, '..', 'android', 'fonts', 'NotoSerifDevanagari')
OUT = os.path.join(HERE, 'icons')
WORD = 'बोध'

PAPER = (250, 247, 242, 255)      # #FAF7F2
TERRACOTTA = (193, 99, 59, 255)   # #C1633B
INK = (43, 39, 35, 255)           # #2B2723


def wordmark(size, colour, fill_fraction):
    """बोध centred on a transparent canvas, its width at `fill_fraction` of size."""
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    low, high, best = 8, int(size * 2), None
    while low <= high:
        mid = (low + high) // 2
        font = ImageFont.truetype(FONT, mid, layout_engine=ImageFont.Layout.RAQM)
        box = draw.textbbox((0, 0), WORD, font=font)
        width = box[2] - box[0]
        if width <= size * fill_fraction:
            best = (font, box)
            low = mid + 1
        else:
            high = mid - 1
    font, box = best
    draw.text(((size - (box[2] - box[0])) / 2 - box[0],
               (size - (box[3] - box[1])) / 2 - box[1]), WORD, font=font, fill=colour)
    return image


def tile(size, radius_fraction=0.22):
    """The icon as Windows shows it: paper, a hairline edge, the wordmark in ink."""
    tile_image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile_image)
    radius = int(size * radius_fraction)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=PAPER,
                           outline=(226, 218, 206, 255), width=max(1, size // 96))
    mark = wordmark(size, INK, 0.62)
    tile_image.alpha_composite(mark)
    return tile_image


def main():
    os.makedirs(OUT, exist_ok=True)
    big = tile(1024)
    for size, name in ((512, 'bodha-512.png'), (256, 'bodha-256.png'), (128, 'bodha-128.png')):
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    # The .ico carries every size Windows asks for, so Explorer, the taskbar and
    # the Alt+Tab switcher all get a sharp one.
    big.resize((256, 256), Image.LANCZOS).save(
        os.path.join(OUT, 'bodha.ico'), format='ICO',
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    # A small mark on terracotta, for the installer's header banner.
    header = Image.new('RGBA', (150, 57), TERRACOTTA)
    mark = wordmark(150, (253, 251, 248, 255), 0.34)
    header.alpha_composite(mark.resize((150, 150), Image.LANCZOS).crop((0, 46, 150, 103)))
    header.convert('RGB').save(os.path.join(OUT, 'header.bmp'), format='BMP')
    print('icons →', OUT)


if __name__ == '__main__':
    main()
