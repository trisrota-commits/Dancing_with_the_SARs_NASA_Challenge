#!/usr/bin/env python3
"""Where the ground did something it had not done before: a change
detector on NISAR's calibrated cells.

For every place measured by tools/measure.py with at least four passes,
this reads the cells of 500 m (<site>_grid.json) and says, pass by pass,
which cells stood out from what is ordinary at that place. It follows
the practice of operational radar change detection (NASA's OPERA
DIST-ALERT-S1 does the same for Sentinel-1, with a baseline of years
where NISAR so far has months):

  1. Relative level. From every pass the middle (median) of all cells is
     taken away, per channel. Rain, a season or a step in NASA's
     calibration moves the whole window alike and drops out; what is
     left is how each cell stands against the ground around it.
  2. Two keys, and a cell stands out only if both turn. Recent: the
     cell's step from the mean of the two latest passes before (at an
     event: before the event), set against the spread such steps had
     over the window. Long: the cell against its own usual value and
     spread over the whole baseline (up to ten passes), the spread
     pulled towards the window's usual one because the passes are few.
  3. A score from both channels. How many spreads the new pass lies from
     what was usual, in HH and in HV, combined (the root of the sum of
     squares). A flood lowers both, standing water under plants raises
     HH, a burn lowers HV: one channel alone misses some of them.
  4. A fixed false-alarm rate. The threshold is not assumed from theory:
     every baseline pass is scored against the other baseline passes
     (leave one out), and the threshold is the score that 1 cell in 100
     exceeded there. Radar engineers call this a constant false-alarm
     rate.
  5. Clusters only. A real change covers neighbouring cells; a single
     cell over the threshold is most often noise. A cell counts only if
     at least two of its eight neighbours are over the threshold too.
  6. Still changed? Where a later pass exists, the share of the flagged
     cells that are over the threshold again, against the same baseline.
     A flood that drains is gone; a burn or a clearing stays.
  7. What kind of change? Where both channels were recorded, the flagged
     cells are sorted by how HH and HV moved, and each kind is given the
     cause it is typical of (both fell: open water; HH rose alone: water
     standing under plants; HV fell alone: lost leaves and branches; both
     rose: wetter or rougher ground). Rules of thumb from the radar
     literature, shown as hypotheses, never as findings.

Why two keys: it was measured (15 November 2026, --sensitivity). The
long key alone works where the ground is otherwise quiet, but where a
place is changing by itself (rice growing, a reservoir filling) what it
read months ago is not what is ordinary now, and one flagged cell in
eight is right. The recent key alone does not know a cell's own habits.
Together they are right far more often than either. Tried and not kept:
a recent key that takes its spread from the pass judged (a change that
covers much of the window then hides itself: the flood in Italy fell
from 12 % to 0.2 %), recent keys of three to six passes, and switching
between the keys by a test of whether the place is drifting.

An event is judged whenever NISAR passed before and after it. With a
single pass before, there is no past to learn what is ordinary from: the
step between the two passes is set against its own spread over the
window, and the threshold is the one theory gives. This is the classic
two-date test; it is much rougher (about one flagged cell in four is
right), and the result says so. With two passes before, the recent key
stands alone (about three in four right on quiet ground).

How well it finds a change of a known size is measured, not asserted
(--sensitivity): a patch of cells in a real, quiet pass is raised or
lowered by a set amount and the detector is run on it, many times over
all places. From that come recall, precision and F1 by size of change,
next to the same figures for the simpler rule used before (a cell's
step against its neighbours' step). Those are test results with changes
put in by this script; they are written to data/detection/, never to
data/measured/, and no measurement is altered.

What it cannot tell: what caused a change. And NISAR's data began in
mid-2026: a baseline of a few passes knows nothing of the season, so a
crop growing or ground freezing stands out as well.

    pip install numpy
    python tools/detect.py                 # every site with a grid
    python tools/detect.py west-bengal
    python tools/detect.py --sensitivity   # the test with changes put in

Writes data/measured/<site>_detect.json, <site>_stood_<date>.png (the
flagged cells of each pass, for the globe) and data/measured/detect.json
(one line a site); with --sensitivity, data/detection/sensitivity.json.
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import forecast as F  # noqa: E402  (png, window_bounds, versions, day, PLAUSIBLE_DB)

warnings.filterwarnings("ignore", message="All-NaN slice encountered")  # cells without data stay without
warnings.filterwarnings("ignore", message="Mean of empty slice")
OUT_DIR = F.OUT_DIR
TEST_DIR = OUT_DIR.parent / "detection"
MIN_BASE = 3  # passes a place needs before it is judged, and the second key needs; an event is judged with fewer
MAX_BASE = 10  # and the most it takes: the latest ten
PRIOR = 4.0  # how many passes the window's usual spread counts for
FALSE_ALARM = 0.01  # share of cells the threshold lets through on a quiet pass
NEIGHBOURS = 2  # flagged neighbours a flagged cell needs
ENOUGH = 0.5  # share of cells a channel must have to be used in a pass
FLOOR_DB = 0.05  # no spread is taken to be smaller than this
MOVED = 2.0  # spreads a channel must move to count as risen or fallen, for the kind of change (noise alone does so 1 time in 20)
# The threshold theory gives for FALSE_ALARM when there is no past to take
# it from: the score of one channel is normal, of two the root of a
# chi-square with two degrees of freedom.
THEORY = {1: 2.576, 2: 3.035}


def relative(x: np.ndarray) -> np.ndarray:
    """Each pass minus the middle of its cells: x is [passes, cells] in dB."""
    with np.errstate(all="ignore"):
        return x - np.nanmedian(x, axis=1, keepdims=True)


def usual(base: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each cell's usual value and spread over the baseline passes
    ([passes, cells]). The spread is pulled towards the middle spread of
    all cells: with few passes a cell's own is too rough to divide by."""
    with np.errstate(all="ignore"):
        centre = np.nanmedian(base, axis=0)
        n = np.isfinite(base).sum(axis=0)
        own = np.nansum((base - centre) ** 2, axis=0) / np.maximum(n - 1, 1)
        pooled = np.nanmedian(own[n >= 2]) if (n >= 2).any() else np.nan
        var = (n * own + PRIOR * pooled) / (n + PRIOR)
    return centre, np.sqrt(np.maximum(var, FLOOR_DB**2))


