from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageOps


ROOT = Path(r"D:\成就素材")
OUT_DIR = Path(r"D:\liuliu-minimap\miniprogram\assets\images\loaders")
OUT_GIF = OUT_DIR / "achievement-cat-loader.gif"
OUT_PREVIEW = OUT_DIR / "achievement-cat-loader-preview.png"
CANVAS = 512
FRAME_MS = 90

SOURCE_FILES = [
    "猫步探春：解锁春季第一次漫步.PNG",
    "猫步逐夏：解锁夏季第一次漫步.PNG",
    "猫步踏秋：解锁秋季第一次漫步.PNG",
    "猫步寻冬：解锁冬季第一次漫步.PNG",
    "掌量世界：在10个不同地点进行漫步.PNG",
    "喵氏马拉松：单次漫步里程＞＝5公里.PNG",
    "节奏大师：解锁声音漫步.PNG",
]


def trim_transparent(img: Image.Image) -> Image.Image:
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    return img.crop(bbox) if bbox else img


def prepare_base_frame(path: Path) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    img = trim_transparent(img)
    img = ImageOps.contain(img, (360, 360), method=Image.Resampling.LANCZOS)
    return img


def transform_frame(base: Image.Image, step: int, phase: int) -> Image.Image:
    t = (step + phase) / 6
    scale = 1 + 0.04 * math.sin(t * math.tau)
    rotate = 6 * math.sin((t + 0.125) * math.tau)
    bob_y = 10 * math.sin((t + 0.25) * math.tau)
    bob_x = 5 * math.sin((t + 0.05) * math.tau)

    size = max(1, int(base.width * scale)), max(1, int(base.height * scale))
    frame_cat = base.resize(size, Image.Resampling.LANCZOS)
    frame_cat = frame_cat.rotate(rotate, resample=Image.Resampling.BICUBIC, expand=True)

    frame = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - frame_cat.width) // 2 + int(bob_x)
    y = (CANVAS - frame_cat.height) // 2 + int(bob_y)
    frame.alpha_composite(frame_cat, (x, y))

    # Add a tiny orbiting dot to make the loading state feel alive.
    orbit = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ox = CANVAS / 2 + math.cos(t * math.tau) * 170
    oy = CANVAS / 2 + math.sin(t * math.tau) * 170
    glow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    for r, alpha in [(18, 56), (12, 92), (7, 180)]:
        dot = Image.new("RGBA", (r * 2, r * 2), (0, 0, 0, 0))
        for yy in range(r * 2):
            for xx in range(r * 2):
                dx = xx - r
                dy = yy - r
                if dx * dx + dy * dy <= r * r:
                    dot.putpixel((xx, yy), (111, 230, 238, alpha))
        glow.alpha_composite(dot, (int(ox - r), int(oy - r)))
    orbit = Image.alpha_composite(orbit, glow)
    return Image.alpha_composite(frame, orbit)


def rgba_to_gif_palette(frame: Image.Image) -> Image.Image:
    # Reserve palette index 0 for transparency.
    alpha = frame.getchannel("A")
    solid = Image.new("RGBA", frame.size, (255, 255, 255, 0))
    solid.alpha_composite(frame)
    pal = solid.convert("RGB").convert("P", palette=Image.Palette.ADAPTIVE, colors=255)
    mask = alpha.point(lambda a: 255 if a <= 8 else 0)
    pal.paste(0, mask=mask)
    pal.info["transparency"] = 0
    pal.info["disposal"] = 2
    return pal


def build_preview(frames: list[Image.Image]) -> Image.Image:
    cols = 4
    rows = math.ceil(len(frames) / cols)
    tile = 160
    preview = Image.new("RGBA", (cols * tile, rows * tile), (248, 244, 232, 255))
    for i, frame in enumerate(frames[: cols * rows]):
        thumb = frame.copy()
        thumb = ImageOps.contain(thumb, (tile - 16, tile - 16), method=Image.Resampling.LANCZOS)
        x = (i % cols) * tile + (tile - thumb.width) // 2
        y = (i // cols) * tile + (tile - thumb.height) // 2
        preview.alpha_composite(thumb, (x, y))
    return preview


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bases = [prepare_base_frame(ROOT / name) for name in SOURCE_FILES]

    rgba_frames: list[Image.Image] = []
    for phase, base in enumerate(bases):
        for step in range(2):
            rgba_frames.append(transform_frame(base, step, phase))

    palette_frames = [rgba_to_gif_palette(frame) for frame in rgba_frames]
    palette_frames[0].save(
        OUT_GIF,
        save_all=True,
        append_images=palette_frames[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=False,
        transparency=0,
        disposal=2,
    )

    build_preview(rgba_frames).save(OUT_PREVIEW)


if __name__ == "__main__":
    main()
