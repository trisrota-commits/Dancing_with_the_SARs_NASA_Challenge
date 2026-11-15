"""Checks the arithmetic of tools/change.py on made-up pictures (no network)."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import change  # noqa: E402


def picture(size=128, rgb=(60, 120, 40)):
    """A solid picture of one colour (a dual-polarisation pass comes out green)."""
    out = np.zeros((size, size, 4), np.uint8)
    out[..., :3] = rgb
    out[..., 3] = 255
    return out


def main() -> None:
    # The window: each day paired with the day 48 days before it, newest first.
    import datetime

    pairs = change.day_pairs(datetime.date(2026, 11, 12), 24)
    assert pairs[0] == ("2026-11-12", "2026-09-25") and pairs[-1] == ("2026-10-20", "2026-09-02") and len(pairs) == 24, (pairs[0], pairs[-1])

    # What is compared: the mean of red and green.
    assert change.brightness(picture(rgb=(60, 120, 40)))[0, 0] == 90.0

    # Like with like: two solid pictures of the same colour family compare everywhere.
    a, b = picture(), picture(rgb=(40, 80, 30))
    ok, took = change.like_with_like(a, b)
    assert ok.all() and took["accepted"] == took["both"] == 128 * 128 and took["footprint"] == took["colour"] == 0

    # The footprint rule: a pass missing on one side in part of the picture.
    # Every block in which the two footprints differ goes, and the blocks
    # next to it: the pass on top may be another one there. (The picture
    # closes on itself from west to east, like the map, so the block at
    # the western edge is next to the one at the eastern edge.)
    b = picture()
    b[:, 64:, 3] = 0  # the eastern half was not flown 48 days earlier
    ok, took = change.like_with_like(a, b)
    assert not ok[:, 64:].any()  # nothing to compare with there
    assert not ok[:, 48:64].any() and not ok[:, :16].any(), "the blocks beside the missing half"
    assert ok[:, 16:48].all(), "away from it both days are compared"
    assert took["both"] == 128 * 64 and took["footprint"] == 128 * 32 and took["accepted"] == 128 * 32
    # A footprint edge inside a block: that block goes as well.
    b = picture()
    b[:, 72:, 3] = 0
    ok, took = change.like_with_like(a, b)
    assert not ok[:, 48:].any() and ok[:, 16:48].all()
    assert took["both"] == 128 * 72 and took["footprint"] == 128 * 40
    # A sliver under 3 % of a block is not held against a pair (the edge of a strip is never exact).
    b = picture()
    b[40:42, 40:43, 3] = 0  # six pixels of 256
    ok, took = change.like_with_like(a, b)
    assert took["footprint"] == 0 and took["accepted"] == took["both"] == 128 * 128 - 6

    # The colour rule: the same ground recorded in another radar mode
    # (single polarisation comes out orange) is not compared.
    orange = picture(rgb=(200, 110, 30))
    ok, took = change.like_with_like(picture(), orange)
    assert not ok.any() and took["colour"] == 128 * 128 and took["footprint"] == 0
    # A strip of it: that strip and the blocks beside it go, the rest stays.
    mixed = picture()
    mixed[:, 32:48, :3] = (200, 110, 30)
    ok, _ = change.like_with_like(picture(), mixed)
    assert not ok[:, 16:64].any() and ok[:, :16].all() and ok[:, 64:].all()

    # Smoothing takes the mean of what is there and leaves holes as holes.
    d = np.full((8, 8), 4.0, np.float32)
    d[2, 2] = np.nan
    d[5, 5] = 13.0
    s = change.smooth(d)
    assert np.isnan(s[2, 2]) and abs(s[5, 5] - 5.0) < 1e-5 and abs(s[2, 3] - 4.0) < 1e-5

    # Halving needs two values of four.
    q = np.array([[1.0, 3.0, np.nan, np.nan], [np.nan, np.nan, np.nan, 8.0]], np.float32)
    h = change.halve(q)
    assert h.shape == (1, 2) and h[0, 0] == 2.0 and np.isnan(h[0, 1])

    # Colour: nothing inside the dead band or without a value; blue for
    # weaker, orange for stronger, the strength as opacity.
    c = change.colour(np.array([[0.0, 9.9, -25.0, 60.0, np.nan]], np.float32))
    assert c[0, 0, 3] == 0 and c[0, 1, 3] == 0 and c[0, 4, 3] == 0
    assert tuple(c[0, 2, :3]) == change.WEAKER and c[0, 2, 3] == 128  # (25 - 10) / (40 - 10) = half
    assert tuple(c[0, 3, :3]) == change.STRONGER and c[0, 3, 3] == 255
    assert tuple(c[0, 0]) == (0, 0, 0, 0)

    # --- What stands out from its surroundings ---
    # The median of what is there, and how many there were.
    m, n = change.median_of_present(np.array([[1.0, 3.0, np.nan, np.nan], [np.nan] * 4, [5.0, 1.0, 3.0, np.nan], [4.0, 1.0, 2.0, 3.0]], np.float32))
    assert m[0] == 2.0 and np.isnan(m[1]) and m[2] == 3.0 and m[3] == 2.5 and list(n) == [2, 0, 3, 4]

    # The surroundings are about as wide on the ground at every latitude:
    # 7 cells at the equator, more towards the poles (Web Mercator
    # stretches the ground there), the same north and south, with a cap.
    reach = change.reach_of_rows(1024)
    assert reach[511] == reach[512] == 3 and (reach == reach[::-1]).all() and (np.diff(reach[:512]) <= 0).all()
    assert reach[0] == change.MOST_CELLS and reach.min() == 3
    row_60n = int((1 - np.arcsinh(np.tan(np.radians(60))) / np.pi) / 2 * 1024)
    wide_km = (2 * reach[row_60n] + 1) * change.EQUATOR_KM / 1024 * np.cos(np.radians(60))
    assert abs(wide_km - change.ACROSS_KM) < 25, wide_km

    # The median over the square around a cell: one wild cell does not
    # move it, a hole is passed over, and where under a quarter of the
    # square holds a value there is none.
    cells = np.full((8, 8), 2.0, np.float32)
    cells[3, 3] = 50.0
    cells[5, 5] = np.nan
    w = change.window_median(cells, np.ones(8, int))
    assert (w == 2.0).all()
    lonely = np.full((8, 8), np.nan, np.float32)
    lonely[4, 4] = lonely[4, 5] = 7.0  # two of nine: under a quarter
    assert np.isnan(change.window_median(lonely, np.ones(8, int))).all()
    lonely[5, 4] = 7.0  # three of nine
    assert change.window_median(lonely, np.ones(8, int))[4, 4] == 7.0

    # Enlarging slides from cell to cell and keeps holes as holes.
    e = change.enlarge(np.array([[0.0, 8.0], [np.nan, 8.0]], np.float32), 8)
    assert e.shape == (16, 16) and e[0, 0] == 0.0 and e[0, 15] == 8.0 and 0 < e[0, 7] < e[0, 8] < 8
    assert np.isnan(e[15, 0]) and e[15, 15] == 8.0

    # The whole of it, on a made-up map of two strips flown on different
    # days: the western one froze (20 darker everywhere), the eastern one
    # did not, and in the east a small patch got 30 brighter.
    rng = np.random.default_rng(1)
    size = 128
    delta = rng.normal(0, 1, (size, size)).astype(np.float32)
    pair = np.ones((size, size), np.uint8)
    pair[:, 64:] = 2
    delta[:, :64] -= 20
    delta[40:44, 100:104] += 30
    delta[90:92, 20:24] = np.nan  # a hole
    pair[90:92, 20:24] = 0
    pair[10:12, 80:82] = 3  # a sliver of a third pair: too little to have surroundings
    around = change.surroundings(delta, pair, np.ones(size // change.CELL, int))
    assert abs(np.nanmedian(around[:, :64]) + 20) < 0.5 and abs(np.nanmedian(around[:, 64:])) < 0.5
    # Only the same pair counts: right up to the seam each side keeps its own level.
    assert np.nanmax(np.abs(around[:, 56:64] + 20)) < 1 and np.nanmax(np.abs(around[:, 64:72])) < 1
    assert np.isnan(around[90:92, 20:24]).all() and np.isnan(around[10:12, 80:82]).all()
    assert np.isfinite(around[pair == 1]).all()
    # The patch does not become its own surroundings.
    assert np.nanmax(np.abs(around[36:48, 96:108])) < 1

    rest, threshold, spread = change.standout(delta, pair)
    assert abs(spread - 1.0) < 0.1 and threshold == change.SPREADS * spread
    beyond = np.abs(rest) > threshold
    assert beyond[40:44, 100:104].all(), "the patch stands out"
    assert beyond[:, :64].mean() < 0.01, "the freeze that hit the whole strip does not"
    assert beyond.sum() - 16 < 0.01 * size * size
    assert abs(change.robust_spread(np.array([0.0, 1.0, 2.0, 3.0, 4.0, 100.0, np.nan])) - 1.4826 * 1.5) < 1e-6

    # Its colours: nothing up to the threshold, faint just beyond it, full at twice.
    c = change.colour(np.array([[5.0, 9.0, -13.5, 18.0, 40.0, np.nan]], np.float32), dead=9.0, full=18.0, faintest=0.35)
    assert [int(v) for v in c[0, :, 3]] == [0, 0, 172, 255, 255, 0], c[0, :, 3]
    assert tuple(c[0, 2, :3]) == change.WEAKER and tuple(c[0, 3, :3]) == change.STRONGER and tuple(c[0, 1]) == (0, 0, 0, 0)
    print("ok")


if __name__ == "__main__":
    main()