def score(rels: list[np.ndarray], base: list[int], row: list[np.ndarray], by_area: bool | None = None) -> tuple[np.ndarray, np.ndarray, list[np.ndarray]]:
    """How far a pass lies from the baseline, in spreads, over the
    channels given: `rels` are the channels' relative levels, `base` the
    baseline passes, `row` the pass to judge (one array a channel).
    Returns the combined score, the signed score of the channel that
    moved most (its sign says rose or fell), and each channel's own.

    With one or two baseline passes a cell has no usable spread of its
    own: its step from the mean of those passes is then set against the
    spread that steps have over all cells: with two passes the step
    between those two, with one the step judged itself (robust, but a
    change that covers much of the window then hides itself). `by_area` says which of the two
    ways to use; left out, it follows the number of baseline passes."""
    if by_area is None:
        by_area = len(base) < MIN_BASE
    total = np.zeros(row[0].shape)
    lead = np.zeros(row[0].shape)
    each = []
    for rel, new in zip(rels, row):
        if by_area or len(base) < 2:
            # One or two passes before: a cell's own spread cannot be had
            # from so few (from two it is worse than none: far too small
            # as often as not). The area's spread is used instead.
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                step = new - np.nanmean(rel[base], axis=0)
                middle = np.nanmedian(step)
                if len(base) >= 2:
                    # From the steps between the baseline passes, not from
                    # the pass judged: a change that covers much of the
                    # window would otherwise widen its own yardstick and
                    # hide itself (seen at the flood in Italy).
                    between = np.diff(rel[base], axis=0)
                    between = between - np.nanmedian(between, axis=1, keepdims=True)
                    spread = 1.4826 * np.nanmedian(np.abs(between)) / np.sqrt(2) * np.sqrt(1 + 1 / len(base))
                else:
                    spread = 1.4826 * np.nanmedian(np.abs(step - middle))
            z = (step - middle) / max(float(spread) if np.isfinite(spread) else 0.0, FLOOR_DB)
        else:
            centre, spread = usual(rel[base])
            z = (new - centre) / spread
        each.append(z)
        total = total + z**2
        lead = np.where(np.abs(z) > np.abs(lead), z, lead)
    return np.sqrt(total), lead, each


