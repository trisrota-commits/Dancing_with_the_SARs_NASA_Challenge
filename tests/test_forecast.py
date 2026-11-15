"""Checks tools/forecast.py on made-up cells whose behaviour is known."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import forecast  # noqa: E402

DAY = 86_400_000


def make_grid(cells=400, passes=12, momentum=0.7, noise=0.15, seed=1):
    """Cells that keep moving the way they moved: this step is `momentum`
    times the last step, plus a little noise. 'Same as last time' is then
    wrong by the step, and a way that has learnt the momentum is not."""
    rng = np.random.default_rng(seed)
    hh = np.zeros((passes, cells))
    hh[0] = rng.normal(-10, 2, cells)
    hh[1] = hh[0] + rng.normal(0.8, 0.3, cells)
    for t in range(2, passes):
        hh[t] = hh[t - 1] + momentum * (hh[t - 1] - hh[t - 2]) + rng.normal(0, noise, cells)
    hv = hh - 7 + rng.normal(0, 0.1, hh.shape)
    times = [1_780_000_000_000 + t * 12 * DAY for t in range(passes)]
    return {"id": "made-up", "name": "Made-up fields", "track": "000-A-000-DHDH", "cellM": 500, "times": times, "hh": hh.tolist(), "hv": hv.tolist()}


def main() -> None:
    # Ranks and rank correlation.
    assert forecast.ranks(np.array([10.0, 30.0, 20.0, 20.0])).tolist() == [0.0, 3.0, 1.5, 1.5]
    assert abs(forecast.spearman(np.array([1.0, 2.0, 3.0, 4.0]), np.array([10.0, 20.0, 25.0, 99.0])) - 1) < 1e-9
    assert abs(forecast.spearman(np.array([1.0, 2.0, 3.0, 4.0]), np.array([4.0, 3.0, 2.0, 1.0])) + 1) < 1e-9
    assert forecast.spearman(np.array([1.0, 1.0, 1.0]), np.array([1.0, 2.0, 3.0])) is None

    # The measures, on numbers worked out by hand.
    last = np.array([0.0, 0.0, 0.0, 0.0])
    seen = np.array([1.0, -1.0, 4.0, 0.0])
    pred = np.array([1.0, 0.0, 3.5, 0.0])  # errors 0, 1, -0.5, 0
    s = forecast.scores(pred, seen, last)
    assert s["n"] == 4 and s["mae"] == 0.38 and s["rmse"] == round(float(np.sqrt((0 + 1 + 0.25 + 0) / 4)), 2), s
    assert s["skill"] == round(1 - 1.25 / 18, 3), s  # against "same as last time": errors 1, 1, 4, 0
    # A strong change (3 dB or more): one cell had one (+4), and the prediction said so (+3.5).
    assert s["strong"] == {"happened": 0.25, "accuracy": 1.0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "tp": 1, "fp": 0, "fn": 0, "tn": 3}, s["strong"]
    # "Same as last time" never says a strong change will come.
    never = forecast.scores(last, seen, last)["strong"]
    assert never["recall"] == 0.0 and never["precision"] is None and never["f1"] is None and never["accuracy"] == 0.75, never

    # Up, down or stay (1 dB or more is a move), on four cells worked out by hand:
    # said up, stay, down, stay; it was up, stay, down, down.
    d = forecast.direction(np.array([2.0, 0.0, -3.0, 0.5]), np.array([1.5, 0.2, -2.0, -1.2]))
    assert d["accuracy"] == 0.75 and d["precision"] == 0.833 and d["recall"] == 0.833 and d["f1"] == 0.778, d
    assert d["commonest"] == 0.5 and d["shares"] == {"down": 0.5, "stay": 0.25, "up": 0.25}, d
    # "Same as last time" always says stay: its accuracy is the share of cells that stayed.
    still = forecast.direction(np.zeros(4), np.array([1.5, 0.2, -2.0, -1.2]))
    assert still["accuracy"] == 0.25 and still["recall"] == 0.333, still

    # The baselines on cells that rise by exactly 0.5 dB a pass: the trend
    # line and the line through the last two are exact, the mean lags.
    steps = np.arange(8, dtype=float)[:, None] * 0.5 + np.array([[-12.0, -8.0, -5.0]])
    times = [1_780_000_000_000 + t * 12 * DAY for t in range(8)]
    said = forecast.predict(steps, None, times, 6)
    assert np.allclose(said["trend"], steps[6]) and np.allclose(said["line"], steps[6])
    assert np.allclose(said["last"], steps[5]) and np.allclose(said["mean"], steps[:6].mean(axis=0))
    # A pass that comes late (24 days, not 12): the trend line reads further along, the two-point line does not know.
    late = times[:6] + [times[5] + 24 * DAY]
    assert np.allclose(forecast.predict(steps, None, late + [late[-1] + 12 * DAY], 6)["trend"], steps[5] + 1.0)

    grid = make_grid()
    result = forecast.forecast(grid)
    o = result["overall"]
    # Where cells keep their momentum, the learnt way beats both simple ones, and comes close to the noise put in.
    assert o["learnt"]["rmse"] < 0.6 * o["last"]["rmse"], (o["learnt"]["rmse"], o["last"]["rmse"])
    assert o["learnt"]["rmse"] < o["line"]["rmse"], (o["learnt"]["rmse"], o["line"]["rmse"])
    assert o["learnt"]["rmse"] < 0.3 and o["learnt"]["skill"] > 0.6, o["learnt"]
    assert o["last"]["skill"] == 0.0 and result["best"] == "learnt"
    assert result["bestBaseline"] in ("line", "trend") and result["modelAgainstBestBaseline"] > 0, (result["bestBaseline"], result["modelAgainstBestBaseline"])
    assert [w["key"] for w in result["ways"] if w["baseline"]] == ["last", "mean", "line", "trend"]
    assert len(result["byDate"]) == 12 - forecast.FIRST and result["cells"] == 400
    print("made-up fields:", {k: (v["rmse"], v["skill"]) for k, v in o.items()})

    # Nothing of the future goes into a prediction: spoiling every pass
    # from the one predicted on leaves that prediction as it was.
    hh = np.array(grid["hh"])
    hv = np.array(grid["hv"])
    t = 8
    before = forecast.predict(hh, hv, grid["times"], t)
    spoilt_hh, spoilt_hv = hh.copy(), hv.copy()
    spoilt_hh[t:] += 50
    spoilt_hv[t:] -= 50
    after = forecast.predict(spoilt_hh, spoilt_hv, grid["times"], t)
    for key in before:
        if key == "peers":  # by design it looks at the pass itself, and is marked as doing so
            assert not np.allclose(before[key], after[key])
            continue
        assert np.allclose(before[key], after[key]), key

    # Cells that only jitter: nothing beats "same as last time" by much, and the script says so.
    still = make_grid(momentum=0.0, noise=0.4, seed=2)
    flat = forecast.forecast(still)["overall"]
    assert flat["learnt"]["skill"] < 0.6 and flat["line"]["skill"] < 0, flat
    print("still fields:", {k: (v["rmse"], v["skill"]) for k, v in flat.items()})

    # Too few passes: no result, not a made-up one. With a few, only the
    # ways that need no long history are tried.
    assert forecast.forecast(make_grid(passes=forecast.MIN_SHORT - 1)) is None
    few = forecast.forecast(make_grid(passes=6))
    assert few["short"] and [w["key"] for w in few["ways"]] == ["last", "line", "peers"] and few["modelAgainstBestBaseline"] is None

    # Against the neighbours: every cell drops by 2 dB on one pass (rain,
    # a season), and one cell in ten drops by 6 more (a flood there). The
    # common drop is no surprise; the cells that went their own way are,
    # and the event's first pass after it is named.
    quiet_grid = make_grid(momentum=0.0, noise=0.2, seed=3)
    for c in range(400):
        quiet_grid["hh"][9][c] -= 2.0 + (6.0 if c % 10 == 0 else 0.0)
        for later in (10, 11):
            quiet_grid["hh"][later][c] -= 2.0 + (6.0 if c % 10 == 0 else 0.0)
    told = forecast.forecast(quiet_grid, event=quiet_grid["times"][9] - 5 * DAY)
    at = next(r for r in told["byDate"] if r["time"] == quiet_grid["times"][9])
    assert at["peers"]["rmse"] < at["last"]["rmse"] / 1.2, (at["peers"]["rmse"], at["last"]["rmse"])
    assert 0.09 <= at["peers"]["outside"] <= 0.2 and at["last"]["outside"] > 0.9, (at["peers"]["outside"], at["last"]["outside"])
    assert told["event"]["firstPassAfter"] == forecast.day(quiet_grid["times"][9]) and told["event"]["outside"] == at["peers"]["outside"]
    assert told["best"] != "peers" and next(w for w in told["ways"] if w["key"] == "peers")["needsNewPass"]

    # A pass on which the fields do something new is a surprise: most cells
    # fall outside the range they had kept to; on the passes before, about
    # one in ten does.
    sudden = make_grid()
    for c in range(0, 400, 2):
        sudden["hh"][10][c] -= 4.0  # half the fields are cut on the eleventh pass
    by_date = forecast.forecast(sudden)
    quiet = [r["learnt"]["outside"] for r in by_date["byDate"] if "outside" in r["learnt"] and r["time"] < sudden["times"][10]]
    hit = next(r for r in by_date["byDate"] if r["time"] == sudden["times"][10])["learnt"]["outside"]
    assert quiet and max(quiet) < 0.25 and 0.45 < hit < 0.6, (quiet, hit)
    # (The pass after is a surprise as well: the fields did not go on falling, as their last step suggested.)
    assert by_date["surprise"]["date"] in (forecast.day(sudden["times"][10]), forecast.day(sudden["times"][11])), by_date["surprise"]
    print("a sudden change:", [round(q, 2) for q in quiet], "->", hit)

    # Cells with gaps are left out of the count, not filled.
    holes = make_grid()
    for row in holes["hh"]:
        row[0] = None
    assert forecast.forecast(holes)["cells"] == 399
    print("ok")


if __name__ == "__main__":
    main()
