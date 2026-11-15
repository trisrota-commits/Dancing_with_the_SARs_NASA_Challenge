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

What remains, and is said in the app: the "after" day differs by up to 24
days from place to place, so where the ground was freezing during the
window neighbouring passes show different amounts of change with a
straight edge between them; rainforest reads 5 to 7 units darker for a
reason not established; and there are holes where no pair was accepted.

    pip install pillow numpy
    python tools/change.py                      # 24 days up to NASA's newest day
    python tools/change.py --end 2026-11-12 --cache /some/folder

It makes about 21,000 small requests (no login) and takes about a quarter
of an hour; the day tiles are kept in --cache (900 MB) so that the
stacking can be redone without asking NASA again. It writes
data/change/{z}/{x}/{y}.webp (see-through tiles, levels 0 to 5) and
data/change/about.json.
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


def colour(delta: np.ndarray) -> np.ndarray:
    """The change as a see-through picture: blue where the echo got weaker,
    orange where stronger, the strength as opacity; nothing inside the
    dead band or where there is no pair."""
    out = np.zeros(delta.shape + (4,), np.uint8)
    size = np.abs(np.nan_to_num(delta, nan=0.0))
    alpha = np.clip((size - DEAD_BAND) / (FULL - DEAD_BAND), 0, 1)
    for mask, rgb in ((delta < 0, WEAKER), (delta > 0, STRONGER)):
        out[mask, 0], out[mask, 1], out[mask, 2] = rgb
    out[..., 3] = (alpha * 255).round().astype(np.uint8)
    out[out[..., 3] == 0] = 0
    return out


def write(delta: np.ndarray, out_dir: str, quality: int) -> dict:
    """The tiles of every level; returns which exist."""
    tiles = {}
    level = LEVEL
    while True:
        n = 2**level
        here = []
        for y in range(n):
            for x in range(n):
                rgba = colour(delta[y * 256 : (y + 1) * 256, x * 256 : (x + 1) * 256])
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
        "limits": "The 'after' day differs by up to 24 days from place to place, so neighbouring passes can show different amounts of change with a straight edge between them. Rainforest reads 5 to 7 units darker for a reason not established. Holes: no pair of passes that compares like with like.",
        "tiles": tiles,
    }
    with open(os.path.join(tmp, "about.json"), "w") as f:
        json.dump(about, f, separators=(",", ":"))
    shutil.rmtree(args.out, ignore_errors=True)
    os.replace(tmp, args.out)
    count = sum(len(v) for v in tiles.values())
    size = sum(os.path.getsize(os.path.join(root, name)) for root, _, names in os.walk(args.out) for name in names)
    print(f"written to {args.out}: {count} tiles, {size / 1e6:.1f} MB; {covered:.0%} of the map covered")


if __name__ == "__main__":
    main()
