"""Turns the rendered frames into the captioned GIFs of the README tour.

Each scene loops, and ends on a hold with a hint of where to click next.
Output: docs/img/tour/*.gif. Needs ffmpeg and the DejaVu fonts.
"""
import json, shutil, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[2]
FR = REPO / ".tour" / "frames"
TMP = REPO / ".tour" / "tmp"
OUT = REPO / "docs" / "img" / "tour"
W, H = 640, 360
FPS = 12
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
caps = json.load(open(FR / "captions.json"))


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def label(img, text, sub=None, where="bottom"):
    """A dark caption bar with a main line and an optional small line."""
    im = img.convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    f, fs = font(16, True), font(11)
    h = 34 + (18 if sub else 0)
    y0 = H - h if where == "bottom" else 0
    d.rectangle([0, y0, im.width, y0 + h], fill=(5, 8, 14, 200))
    d.text((im.width // 2, y0 + 17), text, font=f, fill=(240, 244, 250), anchor="mm")
    if sub:
        d.text((im.width // 2, y0 + 40), sub, font=fs, fill=(170, 182, 198), anchor="mm")
    return im.convert("RGB")


def frame(scene, i):
    return Image.open(FR / scene / f"{i:03d}.png").convert("RGB").resize((W, H), Image.LANCZOS)


def count(scene):
    return len(list((FR / scene).glob("*.png")))


def write(name, seq):
    """seq: list of (image, seconds). Encoded with a shared palette."""
    d = TMP / name
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    k = 0
    for img, secs in seq:
        for _ in range(max(1, round(secs * FPS))):
            img.save(d / f"{k:04d}.png")
            k += 1
    OUT.mkdir(parents=True, exist_ok=True)
    pal = d / "pal.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(d / "%04d.png"),
                    "-vf", "palettegen=max_colors=256:stats_mode=full", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(d / "%04d.png"), "-i", str(pal),
                    "-lavfi", "paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0",
                    str(OUT / f"{name}.gif")], check=True)
    print(name, k, "frames", round((OUT / f"{name}.gif").stat().st_size / 1e6, 2), "MB")


def fmt(day):
    from datetime import date
    y, m, dd = map(int, day.split("-"))
    return date(y, m, dd).strftime("%-d %b %Y")


NAMES = {"left": "the flood in Italy", "right": "the earthquake in Pakistan"}
TITLES = {"left": "Flood in Italy, 7 Oct 2026", "right": "Earthquake M 5.7, Pakistan, 17 Oct 2026"}
WHAT = {"left": "flood", "right": "quake"}
NEXT = {"left": "Click to zoom in", "right": "Click to see its seismic waves"}


def home():
    n = count("home")
    full = [frame("home", i) for i in range(n)]
    # Two halves that sit side by side and read as one picture.
    for side, box, text in (("left", (0, 0, W // 2, H), "◀  Flood in Italy"),
                            ("right", (W // 2, 0, W, H), "Earthquake in Pakistan  ▶")):
        seq = []
        for im in full:
            half = im.crop(box)
            dr = ImageDraw.Draw(half, "RGBA")
            dr.rectangle([0, H - 34, W // 2, H], fill=(5, 8, 14, 200))
            dr.text((W // 4, H - 17), text, font=font(16, True), fill=(240, 244, 250), anchor="mm")
            seq.append((half, 0.18))
        write(f"home-{side}", seq * 2)


def turn(side):
    n = count(f"turn-{side}")
    moving, hold = list(range(22)), list(range(22, n))
    seq = [(label(frame(f"turn-{side}", i), f"Turning to {NAMES[side]}…"), 1 / FPS) for i in moving]
    seq += [(label(frame(f"turn-{side}", i), TITLES[side], NEXT[side]), 0.16) for i in hold] * 3
    write(f"turn-{side}", seq)


def waves(side):
    n = count(f"waves-{side}")
    approach, steps = 16, 34
    seq = [(label(frame(f"waves-{side}", i), "Closing in on the epicentre…"), 1 / FPS) for i in range(approach)]
    rmax, WAVE = 120, 5.5
    for j in range(n - approach):
        im = frame(f"waves-{side}", approach + j)
        t = min(j, steps) / steps * (WAVE + 0.5)
        if t < WAVE:
            secs = round(min(1, t / WAVE) * rmax / 3.5)
            seq.append((label(im, f"Seismic waves spreading · {secs} s after the quake",
                              "Wave fronts at typical crust speeds, sped up about 6×. Not measured."), 1 / FPS))
        else:
            seq.append((label(im, "Red: slower S wave · White: faster P wave",
                              "Click to zoom in on the measured site"), 0.2))
    write(f"waves-{side}", seq)


def zoom(side):
    n = count(f"zoom-{side}")
    seq = [(label(frame(f"zoom-{side}", i), "Zooming in to the measured site…"), 1 / FPS) for i in range(n)]
    seq += [(label(frame(f"zoom-{side}", n - 1), "12 km across, cut into 500 m cells",
                   "Click to play NISAR's passes over it"), 2.0)]
    write(f"zoom-{side}", seq)


def play(side):
    c = caps[side]
    seq = []
    for cap in c["caps"]:
        im = frame(f"play-{side}", cap["frame"])
        if cap["when"] == "stood":
            share = f"{fmt(cap['date'])[:-5]}: {c['stood'] * 100:.1f}%"
            if c["stood"] >= c["stoodOut"]:
                text = f"{share} of cells stood out against their own past"
                sub = "Blue: echo fell · Orange: echo rose"
                if c.get("before") is not None:
                    sub += f" · Before the {WHAT[side]}: {c['before'] * 100:.1f}%"
            else:  # too few to say in words that the place stood out
                text = f"{share} of cells flagged: nothing clear stood out"
                sub = f"We say “stood out” from {c['stoodOut'] * 100:.0f}% on."
            if c.get("newVersion"):
                sub += " NASA's processing version changed with this pass."
            seq.append((label(im, text, sub), 4.0))
        else:
            first = " · first pass after" if cap["first_after"] else ""
            seq.append((label(im, f"NISAR pass, {fmt(cap['date'])}", f"{cap['when'].capitalize()}{first}"), 0.9))
    write(f"play-{side}", seq)


if __name__ == "__main__":
    jobs = sys.argv[1:] or ["home", "turn-left", "zoom-left", "play-left", "turn-right", "waves-right", "zoom-right", "play-right"]
    for j in jobs:
        if j == "home":
            home()
        else:
            kind, side = j.split("-")
            {"turn": turn, "waves": waves, "zoom": zoom, "play": play}[kind](side)
