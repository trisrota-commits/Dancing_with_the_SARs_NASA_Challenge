#!/usr/bin/env python3
"""Assembles the whole planet as NISAR sees it, once, ahead of time.

NASA publishes NISAR's map layer one day at a time: each day holds the
strips flown that day. Stacked over 24 days (two rounds of its orbit) they
cover every place NISAR images, bar thin slivers between passes; over 48
days most of those close too. The app can do that stacking live, but it
then asks NASA for up to 24 pictures per map tile. This script does it once: it takes each day's
tiles, lays them on top of each other with the newest pass on top, and
writes one ready-made set of tiles into data/mosaic/. The app shows that
set from far away and at continent distance; close in, NASA's own tiles
take over, and passes newer than the mosaic are added live.

Nothing here changes NASA's pictures except three things, all stated in
data/mosaic/about.json and in the app: the days are stacked, the tiles are
stored as WebP at reduced file size, and the coarser levels are made by
averaging four tiles into one.

    pip install pillow numpy
    python tools/mosaic.py                  # 48 days up to NASA's newest day
    python tools/mosaic.py --end 2026-11-12 --days 48 --level 5

No login is needed. It makes about 27,000 small requests and takes about a
quarter of an hour. It always builds the whole mosaic afresh from NASA's own
pictures and never patches the one already there: that keeps the newest
pass on top without any bookkeeping, and the stored tiles are compressed
once, not again and again. A tile that has not changed comes out byte for
byte the same, so only changed tiles add to the repository.

Nothing depends on running it again: the app draws every later day live
on top. Run it when the far view should be brought up to date.
"""

import argparse
import concurrent.futures as futures
import datetime
import io
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

LAYER = 'NISAR_L2_Geocoded_Polarimetric_Covariance'
TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + LAYER + '/default/{date}/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png'
MAP = ('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=' + LAYER +
       '&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&BBOX={bbox}&WIDTH={px}&HEIGHT={px}&TIME={date}')
HALF_WORLD = 20037508.342789244  # Web Mercator, in metres
SIZE = 256
SHEET = 1024  # the whole world in one picture, to see where a day has anything
EMPTY_BYTES = 340  # NASA's empty tile is smaller than this


