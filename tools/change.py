#!/usr/bin/env python3
"""How the whole planet's radar picture changed in 48 days, like with like.

NISAR repeats its orbit exactly every 12 days, so a day and the day 48
days before it fly the same tracks. This script compares each day of a
24-day window with the day 48 days earlier, pass against the same pass,
and stacks the differences into one picture of the planet: where NASA's
NISAR picture got darker (the radar echo weaker) and where it got
brighter (the echo stronger).

Comparing two ready-made mosaics instead does not work: where the pass
on top differs between the two (another direction, another radar mode, a
pass NASA has not published for one of the periods) the difference is
the passes', not the ground's, and shows as straight strips and wedges.
That was tried first (15 November 2026).

What is compared is NASA's false-colour picture of the GCOV product
(the GIBS layer the app shows), NOT calibrated backscatter. The measure
is the mean of the red and green channels, 0 to 255: both rise with the
echo (their changes go together), while blue is high where the echo is
weak. The app says so wherever it shows this picture.

A pair of days is only used where it compares like with like, judged in
blocks of 16 pixels:
  footprint  where one day has data and the other has not (over 3 % of
             the block), a pass is missing on one side; that block and
             the blocks next to it are left out.
  colour     where the colour family (R-G)/(R+G) differs by more than
             0.2 between the two days, the strip was recorded in another
             radar mode (single-polarisation passes come out orange,
             dual-polarisation ones green); left out with its neighbours.

Result of 15 November 2026 (20 October to 12 November against 2 to 25
September): 58 % of the overlapping pixels accepted, 16 % left out by the
footprint rule, 26 % by the colour rule; half the map covered. Ground
that should not change reads near zero (Sahara core -1.3, central
Australia -0.6 of 255), where the mosaic comparison read up to -22.

Checked against the calibrated measurements in data/measured/ at the six
places where the picture and a measurement are the same two passes: the
direction agrees at five, at 7 to 10 units of the picture per decibel
(Aletsch, a fire in Utah, a flood in Italy, the Okavango, Rondonia). At
the rice fields of Bardhaman it does not: between 24 September and 11
November HH fell by 1.3 dB and HV rose by 2.4 dB, and the picture, which
mixes both channels, got brighter.

What remains, and is said in the app: the "after" day differs by up to 24
days from place to place, so where the ground was freezing during the
window neighbouring passes show different amounts of change with a
straight edge between them; rainforest reads 5 to 7 units darker for a
reason not established; and there are holes where no pair was accepted.

    pip install pillow numpy
    python tools/change.py                      # 24 days up to NASA's newest day
    python tools/change.py --end 2026-11-12 --cache /some/folder

A second product, "what stands out from its surroundings" (written to
data/standout/, levels 0 to 4), is the rough planet-wide counterpart of
the calibrated "peers" measure in tools/forecast.py. From each pixel's
change it takes away the median change of the ground around it, about
270 km across at every latitude, counted only among pixels of the same
pair of days. What hit a whole region alike (freezing, a dry season, a
pass that reads darker as a whole) goes; what is left is how a pixel
differs from its neighbours of the same pass. It is coloured only beyond
three robust spreads (1.4826 x the median absolute deviation) of that
remainder over the whole covered map. The median is taken on a grid of
8-pixel cells (the median of the cells' medians) and enlarged again, so
it is quick; a pixel with under a quarter of its surroundings covered by
its own pair gets no value. It says "unlike its surroundings", not what
happened there: a field harvested, a lake frozen, a flood and the edge
of a strip all stand out alike.

Result of 15 November 2026: a threshold of 8.7 of 255; 42 % of the map
has a value and 11.6 % of that is coloured (27 % north of 60 degrees,
under 1 % in the Sahara core and the central Amazon). The regional part
goes as intended: where the change itself has a median of -16 (Siberia,
Canada), -13 (Sahel) or -7 (Amazon forest), the remainder's median is
within 0.3 of zero. What is left is mostly unevenness of the season
(patchy freezing, harvest, burning) and wind on water; the edges of
strips are a smaller part (one in six of the coloured pixels lies
within 3 pixels of an edge of its strip, where one in nine of all
valued pixels lies).
Checked against events reported between the two passes: see
CHECKED_STANDOUT below. Wildfires are coloured a little more often than
other ground; floods and earthquakes are not, and the two events the
calibrated measurement shows best are not coloured at all. It is a
picture of where the change was uneven, not an event finder.

It makes about 21,000 small requests (no login) and takes about a quarter
of an hour; the day tiles are kept in --cache (900 MB) so that the
stacking can be redone without asking NASA again. It writes
data/change/{z}/{x}/{y}.webp (see-through tiles, levels 0 to 5) and
data/change/about.json, and data/standout/ in the same shape (levels 0
to 4). The tiles are Web Mercator (GoogleMapsCompatible), so a level-5
pixel is 4.9 km at the equator and 2.4 km at 60 degrees.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mosaic as M  # noqa: E402

LEVEL = 5
N = 256 * 2**LEVEL  # the world at level 5, in pixels
BLOCK = 16
GAP_DAYS = 48  # four rounds of the orbit
FOOTPRINT = 0.03
COLOUR = 0.2
DEAD_BAND = 10.0  # changes smaller than this are not drawn
FULL = 40.0  # full colour from here
WEAKER = (0x40, 0xAA, 0xFF)  # as PALETTE.weaker in js/config.js
STRONGER = (0xFF, 0xAA, 0x3C)  # as PALETTE.stronger

# What stands out from its surroundings.
STANDOUT_LEVEL = 4  # the finest level written
CELL = 8  # pixels to a cell of the reduced grid the regional median is taken on
ACROSS_KM = 270.0  # the surroundings: a square about this wide, at every latitude
MOST_CELLS = 10  # the square reaches at most this many cells each way (met beyond 73 degrees)
ENOUGH = 0.25  # of the surroundings must be covered by the pixel's own pair of days
SPREADS = 3.0  # coloured beyond this many robust spreads of the remainder
FAINTEST = 0.35  # opacity just beyond the threshold; full at twice the threshold
EQUATOR_KM = 40075.0
LIMITS_STANDOUT = (
    "It says where a pixel changed differently from the ground around it, not what happened there, and not that anything happened: "
    "a patch that stayed as it was while everything around it froze or dried reads orange just as one that got brighter. "
    "A harvested field, a lake freezing, wind on open water (seas and lakes are not masked out), wet snow, a flood, a burn and the edge of a radar strip all stand out alike; "
    "pixels beside the edge of their strip are coloured about one and a half times as often as the rest. "
    "Something that fills more than half of the 270 km square around it becomes its own surroundings and disappears. "
    "One threshold serves the whole planet, so busy regions (the freezing north, the drying Sahel) are coloured several times as often as deserts and rainforest. "
    "NASA's processing version changed from P05023 to P05036 with the passes from about 21 October 2026, between the 'before' and most of the 'after' days; calibrated measurements fell by about 0.4 dB at that step. "
    "A step that is alike across a region is taken out here with the regional median, but one that differs within a strip is not. "
    "It is the brightness of a picture, not calibrated backscatter, and mixes both radar channels. "
    "No value (holes): no pair of passes that compares like with like, or the pixel's own pair covers under a quarter of its surroundings."
)
# What the check against reported events gave; only true of the window it was made on.
CHECKED_STANDOUT_WINDOW = ("2026-11-12", 24)
CHECKED_STANDOUT = (
    "Checked on 15 November 2026 against events reported between the two passes of the ground around them (NASA EONET, USGS, GDACS), within 25 km of each, with the threshold fixed beforehand. "
    "507 wildfires: 21 % of the ground around them coloured on average, against 15 % at 2,000 random covered points and 16 % at covered points 100 to 400 km from the fires; a fire is more coloured than a random point 57 times in 100 (50 would be chance). "
    "51 floods (placed only by the middle of a reported outline): 12 %, no more than random ground. 15 earthquakes of M 5.5 or more on covered ground: 7 %, less than random ground. "
    "At the flood in Italy of 7 October and the earthquake near Khuzdar of 17 October, where the calibrated measurement found 31 % and 25 % of its 500 m cells standing out, this picture colours nothing within 25 km. "
    "So it does not find events: it shows where the change was uneven."
)


def day_pairs(end: datetime.date, days: int) -> list[tuple[str, str]]:
    """(after, before) for each day of the window, newest first."""
    return [((end - datetime.timedelta(days=k)).isoformat(), (end - datetime.timedelta(days=k + GAP_DAYS)).isoformat()) for k in range(days)]


def fetch(pairs, cache: str, workers: int) -> dict:
    """Every level-5 tile that holds something on both days of a pair, into
    the cache. Returns the plan: for each "after" day its "before" day
    and the tiles."""
    gate = threading.Semaphore(4)  # the map service is asked gently
    real = M.fetch_picture

    def gated(url, tries=5):
        with gate:
            return real(url, tries)

    M.fetch_picture = gated
    days = sorted({d for p in pairs for d in p})
    with ThreadPoolExecutor(4) as pool:
        where = dict(zip(days, pool.map(lambda d: M.where_anything(d, LEVEL), days)))
    plan, jobs = {}, []
    for after, before in pairs:
        both = sorted(where[after] & where[before])
        plan[after] = {"before": before, "tiles": [f"{x}_{y}" for x, y in both]}
        for x, y in both:
            jobs += [(after, x, y), (before, x, y)]
    counts = {"mended": 0}
    failed, done, t0 = [], [0], time.time()

    def one(job):
        date, x, y = job
        path = os.path.join(cache, date, f"{x}_{y}.png")
        if os.path.exists(path) or os.path.exists(path + ".none"):
            return
        try:
            rgba = M.day_tile(date, LEVEL, x, y, counts)
        except Exception as err:  # noted; a pair with a tile missing is skipped
            failed.append((job, str(err)[:80]))
            if len(failed) > 300:
                raise SystemExit("too many tiles failed; stopping") from err
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if rgba is None:
            open(path + ".none", "w").close()
        else:
            Image.fromarray(rgba).save(path, compress_level=1)
        done[0] += 1
        if done[0] % 2000 == 0:
            print(f"  {done[0]} of {len(jobs)} day-tiles, {counts['mended']} taken from the map service, {round(time.time() - t0)} s", flush=True)

    print(f"{len(pairs)} day pairs, {len(jobs)} day-tiles", flush=True)
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, jobs))
    M.fetch_picture = real
    print(f"fetched {done[0]}, {counts['mended']} from the map service, {len(failed)} failed, {round(time.time() - t0)} s", flush=True)
    return plan


def blocks(a: np.ndarray) -> np.ndarray:
    n = a.shape[0] // BLOCK
    return a.reshape(n, BLOCK, a.shape[1] // BLOCK, BLOCK).sum(axis=(1, 3))


def grow(mask: np.ndarray) -> np.ndarray:
    """A block mask with every block next to a marked one marked too; the
    map closes on itself from west to east."""
    out = mask.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            shifted = np.roll(mask, dx, axis=1)
            if dy == 1:
                out[1:] |= shifted[:-1]
            elif dy == -1:
                out[:-1] |= shifted[1:]
            else:
                out |= shifted
    return out


def like_with_like(a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, dict]:
    """Where two days' pictures (RGBA) can be compared: both solid, and
    neither rule against it. Returns the mask and what each rule took."""
    solid_a, solid_b = a[..., 3] == 255, b[..., 3] == 255
    both = solid_a & solid_b
    union = blocks((solid_a | solid_b).astype(np.int32))
    differ = blocks((solid_a ^ solid_b).astype(np.int32))
    n = blocks(both.astype(np.int32))
    footprint = grow((union > 0) & (differ > FOOTPRINT * union))
    family = []
    for im in (a, b):
        r = blocks(im[..., 0].astype(np.int32) * both)
        g = blocks(im[..., 1].astype(np.int32) * both)
        family.append((r - g) / (r + g + 1.0))
    colour = grow((n >= BLOCK) & (np.abs(family[0] - family[1]) > COLOUR))
    up = lambda m: np.repeat(np.repeat(m, BLOCK, axis=0), BLOCK, axis=1)  # noqa: E731
    ok = both & ~up(footprint | colour)
    return ok, {"both": int(both.sum()), "accepted": int(ok.sum()), "footprint": int((both & up(footprint)).sum()), "colour": int((both & up(colour & ~footprint)).sum())}


def stack(plan: dict, cache: str):
    """The accepted pairs as two pictures of the world, the newest pair on
    top: brightness before and after (float32, NaN where no pair), and
    which pair each pixel comes from."""
    before_w = np.full((N, N), np.nan, np.float32)
    after_w = np.full((N, N), np.nan, np.float32)
    pair_w = np.zeros((N, N), np.uint8)
    took = []
    for k, after in enumerate(sorted(plan)):  # oldest first, so the newest ends on top
        before = plan[after]["before"]
        a = np.zeros((N, N, 4), np.uint8)
        b = np.zeros((N, N, 4), np.uint8)
        got = 0
        for t in plan[after]["tiles"]:
            pa, pb = os.path.join(cache, after, t + ".png"), os.path.join(cache, before, t + ".png")
            if not (os.path.exists(pa) and os.path.exists(pb)):
                continue
            x, y = map(int, t.split("_"))
            a[y * 256 : (y + 1) * 256, x * 256 : (x + 1) * 256] = np.array(Image.open(pa))
            b[y * 256 : (y + 1) * 256, x * 256 : (x + 1) * 256] = np.array(Image.open(pb))
            got += 1
        if not got:
            continue
        ok, t = like_with_like(a, b)
        after_w[ok] = brightness(a)[ok]
        before_w[ok] = brightness(b)[ok]
        pair_w[ok] = k + 1
        took.append({"after": after, "before": before, **t})
        print(f"  {after} against {before}: {got} tiles, {t['accepted'] / max(1, t['both']):.0%} of the overlap accepted", flush=True)
    return before_w, after_w, pair_w, took


def brightness(rgba: np.ndarray) -> np.ndarray:
    """What is compared: the mean of red and green, which both rise with the echo."""
    return (rgba[..., 0].astype(np.float32) + rgba[..., 1].astype(np.float32)) / 2


def smooth(a: np.ndarray) -> np.ndarray:
    """The mean over 3 x 3 pixels, of those that hold a value."""
    valid = np.isfinite(a)
    filled = np.where(valid, a, 0).astype(np.float32)
    total = np.zeros_like(filled)
    count = np.zeros_like(filled)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            total += np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            count += np.roll(np.roll(valid.astype(np.float32), dy, axis=0), dx, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = total / count
    out[~valid] = np.nan
    return out


def halve(a: np.ndarray) -> np.ndarray:
    """Half the size: the mean of each 2 x 2 that holds at least two values."""
    v = a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2)
    valid = np.isfinite(v)
    count = valid.sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(valid, v, 0).sum(axis=(1, 3)) / count
    out[count < 2] = np.nan
    return out.astype(np.float32)


def median_of_present(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Along the last axis: the median of the values that are there (NaN
    where none), and how many there were."""
    ordered = np.sort(a, axis=-1)  # NaN goes to the end
    n = np.isfinite(a).sum(axis=-1)
    low = np.take_along_axis(ordered, np.maximum((n - 1) // 2, 0)[..., None], axis=-1)[..., 0]
    high = np.take_along_axis(ordered, np.minimum(n // 2, a.shape[-1] - 1)[..., None], axis=-1)[..., 0]
    return ((low + high) / 2).astype(np.float32), n


def reach_of_rows(rows: int) -> np.ndarray:
    """For each row of cells of a Web Mercator world `rows` cells high: how
    many cells the surroundings reach each way, so that the square is about
    ACROSS_KM wide on the ground at that latitude."""
    y = (np.arange(rows) + 0.5) / rows
    lat = np.arctan(np.sinh(np.pi * (1 - 2 * y)))
    cell_km = EQUATOR_KM / rows * np.cos(lat)
    return np.clip(np.round((ACROSS_KM / cell_km - 1) / 2), 1, MOST_CELLS).astype(int)


def window_median(cells: np.ndarray, reach: np.ndarray) -> np.ndarray:
    """The median of the cells in a square around each cell, reaching
    reach[row] cells each way, of those that hold a value; NaN where
    fewer than ENOUGH of the square do. Closes from west to east."""
    out = np.full(cells.shape, np.nan, np.float32)
    held = np.isfinite(cells).any(axis=1)
    for h in np.unique(reach):
        near = np.convolve(held, np.ones(2 * h + 1), "same") > 0
        at = np.flatnonzero((reach == h) & near)
        if not at.size:
            continue
        padded = np.pad(cells, ((h, h), (0, 0)), constant_values=np.nan)
        layers = np.stack([np.roll(padded[at + h + dy], dx, axis=1) for dy in range(-h, h + 1) for dx in range(-h, h + 1)], axis=-1)
        med, n = median_of_present(layers)
        med[n < ENOUGH * (2 * h + 1) ** 2] = np.nan
        out[at] = med
    return out


def enlarge(cells: np.ndarray, by: int) -> np.ndarray:
    """A grid of cells back at full size, sliding from one cell's value to
    the next; holes stay holes."""
    ok = np.isfinite(cells)
    size = (cells.shape[1] * by, cells.shape[0] * by)
    value = np.asarray(Image.fromarray(np.where(ok, cells, 0).astype(np.float32)).resize(size, Image.BILINEAR))
    weight = np.asarray(Image.fromarray(ok.astype(np.float32)).resize(size, Image.BILINEAR))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(weight >= 0.5, value / weight, np.nan).astype(np.float32)


def surroundings(delta: np.ndarray, pair: np.ndarray, reach: np.ndarray) -> np.ndarray:
    """For each pixel the median change of the ground around it, taken only
    from pixels of the same pair of days: the median of each CELL x CELL
    cell, then the median of the cells in the square around it, enlarged
    to full size again. NaN where the pixel's pair covers too little of
    its surroundings."""
    out = np.full(delta.shape, np.nan, np.float32)
    have = np.isfinite(delta) & (pair > 0)
    cols = delta.shape[1] // CELL
    for k in np.unique(pair[have]):
        mine = have & (pair == k)
        rows = np.flatnonzero(mine.any(axis=1))
        r0, r1 = rows[0] // CELL, rows[-1] // CELL + 1
        part, own = delta[r0 * CELL : r1 * CELL], mine[r0 * CELL : r1 * CELL]
        four = np.where(own, part, np.nan).reshape(r1 - r0, CELL, cols, CELL).transpose(0, 2, 1, 3)
        cells, n = median_of_present(four.reshape(r1 - r0, cols, CELL * CELL))
        cells[n < CELL] = np.nan  # a sliver of a cell does not speak for it
        around = enlarge(window_median(cells, reach[r0:r1]), CELL)
        out[r0 * CELL : r1 * CELL][own] = around[own]
    return out


def robust_spread(a: np.ndarray) -> float:
    """1.4826 x the median distance from the median: the standard deviation
    a bell curve with the same middle half would have."""
    v = a[np.isfinite(a)]
    return float(1.4826 * np.median(np.abs(v - np.median(v))))


def standout(delta: np.ndarray, pair: np.ndarray) -> tuple[np.ndarray, float, float]:
    """How each pixel's change differs from its surroundings', the
    threshold beyond which that is drawn, and the spread it comes from."""
    rest = delta - surroundings(delta, pair, reach_of_rows(delta.shape[0] // CELL))
    spread = robust_spread(rest)
    return rest, SPREADS * spread, spread


def colour(delta: np.ndarray, dead: float = DEAD_BAND, full: float = FULL, faintest: float = 0.0) -> np.ndarray:
    """The change as a see-through picture: blue where the echo got weaker,
    orange where stronger, the strength as opacity; nothing inside the
    dead band or where there is no pair."""
    out = np.zeros(delta.shape + (4,), np.uint8)
    size = np.abs(np.nan_to_num(delta, nan=0.0))
    alpha = np.clip((size - dead) / (full - dead), 0, 1)
    if faintest:
        alpha = np.where(size > dead, faintest + (1 - faintest) * alpha, 0)
    for mask, rgb in ((delta < 0, WEAKER), (delta > 0, STRONGER)):
        out[mask, 0], out[mask, 1], out[mask, 2] = rgb
    out[..., 3] = (alpha * 255).round().astype(np.uint8)
    out[out[..., 3] == 0] = 0
    return out


def write(delta: np.ndarray, out_dir: str, quality: int, top: int = LEVEL, **how) -> dict:
    """The tiles of every level from `top` down; returns which exist."""
    tiles = {}
    level = LEVEL
    while level > top:
        delta = halve(delta)
        level -= 1
    while True:
        n = 2**level
        here = []
        for y in range(n):
            for x in range(n):
                rgba = colour(delta[y * 256 : (y + 1) * 256, x * 256 : (x + 1) * 256], **how)
                if not rgba[..., 3].any():
                    continue
                path = os.path.join(out_dir, str(level), str(x), f"{y}.webp")
                os.makedirs(os.path.dirname(path), exist_ok=True)
                Image.fromarray(rgba).save(path, "WEBP", quality=quality, method=6)
                here.append(f"{x}/{y}")
        tiles[str(level)] = here
        if level == 0:
            return tiles
        delta = halve(delta)
        level -= 1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--end", help="newest day of the window, YYYY-MM-DD (default: the newest day NASA has)")
    ap.add_argument("--days", type=int, default=24, help="days in the window (default 24: two rounds of the orbit)")
    ap.add_argument("--cache", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".change-cache"), help="folder for the day tiles (900 MB; not part of the repository)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "change"))
    ap.add_argument("--standout", default="", help="folder for a second product, what stands out from its surroundings (left out by default: the app does not show it, see CHECKED_STANDOUT)")
    ap.add_argument("--quality", type=int, default=84)
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    end = datetime.date.fromisoformat(args.end or M.newest_day())
    pairs = day_pairs(end, args.days)
    plan = fetch(pairs, args.cache, args.workers)
    before_w, after_w, pair_w, took = stack(plan, args.cache)
    delta = smooth(after_w - before_w)
    covered = float(np.isfinite(delta).mean())
    if covered < 0.2:
        raise SystemExit(f"only {covered:.0%} of the map has an accepted pair: nothing written")
    tmp = args.out.rstrip("/") + ".new"
    shutil.rmtree(tmp, ignore_errors=True)
    tiles = write(delta, tmp, args.quality)
    finite = delta[np.isfinite(delta)]
    both = sum(t["both"] for t in took)
    about = {
        "what": "How NASA's NISAR picture changed between each pass and the same pass 48 days earlier: blue where it got darker (the radar echo weaker), orange where brighter. Made by tools/change.py.",
        "source": "NASA GIBS, layer " + M.LAYER,
        "notCalibrated": "The brightness of NASA's false-colour picture (mean of red and green, 0 to 255), not calibrated backscatter.",
        "after": {"from": pairs[-1][0], "to": pairs[0][0]},
        "before": {"from": pairs[-1][1], "to": pairs[0][1]},
        "gapDays": GAP_DAYS,
        "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "levels": LEVEL,
        "deadBand": DEAD_BAND,
        "full": FULL,
        "rules": {"footprint": FOOTPRINT, "colour": COLOUR, "block": BLOCK},
        "numbers": {
            "covered": round(covered, 4),
            "accepted": round(sum(t["accepted"] for t in took) / max(1, both), 4),
            "leftOutByFootprint": round(sum(t["footprint"] for t in took) / max(1, both), 4),
            "leftOutByColour": round(sum(t["colour"] for t in took) / max(1, both), 4),
            "mean": round(float(finite.mean()), 2),
            "sd": round(float(finite.std()), 2),
            "beyond25": round(float((np.abs(finite) > 25).mean()), 4),
        },
        "limits": "The 'after' day differs by up to 24 days from place to place, so neighbouring passes can show different amounts of change with a straight edge between them. The picture mixes both radar channels: where they move in opposite directions (as over rice at harvest, where HH falls and HV rises) it can read brighter while the HH echo got weaker. Rainforest reads 5 to 7 units darker for a reason not established. Holes: no pair of passes that compares like with like.",
        "tiles": tiles,
    }
    with open(os.path.join(tmp, "about.json"), "w") as f:
        json.dump(about, f, separators=(",", ":"))
    shutil.rmtree(args.out, ignore_errors=True)
    os.replace(tmp, args.out)
    report(args.out, tiles, f"{covered:.0%} of the map covered")
    if args.standout:
        write_standout(delta, pair_w, pairs, args.standout, args.quality)


def report(folder: str, tiles: dict, note: str) -> None:
    count = sum(len(v) for v in tiles.values())
    size = sum(os.path.getsize(os.path.join(root, name)) for root, _, names in os.walk(folder) for name in names)
    print(f"written to {folder}: {count} tiles, {size / 1e6:.1f} MB; {note}")


def write_standout(delta: np.ndarray, pair_w: np.ndarray, pairs, out: str, quality: int) -> None:
    """The second product: tiles and about.json of what stands out from its surroundings."""
    rest, threshold, spread = standout(delta, pair_w)
    valued = np.isfinite(rest)
    beyond = np.abs(rest[valued]) > threshold
    shown = rest
    for _ in range(LEVEL - STANDOUT_LEVEL):
        shown = halve(shown)
    shown_valued = np.isfinite(shown)
    tmp = out.rstrip("/") + ".new"
    shutil.rmtree(tmp, ignore_errors=True)
    tiles = write(rest, tmp, quality, top=STANDOUT_LEVEL, dead=threshold, full=2 * threshold, faintest=FAINTEST)
    about = {
        "what": "Where the 48-day change of NASA's NISAR picture differs from the change of the ground around it: from each pixel's change (see data/change) the median change of its surroundings is taken away, and what is left is coloured where it is unusually large. Blue: got darker than its surroundings did (the radar echo weaker); orange: brighter. Made by tools/change.py.",
        "source": "NASA GIBS, layer " + M.LAYER,
        "notCalibrated": "The brightness of NASA's false-colour picture (mean of red and green, 0 to 255), not calibrated backscatter. The rough planet-wide counterpart of the calibrated 'peers' measure, which exists only for the measured places.",
        "after": {"from": pairs[-1][0], "to": pairs[0][0]},
        "before": {"from": pairs[-1][1], "to": pairs[0][1]},
        "gapDays": GAP_DAYS,
        "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "levels": STANDOUT_LEVEL,
        "neighbourhood": {
            "acrossKm": ACROSS_KM,
            "cellPixels": CELL,
            "samePairOnly": True,
            "enough": ENOUGH,
            "how": f"A square about {ACROSS_KM:.0f} km wide around the pixel at every latitude (7 cells of 39 km at the equator, 21 cells of 13 km at 70 degrees; a little smaller beyond 73 degrees). The median is taken over cells of {CELL} x {CELL} level-5 pixels (the median of the cells' medians), only from pixels that come from the same pair of days as the pixel itself, and slid from cell to cell. No value where under {ENOUGH:.0%} of the square is covered by that pair. Why this size: wider than a flood, a burn or a town, so those do not become their own surroundings; no wider than one strip of the radar (240 km), beyond which the same pair of days has nothing to say.",
        },
        "threshold": {
            "value": round(threshold, 2),
            "spreads": SPREADS,
            "spread": round(spread, 2),
            "full": round(2 * threshold, 2),
            "how": f"{SPREADS:g} x the robust spread of the remainder over every valued pixel of the map at level 5 (1.4826 x the median absolute deviation from the median). One threshold for the whole planet, fixed before any check against reported events. Opacity runs from {FAINTEST:.0%} just beyond it to full at twice the threshold. Coarser levels show the mean of the pixels below them against the same threshold.",
        },
        "numbers": {
            "covered": round(float(valued.mean()), 4),
            "coveredByChange": round(float(np.isfinite(delta).mean()), 4),
            "coloured": round(float(beyond.mean()), 4),
            "colouredWeaker": round(float((rest[valued] < -threshold).mean()), 4),
            "colouredStronger": round(float((rest[valued] > threshold).mean()), 4),
            "colouredAtLevel" + str(STANDOUT_LEVEL): round(float((np.abs(shown[shown_valued]) > threshold).mean()), 4),
            "beyondTwiceTheThreshold": round(float((np.abs(rest[valued]) > 2 * threshold).mean()), 4),
        },
        "limits": LIMITS_STANDOUT,
        "tiles": tiles,
    }
    if (pairs[0][0], len(pairs)) == CHECKED_STANDOUT_WINDOW:
        about["checked"] = CHECKED_STANDOUT
    with open(os.path.join(tmp, "about.json"), "w") as f:
        json.dump(about, f, separators=(",", ":"))
    shutil.rmtree(out, ignore_errors=True)
    os.replace(tmp, out)
    report(out, tiles, f"{valued.mean():.0%} of the map valued, {beyond.mean():.1%} of that coloured beyond {threshold:.1f}")


if __name__ == "__main__":
    main()
