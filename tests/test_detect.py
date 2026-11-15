#!/usr/bin/env python3
"""Checks tools/detect.py on made-up cells with known properties.

    python tests/test_detect.py

Nothing here is a measurement: the grids are noise with changes put in,
so that what the detector should find is known.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import detect as D  # noqa: E402

DAY = 86400_000
N = 24


def grid(passes=8, noise=0.4, seed=1, hv=True, level=None):
    """Cells that keep their own level, with noise from pass to pass and a
    shift of the whole window that differs from pass to pass (weather)."""
    rng = np.random.default_rng(seed)
    own = rng.normal(-10, 2.0, N * N)
    weather = rng.normal(0, 0.8, passes) if level is None else np.asarray(level, dtype=float)
    hh = own + weather[:, None] + rng.normal(0, noise, (passes, N * N))
    g = {"id": "test", "name": "Test", "track": "000", "cellM": 500.0, "n": N, "radiusM": 6000, "times": [i * 12 * DAY for i in range(passes)], "files": [f"X_P05023_{i}.h5" for i in range(passes)], "hh": hh.tolist(), "hv": None}
    if hv:
        g["hv"] = (own - 7 + weather[:, None] + rng.normal(0, noise, (passes, N * N))).tolist()
    return g


def patch(size=6, at=5):
    m = np.zeros((N, N), dtype=bool)
    m[at : at + size, at : at + size] = True
    return m.ravel()


def put(g, mask, db, since):
    """Changes the cells of `mask` by `db` in every pass from `since` on."""
    for key in ("hh", "hv"):
        if g.get(key):
            a = np.array(g[key])
            a[since:, mask] += db
            g[key] = a.tolist()
    return g


def test_noise_alone_is_not_flagged():
    d = D.detect(grid())
    assert d and len(d["byDate"]) == 8 - D.MIN_BASE
    assert all(r["stood"] < 0.01 for r in d["byDate"]), [r["stood"] for r in d["byDate"]]


def test_a_patch_is_found_and_little_else():
    m = patch()
    d = D.detect(put(grid(), m, -4.0, 7))
    last = d["byDate"][-1]
    assert abs(last["stood"] - m.mean()) < 0.02, (last["stood"], m.mean())
    assert last["fell"] > 0.9 * last["stood"] and last["rose"] < 0.005
    hh, hv = D.read(put(grid(), m, -4.0, 7))
    r = D.judge(hh, hv, list(range(7)), 7, N)
    assert r["kept"][m].mean() > 0.9 and r["kept"][~m].mean() < 0.01


def test_a_shift_of_the_whole_window_is_not_a_change():
    level = [0, 0.3, -0.2, 0.1, 0, -0.1, 0.2, -3.0]  # the last pass: everything 3 dB down
    d = D.detect(grid(level=level))
    assert d["byDate"][-1]["stood"] < 0.01, d["byDate"][-1]


def test_single_cells_do_not_count():
    flag = np.zeros((N, N), dtype=bool)
    flag[3, 3] = True  # alone
    flag[10, 10:13] = True  # three in a row: the middle one has two neighbours
    flag[20, 20] = flag[21, 21] = flag[20, 21] = True  # a corner of three
    kept = D.clustered(flag.ravel(), N).reshape(N, N)
    assert not kept[3, 3]
    assert kept[10, 11] and not kept[10, 10] and not kept[10, 12]
    assert kept[20, 20] and kept[21, 21] and kept[20, 21]


def test_one_channel_is_enough():
    m = patch()
    d = D.detect(put(grid(hv=False), m, 4.0, 7))
    last = d["byDate"][-1]
    assert last["channels"] == 1 and last["rose"] > 0.8 * m.mean()


def test_an_event_keeps_its_baseline_before_the_event():
    m = patch()
    g = put(grid(passes=7), m, -4.0, 4)  # the change comes with pass 4 and stays
    event = g["times"][4] - 3 * DAY
    d = D.detect(g, event)
    after = [r for r in d["byDate"] if r["afterEvent"]]
    assert len(after) == 3 and all(r["baseline"] == 4 for r in after)
    # Were the changed passes taken into the baseline, the later ones would fade.
    assert all(r["stood"] > 0.8 * m.mean() for r in after), [r["stood"] for r in after]
    assert d["event"]["firstPassAfter"] == after[0]["date"] and d["event"]["stood"] == after[0]["stood"]
    assert after[0]["stillNext"] > 0.9
    assert d["picture"]["date"] == after[0]["date"]


def test_a_new_processing_version_is_marked():
    g = grid()
    g["files"][-1] = "X_P05036_7.h5"
    d = D.detect(g)
    assert d["byDate"][-1]["newVersion"] == {"from": "P05023", "to": "P05036"}
    assert "newVersion" not in d["byDate"][-2]


def test_an_impossible_cell_is_left_out():
    g = grid()
    a = np.array(g["hh"])
    a[2, 100] = -145.0
    g["hh"] = a.tolist()
    hh, _ = D.read(g)
    assert np.isnan(hh[:, 100]).all() and np.isfinite(hh[:, 101]).all()
    assert D.detect(g)["cells"] == N * N - 1


def test_too_few_passes_give_nothing():
    assert D.detect(grid(passes=3)) is None


def test_the_picture_marks_rise_and_fall():
    kept = np.zeros(N * N, dtype=bool)
    lead = np.zeros(N * N)
    kept[0], lead[0] = True, 4.0
    kept[1], lead[1] = True, -4.0
    img = D.stood_rgba(kept, lead, N)
    px = D.F.STOOD_PIXELS
    assert tuple(img[0, 0, :3]) == D.F.STRONGER and tuple(img[0, px, :3]) == D.F.WEAKER
    assert img[0, 2 * px, 3] == 0 and img.shape == (N * px, N * px, 4)
    # An outline with a light fill: the map shows through the middle of a cell.
    assert img[0, 0, 3] > 200 and img[px // 2, px // 2, 3] == D.INSIDE


def test_the_sensitivity_test_counts_what_was_put_in():
    D.TRIALS, trials = 2, D.TRIALS
    try:
        r = D.sensitivity([(grid(seed=3), None)])
    finally:
        D.TRIALS = trials
    g = r["groups"]["all"]
    row = next(x for x in g["rows"] if x["db"] == -6.0 and x["cells"] == 5)
    assert row["new"]["recall"] > 0.9 and row["new"]["precision"] > 0.8, row
    small = next(x for x in g["rows"] if x["db"] == -1.0 and x["cells"] == 5)
    assert small["new"]["recall"] < row["new"]["recall"]
    assert g["flaggedWithNothingPutIn"]["new"] < 0.01
    assert r["sites"][0]["group"] == "quiet"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok  ", name)
