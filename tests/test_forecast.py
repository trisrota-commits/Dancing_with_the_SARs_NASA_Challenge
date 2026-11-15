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

    grid = make_grid()
    result = forecast.forecast(grid)
    o = result["overall"]
    # Where cells keep their momentum, the learnt way beats both simple ones, and comes close to the noise put in.
    assert o["learnt"]["rmse"] < 0.6 * o["last"]["rmse"], (o["learnt"]["rmse"], o["last"]["rmse"])
    assert o["learnt"]["rmse"] < o["line"]["rmse"], (o["learnt"]["rmse"], o["line"]["rmse"])
    assert o["learnt"]["rmse"] < 0.3 and o["learnt"]["skill"] > 0.6, o["learnt"]
    assert o["last"]["skill"] == 0.0 and result["best"] == "learnt"
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
        assert np.allclose(before[key], after[key]), key

    # Cells that only jitter: nothing beats "same as last time" by much, and the script says so.
    still = make_grid(momentum=0.0, noise=0.4, seed=2)
    flat = forecast.forecast(still)["overall"]
    assert flat["learnt"]["skill"] < 0.6 and flat["line"]["skill"] < 0, flat
    print("still fields:", {k: (v["rmse"], v["skill"]) for k, v in flat.items()})

    # Too few passes: no result, not a made-up one.
    short = make_grid(passes=forecast.FIRST)
    assert forecast.forecast(short) is None

    # Cells with gaps are left out of the count, not filled.
    holes = make_grid()
    for row in holes["hh"]:
        row[0] = None
    assert forecast.forecast(holes)["cells"] == 399
    print("ok")


if __name__ == "__main__":
    main()