def clustered(flag: np.ndarray, n: int) -> np.ndarray:
    """The flagged cells with at least NEIGHBOURS flagged cells among
    their eight neighbours; `flag` is a flat n by n grid."""
    g = flag.reshape(n, n).astype(int)
    p = np.pad(g, 1)
    around = sum(p[1 + dy : 1 + dy + n, 1 + dx : 1 + dx + n] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) - g
    return ((g == 1) & (around >= NEIGHBOURS)).ravel()


def channels(hh: np.ndarray, hv: np.ndarray | None, base: list[int], t: int) -> tuple[list[np.ndarray], list[int]]:
    """The channels to use for pass t, and the baseline passes that have
    all of them. HV is used where the pass and enough of the baseline
    have it; some passes are recorded in one channel only."""
    have = lambda x, i: np.isfinite(x[i]).mean() >= ENOUGH  # noqa: E731
    if hv is not None and have(hv, t):
        both = [b for b in base if have(hv, b)]
        if len(both) >= min(MIN_BASE, len(base)):
            return [hh, hv], both
    return [hh], base


def quiet(rels: list[np.ndarray], base: list[int], n: int) -> tuple[float, float, float]:
    """The threshold for this baseline, and what the rules flag on the
    baseline passes themselves: each one is judged against the others.
    Returns (threshold, share over it, share over it and in a cluster)."""
    if len(base) < 2:
        return THEORY[len(rels)], np.nan, np.nan
    # (Scored the way the pass itself will be: by the cell's own spread
    # with a full baseline, by the area's with a short one.)
    by_area = len(base) < MIN_BASE
    scores = [score(rels, [x for x in base if x != b], [rel[b] for rel in rels], by_area)[0] for b in base]
    pooled = np.concatenate(scores)
    pooled = pooled[np.isfinite(pooled)]
    if not len(pooled):
        return np.nan, np.nan, np.nan
    threshold = float(np.quantile(pooled, 1 - FALSE_ALARM))
    raw = [float((s > threshold)[np.isfinite(s)].mean()) for s in scores]
    kept = [float(clustered(np.nan_to_num(s, nan=0.0) > threshold, n)[np.isfinite(s)].mean()) for s in scores]
    return threshold, float(np.mean(raw)), float(np.mean(kept))


KINDS = {
    "bothFell": "both channels fell: typical of open water, or of ground made smooth",
    "bothRose": "both channels rose: typical of wetter or rougher ground",
    "hhRose": "HH rose alone: typical of water standing under plants",
    "hhFell": "HH fell alone: typical of a smoother or drier surface",
    "hvRose": "HV rose alone: typical of growing plants (more leaves and branches)",
    "hvFell": "HV fell alone: typical of lost leaves and branches (a burn, a harvest, a clearing)",
    "other": "the channels moved against each other",
}


def kinds(kept: np.ndarray, each: list[np.ndarray]) -> dict | None:
    """The flagged cells by how the two channels moved, as shares of the
    flagged cells. A channel counts as moved from MOVED spreads on. None
    with one channel, or with nothing flagged."""
    if len(each) < 2 or not kept.any():
        return None
    hh, hv = each[0][kept], each[1][kept]
    up_h, down_h, up_v, down_v = hh > MOVED, hh < -MOVED, hv > MOVED, hv < -MOVED
    still_h, still_v = ~(up_h | down_h), ~(up_v | down_v)
    sorted_ = {
        "bothFell": down_h & down_v,
        "bothRose": up_h & up_v,
        "hhRose": up_h & still_v,
        "hhFell": down_h & still_v,
        "hvRose": up_v & still_h,
        "hvFell": down_v & still_h,
    }
    sorted_["other"] = ~np.any(list(sorted_.values()), axis=0)
    return {k: round(float(v.mean()), 3) for k, v in sorted_.items()}


