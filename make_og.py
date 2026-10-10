
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H = 1200, 630
BG = (251, 247, 242)
ROSE = (183, 110, 121)
INK = (62, 48, 53)
MUTED = (143, 124, 129)

im = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(im)

def font(size, serif=False):
    paths = (
        [
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
            "C:/Windows/Fonts/georgia.ttf"
        ] if serif else [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf"
        ]
    )
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()

def centered(text, y, f, color):
    box = draw.textbbox((0, 0), text, font=f)
    width = box[2] - box[0]
    draw.text(
        ((W - width) / 2, y - box[1]),
        text, font=f, fill=color
    )

# Delicate double border
draw.rounded_rectangle(
    (42, 42, W-42, H-42),
    radius=16,
    outline=(225, 205, 202),
    width=2
)
draw.rounded_rectangle(
    (52, 52, W-52, H-52),
    radius=12,
    outline=(237, 222, 218),
    width=1
)

# Small decorative accents
for x in (130, W-130):
    draw.ellipse((x-4, 310-4, x+4, 310+4), fill=ROSE)

centered("THE BRIDAL EDIT", 115, font(23), ROSE)
centered("Guess the", 190, font(91, True), INK)
centered("Bride", 305, font(122, True), ROSE)

draw.line((450, 467, 750, 467), fill=(219, 167, 173), width=2)

centered(
    "11 GIRLS  |  ONE SECRET BRIDE",
    490,
    font(25),
    MUTED
)

output = Path(__file__).resolve().parent / "public" / "og.png"
output.parent.mkdir(parents=True, exist_ok=True)
im.save(output, "PNG", optimize=True)
print("Created:", output)
