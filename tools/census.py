#!/usr/bin/env python3
"""A census of NASA's NISAR map tiles, world wide: which are sound?

The app decides whether a tile from NASA's tile service is sound by the
kind of PNG the file says it is (see `pngKind` in js/engine/tiles.js and
`sound` in tools/mosaic.py). This script checks that rule against the
data. It samples tiles over the whole planet, on several days and at
levels 7, 9, 11 and 13, notes the kind of each, and compares tiles with
NASA's map service, which draws the same data another way and has never
been seen damaged: every tile of another kind than 2, and a random sample
of those of kind 2.

    pip install pillow numpy
    python tools/census.py                      # 26 days up to yesterday, 300 places a day
    python tools/census.py 2026-11-14 26 300 600

Arguments: newest day, number of days, places sampled per day, how many
tiles of kind 2 to compare. No login is needed. With the defaults it makes
about 27,000 requests to the tile service and 5,000 to the map service and
takes half an hour. It is run by hand, never by the app. The list of what
was compared goes to census.json in the current directory.

Result of 15 November 2026 (26 days to 14 November): 10,421 tiles held a
picture. All 4,447 of kinds 0, 3, 4 and 6 were damaged, without
exception. Of 600 tiles of kind 2, 591 were the same picture as the map
service's, 6 were empty in both, and 3 held less than the map service
showed, on a day NASA was adding to at that moment; twenty minutes later
those three were complete (see `expectedCover` in js/engine/tiles.js).
The share of damaged tiles grows with the level: 10 % at level 7, 45 % at
level 9, 65 % at level 11, 72 % at level 13. The same tile asked for
twice is not always the same file: of 35 tiles of kind 2 asked for again
an hour later, 3 came back as a damaged kind, and damaged ones came back
as another damaged kind. (That run judged likeness by colour difference;
the measure used now, `alike`, was checked afterwards on 60 of its
tiles: sound ones score 0.69 to 1.0, damaged ones 0.11 or less.)
"""
import sys, os, io, json, random, datetime, collections, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mosaic as M
ARGS = sys.argv[1:]
END = datetime.date.fromisoformat(ARGS[0]) if ARGS else datetime.date.today() - datetime.timedelta(days=1)
DAYS = int(ARGS[1]) if len(ARGS) > 1 else 26
PER_DAY = int(ARGS[2]) if len(ARGS) > 2 else 300
CHECK_SOUND = int(ARGS[3]) if len(ARGS) > 3 else 600
random.seed(20261115)
days = [(END - datetime.timedelta(days=d)).isoformat() for d in range(DAYS)]
t0 = time.time()
with ThreadPoolExecutor(4) as ex: where = dict(zip(days, ex.map(lambda d: sorted(M.where_anything(d, 7)), days)))
jobs = []
for d in days:
    cells = random.sample(where[d], min(PER_DAY, len(where[d])))
    for (x, y) in cells:
        jobs.append((d, 7, x, y))
        for z in (9, 11, 13):
            s = z - 7; jobs.append((d, z, (x << s) + random.randrange(1 << s), (y << s) + random.randrange(1 << s)))
print(len(jobs), 'tiles asked for, over', len(days), 'days;', round(time.time() - t0), 's for the world pictures', flush=True)
def rgba_of(raw):
    try: return np.array(Image.open(io.BytesIO(raw)).convert('RGBA'))
    except Exception: return None
def alike(mine, ref, both):
    """How much two pictures show the same thing where both are solid: 1 the
    same, 0 unrelated, None where too little is solid to say. Brightness is
    compared in blocks of 4 x 4 pixels, so that the radar's speckle and the
    map service's smoothing do not count. (Colour difference alone misleads:
    over dark ground a damaged grey tile comes numerically close.)"""
    if both.sum() < 400: return None
    def blocks(a):
        g = a[..., :3].astype(float).mean(axis=2) * both
        gb = g.reshape(64, 4, 64, 4).sum(axis=(1, 3)); wb = both.reshape(64, 4, 64, 4).sum(axis=(1, 3))
        return gb[wb >= 12] / wb[wb >= 12]
    a, b = blocks(mine), blocks(ref)
    if len(a) < 30: return None
    if a.std() < 1e-6 or b.std() < 1e-6: return 0.0
    return float(np.corrcoef(a, b)[0, 1])