RECENT = 2  # passes of the first key: the latest two before the pass (or before the event)


def one_key(hh: np.ndarray, hv: np.ndarray | None, base: list[int], t: int, n: int, row: tuple | None = None) -> dict | None:
    """Pass t against one baseline: which cells are over the threshold and
    in a cluster. With fewer than MIN_BASE passes the area's spread is
    used, with more the cell's own (see score)."""
    use, base = channels(hh, hv, base, t)
    if not base:
        return None
    rels = [relative(x) for x in use]
    threshold, quiet_raw, quiet_kept = quiet(rels, base, n)
    if not np.isfinite(threshold):
        return None
    if row is None:
        new = [rel[t] for rel in rels]
    else:
        new = [relative(x[None, :])[0] for x in row[: len(use)]]
    total, lead, each = score(rels, base, new)
    valid = np.isfinite(total)
    over = np.nan_to_num(total, nan=0.0) > threshold
    return {"valid": valid, "over": over, "kept": clustered(over, n), "lead": lead, "each": each, "threshold": threshold, "quiet": quiet_kept, "channels": len(use), "baseline": len(base)}


def judge(hh: np.ndarray, hv: np.ndarray | None, base: list[int], t: int, n: int, row: tuple | None = None, need: int = MIN_BASE) -> dict | None:
    """Pass t against the passes before it: which cells stood out. `row`
    replaces the pass's own values (the sensitivity test puts a change
    in that way); it is given as (hh, hv) in dB. `need` is the fewest
    earlier passes accepted: three, or one for a pass after an event.

    Two keys, and a cell stands out only if both turn:
      recent   the latest RECENT passes: has the cell left what the place
               read just now?
      long     the whole baseline, cell by cell with its own spread: has
               it left what is usual for this cell?
    Measured with changes put in (15 November 2026): on quiet ground 95
    in 100 cells flagged by both are right, against 80 for the long key
    alone and 73 for the recent one; where a place is changing by itself
    it is 29 against 12 and 20. With nothing put in, both keys together
    flag 0.9 % of all cells, the long key alone 2.4 %.

    With fewer than MIN_BASE passes before (only possible after an
    event) there is no long key: the result is the recent key alone
    (grade "two"), or with a single pass the two-date test (grade
    "pair"), and says so."""
    if len(base) < need:
        return None
    r = one_key(hh, hv, base[-RECENT:], t, n, row)
    if not r:
        return None
    r["recent"] = r["kept"]
    r["grade"] = "pair" if r["baseline"] == 1 else "two"
    r["history"] = 0
    if len(base) >= MIN_BASE:
        long = one_key(hh, hv, base, t, n, row)
        if long:
            r["long"] = long["kept"]
            r["kept"] = r["recent"] & long["kept"]
            r["history"] = long["baseline"]
            r["grade"] = "both"
    return r


EDGE = 2  # pixels of a cell's outline in the picture
INSIDE = 105  # how solid a cell is inside its outline, of 255: the map shows through


def stood_rgba(kept: np.ndarray, lead: np.ndarray, n: int) -> np.ndarray:
    """The cells that stood out as a picture, north at the top: orange
    where the echo rose against what was usual, blue where it fell (by
    the channel that moved most). A cell is drawn as an outline with a
    light fill, so that the map under it can still be read; everything
    else is see-through."""
    px = F.STOOD_PIXELS
    out = np.zeros((n * px, n * px, 4), dtype=np.uint8)
    k, z = kept.reshape(n, n), lead.reshape(n, n)
    # Within one cell: solid along its edge, light inside.
    inside = np.tile(np.pad(np.ones((px - 2 * EDGE, px - 2 * EDGE), dtype=bool), EDGE), (n, n))
    alpha = np.where(inside, INSIDE, 245).astype(np.uint8)
    for mask, colour in ((k & (z > 0), F.STRONGER), (k & (z < 0), F.WEAKER)):
        big = mask.repeat(px, axis=0).repeat(px, axis=1)
        out[big, :3] = colour
        out[big, 3] = alpha[big]
    return out


