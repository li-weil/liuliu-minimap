from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(r"D:\成就素材")
BASE_PNG = ROOT / "喵氏马拉松：单次漫步里程＞＝5公里.PNG"
OUT_PNG = ROOT / "节奏大师：解锁声音漫步.PNG"
OUT_JPG = ROOT / "节奏大师：解锁声音漫步.JPG"
SIZE = 4096
BG = (247, 243, 230, 255)
CYAN = (80, 225, 235, 210)
CYAN_SOFT = (120, 240, 245, 110)
BLACK = (18, 18, 18, 220)


def rough_line(draw: ImageDraw.ImageDraw, points, fill, width, repeats=10, jitter=24):
    for _ in range(repeats):
        pts = [
            (
                x + random.uniform(-jitter, jitter),
                y + random.uniform(-jitter, jitter),
            )
            for x, y in points
        ]
        w = max(1, int(width + random.uniform(-width * 0.15, width * 0.15)))
        alpha = max(20, min(255, int(fill[3] + random.uniform(-30, 20))))
        draw.line(pts, fill=(*fill[:3], alpha), width=w, joint="curve")


def rough_arc(draw, box, start, end, fill, width, repeats=10, jitter=18, steps=24):
    x1, y1, x2, y2 = box
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    rx = (x2 - x1) / 2
    ry = (y2 - y1) / 2
    pts = []
    for i in range(steps + 1):
        t = math.radians(start + (end - start) * (i / steps))
        pts.append((cx + rx * math.cos(t), cy + ry * math.sin(t)))
    rough_line(draw, pts, fill, width, repeats=repeats, jitter=jitter)


def rough_ellipse(draw, box, outline, width, fill=None, repeats=8, jitter=14):
    x1, y1, x2, y2 = box
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    rx = (x2 - x1) / 2
    ry = (y2 - y1) / 2
    for _ in range(repeats):
        jx = random.uniform(-jitter, jitter)
        jy = random.uniform(-jitter, jitter)
        pts = []
        for i in range(36):
            t = math.tau * i / 36
            pts.append(
                (
                    cx + jx + (rx + random.uniform(-jitter, jitter)) * math.cos(t),
                    cy + jy + (ry + random.uniform(-jitter, jitter)) * math.sin(t),
                )
            )
        if fill:
            draw.polygon(pts, fill=fill)
        pts.append(pts[0])
        rough_line(draw, pts, outline, width, repeats=1, jitter=max(4, jitter / 2))


def rough_note(draw, x, y, scale=1.0):
    head_w = 150 * scale
    head_h = 115 * scale
    rough_ellipse(
        draw,
        (x, y, x + head_w, y + head_h),
        outline=BLACK,
        width=int(30 * scale),
        fill=CYAN_SOFT,
        repeats=5,
        jitter=10 * scale,
    )
    stem = [
        (x + head_w * 0.76, y + head_h * 0.3),
        (x + head_w * 0.76, y - 150 * scale),
    ]
    rough_line(draw, stem, BLACK, int(28 * scale), repeats=5, jitter=8 * scale)
    rough_line(
        draw,
        [(x + head_w * 0.74, y - 145 * scale), (x + head_w * 1.26, y - 50 * scale)],
        BLACK,
        int(26 * scale),
        repeats=4,
        jitter=10 * scale,
    )
    rough_line(
        draw,
        [(x + head_w * 0.74, y - 145 * scale), (x + head_w * 1.26, y - 50 * scale)],
        CYAN,
        int(16 * scale),
        repeats=3,
        jitter=10 * scale,
    )


def recolor_pinks(img: Image.Image) -> Image.Image:
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if r > 165 and b > 145 and g < 235 and (r - g) > 15:
                px[x, y] = (
                    110,
                    230,
                    240,
                    a,
                )
    return img


def main():
    random.seed(42)
    base = recolor_pinks(Image.open(BASE_PNG).convert("RGBA"))

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    offset = ((SIZE - base.width) // 2, 0)
    canvas.alpha_composite(base, offset)

    # Clear the original sparkles so the sound-themed marks read cleanly.
    erase = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    erase_draw = ImageDraw.Draw(erase, "RGBA")
    erase_draw.ellipse((40, 20, 1160, 1120), fill=(0, 0, 0, 255))
    erase_draw.ellipse((3120, 700, 4096, 2240), fill=(0, 0, 0, 255))
    erase_draw.ellipse((2940, 2860, 3500, 3460), fill=(0, 0, 0, 255))
    alpha = canvas.getchannel("A")
    alpha = Image.composite(Image.new("L", alpha.size, 0), alpha, erase.getchannel("A"))
    canvas.putalpha(alpha)

    paint = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(paint, "RGBA")

    # Headphones
    rough_arc(draw, (900, 320, 3180, 1400), 202, 338, BLACK, 72, repeats=9, jitter=18, steps=28)
    rough_arc(draw, (930, 350, 3150, 1360), 202, 338, CYAN, 42, repeats=8, jitter=16, steps=28)
    rough_ellipse(draw, (770, 1040, 1210, 1820), BLACK, 44, fill=CYAN_SOFT, repeats=7, jitter=18)
    rough_ellipse(draw, (2886, 1040, 3326, 1820), BLACK, 44, fill=CYAN_SOFT, repeats=7, jitter=18)
    rough_ellipse(draw, (860, 1150, 1120, 1710), CYAN, 18, fill=(100, 230, 238, 95), repeats=5, jitter=10)
    rough_ellipse(draw, (2976, 1150, 3236, 1710), CYAN, 18, fill=(100, 230, 238, 95), repeats=5, jitter=10)

    # Waveform trail
    waveform = [
        (620, 3400),
        (980, 3360),
        (1180, 3180),
        (1460, 3520),
        (1790, 3260),
        (2120, 3550),
        (2470, 3180),
        (2820, 3500),
        (3150, 3340),
        (3500, 3380),
    ]
    rough_line(draw, waveform, BLACK, 56, repeats=8, jitter=24)
    rough_line(draw, waveform, CYAN, 28, repeats=7, jitter=24)

    # Floating music notes
    rough_note(draw, 540, 520, 1.35)
    rough_note(draw, 3180, 700, 1.05)
    rough_note(draw, 2780, 3000, 0.9)

    # Sound rings near headphones
    for box in [(500, 980, 1280, 1900), (2810, 980, 3590, 1900)]:
        rough_arc(draw, box, 215, 330, CYAN_SOFT, 20, repeats=5, jitter=14, steps=20)

    paint = paint.filter(ImageFilter.GaussianBlur(1.2))
    final = Image.alpha_composite(canvas, paint)
    final.save(OUT_PNG)

    bg = Image.new("RGBA", (SIZE, SIZE), BG)
    bg.alpha_composite(final)
    bg.convert("RGB").save(OUT_JPG, quality=96)


if __name__ == "__main__":
    main()
