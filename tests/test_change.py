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
    print("ok")


if __name__ == "__main__":
    main()
