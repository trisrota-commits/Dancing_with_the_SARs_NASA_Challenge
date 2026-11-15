#!/usr/bin/env python3
"""How well can NISAR's next pass over a place be predicted from its past
passes, and how far off is the prediction?

The idea is Trisrota's (team discussion, 15 November 2026): if the app can
say what the next pass should show, then a pass that shows something else
is a change worth looking at; but a prediction is only worth as much as
its measured error. This script measures that error.

What it reads: data/measured/<site>_grid.json, written by
`tools/measure.py --grid`: the calibrated backscatter (dB) of every 500 m
cell around a site, for every pass on one track.

What it does, for every pass from the fifth on ("rolling origin": only
passes before the one predicted are ever used):

  1. Three ways of predicting each cell's co-polarised backscatter:
       last    the same as last time (the bar every other way must beat)
       line    the last value plus the last step (a straight line on)
       learnt  a ridge regression on the last three passes of both
               channels and the days since the last pass, fitted on every
               cell's history before the pass predicted (a small
               autoregressive model; nothing of the future goes in)
  2. Compares the prediction with what NISAR then measured, cell by cell:
       RMSE, MAE         how far off, in dB
       within90          nine of ten cells are within this many dB: the
                         error margin
       R2, Spearman      how well prediction and measurement agree
       skill             how much smaller the squared error is than that
                         of "last" (0 = no better, 1 = perfect)
  3. A yes/no question, for the measures used with rare events: "will
     this cell change by 3 dB or more (half or double the echo's power)
     by the next pass?" Answered by each way's own prediction and scored
     with accuracy, precision, recall and F1, next to how often it
     happens at all.

What it cannot tell: NISAR's data began in mid-2026, so no place has
been seen through the same season twice. No way of predicting here knows
what a harvest or a thaw looks like before it has happened once. Cells
next to each other change together, so the cells are fewer independent
samples than their number.

    pip install numpy
    python tools/forecast.py                 # every site with a grid
    python tools/forecast.py west-bengal

It writes data/measured/<site>_forecast.json for each site and
data/measured/forecast.json with one line per site.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "measured"
LAGS = 3  # passes of history a prediction looks at
FIRST = LAGS + 1  # the first pass predicted: there must be history to learn from as well
STRONG_DB = 3.0  # "a strong change": half or double the echo's power
RIDGE = 1.0
DAY = 86_400_000

WAYS = [
    {"key": "last", "name": "Same as last time", "how": "The next pass is predicted to read what the last one read."},
    {"key": "line", "name": "Straight line on", "how": "The last value plus the last step."},
    {"key": "learnt", "name": "Learnt from the cells' past", "how": f"A ridge regression on the last {LAGS} passes of both channels and the days since the last pass, fitted on every cell's history before the pass predicted."},
]


def ranks(a: np.ndarray) -> np.ndarray:
    """Ranks with ties given their mean rank."""
    order = np.argsort(a, kind="mergesort")
    r = np.empty(len(a))
    r[order] = np.arange(len(a))
    values, inverse, counts = np.unique(a, return_inverse=True, return_counts=True)
    sums = np.zeros(len(values))
    np.add.at(sums, inverse, r)
    return (sums / counts)[inverse]


def spearman(a: np.ndarray, b: np.ndarray) -> float | None:
    if len(a) < 3 or np.ptp(a) == 0 or np.ptp(b) == 0:
        return None
    return float(np.corrcoef(ranks(a), ranks(b))[0, 1])


def scores(pred: np.ndarray, seen: np.ndarray, last: np.ndarray) -> dict | None:
    """The measures of a prediction against what was measured."""
    ok = np.isfinite(pred) & np.isfinite(seen) & np.isfinite(last)
    if ok.sum() < 3:
        return None
    p, y, l = pred[ok], seen[ok], last[ok]
    err = p - y
    sse = float((err**2).sum())
    sst = float(((y - y.mean()) ** 2).sum())
    base = float(((l - y) ** 2).sum())
    out = {
        "n": int(ok.sum()),
        "rmse": round(float(np.sqrt((err**2).mean())), 2),
        "mae": round(float(np.abs(err).mean()), 2),
        "within90": round(float(np.quantile(np.abs(err), 0.9)), 2),
        "r2": None if sst == 0 else round(1 - sse / sst, 3),
        "spearman": None if spearman(p, y) is None else round(spearman(p, y), 3),
        "skill": None if base == 0 else round(1 - sse / base, 3),
    }
    # The yes/no question: a strong change by the next pass?
    said = np.abs(p - l) >= STRONG_DB
    was = np.abs(y - l) >= STRONG_DB
    tp, fp, fn, tn = int((said & was).sum()), int((said & ~was).sum()), int((~said & was).sum()), int((~said & ~was).sum())
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    out["strong"] = {
        "happened": round(float(was.mean()), 3),
        "accuracy": round((tp + tn) / ok.sum(), 3),
        "precision": None if precision is None else round(precision, 3),
        "recall": None if recall is None else round(recall, 3),
        "f1": None if not precision or not recall else round(2 * precision * recall / (precision + recall), 3),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
    }
    return out


def features(hh: np.ndarray, hv: np.ndarray | None, times: list[int], t: int) -> np.ndarray:
    """What the learnt way looks at to predict pass t: one row per cell."""
    cols = [np.ones(hh.shape[1])]
    cols += [hh[t - k] for k in range(1, LAGS + 1)]
    if hv is not None:
        cols += [hv[t - k] for k in range(1, LAGS + 1)]
    cols.append(np.full(hh.shape[1], (times[t] - times[t - 1]) / DAY / 12))
    return np.column_stack(cols)


def learn(hh: np.ndarray, hv: np.ndarray | None, times: list[int], before: int) -> np.ndarray | None:
    """Fits the learnt way on every step that ended before pass `before`."""
    xs, ys = [], []
    for s in range(LAGS, before):
        x, y = features(hh, hv, times, s), hh[s]
        ok = np.isfinite(x).all(axis=1) & np.isfinite(y)
        xs.append(x[ok])
        ys.append(y[ok])
    if not xs:
        return None
    x, y = np.vstack(xs), np.concatenate(ys)
    if len(y) < 10 * x.shape[1]:
        return None
    # The constant is not shrunk.
    penalty = RIDGE * np.eye(x.shape[1])
    penalty[0, 0] = 0
    return np.linalg.solve(x.T @ x + penalty, x.T @ y)


def predict(hh: np.ndarray, hv: np.ndarray | None, times: list[int], t: int) -> dict:
    """Each way's prediction of pass t for every cell, from passes before t only."""
    out = {"last": hh[t - 1], "line": 2 * hh[t - 1] - hh[t - 2]}
    weights = learn(hh, hv, times, t)
    out["learnt"] = features(hh, hv, times, t) @ weights if weights is not None else np.full(hh.shape[1], np.nan)
    return out