def read(grid: dict) -> tuple[np.ndarray, np.ndarray | None]:
    """The cells in dB, [passes, cells]; a cell that ever read a value no
    radar could measure is left out whole (see tools/measure.py)."""
    hh = np.array(grid["hh"], dtype=float)
    hv = None
    if grid.get("hv"):
        hv = np.array([row if row is not None else [np.nan] * hh.shape[1] for row in grid["hv"]], dtype=float)
    lo, hi = F.PLAUSIBLE_DB
    with np.errstate(invalid="ignore"):
        faulty = ((hh < lo) | (hh > hi)).any(axis=0)
        if hv is not None:
            faulty |= ((hv < lo) | (hv > hi)).any(axis=0)
    hh[:, faulty] = np.nan
    if hv is not None:
        hv[:, faulty] = np.nan
    return hh, hv


def pct(v: float | None) -> str:
    return "–" if v is None else (f"{v * 100:.1f} %" if v < 0.095 else f"{v * 100:.0f} %")


def share(v) -> float | None:
    return None if v is None or not np.isfinite(v) else round(float(v), 4)


ROUGH = {
    "two": "Only two passes lie before the event, so the second key, the cell's own longer history, is missing. In our test about three in four cells flagged this way on quiet ground are right.",
    "pair": "Only one pass lies before the event: there is no past to learn what is ordinary from. The step between the two passes is set against its own spread over the area, and the threshold is the one theory gives. In our test about one cell in four flagged this way is right.",
}


