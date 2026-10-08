#!/usr/bin/env python3
"""
BODHA's launcher icon — बोध, drawn rather than downloaded.

Rendered at build time so the wordmark uses a real Devanagari face with proper
shaping (Raqm), at every density Android asks for, plus the two layers of an
adaptive icon for Android 8 and later.
"""

from PIL import Image, ImageDraw, ImageFont
import os

FONT = os.path.join(os.path.dirname(__file__), 'fonts', 'NotoSerifDevanagari')
FONT = FONT if os.path.exists(FONT) else 'fonts/NotoSerifDevanagari'
OUT = os.path.join(os.path.dirname(__file__), 'res')
WORD = 'बोध'

CREAM = (250, 247, 242, 255)      # #FAF7F2 — the app's paper
TERRACOTTA = (193, 99, 59, 255)   # #C1633B — the app's accent
DEEP = (43, 39, 35, 255)          # #2B2723 — the app's ink

# Android's launcher sizes, in device pixels.
LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
# An adaptive icon is 108dp; only the middle 72dp is guaranteed visible.
ADAPTIVE = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}


def render_wordmark(size, colour, fill_fraction):
    """Draws बोध centred on a transparent canvas of `size`, sized to fill_fraction."""
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    target = size * fill_fraction
    # Binary-search the point size that gives the requested visual width.
    low, high = 8, int(size * 2)
    best = None
    while low <= high:
        mid = (low + high) // 2
        font = ImageFont.truetype(FONT, mid, layout_engine=ImageFont.Layout.RAQM)
        box = draw.textbbox((0, 0), WORD, font=font)
        width = box[2] - box[0]
        if width <= target:
            best = (font, box, width)
            low = mid + 1
        else:
            high = mid - 1
    font, box, width = best
    # Optically centre: Devanagari carries weight above the baseline, so centre
    # on the real ink box rather than the line box.
    x = (size - width) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), WORD, font=font, fill=colour)
    return image


def legacy_icon(size):
    """A rounded terracotta tile with the wordmark in cream."""
    scale = 4  # supersample, then shrink — cheap anti-aliasing
    big = size * scale
    tile = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=TERRACOTTA)
    word = render_wordmark(big, CREAM, 0.66)
    tile.alpha_composite(word)
    return tile.resize((size, size), Image.LANCZOS)


def adaptive_background(size):
    """Fills the full bleed — the launcher masks it to whatever shape it likes."""
    return Image.new('RGBA', (size, size), TERRACOTTA)


def adaptive_foreground(size):
    """The wordmark alone, inside the safe zone (66% of the canvas)."""
    return render_wordmark(size, CREAM, 0.44)


def splash(size):
    """The launch screen mark: the wordmark in ink on paper, for the theme."""
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    image.alpha_composite(render_wordmark(size, TERRACOTTA, 0.78))
    return image


def main():
    for density, px in LEGACY.items():
        folder = f'{OUT}/mipmap-{density}'
        os.makedirs(folder, exist_ok=True)
        legacy_icon(px).save(f'{folder}/ic_launcher.png')
        legacy_icon(px).save(f'{folder}/ic_launcher_round.png')
        print(f'  ic_launcher      {density:8} {px:4}px')
    for density, px in ADAPTIVE.items():
        folder = f'{OUT}/mipmap-{density}'
        os.makedirs(folder, exist_ok=True)
        adaptive_foreground(px).save(f'{folder}/ic_launcher_foreground.png')
        adaptive_background(px).save(f'{folder}/ic_launcher_background.png')
        print(f'  adaptive layers  {density:8} {px:4}px')
    os.makedirs(f'{OUT}/drawable-xxhdpi', exist_ok=True)
    splash(288).save(f'{OUT}/drawable-xxhdpi/splash_mark.png')
    os.makedirs(f'{OUT}/drawable-xhdpi', exist_ok=True)
    splash(192).save(f'{OUT}/drawable-xhdpi/splash_mark.png')
    print('  splash mark      2 densities')


if __name__ == '__main__':
    main()