def day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def forecast(grid: dict) -> dict | None:
    times = grid["times"]
    hh = np.array(grid["hh"], dtype=float)
    hv = np.array(grid["hv"], dtype=float) if grid.get("hv") else None
    if len(times) <= FIRST:
        return None
    by_date, pooled = [], {w["key"]: {"pred": [], "seen": [], "last": []} for w in WAYS}
    for t in range(FIRST, len(times)):
        preds = predict(hh, hv, times, t)
        row = {"time": times[t], "date": day(times[t]), "seenMean": round(float(np.nanmean(hh[t])), 2), "lastMean": round(float(np.nanmean(hh[t - 1])), 2)}
        for key, p in preds.items():
            s = scores(p, hh[t], hh[t - 1])
            row[key] = s and {**s, "predMean": round(float(np.nanmean(p)), 2)}
            pooled[key]["pred"].append(p)
            pooled[key]["seen"].append(hh[t])
            pooled[key]["last"].append(hh[t - 1])
        by_date.append(row)
    overall = {key: scores(np.concatenate(v["pred"]), np.concatenate(v["seen"]), np.concatenate(v["last"])) for key, v in pooled.items()}
    if not overall["last"]:
        return None
    best = min((k for k in overall if overall[k]), key=lambda k: overall[k]["rmse"])
    margin = overall[best]["within90"]
    worst = max(by_date, key=lambda r: (r[best] or {}).get("rmse", 0))
    return {
        "id": grid["id"],
        "name": grid["name"],
        "track": grid["track"],
        "cellM": grid["cellM"],
        "cells": int(np.isfinite(hh).all(axis=0).sum()),
        "passes": len(times),
        "from": day(times[0]),
        "to": day(times[-1]),
        "channel": "co-polarised backscatter, dB",
        "strongDb": STRONG_DB,
        "ways": WAYS,
        "overall": overall,
        "best": best,
        "byDate": by_date,
        "summary": (
            f"Predicting the next pass one step ahead, {len(by_date)} times over {overall[best]['n']:,} cell readings: "
            f"the best way here is \"{next(w['name'] for w in WAYS if w['key'] == best).lower()}\", off by {overall[best]['mae']} dB on average, "
            f"and within {margin} dB for nine cells in ten. It was furthest off for the pass of {worst['date']} ({worst[best]['rmse']} dB)."
        ),
        "method": (
            f"Calibrated NISAR backscatter (GCOV, gamma-naught) in cells of {grid['cellM']:g} m on track {grid['track']}. "
            f"Each pass from the {FIRST + 1}th on is predicted from the passes before it only, and compared with what was measured. "
            "RMSE and MAE in dB; 'within90' is the error nine cells in ten stay under; 'skill' compares the squared error with that of 'same as last time'. "
            f"The yes/no question is whether a cell changes by {STRONG_DB:g} dB or more by the next pass."
        ),
        "limits": "One season of data: no way of predicting has seen a harvest, a flood or a thaw here before it happened. Neighbouring cells change together, so they are fewer independent samples than their number.",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def main() -> None:
    wanted = set(sys.argv[1:])
    lines = []
    for path in sorted(OUT_DIR.glob("*_grid.json")):
        grid = json.loads(path.read_text())
        if wanted and grid["id"] not in wanted:
            continue
        result = forecast(grid)
        if not result:
            print(f"{grid['id']}: too few passes to test a prediction ({len(grid['times'])})")
            continue
        (OUT_DIR / f"{grid['id']}_forecast.json").write_text(json.dumps(result, indent=1) + "\n")
        o = result["overall"]
        print(f"\n{result['name']}: {result['cells']} cells, {result['passes']} passes, {result['from']} to {result['to']}")
        for w in WAYS:
            s = o[w["key"]]
            if s:
                c = s["strong"]
                print(f"  {w['name']:28s} RMSE {s['rmse']:5.2f}  MAE {s['mae']:5.2f}  within90 {s['within90']:5.2f}  R2 {s['r2']}  Spearman {s['spearman']}  skill {s['skill']}  | strong change: accuracy {c['accuracy']}, precision {c['precision']}, recall {c['recall']}, F1 {c['f1']} (happened in {c['happened']:.1%})")
        print(f"  → {result['summary']}")
        lines.append({"id": result["id"], "name": result["name"], "cells": result["cells"], "passes": result["passes"], "best": result["best"], **{k: o[k] and {m: o[k][m] for m in ("rmse", "mae", "within90", "r2", "spearman", "skill")} for k in o}})
    if not wanted:
        (OUT_DIR / "forecast.json").write_text(json.dumps(lines, indent=1) + "\n")
    print(f"\n{len(lines)} site(s) tested")


if __name__ == "__main__":
    main()