def detect(grid: dict, event: int | None = None) -> dict | None:
    """Every pass that has a baseline, judged. At an event the baseline
    is the passes before it, for every pass after it, however few they
    are; elsewhere it is the passes before the pass judged (the latest
    MAX_BASE, at least MIN_BASE)."""
    times, n = grid["times"], grid.get("n")
    hh, hv = read(grid)
    if not n or n * n != hh.shape[1]:
        return None
    made = F.versions(grid.get("files"), len(times))
    before = [i for i, t in enumerate(times) if event is None or t < event]
    rows, results = [], {}
    for t in range(len(times)):
        base = [i for i in before if i < t][-MAX_BASE:]
        after_event = event is not None and times[t] >= event
        r = judge(hh, hv, base, t, n, need=1 if after_event else MIN_BASE)
        if not r:
            continue
        results[t] = (r, base)
        valid = r["valid"]
        if not valid.any():
            continue
        row = {
            "time": times[t],
            "date": F.day(times[t]),
            "baseline": r["baseline"],
            "history": r["history"],
            "grade": r["grade"],
            "channels": r["channels"],
            "threshold": round(r["threshold"], 2),
            "over": share(r["over"][valid].mean()),
            "stood": share(r["kept"][valid].mean()),
            "recent": share(r["recent"][valid].mean()),
            "long": share(r["long"][valid].mean()) if "long" in r else None,
            "rose": share((r["kept"] & (r["lead"] > 0))[valid].mean()),
            "fell": share((r["kept"] & (r["lead"] < 0))[valid].mean()),
        }
        how = kinds(r["kept"], r["each"])
        if how:
            row["kinds"] = how
        if event is not None:
            row["afterEvent"] = after_event
        if made[t] and made[t - 1] and made[t] != made[t - 1]:
            row["newVersion"] = {"from": made[t - 1], "to": made[t]}
        # Still changed a pass later, against the same baseline?
        if t + 1 < len(times) and r["kept"].any():
            later = judge(hh, hv, base, t + 1, n, need=1)
            if later:
                both = r["kept"] & later["valid"]
                if both.any():
                    row["stillNext"] = round(float(later["kept"][both].mean()), 3)
        if r["kept"].any():
            row["image"] = f"{grid['id']}_stood_{row['date']}.png"
            row["_rgba"] = stood_rgba(r["kept"], r["lead"], n)
        rows.append(row)
    if not rows:
        return None
    after = next((r for r in rows if r.get("afterEvent")), None)
    most = max(rows, key=lambda r: r["stood"])
    shown = after if event is not None else most
    picture = None
    if shown:
        base = results[times.index(shown["time"])][1]
        picture = {"date": shown["date"], "time": shown["time"], "baselineFrom": F.day(times[base[0]]), "baselineTo": F.day(times[base[-1]]), "n": n}
    cells = int(np.isfinite(hh).all(axis=0).sum())

    def told(r: dict) -> str:
        if r["grade"] == "both":
            return f"{pct(r['stood'])} of the cells stood out: they had left both what the place read on its two latest passes and their own usual reading over {r['history']} passes."
        against = "the pass before" if r["baseline"] == 1 else f"the {r['baseline']} passes before"
        return f"{pct(r['stood'])} of the cells stood out against {against}."

    if after:
        summary = (
            f"On NISAR's first pass after the event of {F.day(event)} ({after['date']}), {told(after)}"
            + (f" {ROUGH[after['grade']]}" if after["grade"] in ROUGH else "")
            + (f" A pass later, {pct(after['stillNext'])} of the flagged cells were still changed." if "stillNext" in after else "")
        )
    elif event is not None:
        summary = f"No pass after the event of {F.day(event)} can be judged yet."
    else:
        summary = f"The pass that stood out most was that of {most['date']}: {told(most)}"
    return {
        "id": grid["id"],
        "name": grid["name"],
        "track": grid["track"],
        "cellM": grid["cellM"],
        "cells": cells,
        "passes": len(times),
        "from": F.day(times[0]),
        "to": F.day(times[-1]),
        "falseAlarm": FALSE_ALARM,
        "event": None
        if event is None
        else {"time": event, "date": F.day(event), "firstPassAfter": after and after["date"], "stood": after and after["stood"], "recent": after and after["recent"], "long": after and after["long"], "stillNext": (after or {}).get("stillNext"), "newVersion": (after or {}).get("newVersion"), "baseline": after and after["baseline"], "grade": after and after["grade"]},
        "most": {"date": most["date"], "time": most["time"], "stood": most["stood"], "recent": most["recent"], "long": most["long"]},
        "picture": picture,
        "kindsOfChange": KINDS,
        "rough": ROUGH,
        "byDate": rows,
        "summary": summary,
        "method": (
            f"NISAR L2 GCOV backscatter in cells of {grid['cellM']:.0f} m. From each pass the middle of all cells is taken away, so that what moved the whole area alike drops out. "
            f"A cell stands out if two keys both turn. Recent: its step from the mean of the {RECENT} latest passes before (at an event: before the event) is beyond the spread such steps had over the area. "
            f"Long: it lies beyond its own usual value and spread over the whole baseline (at most {MAX_BASE} passes). Both in HH and, where recorded, HV. "
            f"Each threshold is the score that {FALSE_ALARM:.0%} of the cells exceeded when the baseline passes were judged against each other, and a cell counts only if at least {NEIGHBOURS} of its eight neighbours are over it too."
        ),
        "limits": "It says that the ground changed and where, not why. A baseline of a few passes knows nothing of the season: a crop growing or ground freezing stands out as well. Over open water the echo follows the wind from pass to pass. Cells next to each other share speckle and weather, so a cluster is weaker evidence than its size suggests.",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# ---- how well a change of a known size is found ----

CHANGES_DB = (-6.0, -3.0, -2.0, -1.0, 1.0, 2.0, 3.0)
PATCHES = (3, 5)  # cells across: 1.5 km and 2.5 km
TRIALS = 12  # places a patch is put, per pass and size


def old_rule(hh: np.ndarray, t: int) -> np.ndarray | None:
    """The rule used before this detector: a cell stands out if its step
    since the last pass differs from the middle step of all cells by more
    than nine cells in ten did on the steps before. HH only, no baseline
    per cell, no clusters. Returns the threshold in dB, or None."""
    steps = [np.abs((hh[i] - hh[i - 1]) - np.nanmedian(hh[i] - hh[i - 1])) for i in range(1, t)]
    steps = [s[np.isfinite(s)] for s in steps]
    if len(steps) < 2:
        return None
    return float(np.quantile(np.concatenate(steps), 0.9))


WHO = ("new", "recent", "long", "pair", "old")


def sensitivity(grids: list[tuple[dict, int | None]], seed: int = 2026) -> dict:
    """Puts a change of a known size into a patch of a real pass and
    counts what the detector, and the rule used before, make of it. Only
    passes before any reported event are used, so that what is flagged
    outside the patch is a false alarm as far as anyone knows.

    Counted side by side: the detector, both keys (new); each key alone
    (recent, long); the test with a single pass before (pair); and the
    rule used before (old).

    The places fall into two groups by one rule: "quiet" where the long
    baseline, with nothing put in, flags no more than the false-alarm
    rate, and "changing" where it flags more (a crop growing, a reservoir
    filling, a glacier moving: the place itself is changing, pass after
    pass). The figures are given for each group and for all."""
    rng = np.random.default_rng(seed)
    keys = [(db, size, who) for db in CHANGES_DB for size in PATCHES for who in WHO]
    sites = []

    def flags(hh, hv, base, t, n, row=None) -> dict:
        r = judge(hh, hv, base, t, n, row)
        one = judge(hh, hv, base[-1:], t, n, row, need=1)
        return {"new": r["kept"], "recent": r["recent"], "long": r["long"], "pair": one["kept"], "valid": r["valid"]}

    for grid, event in grids:
        times, n = grid["times"], grid.get("n")
        hh, hv = read(grid)
        if not n or n * n != hh.shape[1]:
            continue
        tally = {k: np.zeros(3) for k in keys}  # found in the patch, flagged outside it, put in
        still = {who: [] for who in WHO}
        for t in range(MIN_BASE, len(times)):
            if event is not None and times[t] >= event:
                break
            base = list(range(max(0, t - MAX_BASE), t))
            limit = old_rule(hh, t)
            probe = judge(hh, hv, base, t, n)
            if limit is None or not probe or "long" not in probe or not probe["valid"].any():
                continue
            plain = flags(hh, hv, base, t, n)
            valid = plain["valid"]
            for who in WHO[:-1]:
                still[who].append(float(plain[who][valid].mean()))
            step = hh[t] - hh[t - 1]
            still["old"].append(float((np.abs(step - np.nanmedian(step)) > limit)[np.isfinite(step)].mean()))
            for size in PATCHES:
                for _ in range(TRIALS):
                    y, x = rng.integers(0, n - size + 1, 2)
                    patch = np.zeros((n, n), dtype=bool)
                    patch[y : y + size, x : x + size] = True
                    patch = patch.ravel() & valid
                    if patch.sum() < size * size:
                        continue
                    for db in CHANGES_DB:
                        row_hh = hh[t] + db * patch
                        row_hv = None if hv is None else hv[t] + db * patch
                        got = flags(hh, hv, base, t, n, (row_hh, row_hv))
                        step = row_hh - hh[t - 1]
                        with np.errstate(invalid="ignore"):
                            got["old"] = np.abs(step - np.nanmedian(step)) > limit
                        for who in WHO:
                            tally[(db, size, who)] += (int((got[who] & patch).sum()), int((got[who] & ~patch & valid).sum()), int(patch.sum()))
        if still["new"]:
            rates = {who: float(np.mean(still[who])) for who in WHO}
            sites.append({"id": grid["id"], "name": grid["name"], "passes": len(still["new"]), **rates, "group": "quiet" if rates["long"] <= FALSE_ALARM else "changing", "tally": tally})

    def figures(v: np.ndarray) -> dict:
        tp, fp, injected = v
        recall = tp / injected if injected else None
        precision = tp / (tp + fp) if tp + fp else None
        f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
        r = lambda x: None if x is None else round(float(x), 3)  # noqa: E731
        return {"recall": r(recall), "precision": r(precision), "f1": r(f1)}

    def group(members: list[dict]) -> dict:
        total = {k: sum((m["tally"][k] for m in members), np.zeros(3)) for k in keys}
        weight = sum(m["passes"] for m in members) or 1
        return {
            "places": [m["name"] for m in members],
            "passes": sum(m["passes"] for m in members),
            "flaggedWithNothingPutIn": {who: round(sum(m[who] * m["passes"] for m in members) / weight, 4) for who in WHO},
            "rows": [{"db": db, "cells": size, "km": size * grids[0][0]["cellM"] / 1000, **{who: figures(total[(db, size, who)]) for who in WHO}} for size in PATCHES for db in CHANGES_DB],
        }

    return {
        "what": "A test with changes put in by tools/detect.py, not a measurement: a square patch of cells in a real NISAR pass is raised or lowered by a set amount in both channels, and the detector is run on it.",
        "trialsEach": TRIALS,
        "falseAlarm": FALSE_ALARM,
        "groups": {
            "quiet": {"what": f"Places where the long baseline, with nothing put in, flags no more than the false-alarm rate ({FALSE_ALARM:.0%}) of the cells", **group([m for m in sites if m["group"] == "quiet"])},
            "changing": {"what": "Places that are themselves changing from pass to pass (the long baseline flags more than that with nothing put in)", **group([m for m in sites if m["group"] == "changing"])},
            "all": {"what": "All places", **group(sites)},
        },
        "sites": [{k: (round(m[k], 4) if isinstance(m[k], float) else m[k]) for k in ("id", "name", "passes", *WHO, "group")} for m in sites],
        "names": {
            "new": "This detector: both keys",
            "recent": "The recent key alone (the two latest passes): what an event with two passes before it gets",
            "long": "The long key alone (each cell's own history)",
            "pair": "With a single pass before (the two-date test)",
            "old": "The rule used before (step against the neighbours' step, HH)",
        },
        "limits": "Only passes before any reported event are used. What is flagged outside the patch counts as a false alarm, though some of it may be real change nobody reported, so precision is a lower bound. Precision also depends on how much of the window the patch fills (a patch of 5 by 5 cells is 0.7 to 4 % of it). A real change is not a square and not the same in both channels. The two groups are told apart by the long baseline's own behaviour on the same passes, after the fact.",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def event_of(site_id: str) -> int | None:
    try:
        return json.loads((OUT_DIR / f"{site_id}.json").read_text()).get("event")
    except (OSError, ValueError):
        return None


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    grids = [json.loads(p.read_text()) for p in sorted(OUT_DIR.glob("*_grid.json"))]
    if "--sensitivity" in sys.argv:
        result = sensitivity([(g, event_of(g["id"])) for g in grids])
        TEST_DIR.mkdir(parents=True, exist_ok=True)
        (TEST_DIR / "sensitivity.json").write_text(json.dumps(result, indent=1) + "\n")
        for key, g in result["groups"].items():
            print(f"\n{key}: {len(g['places'])} places, {g['passes']} passes; flagged with nothing put in: " + ", ".join(f"{who} {v:.2%}" for who, v in g["flaggedWithNothingPutIn"].items()))
            for r in g["rows"]:
                print(f"  {r['db']:+.0f} dB, {r['cells']}x{r['cells']} cells: " + " | ".join(f"{who} R {r[who]['recall']} P {r[who]['precision']} F1 {r[who]['f1']}" for who in WHO))
        return
    lines = []
    for grid in grids:
        if args and grid["id"] not in args:
            continue
        event = event_of(grid["id"])
        result = detect(grid, event)
        files = [OUT_DIR / f"{grid['id']}_detect.json"]
        # The pictures are made anew: none of an earlier run may stay behind.
        for old in OUT_DIR.glob(f"{grid['id']}_stood*.png"):
            old.unlink()
        if not result:
            print(f"{grid['id']}: no pass can be judged ({len(grid['times'])} passes; a place needs {MIN_BASE + 1}, an event one before it and one after)")
            if files[0].exists():
                files[0].unlink()
            continue
        site = json.loads((OUT_DIR / f"{grid['id']}.json").read_text())
        result["bounds"] = F.window_bounds(site["lat"], site["lon"], grid["radiusM"])
        for row in result["byDate"]:
            if "_rgba" in row:
                (OUT_DIR / row["image"]).write_bytes(F.png(row.pop("_rgba")))
        files[0].write_text(json.dumps(result, indent=1) + "\n")
        print(f"{result['name']}: {result['summary']}")
        lines.append({k: result[k] for k in ("id", "name", "cells", "passes", "event", "most")})
    if not args:
        (OUT_DIR / "detect.json").write_text(json.dumps(lines, indent=1) + "\n")
    print(f"\n{len(lines)} site(s) judged")


if __name__ == "__main__":
    main()
