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

  1. Five ways of predicting each cell's co-polarised backscatter. Four
     are baselines, simple rules a model has to beat:
       last    the same as last time (persistence, the naive forecast)
       mean    the mean of every earlier pass of the cell
       line    the last value plus the last step
       trend   a least-squares line (linear regression) through the
               cell's last four passes, read off at the date predicted
     and one is the model:
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
  3. Says how surprising each pass was: the share of cells that fell
     outside the range nine cells in ten had stayed within on the passes
     predicted before it. About one in ten is nothing unusual; many more
     means the ground did something the passes before gave no sign of.
     This is the use a prediction has here: not to foretell, but to tell
     a change from the ordinary.
  4. A three-way question scored flat out: "will the echo go down,
     stay, or go up by the next pass?" (1 dB or more counts as a move):
     accuracy, and precision, recall and F1 averaged over the three
     answers, next to the accuracy of always naming the commonest answer.
  5. A yes/no question, for the measures used with rare events: "will
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
import math
import re
import struct
import sys
import zlib
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "measured"
LAGS = 3  # passes of history a prediction looks at
FIRST = LAGS + 1  # the first pass predicted: there must be history to learn from as well
MIN_PASSES = 8  # fewer passes than this are too little history to test a prediction on
MIN_SHORT = 5  # with this many, the comparison with the neighbours can still be made
QUIET = 0.9  # "the expected range": what this share of cells stayed within on the passes before
PLAUSIBLE_DB = (-40.0, 20.0)  # as in tools/measure.py: outside this, no reading of the ground
STRONG_DB = 3.0  # "a strong change": half or double the echo's power
RIDGE = 1.0
DAY = 86_400_000

DIRECTION_DB = 1.0  # "up" or "down": a change of this much or more (a quarter more or less power)

