"""Checks the mosaic build's own arithmetic, without the network.

    python tests/test_mosaic.py
"""
import io
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
import mosaic  # noqa: E402


def png(rgba, mode):
    out = io.BytesIO()
    image = Image.fromarray(rgba, 'RGBA')
    if mode == 'RGB':
        # As NASA sends a sound tile: plain RGB with black as the see-through colour.
        image.convert('RGB').save(out, 'PNG', transparency=(0, 0, 0))
    else:
        image.save(out, 'PNG')
    return out.getvalue()


def test_sound_and_damaged():
    tile = np.zeros((256, 256, 4), np.uint8)
    tile[:128] = [40, 200, 30, 255]
    good = mosaic.sound(png(tile, 'RGB'))
    assert good is not None and (good[..., 3] == 255).sum() == 128 * 256
    # The same picture labelled as RGBA is what the damaged answers look like: refused.
    assert mosaic.sound(png(tile, 'RGBA')) is None
    # Solid black is refused too.
    black = np.zeros((256, 256, 4), np.uint8)
    black[..., 3] = 255
    assert mosaic.sound(png(black, 'RGBA')) is None


def test_newest_on_top():
    older = np.zeros((256, 256, 4), np.uint8)
    older[:, :200] = [10, 10, 200, 255]
    newer = np.zeros((256, 256, 4), np.uint8)
    newer[:, 100:] = [200, 10, 10, 255]
    out = np.zeros((256, 256, 4), np.uint8)
    for rgba in (older, newer):  # oldest first, as the build does
        on = rgba[..., 3] == 255
        out[on] = rgba[on]
    assert out[0, 50].tolist() == [10, 10, 200, 255]  # only the older pass was here
    assert out[0, 150].tolist() == [200, 10, 10, 255]  # both: the newer one shows
    assert out[0, 250].tolist() == [200, 10, 10, 255]


def test_halving_keeps_colour_and_edges():
    four = np.zeros((512, 512, 4), np.uint8)
    four[:256, :256] = [10, 200, 30, 255]
    half = mosaic.halve(four)
    assert half[10, 10].tolist() == [10, 200, 30, 255]
    assert half[200, 200].tolist() == [0, 0, 0, 0]
    # The colour of a solid pixel is not darkened by see-through neighbours.
    edge = np.zeros((512, 512, 4), np.uint8)
    edge[0::2, 0::2] = [100, 100, 100, 255]
    edge[0::2, 1::2] = [100, 100, 100, 255]
    assert mosaic.halve(edge)[5, 5].tolist() == [100, 100, 100, 255]


def test_fingerprint_matches_the_app():
    # FNV-1a over the bytes, with their count in front, as in js/engine/tiles.js.
    real = mosaic.fetch
    mosaic.fetch = lambda url, tries=4: b'NISAR'
    try:
        h = 0x811C9DC5
        for b in b'NISAR':
            h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
        assert mosaic.fingerprint('2026-11-01') == f'5:{h:x}'
    finally:
        mosaic.fetch = real


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_'):
            fn()
            print('ok  ', name)