def first(j):
    d, z, x, y = j
    try: raw = M.fetch(M.TILES.format(date=d, z=z, x=x, y=y))
    except Exception as e: return (j, 'no answer', None)
    if raw is None or len(raw) <= M.EMPTY_BYTES: return (j, 'empty', None)
    kind = raw[25] if raw[:4] == b'\x89PNG' and len(raw) > 26 else -1
    return (j, kind, raw)
with ThreadPoolExecutor(16) as ex: got = list(ex.map(first, jobs))
print('first pass done,', round(time.time() - t0), 's', flush=True)
tally = collections.Counter((j[1], k if isinstance(k, str) else f'kind {k}') for j, k, raw in got)
for (z, k), c in sorted(tally.items()): print(f'  level {z}: {k}: {c}')
full = [g for g in got if isinstance(g[1], int)]
odd = [g for g in full if g[1] != 2]
plain = [g for g in full if g[1] == 2]
check = odd + random.sample(plain, min(CHECK_SOUND, len(plain)))
print(len(full), 'hold a picture:', len(plain), 'of kind 2,', len(odd), 'of another kind; comparing', len(check), 'with the map service', flush=True)
def second(g):
    (d, z, x, y), kind, raw = g
    mine = rgba_of(raw)
    try: ref = M.fetch_picture(M.MAP.format(bbox=M.bbox(z, x, y), px=M.SIZE, date=d))
    except Exception: return (g[0], kind, 'map service did not answer', None)
    if mine is None or mine.shape[:2] != (256, 256): return (g[0], kind, 'undecodable', None)
    a = mine[..., 3] == 255
    b = (ref[..., 3] == 255) if ref is not None else np.zeros((256, 256), bool)
    both = a & b
    same_cover = float((a == b).mean())
    diff = float(np.abs(mine[..., :3].astype(int) - ref[..., :3].astype(int))[both].mean()) if both.sum() > 50 else None
    half = float(((mine[..., 3] > 0) & ~a).mean())
    return (g[0], kind, 'compared', dict(cover_tile=float(a.mean()), cover_map=float(b.mean()), same_cover=same_cover, diff=diff, alike=alike(mine, ref, both) if ref is not None else None, half=half, bytes=len(raw)))
with ThreadPoolExecutor(8) as ex: cmp = list(ex.map(second, check))
print('comparison done,', round(time.time() - t0), 's', flush=True)
def verdict(r):
    if r[2] != 'compared': return r[2]
    m = r[3]
    if m['cover_map'] < 0.002 and m['cover_tile'] < 0.002: return 'both empty'
    same = m['alike'] is None or m['alike'] > 0.5
    if m['same_cover'] > 0.97 and same: return 'SOUND (same picture as the map service)'
    if m['cover_tile'] > 0.002 and m['cover_tile'] < m['cover_map'] * 0.9 and m['alike'] is not None and same: return 'THIN (the same picture, but less of it than the map service shows)'
    return 'DAMAGED (differs from the map service)'
table = collections.Counter((('kind 2' if r[1] == 2 else f'kind {r[1]}'), verdict(r)) for r in cmp)
for (k, v), c in sorted(table.items()): print(f'  {k}: {v}: {c}')
out = [dict(day=r[0][0], z=r[0][1], x=r[0][2], y=r[0][3], kind=r[1], verdict=verdict(r), m=r[3]) for r in cmp]
json.dump(out, open('census.json', 'w'))
print('done in', round(time.time() - t0), 's; details in census.json')