# The ways of predicting. The first four are baselines: simple rules any
# model has to beat before it is worth anything. The fifth is the model.
WAYS = [
    {"key": "last", "name": "Same as last time", "baseline": True, "how": "Persistence, the naive forecast: the next pass is predicted to read what the last one read."},
    {"key": "mean", "name": "Mean of the earlier passes", "baseline": True, "how": "The cell's average over every pass before the one predicted."},
    {"key": "line", "name": "Line through the last two", "baseline": True, "how": "The last value plus the last step."},
    {"key": "trend", "name": "Trend of the last four", "baseline": True, "how": "A straight line fitted by least squares (linear regression) through the cell's last four passes against their dates, read off at the date predicted."},
    {
        "key": "peers",
        "name": "Last pass plus what the neighbours did",
        "baseline": False,
        "needsNewPass": True,
        "how": "The last value plus the median step of all the place's cells in the same pass. It uses the new pass itself, so it is no forecast: it removes what rain, season or the whole scene did to every cell alike, and shows which cells did something else.",
    },
    {"key": "learnt", "name": "Model learnt from the cells' past", "baseline": False, "how": f"A ridge regression on the last {LAGS} passes of both channels and the days since the last pass, fitted on every cell's history before the pass predicted."},
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
    out["direction"] = direction(p - l, y - l)
    return out


def direction(said: np.ndarray, was: np.ndarray) -> dict:
    """The three-way question "will the echo go down, stay, or go up by the
    next pass?" (a step of DIRECTION_DB or more counts as a move), scored
    flat out: accuracy, and precision, recall and F1 averaged over the
    classes that occurred. `commonest` is the accuracy of always naming
    the class that occurred most: the number an accuracy has to beat."""
    kind = lambda d: np.where(d <= -DIRECTION_DB, 0, np.where(d >= DIRECTION_DB, 2, 1))  # noqa: E731
    p, y = kind(said), kind(was)
    precisions, recalls, f1s, shares = [], [], [], {}
    for k, name in enumerate(("down", "stay", "up")):
        shares[name] = round(float((y == k).mean()), 3)
        if not (y == k).any():
            continue
        tp = int(((p == k) & (y == k)).sum())
        precision = tp / int((p == k).sum()) if (p == k).any() else 0.0
        recall = tp / int((y == k).sum())
        precisions.append(precision)
        recalls.append(recall)
        f1s.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    return {
        "accuracy": round(float((p == y).mean()), 3),
        "precision": round(float(np.mean(precisions)), 3),
        "recall": round(float(np.mean(recalls)), 3),
        "f1": round(float(np.mean(f1s)), 3),
        "commonest": max(shares.values()),
        "shares": shares,
    }


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


def predict(hh: np.ndarray, hv: np.ndarray | None, times: list[int], t: int, short: bool = False) -> dict:
    """Each way's prediction of pass t for every cell, from passes before t
    only; except "peers", which also takes the median step of pass t itself.
    `short`: only the ways that need no long history."""
    out = {"last": hh[t - 1], "line": 2 * hh[t - 1] - hh[t - 2]}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # a cell with no value at all stays NaN
        out["peers"] = hh[t - 1] + np.nanmedian(hh[t] - hh[t - 1])
        if short:
            return out
        out["mean"] = np.nanmean(hh[:t], axis=0)
    # Least squares through the last four passes, against their dates.
    days = np.array(times[t - 4 : t + 1], dtype=float) / DAY
    x = days[:4] - days[:4].mean()
    y = hh[t - 4 : t]
    slope = (x[:, None] * (y - y.mean(axis=0))).sum(axis=0) / (x**2).sum()
    out["trend"] = y.mean(axis=0) + slope * (days[4] - days[:4].mean())
    weights = learn(hh, hv, times, t)
    out["learnt"] = features(hh, hv, times, t) @ weights if weights is not None else np.full(hh.shape[1], np.nan)
    return out


def day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


WEAKER, STRONGER = (0x40, 0xAA, 0xFF), (0xFF, 0xAA, 0x3C)  # the app's blue and orange
STOOD_PIXELS = 16  # pixels a cell in the picture


def stood_rgba(residual: np.ndarray, expected: float, n: int) -> np.ndarray:
    """The cells that did something other than their neighbours, as a
    picture: n by n cells, north at the top. `residual` is each cell's
    step minus the median step of all cells, in dB. Orange where the echo
    rose by more than `expected` beyond its neighbours', blue where it
    fell by more; the colour is full at twice that. Every other cell, and
    a cell without data, is see-through."""
    r = residual.reshape(n, n)
    out = np.zeros((n, n, 4), dtype=np.uint8)
    with np.errstate(invalid="ignore"):
        beyond = np.abs(r) > expected
    beyond &= np.isfinite(r)
    strength = np.clip((np.abs(r) - expected) / expected, 0, 1)
    for mask, colour in ((beyond & (r > 0), STRONGER), (beyond & (r < 0), WEAKER)):
        out[mask, :3] = colour
        out[mask, 3] = (150 + 105 * strength[mask]).astype(np.uint8)
    return out.repeat(STOOD_PIXELS, axis=0).repeat(STOOD_PIXELS, axis=1)


def png(rgba: np.ndarray) -> bytes:
    """An RGBA picture as PNG bytes (no library needed for so little)."""
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def window_bounds(lat: float, lon: float, radius_m: float) -> dict:
    """The window of the cells in degrees, as tools/measure.py lays out its
    change map. The cells are square on the map projection of NISAR's
    file, which is turned against north by up to a few degrees: the
    picture is placed to within about half a cell at its edges."""
    dlat = radius_m / 111_320
    dlon = radius_m / (111_320 * max(0.05, math.cos(math.radians(lat))))
    return {"west": lon - dlon, "east": lon + dlon, "south": lat - dlat, "north": lat + dlat}


def versions(files: list[str] | None, n: int) -> list[str | None]:
    """The version of NASA's processing each pass was made with, from the
    file name (the part like P05036). When it changes, the values can
    shift by themselves: at the change from P05023 to P05036 (passes from
    about 21 October 2026) the mean over the window fell at 12 of the 15
    places measured, by 0.4 dB in the middle (found 15 November 2026). A
    pass that is the first of a new version is marked, so that such a
    shift is not read as the ground's."""
    out = []
    for i in range(n):
        m = re.search(r"_(P\d{5})_", files[i]) if files and i < len(files) and files[i] else None
        out.append(m.group(1) if m else None)
    return out


def forecast(grid: dict, event: int | None = None) -> dict | None:
    times = grid["times"]
    made = versions(grid.get("files"), len(times))
    hh = np.array(grid["hh"], dtype=float)
    hv = np.array(grid["hv"], dtype=float) if grid.get("hv") else None
    # A cell that ever read a value no radar could measure is left out
    # whole: its other passes come from the same faulty strip of the file.
    with np.errstate(invalid="ignore"):
        faulty = ((hh < PLAUSIBLE_DB[0]) | (hh > PLAUSIBLE_DB[1])).any(axis=0)
        if hv is not None:
            faulty |= ((hv < PLAUSIBLE_DB[0]) | (hv > PLAUSIBLE_DB[1])).any(axis=0)
    hh[:, faulty] = np.nan
    if hv is not None:
        hv[:, faulty] = np.nan
    if len(times) < MIN_SHORT:
        return None
    short = len(times) < MIN_PASSES
    by_date, pooled = [], {}
    earlier = {}  # each way's misses on the passes predicted so far
    apart = {}  # by pass: each cell's step minus its neighbours' (dB), for the picture
    for t in range(2 if short else FIRST, len(times)):
        preds = predict(hh, hv, times, t, short)
        for key in preds:
            pooled.setdefault(key, {"pred": [], "seen": [], "last": []})
            earlier.setdefault(key, [])
        row = {"time": times[t], "date": day(times[t]), "seenMean": round(float(np.nanmean(hh[t])), 2), "lastMean": round(float(np.nanmean(hh[t - 1])), 2)}
        if made[t] and made[t - 1] and made[t] != made[t - 1]:
            row["newVersion"] = {"from": made[t - 1], "to": made[t]}
        if "peers" in preds:
            apart[times[t]] = hh[t] - preds["peers"]
        for key, p in preds.items():
            s = scores(p, hh[t], hh[t - 1])
            row[key] = s and {**s, "predMean": round(float(np.nanmean(p)), 2)}
            miss = np.abs(p - hh[t])
            miss = miss[np.isfinite(miss)]
            # How surprising this pass was, going by the misses before it only.
            if row[key] and len(earlier[key]) >= 2 and len(miss):
                expected = float(np.quantile(np.concatenate(earlier[key]), QUIET))
                row[key]["expected"] = round(expected, 2)
                row[key]["outside"] = round(float((miss > expected).mean()), 3)
            if len(miss):
                earlier[key].append(miss)
            pooled[key]["pred"].append(p)
            pooled[key]["seen"].append(hh[t])
            pooled[key]["last"].append(hh[t - 1])
        by_date.append(row)
    overall = {key: scores(np.concatenate(v["pred"]), np.concatenate(v["seen"]), np.concatenate(v["last"])) for key, v in pooled.items()}
    if not overall["last"]:
        return None
    ways = [w for w in WAYS if overall.get(w["key"])]
    # (The best way of predicting: "peers" is left out, it needs the pass it predicts.)
    best = min((w["key"] for w in ways if not w.get("needsNewPass")), key=lambda k: overall[k]["rmse"])
    # The baseline to beat, and by how much the model does or does not.
    bar = min((w["key"] for w in ways if w["baseline"]), key=lambda k: overall[k]["rmse"])
    model = overall.get("learnt")
    gain = None if not model else round(1 - (model["rmse"] / overall[bar]["rmse"]) ** 2, 3)
    margin = overall[best]["within90"]
    worst = max(by_date, key=lambda r: (r[best] or {}).get("rmse", 0))
    judged = [r for r in by_date if r[best] and "outside" in r[best]]
    surprise = max(judged, key=lambda r: r[best]["outside"]) if judged else None
    # Against the neighbours: the pass on which most cells did something of their own.
    stood = [r for r in by_date if r.get("peers") and "outside" in r["peers"]]
    odd = max(stood, key=lambda r: r["peers"]["outside"]) if stood else None
    # An event: the first pass after it.
    after = next((r for r in by_date if event and r["time"] >= event), None)
    hit = after and after.get("peers") and after["peers"].get("outside")
    # The pass to draw: at an event the first pass afterwards, elsewhere
    # the one that stood out most. Only where the range could be judged.
    shown = after if event else odd
    picture = None
    if shown and shown.get("peers") and "expected" in shown["peers"] and grid.get("n") and grid["n"] ** 2 == hh.shape[1]:
        picture = {"date": shown["date"], "time": shown["time"], "before": by_date[by_date.index(shown) - 1]["date"] if by_date.index(shown) else day(times[times.index(shown["time"]) - 1]), "expected": shown["peers"]["expected"], "outside": shown["peers"]["outside"], "n": grid["n"], "image": f"{grid['id']}_stood.png", "_rgba": stood_rgba(apart[shown["time"]], shown["peers"]["expected"], grid["n"])}
    return {
        "stood": picture,
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
        "ways": ways,
        "short": short,
        "peerSurprise": odd and {"date": odd["date"], "time": odd["time"], "outside": odd["peers"]["outside"], "expected": odd["peers"]["expected"]},
        "event": None if not event else {"time": event, "date": day(event), "firstPassAfter": after and after["date"], "outside": hit if hit is not None else None, "newVersion": (after or {}).get("newVersion")},
        "overall": overall,
        "best": best,
        "bestBaseline": bar,
        "modelAgainstBestBaseline": gain,
        "directionDb": DIRECTION_DB,
        "byDate": by_date,
        "summary": (
            f"Predicting the next pass one step ahead, {len(by_date)} times over {overall[best]['n']:,} cell readings: "
            f"the best way here is \"{next(w['name'] for w in WAYS if w['key'] == best).lower()}\", off by {overall[best]['mae']} dB on average, "
            f"and within {margin} dB for nine cells in ten. It was furthest off for the pass of {worst['date']} ({worst[best]['rmse']} dB)."
            + (
                f" The model {'beats' if gain > 0 else 'does not beat'} the best simple rule (\"{next(w['name'] for w in WAYS if w['key'] == bar).lower()}\", RMSE {overall[bar]['rmse']} dB) with RMSE {model['rmse']} dB."
                if model and gain is not None
                else ""
            )
            + (
                f" Set against their neighbours, most cells stood out at the pass of {odd['date']}: {odd['peers']['outside']:.0%} did something of their own (about 10 % is ordinary)."
                if odd
                else ""
            )
            + (
                f" At the first pass after the event of {day(event)} ({after['date']}), {hit:.0%} of the cells did something other than their neighbours."
                if hit is not None
                else ""
            )
            + (
                f" The most surprising pass was that of {surprise['date']}: {surprise[best]['outside']:.0%} of the cells fell outside the range nine in ten had kept to before (±{surprise[best]['expected']} dB)."
                if surprise
                else ""
            )
        ),
        "surprise": surprise and {"date": surprise["date"], "time": surprise["time"], "outside": surprise[best]["outside"], "expected": surprise[best]["expected"]},
        "method": (
            f"Calibrated NISAR backscatter (GCOV, gamma-naught) in cells of {grid['cellM']:g} m on track {grid['track']}. "
            f"Each pass from the {FIRST + 1}th on is predicted from the passes before it only, and compared with what was measured. "
            "RMSE and MAE in dB; '9 in 10' is the error nine cells in ten stay under. "
            f"'Up or down' asks whether a cell's echo goes down or up by {DIRECTION_DB:g} dB or more by the next pass, or stays; precision, recall and F1 are averaged over the three answers. "
            f"The yes/no question is whether a cell changes by {STRONG_DB:g} dB or more by the next pass. "
            "'Outside the expected range' is the share of cells whose miss was larger than nine in ten misses on the passes predicted before; about 10 % is ordinary."
        ),
        "limits": "One season of data: no way of predicting has seen a harvest, a flood or a thaw here before it happened. Neighbouring cells change together, so they are fewer independent samples than their number. A pass made with a new version of NASA's processing can shift by itself; such passes are marked.",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def main() -> None:
    wanted = set(sys.argv[1:])
    lines = []
    for path in sorted(OUT_DIR.glob("*_grid.json")):
        grid = json.loads(path.read_text())
        if wanted and grid["id"] not in wanted:
            continue
        try:
            event = json.loads((OUT_DIR / f"{grid['id']}.json").read_text()).get("event")
        except (OSError, ValueError):
            event = None
        result = forecast(grid, event)
        # (The picture of the cells that stood out is made by tools/detect.py.)
        if result and result["stood"]:
            result["stood"] = None
        if not result:
            print(f"{grid['id']}: too few passes to test anything ({len(grid['times'])}; {MIN_SHORT} are needed)")
            stale = OUT_DIR / f"{grid['id']}_forecast.json"
            if stale.exists():
                stale.unlink()
            continue
        (OUT_DIR / f"{grid['id']}_forecast.json").write_text(json.dumps(result, indent=1) + "\n")
        o = result["overall"]
        print(f"\n{result['name']}: {result['cells']} cells, {result['passes']} passes, {result['from']} to {result['to']}")
        for w in WAYS:
            s = o.get(w["key"])
            if s:
                c, d = s["strong"], s["direction"]
                print(f"  {w['name']:34s} RMSE {s['rmse']:5.2f} MAE {s['mae']:5.2f} within90 {s['within90']:5.2f} R2 {s['r2']} Spearman {s['spearman']} | up/down/stay: accuracy {d['accuracy']} (commonest {d['commonest']}), precision {d['precision']}, recall {d['recall']}, F1 {d['f1']} | strong change: accuracy {c['accuracy']}, precision {c['precision']}, recall {c['recall']}, F1 {c['f1']} ({c['happened']:.1%})")
        print(f"  → {result['summary']}")
        lines.append({"id": result["id"], "name": result["name"], "cells": result["cells"], "passes": result["passes"], "best": result["best"], "event": result["event"], "peerSurprise": result["peerSurprise"], **{k: o[k] and {m: o[k][m] for m in ("rmse", "mae", "within90", "r2", "spearman", "skill")} for k in o}})
    if not wanted:
        (OUT_DIR / "forecast.json").write_text(json.dumps(lines, indent=1) + "\n")
    print(f"\n{len(lines)} site(s) tested")


if __name__ == "__main__":
    main()
