#!/usr/bin/env python3
"""How the change detector works, as one animated picture made from the
real cells of the flood in Italy (event-gdacs-fl1104220).

Every grid and every number on the frames comes from tools/detect.py
itself (read, relative, one_key, judge): nothing is computed a second
way here. Before anything is written, the shares on the frames are
checked against the published data/measured/<site>_detect.json.

    pip install numpy pillow
    python3 tools/explain_gif.py                 # writes the two files below
    python3 tools/explain_gif.py --frames DIR    # and every frame as a PNG

Writes demo/img/how-it-works.gif and demo/img/how-it-works.png (the last
frame, as a still). Made with an AI assistant; the frames say so.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import detect as D  # noqa: E402

SITE = "event-gdacs-fl1104220"
OUT = ROOT / "demo" / "img"
W, H = 1200, 675
BG, TEXT, DIM, ACCENT = "#05090f", "#eef3f8", "#a9b6c6", "#39e6c4"
WEAKER, STRONGER = "#40aaff", "#ffaa3c"  # fell, rose: the app's blue and orange
CELL_OFF = "#121a24"  # a cell with nothing to show
LINE = "#33404f"
# Echo strength: one hue, dark (weak echo) to light (strong echo).
SEQ = ["#0c2630", "#12565a", "#1f8f86", "#62cdb9", "#d4fff3"]
# Change: blue (fell), a neutral dark grey (no change), orange (rose).
DIV = [WEAKER, "#262d37", STRONGER]
NOTE = "Made with an AI assistant from NISAR L2 GCOV data (tools/explain_gif.py)"
MARGIN = 48


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    names = ["opentype/inter/Inter-SemiBold.otf", "truetype/dejavu/DejaVuSans-Bold.ttf"] if bold else ["opentype/inter/Inter-Regular.otf", "truetype/dejavu/DejaVuSans.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(f"/usr/share/fonts/{name}", size)
        except OSError:
            continue
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size)  # Pillow's own copy
    except OSError:
        return ImageFont.load_default()


def rgb(h: str) -> tuple[int, int, int]:
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def ramp(stops: list[str], v: float) -> tuple[int, int, int]:
    """The colour at v (0 to 1) along the stops."""
    v = min(max(float(v), 0.0), 1.0) * (len(stops) - 1)
    i = min(int(v), len(stops) - 2)
    a, b = rgb(stops[i]), rgb(stops[i + 1])
    return tuple(round(a[k] + (b[k] - a[k]) * (v - i)) for k in range(3))


def long_date(ms: float) -> str:
    d = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return f"{d.day} {d.strftime('%B %Y')}"


def short_date(ms: float) -> str:
    d = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return f"{d.day} {d.strftime('%b')}"


def wrap(draw: ImageDraw.ImageDraw, text: str, f, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and draw.textlength(trial, font=f) > width:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + [line]


def paragraph(draw, xy, text, f, fill, width, gap=6) -> int:
    """Text wrapped to a width; returns the y below it."""
    x, y = xy
    for line in wrap(draw, text, f, width):
        draw.text((x, y), line, font=f, fill=fill)
        y += f.size + gap
    return y


def grid(draw, x0, y0, cs, n, fill=None, outline=None, gap=2):
    """An n by n grid of squares, row 0 (north) at the top, column 0
    (west) at the left. `fill` and `outline` give a colour or None a cell
    (flat, n*n)."""
    for i in range(n * n):
        r, c = divmod(i, n)
        box = [x0 + c * cs, y0 + r * cs, x0 + (c + 1) * cs - gap - 1, y0 + (r + 1) * cs - gap - 1]
        colour = fill[i] if fill is not None and fill[i] is not None else CELL_OFF
        draw.rectangle(box, fill=colour)
        if outline is not None and outline[i] is not None:
            draw.rectangle(box, outline=outline[i], width=2)


def north(draw, x, y):
    """A small arrow with an N: north is up."""
    draw.line([(x, y + 26), (x, y + 4)], fill=DIM, width=2)
    draw.polygon([(x, y), (x - 5, y + 9), (x + 5, y + 9)], fill=DIM)
    draw.text((x, y + 30), "N", font=font(15, True), fill=DIM, anchor="ma")


def colour_bar(draw, x, y, w, stops, ticks, title):
    draw.text((x, y), title, font=font(19), fill=DIM)
    y += 30
    for i in range(w):
        draw.line([(x + i, y), (x + i, y + 15)], fill=ramp(stops, i / (w - 1)))
    for k, (pos, label) in enumerate(ticks):
        anchor = "la" if k == 0 else ("ra" if k == len(ticks) - 1 else "ma")
        draw.text((x + pos * (w - 1), y + 22), label, font=font(17), fill=DIM, anchor=anchor)
    return y + 50


def swatch(draw, x, y, label, fill=None, outline=None):
    box = [x, y + 2, x + 19, y + 21]
    draw.rectangle(box, fill=fill or CELL_OFF)
    if outline:
        draw.rectangle(box, outline=outline, width=2)
    draw.text((x + 32, y), label, font=font(19), fill=TEXT)
    return y + 32


def timeline(draw, x, y, w, times, event, now, compared):
    """The passes as dots on a line, with the flood between them. `now`
    is the pass shown, `compared` the passes it is set against."""
    lo, hi = times[0], times[-1]
    at = lambda t: x + 26 + (w - 52) * (t - lo) / (hi - lo)  # noqa: E731
    draw.line([(x, y), (x + w, y)], fill=LINE, width=2)
    xe = at(event)
    draw.line([(xe, y - 22), (xe, y + 12)], fill=TEXT, width=2)
    draw.text((xe, y - 46), "flood reported", font=font(16), fill=TEXT, anchor="ma")
    for i, t in enumerate(times):
        cx = at(t)
        if i == now:
            draw.ellipse([cx - 9, y - 9, cx + 9, y + 9], fill=ACCENT, outline=BG, width=2)
        elif i in compared:
            draw.ellipse([cx - 7, y - 7, cx + 7, y + 7], fill=TEXT, outline=BG, width=2)
        else:
            draw.ellipse([cx - 6, y - 6, cx + 6, y + 6], fill=BG, outline=DIM, width=2)
        draw.text((cx, y + 18), short_date(t), font=font(16, i == now), fill=TEXT if i == now else DIM, anchor="ma")


def base_frame(caption: str, step: int, steps: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(im)
    f = font(34, True)
    lines = wrap(draw, caption, f, W - 2 * MARGIN)
    assert len(lines) <= 2, caption
    if len(lines) == 2:
        # Two lines of about the same length, not one full and one word.
        words = caption.split()
        cuts = [(" ".join(words[:k]), " ".join(words[k:])) for k in range(1, len(words))]
        lines = list(min(cuts, key=lambda c: max(draw.textlength(part, font=f) for part in c)))
    y = 26 if len(lines) == 2 else 46
    for line in lines:
        draw.text((MARGIN, y), line, font=f, fill=TEXT)
        y += 42
    draw.text((MARGIN, H - 34), NOTE, font=font(16), fill=DIM)
    # The step counter, with a dot a step.
    draw.text((W - MARGIN, H - 38), f"{step} / {steps}", font=font(22, True), fill=TEXT, anchor="ra")
    for k in range(steps):
        cx = W - MARGIN - 70 - (steps - 1 - k) * 16
        draw.ellipse([cx - 4, H - 30, cx + 4, H - 22], fill=ACCENT if k < step else LINE)
    return im, draw


GX, GY, CS = MARGIN + 34, 126, 20  # the grid: left, top, pixels a cell
PX, PW = 620, W - MARGIN - 620  # the panel right of it: left, width


def scene(caption, step, steps, n, times, event, now, compared, when, fill=None, outline=None) -> tuple[Image.Image, ImageDraw.ImageDraw, int]:
    """A frame with the grid at the left and, at the right, the date and
    the timeline. Returns the y from which the panel is free."""
    im, draw = base_frame(caption, step, steps)
    grid(draw, GX, GY, CS, n, fill, outline)
    north(draw, MARGIN + 10, GY + 2)
    draw.text((GX, GY + n * CS + 6), f"{n * 0.5:.0f} km across · one square = 500 m of ground", font=font(16), fill=DIM)
    draw.text((PX, GY - 2), "NISAR pass of", font=font(19), fill=DIM)
    draw.text((PX, GY + 22), long_date(times[now]), font=font(40, True), fill=TEXT)
    draw.text((PX, GY + 74), when, font=font(19), fill=DIM)
    timeline(draw, PX, GY + 164, PW, times, event, now, compared)
    return im, draw, GY + 224


def stat(draw, y, number: str, text: str, small: str) -> int:
    f = font(52, True)
    draw.text((PX, y), number, font=f, fill=TEXT)
    w = draw.textlength(number, font=f)
    draw.text((PX + w + 18, y + 6), text, font=font(21), fill=TEXT)
    draw.text((PX + w + 18, y + 34), small, font=font(19), fill=DIM)
    return y + 74


def main() -> None:
    grid_file = json.loads((D.OUT_DIR / f"{SITE}_grid.json").read_text())
    event = json.loads((D.OUT_DIR / f"{SITE}.json").read_text())["event"]
    published = json.loads((D.OUT_DIR / f"{SITE}_detect.json").read_text())
    times, n = grid_file["times"], grid_file["n"]
    assert grid_file["cellM"] == 500, "the frames say a cell is 500 m"
    hh, hv = D.read(grid_file)
    base = [i for i, t in enumerate(times) if t < event]  # the passes before the flood
    t = len(base)  # the first pass after it
    recent_base = base[-D.RECENT :]
    cells = n * n

    # --- The detector's own results -------------------------------------
    final = D.judge(hh, hv, base, t, n, need=1)
    key1 = D.one_key(hh, hv, recent_base, t, n)
    key2 = D.one_key(hh, hv, base, t, n)
    valid = final["valid"]
    later = {i: D.judge(hh, hv, base, i, n, need=1) for i in range(t + 1, len(times))}

    # The same numbers as published, or nothing is written.
    rows = {r["date"]: r for r in published["byDate"]}
    for i, r in [(t, final), *later.items()]:
        row = rows[D.F.day(times[i])]
        assert D.share(r["kept"][r["valid"]].mean()) == row["stood"], (row["date"], "stood")
        assert D.share(r["recent"][r["valid"]].mean()) == row["recent"], (row["date"], "recent")
        assert D.share(r["long"][r["valid"]].mean()) == row["long"], (row["date"], "long")
    assert D.share(final["kept"][valid].mean()) == published["event"]["stood"] == 0.0347
    assert (key1["kept"] == final["recent"]).all() and (key2["kept"] == final["long"]).all()
    assert (final["kept"] == (key1["kept"] & key2["kept"])).all()

    # The step drawn in frame 4 is the one the recent key scores: the new
    # pass minus the mean of the two latest before, each first taken
    # relative to its own middle. It must be the key's HH score times one
    # number (the spread), or the picture would not show what is judged.
    rel = D.relative(hh)
    step = rel[t] - np.nanmean(rel[recent_base], axis=0)
    step = step - np.nanmedian(step)
    ratio = step / key1["each"][0]
    assert np.nanstd(ratio) < 1e-9, "the step drawn is not the step scored"
    whole_area = float(np.nanmedian(hh[t]) - np.nanmean(np.nanmedian(hh[recent_base], axis=1)))

    # --- Colours ----------------------------------------------------------
    lo, hi = np.floor(np.nanpercentile(hh, 1)), np.ceil(np.nanpercentile(hh, 99))
    swing = float(np.ceil(np.nanpercentile(np.abs(step), 99)))
    seq = lambda row: [None if not np.isfinite(v) else ramp(SEQ, (v - lo) / (hi - lo)) for v in row]  # noqa: E731
    div = lambda row: [None if not np.isfinite(v) else ramp(DIV, (v + swing) / (2 * swing)) for v in row]  # noqa: E731
    sign = lambda r: [None if not k else (STRONGER if z > 0 else WEAKER) for k, z in zip(r["kept"], r["lead"])]  # noqa: E731
    db_ticks = [(0.0, f"{lo:.0f} dB · weak echo"), (1.0, f"strong echo · {hi:+.0f} dB")]
    days_after = round((times[t] - event) / 86_400_000)
    before, after = "before the flood", f"{days_after} days after the flood was reported"
    steps = 8
    frames: list[tuple[Image.Image, int]] = []

    # 1. The cells.
    im, draw, y = scene("NISAR's radar echo, cut into cells of 500 m", 1, steps, n, times, event, 0, [], before, seq(hh[0]))
    y = colour_bar(draw, PX, y + 8, 360, SEQ, db_ticks, "Strength of the echo (HH)")
    paragraph(draw, (PX, y + 8), f"{cells} cells: one number for each, at every pass.", font(20), TEXT, PW)
    frames.append((im, 2400))

    # 2. Pass after pass.
    for k, i in enumerate(base[1:]):
        im, draw, y = scene("Pass after pass, a cell keeps to its own level", 2, steps, n, times, event, i, [], before, seq(hh[i]))
        y = colour_bar(draw, PX, y + 8, 360, SEQ, db_ticks, "Strength of the echo (HH)")
        paragraph(draw, (PX, y + 8), "Every 12 days the same picture: that is what is ordinary here.", font(20), TEXT, PW)
        frames.append((im, 1000 if i == base[-1] else 900))

    # 3. The first pass after.
    im, draw, y = scene("The first pass after the flood", 3, steps, n, times, event, t, [], after, seq(hh[t]))
    y = colour_bar(draw, PX, y + 8, 360, SEQ, db_ticks, "Strength of the echo (HH)")
    paragraph(draw, (PX, y + 8), f"By eye: a little {'brighter' if whole_area > 0 else 'darker'} all over, otherwise the same picture.", font(20), TEXT, PW)
    frames.append((im, 2400))

    # 4. The relative step.
    im, draw, y = scene("Take away what moved the whole area (rain, season)", 4, steps, n, times, event, t, recent_base, "set against the two passes before it", div(step))
    y = colour_bar(draw, PX, y + 8, 360, DIV, [(0.0, f"−{swing:.0f} dB · fell"), (0.5, "0"), (1.0, f"rose · +{swing:.0f} dB")], "Change of each cell (HH), area's own shift removed")
    paragraph(draw, (PX, y + 8), f"The whole area read {abs(whole_area):.1f} dB {'stronger' if whole_area > 0 else 'weaker'}: taken away. What is left is each cell against the ground around it.", font(20), TEXT, PW)
    frames.append((im, 2800))

    # 5 and 6. The two keys.
    for step_no, key, compared, caption, against in (
        (5, key1, recent_base, "Key 1: has the cell left what the place read on its two latest passes?", "set against the two passes before it"),
        (6, key2, base, "Key 2: has it left its own usual reading over the longer history?", f"set against all {len(base)} passes before it"),
    ):
        alone = key["over"] & ~key["kept"]
        im, draw, y = scene(caption, step_no, steps, n, times, event, t, compared, against, [ACCENT if k else None for k in key["kept"]], [ACCENT if a else None for a in alone])
        y = stat(draw, y + 4, D.pct(D.share(key["kept"][valid].mean())), "of the cells flagged", f"{int(key['kept'].sum())} of {cells} cells")
        y = swatch(draw, PX, y, "over the bar, with flagged neighbours", fill=ACCENT)
        y = swatch(draw, PX, y, f"over the bar, but alone: dropped ({int(alone.sum())})", outline=ACCENT)
        paragraph(draw, (PX, y + 8), "The bar: only 1 cell in 100 gets over it on a quiet pass.", font(19), DIM, PW)
        frames.append((im, 2800))

    # 7. Both keys.
    kept = final["kept"]
    one_only = (final["recent"] | final["long"]) & ~kept
    rose, fell = int((kept & (final["lead"] > 0)).sum()), int((kept & (final["lead"] < 0)).sum())
    assert rose + fell == int(kept.sum())
    im, draw, y = scene("Only cells that both keys flag count. Each key asks for flagged neighbours", 7, steps, n, times, event, t, base, after, sign(final), [LINE if o else None for o in one_only])
    y = stat(draw, y + 4, D.pct(published["event"]["stood"]), "of the ground stood out", f"{int(kept.sum())} of {cells} cells")
    y = swatch(draw, PX, y, f"echo rose ({rose} cells)", fill=STRONGER)
    y = swatch(draw, PX, y, f"echo fell ({fell} cells)", fill=WEAKER)
    y = swatch(draw, PX, y, f"one key only: not counted ({int(one_only.sum())})", outline=LINE)
    frames.append((im, 3400))

    # 8. The passes after: three small grids.
    im, draw = base_frame("On the passes after, the change fades", 8, steps)
    cs, top = 13, 132
    wide = n * cs
    space = (W - 2 * MARGIN - 3 * wide) // 2
    for k, (i, r) in enumerate([(t, final), *later.items()]):
        x = MARGIN + k * (wide + space)
        grid(draw, x, top, cs, n, sign(r), gap=1)
        draw.text((x, top + wide + 12), long_date(times[i]), font=font(22), fill=DIM)
        number = D.pct(rows[D.F.day(times[i])]["stood"])
        draw.text((x, top + wide + 42), number, font=font(52, True), fill=TEXT)
        w = draw.textlength(number, font=font(52, True))
        draw.text((x + w + 14, top + wide + 68), "stood out", font=font(22), fill=TEXT)
    y = top + wide + 114
    draw.rectangle([MARGIN, y + 2, MARGIN + 19, y + 21], fill=STRONGER)
    draw.text((MARGIN + 30, y), "echo rose", font=font(19), fill=TEXT)
    draw.rectangle([MARGIN + 150, y + 2, MARGIN + 169, y + 21], fill=WEAKER)
    draw.text((MARGIN + 180, y), "echo fell", font=font(19), fill=TEXT)
    draw.text((MARGIN + 300, y), f"· all three against the same passes before the flood (reported {long_date(event)})", font=font(19), fill=DIM)
    frames.append((im, 3600))

    # --- Write ------------------------------------------------------------
    # One palette for all frames, taken from all of them, and no dither:
    # flat colours stay flat and the file stays small.
    sheet = Image.new("RGB", (W, H * len(frames)))
    for k, (im, _) in enumerate(frames):
        sheet.paste(im, (0, k * H))
    found = sheet.quantize(colors=240, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).getpalette()[: 240 * 3]
    # The colours that carry meaning are put in exactly: left to itself
    # the palette rounds the few blue cells to a neighbouring shade.
    exact = [v for h in (BG, TEXT, DIM, ACCENT, WEAKER, STRONGER, CELL_OFF, LINE) for v in rgb(h)]
    palette = Image.new("P", (1, 1))
    palette.putpalette(exact + found)
    out = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im, _ in frames]
    OUT.mkdir(parents=True, exist_ok=True)
    out[0].save(OUT / "how-it-works.gif", save_all=True, append_images=out[1:], duration=[d for _, d in frames], loop=0, optimize=True, disposal=1)
    frames[-1][0].save(OUT / "how-it-works.png", optimize=True)
    if "--frames" in sys.argv:
        folder = Path(sys.argv[sys.argv.index("--frames") + 1])
        folder.mkdir(parents=True, exist_ok=True)
        for k, im in enumerate(out):
            im.convert("RGB").save(folder / f"frame-{k + 1:02d}.png")

    total = sum(d for _, d in frames) / 1000
    print(f"{len(frames)} frames, {total:.1f} s, {(OUT / 'how-it-works.gif').stat().st_size / 1024:.0f} kB -> {OUT / 'how-it-works.gif'}")
    print(f"first pass after: key 1 {D.pct(published['event']['recent'])} ({int(key1['kept'].sum())} cells, {int(key1['over'].sum())} over the bar), key 2 {D.pct(published['event']['long'])} ({int(key2['kept'].sum())}, {int(key2['over'].sum())} over), both {D.pct(published['event']['stood'])} ({int(kept.sum())}: {rose} rose, {fell} fell)")
    print("later: " + ", ".join(f"{D.F.day(times[i])} {D.pct(rows[D.F.day(times[i])]['stood'])}" for i in later))
    print(f"scales: echo {lo:.0f} to {hi:+.0f} dB, change ±{swing:.0f} dB; the whole area moved {whole_area:+.2f} dB")


if __name__ == "__main__":
    main()
