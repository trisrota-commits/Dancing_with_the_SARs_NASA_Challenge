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
    assert len(after) == 3 and all(r["baseline"] == 2 and r["history"] == 4 and r["grade"] == "both" for r in after)
    # Were the changed passes taken into the baseline, the later ones would fade.
    assert all(r["stood"] > 0.8 * m.mean() for r in after), [r["stood"] for r in after]
    assert d["event"]["firstPassAfter"] == after[0]["date"] and d["event"]["stood"] == after[0]["stood"]
    assert after[0]["stillNext"] > 0.9
    assert d["picture"]["date"] == after[0]["date"]


def test_an_event_with_few_passes_before_it_is_still_judged():
    m = patch()
    for before, grade in ((2, "two"), (1, "pair")):
        g = put(grid(passes=before + 2, seed=5), m, -4.0, before)
        d = D.detect(g, g["times"][before] - 3 * DAY)
        after = [r for r in d["byDate"] if r["afterEvent"]]
        assert len(after) == 2 and after[0]["grade"] == grade and after[0]["baseline"] == before, after
        assert abs(after[0]["stood"] - m.mean()) < 0.03, (grade, after[0]["stood"], m.mean())
        # Without the long key the result is the recent key's, and says why it is rougher.
        assert after[0]["long"] is None and after[0]["stood"] == after[0]["recent"] and after[0]["history"] == 0
        assert d["event"]["grade"] == grade and "Only" in d["summary"]
    # With one pass before there is no past: the threshold is the one theory gives.
    assert abs(after[0]["threshold"] - D.THEORY[2]) < 0.01
    # A place without an event is not judged on so little.
    assert D.detect(grid(passes=3)) is None


def test_noise_is_not_flagged_in_the_rougher_grades():
    hh, hv = D.read(grid(seed=7))
    for base in ([5, 6], [6]):
        r = D.judge(hh, hv, base, 7, N, need=1)
        assert r["kept"].mean() < 0.02, (base, r["kept"].mean())


def test_a_cell_stands_out_only_if_both_keys_turn():
    m = patch()
    hh, hv = D.read(put(grid(), m, -4.0, 7))
    r = D.judge(hh, hv, list(range(7)), 7, N)
    assert r["grade"] == "both" and r["baseline"] == 2 and r["history"] == 7
    assert (r["kept"] == (r["recent"] & r["long"])).all()
    assert r["recent"][m].mean() > 0.9 and r["long"][m].mean() > 0.9


def test_a_change_over_much_of_the_window_does_not_hide_itself():
    # A third of the window falls by 3 dB. Were the recent key's spread
    # taken from the pass judged, the change would widen its own
    # yardstick; the flood in Italy fell from 12 % to 0.2 % that way.
    m = np.zeros((N, N), dtype=bool)
    m[:8, :] = True
    m = m.ravel()
    hh, hv = D.read(put(grid(noise=0.3), m, -3.0, 7))
    r = D.judge(hh, hv, list(range(7)), 7, N)
    assert r["recent"][m].mean() > 0.7, r["recent"][m].mean()


def test_the_kind_of_change_follows_the_two_channels():
    m = patch()
    fell = D.detect(put(grid(), m, -4.0, 7))["byDate"][-1]["kinds"]
    assert fell["bothFell"] > 0.9, fell
    g = grid()
    a = np.array(g["hv"])
    a[7:, m] -= 5.0  # the cross channel alone: leaves and branches gone
    g["hv"] = a.tolist()
    lost = D.detect(g)["byDate"][-1]["kinds"]
    assert lost["hvFell"] > 0.9, lost
    assert "kinds" not in D.detect(put(grid(hv=False), m, 4.0, 7))["byDate"][-1]
    assert set(fell) == set(D.KINDS)


def test_every_pass_with_flagged_cells_gets_a_picture():
    m = patch()
    d = D.detect(put(grid(), m, -4.0, 6))
    # (Without an event the changed pass joins the baseline of the next
    # one, and widens those cells' usual spread: it is flagged once.)
    assert [("image" in r) for r in d["byDate"]][:4] == [False, False, False, True]
    assert d["byDate"][3]["image"] == f"test_stood_{d['byDate'][3]['date']}.png" and "_rgba" in d["byDate"][3]


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


def test_open_water_is_left_out_and_a_window_at_sea_is_not_judged():
    # The southern third of the window is water: a weak cross-polarised
    # echo that the wind moves by several dB from pass to pass.
    rng = np.random.default_rng(11)
    sea = np.zeros((N, N), dtype=bool)
    sea[16:, :] = True
    sea = sea.ravel()
    g = grid()
    hh, hv = np.array(g["hh"]), np.array(g["hv"])
    hh[:, sea] = -18 + rng.normal(0, 3.0, (hh.shape[0], 1)) + rng.normal(0, 0.5, (hh.shape[0], sea.sum()))
    hv[:, sea] = -27 + rng.normal(0, 3.0, (hv.shape[0], 1)) + rng.normal(0, 0.5, (hv.shape[0], sea.sum()))
    g["hh"], g["hv"] = hh.tolist(), hv.tolist()
    d = D.detect(g)
    assert abs(d["water"] - sea.mean()) < 0.01 and "left out" in d["method"]
    assert all(r["stood"] < 0.01 for r in d["byDate"]), [r["stood"] for r in d["byDate"]]
    # All of it water: nothing is said about change.
    hh[:], hv[:] = -18 + rng.normal(0, 3.0, hh.shape), -27 + rng.normal(0, 3.0, hv.shape)
    g["hh"], g["hv"] = hh.tolist(), hv.tolist()
    d = D.detect(g, g["times"][5] - DAY)
    assert d["byDate"] == [] and d["event"]["openWater"] and d["event"]["stood"] is None and "open water" in d["summary"]


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
