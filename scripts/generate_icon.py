"""Generate SpriteSplit app icon with two interlocking S letters."""
from PIL import Image, ImageDraw, ImageFont
import os
import subprocess

SIZE = 1024
ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
RADIUS = 220

BG = (22, 24, 30)
ACCENT = (255, 190, 89)
WHITE = (255, 255, 255)


def find_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/System/Library/Fonts/SFNSText.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, ValueError):
            continue
    return ImageFont.load_default()


def draw_s(img: Image.Image, color: tuple[int, ...], ox: int, oy: int, rotation: float, scale: float) -> Image.Image:
    font_size = int(480 * scale)
    font = find_font(font_size)

    txt = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(txt)

    bbox = draw.textbbox((0, 0), "S", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (SIZE - tw) // 2 - bbox[0] + ox
    ty = (SIZE - th) // 2 - bbox[1] + oy - 20

    draw.text((tx, ty), "S", fill=(*color[:3], 255), font=font)
    return txt.rotate(rotation, resample=Image.BICUBIC, center=(SIZE // 2, SIZE // 2))


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, SIZE, SIZE], radius=RADIUS, fill=(*BG, 255))

    # subtle vertical gradient
    for i in range(SIZE):
        t = i / SIZE
        a = int(12 * (1 - abs(t - 0.5) * 2))
        draw.line([(0, i), (SIZE, i)], fill=(255, 255, 255, a))

    # back S — accent color, rotated left
    img = Image.alpha_composite(img, draw_s(img, ACCENT, 18, 12, -8, 0.95))
    # front S — white, rotated right
    img = Image.alpha_composite(img, draw_s(img, WHITE, -14, -8, 5, 1.0))

    # top inner shadow
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    for i in range(60):
        a = int(40 * (1 - i / 60))
        sdraw.line([(RADIUS, i), (SIZE - RADIUS, i)], fill=(0, 0, 0, a))
    img = Image.alpha_composite(img, shadow)

    # icon.png (full RGBA)
    img.save(os.path.join(ICON_DIR, "icon.png"), "PNG")

    # platform sizes — all RGBA
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }
    for name, s in sizes.items():
        img.resize((s, s), Image.LANCZOS).save(os.path.join(ICON_DIR, name), "PNG")

    # .icns
    iconset = "/tmp/SpriteSplit.iconset"
    os.makedirs(iconset, exist_ok=True)
    for s in [16, 32, 64, 128, 256, 512]:
        img.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"), "PNG")
        if s <= 512:
            img.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"), "PNG")
    subprocess.run(["iconutil", "-c", "icns", "-o", os.path.join(ICON_DIR, "icon.icns"), iconset], check=True)

    # .ico
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    frames = [img.resize(s, Image.LANCZOS).convert("RGB") for s in ico_sizes]
    frames[0].save(os.path.join(ICON_DIR, "icon.ico"), format="ICO", sizes=ico_sizes, append_images=frames[1:])

    print("Icon generated in", ICON_DIR)


if __name__ == "__main__":
    main()