def fetch(url, tries=4):
    """The bytes at an address, or None when the server says there is nothing."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as err:
            if err.code in (400, 404):
                return None
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f'no answer after {tries} tries: {url}')


def fetch_picture(url, tries=5):
    """A picture from NASA's map service as pixels, or None when it is
    empty. Under load that service now and then answers with an error
    page instead of a picture; such an answer is asked for again."""
    for attempt in range(tries):
        raw = fetch(url)
        if raw is None or len(raw) <= EMPTY_BYTES:
            return None
        try:
            return np.array(Image.open(io.BytesIO(raw)).convert('RGBA'))
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'no picture after {tries} tries: {url}')


def fingerprint(date):
    """What the app compares to tell whether NASA has added to a day since
    the mosaic was built: the size and a short hash (FNV-1a) of that day's
    smallest tile, which shows the whole world. The same sum as
    `fingerprint` in js/engine/tiles.js."""
    raw = fetch(TILES.format(date=date, z=0, x=0, y=0))
    if raw is None:
        return None
    h = 0x811C9DC5
    for b in raw:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f'{len(raw)}:{h:x}'


def bbox(z, x, y):
    span = 2 * HALF_WORLD / 2 ** z
    west = -HALF_WORLD + x * span
    north = HALF_WORLD - y * span
    return f'{west},{north - span},{west + span},{north}'


def solid(rgba):
    """Only fully solid pixels count; anything else is made see-through."""
    out = rgba.copy()
    out[..., 3] = np.where(out[..., 3] == 255, 255, 0)
    out[out[..., 3] == 0] = 0
    return out


def sound(raw):
    """A tile from NASA's tile service as pixels, or None if it is damaged.

    For some days and places the tile service labels a picture as the wrong
    kind of PNG, and it decodes as noise or as solid black (see "Damaged
    tiles" in docs/HANDOFF.md). A sound NISAR tile is plain RGB with one
    see-through colour: PNG colour type 2.
    """
    if len(raw) < 30 or raw[25] != 2:
        return None
    try:
        rgba = np.array(Image.open(io.BytesIO(raw)).convert('RGBA'))
    except Exception:
        return None
    if rgba.shape[:2] != (SIZE, SIZE):
        return None
    opaque = rgba[..., 3] == 255
    half = (rgba[..., 3] > 0) & ~opaque
    if half.sum() > 0.2 * max(1, half.sum() + opaque.sum()):
        return None
    if opaque.sum() > 600 and (rgba[opaque][:, :3].max(axis=1) <= 1).mean() > 0.9:
        return None
    return solid(rgba)


def day_tile(date, z, x, y, counts):
    """One day's picture for one tile: from the tile service, or from the
    map service when the tile service's answer is damaged."""
    raw = fetch(TILES.format(date=date, z=z, x=x, y=y))
    if raw is None or len(raw) <= EMPTY_BYTES:
        return None
    rgba = sound(raw)
    if rgba is None:
        counts['mended'] += 1
        rgba = fetch_picture(MAP.format(bbox=bbox(z, x, y), px=SIZE, date=date))
        if rgba is None:
            return None
        rgba = solid(rgba)
    return rgba if rgba[..., 3].any() else None


def where_anything(date, level):
    """The tiles of `level` in which this day shows anything, from the
    day's picture of the whole world. Neighbours count too: the edge of a
    strip can be thinner than a pixel there."""
    world = fetch_picture(MAP.format(bbox=f'{-HALF_WORLD},{-HALF_WORLD},{HALF_WORLD},{HALF_WORLD}', px=SHEET, date=date))
    if world is None:
        return set()
    alpha = world[..., 3] == 255
    # Looked at in small cells (level 7, eight pixels of the world picture),
    # grown by one such cell, and only then counted per tile: growing by a
    # whole tile would ask for twice as many tiles, nearly all empty.
    fine = 2 ** 7
    cell = SHEET // fine
    seen = alpha.reshape(fine, cell, fine, cell).any(axis=(1, 3))
    padded = np.pad(seen, 1)
    grown = np.zeros_like(seen)
    for dy in range(3):
        for dx in range(3):
            grown |= padded[dy:dy + fine, dx:dx + fine]
    # The map closes on itself in longitude.
    grown[:, 0] |= seen[:, -1]
    grown[:, -1] |= seen[:, 0]
    n = 2 ** level
    per = fine // n
    grown = grown.reshape(n, per, n, per).any(axis=(1, 3))
    ys, xs = np.nonzero(grown)
    return {(int(x), int(y)) for x, y in zip(xs, ys)}


def halve(four):
    """Four tiles (2 x 2, as one 512-pixel picture) averaged into one.
    Colours are averaged over the solid pixels only, and a pixel is solid
    when at least half of what went into it was."""
    a = (four[..., 3:4] == 255).astype(np.float32)
    rgb = four[..., :3].astype(np.float32) * a
    a4 = a.reshape(SIZE, 2, SIZE, 2, 1).sum(axis=(1, 3))
    rgb4 = rgb.reshape(SIZE, 2, SIZE, 2, 3).sum(axis=(1, 3))
    out = np.zeros((SIZE, SIZE, 4), np.uint8)
    keep = a4[..., 0] >= 2
    out[..., :3][keep] = np.clip(rgb4[keep] / a4[keep], 0, 255).astype(np.uint8)
    out[..., 3][keep] = 255
    return out


def save(rgba, folder, z, x, y, quality):
    path = os.path.join(folder, str(z), str(x))
    os.makedirs(path, exist_ok=True)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(path, f'{y}.webp'), 'WEBP', quality=quality, method=5)


def newest_day():
    """NASA's newest day with anything in it (a day not yet published
    answers with the tiny empty tile)."""
    today = datetime.date.today()
    for back in range(1, 20):
        date = (today - datetime.timedelta(days=back)).isoformat()
        raw = fetch(TILES.format(date=date, z=0, x=0, y=0))
        if raw is not None and len(raw) > EMPTY_BYTES:
            return date
    raise RuntimeError('no published day found in the last 19 days')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--end', help='newest day in the mosaic, YYYY-MM-DD (default: the newest day NASA has)')
    ap.add_argument('--days', type=int, default=48, help='how many days are stacked (default 48: four rounds of the orbit, which closes most slivers between passes)')
    ap.add_argument('--level', type=int, default=5, help='finest level written (default 5: continent detail, about 780 tiles)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'mosaic'))
    ap.add_argument('--quality', type=int, default=84, help='WebP quality (default 84)')
    ap.add_argument('--workers', type=int, default=12)
    ap.add_argument('--force', action='store_true', help='write the result even if it holds far fewer tiles than the mosaic already there')
    args = ap.parse_args()

    end = datetime.date.fromisoformat(args.end or newest_day())
    dates = [(end - datetime.timedelta(days=k)).isoformat() for k in range(args.days - 1, -1, -1)]  # oldest first
    level = args.level
    print(f'{args.days} days, {dates[0]} to {dates[-1]}, down to level {level}')

    # Each day as it stands now, taken before its tiles are read: a pass
    # NASA adds during the build then shows as a change, not as included.
    with futures.ThreadPoolExecutor(args.workers) as pool:
        prints = dict(zip(dates, pool.map(fingerprint, dates)))

    # Where each day has anything.
    # A few at a time: these are the map service's heaviest requests.
    with futures.ThreadPoolExecutor(min(4, args.workers)) as pool:
        wanted = list(pool.map(lambda d: where_anything(d, level), dates))
    by_tile = {}
    for date, tiles in zip(dates, wanted):
        for t in tiles:
            by_tile.setdefault(t, []).append(date)
    asks = sum(len(v) for v in by_tile.values())
    print(f'{len(by_tile)} tiles hold something; {asks} day-tiles to fetch')

    counts = {'mended': 0, 'fetched': 0}
    started = time.time()

    def assemble(item):
        (x, y), days = item
        out = np.zeros((SIZE, SIZE, 4), np.uint8)
        for date in days:  # oldest first, so the newest pass ends on top
            rgba = day_tile(date, level, x, y, counts)
            counts['fetched'] += 1
            if rgba is None:
                continue
            on = rgba[..., 3] == 255
            out[on] = rgba[on]
        return (x, y), (out if out[..., 3].any() else None)

    tmp = args.out + '.building'
    shutil.rmtree(tmp, ignore_errors=True)
    finest = {}
    with futures.ThreadPoolExecutor(args.workers) as pool:
        for n, ((x, y), rgba) in enumerate(pool.map(assemble, sorted(by_tile.items())), 1):
            if rgba is not None:
                finest[(x, y)] = rgba
                save(rgba, tmp, level, x, y, args.quality)
            if n % 50 == 0 or n == len(by_tile):
                print(f'  {n} of {len(by_tile)} tiles, {counts["fetched"]} of {asks} day-tiles, {counts["mended"]} taken from the map service, {time.time() - started:.0f} s', flush=True)

    # The coarser levels, each tile averaged from the four beneath it.
    index = {str(level): sorted(f'{x}/{y}' for x, y in finest)}
    below = finest
    for z in range(level - 1, -1, -1):
        here = {}
        for px, py in {(x // 2, y // 2) for x, y in below}:
            four = np.zeros((2 * SIZE, 2 * SIZE, 4), np.uint8)
            for i in range(4):
                child = below.get((px * 2 + (i & 1), py * 2 + (i >> 1)))
                if child is not None:
                    four[(i >> 1) * SIZE:(i >> 1) * SIZE + SIZE, (i & 1) * SIZE:(i & 1) * SIZE + SIZE] = child
            rgba = halve(four)
            if rgba[..., 3].any():
                here[(px, py)] = rgba
                save(rgba, tmp, z, px, py, args.quality)
        index[str(z)] = sorted(f'{x}/{y}' for x, y in here)
        below = here

    about = {
        'what': "The whole planet as NISAR sees it: NASA's daily NISAR map layer, stacked by tools/mosaic.py with the newest pass on top.",
        'source': f'NASA GIBS, layer {LAYER}',
        'from': dates[0],
        'to': dates[-1],
        'built': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'levels': level,
        # One fingerprint per day (see `fingerprint`). The app draws a day
        # live again, with every day after it, once NASA's differs.
        'days': prints,
        'changes': 'Days stacked; tiles stored as WebP at reduced file size; coarser levels averaged from the finest. Tiles NASA\'s tile service sent damaged were taken from its map service.',
        'mended': counts['mended'],
        'tiles': index,
    }
    # A build that comes out much smaller than the one before it is not
    # NASA losing a third of the planet overnight: its services were
    # failing. The old mosaic then stays, and the job says so.
    try:
        with open(os.path.join(args.out, 'about.json')) as f:
            before = len(json.load(f)['tiles'].get(str(level), []))
    except Exception:
        before = 0
    if not args.force and len(finest) < 0.8 * before:
        shutil.rmtree(tmp, ignore_errors=True)
        raise SystemExit(f'only {len(finest)} tiles at level {level}, where the mosaic in place has {before}: kept the old one (use --force to write this one anyway)')

    with open(os.path.join(tmp, 'about.json'), 'w') as f:
        json.dump(about, f, separators=(',', ':'))
        f.write('\n')
    shutil.rmtree(args.out, ignore_errors=True)
    os.replace(tmp, args.out)
    total = sum(os.path.getsize(os.path.join(d, n)) for d, _, names in os.walk(args.out) for n in names)
    print(f'written to {os.path.normpath(args.out)}: {sum(len(v) for v in index.values())} tiles, {total / 1e6:.1f} MB, in {time.time() - started:.0f} s')


if __name__ == '__main__':
    sys.exit(main())
