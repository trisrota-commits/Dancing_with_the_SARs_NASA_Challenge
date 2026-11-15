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
  2. A baseline per cell. From the passes before (at an event: the
     passes before the event), each cell gets its usual value (the
     median) and its usual spread. With three to ten passes a cell's own
     spread is rough, so it is pulled towards the spread that is usual
     for all cells of the window (shrinkage).
  3. A score from both channels. How many spreads the new pass lies from
     the cell's usual value, in HH and in HV, combined (the root of the
     sum of squares). A flood lowers both, standing water under plants
     raises HH, a burn lowers HV: one channel alone misses some of them.
  4. A fixed false-alarm rate. The threshold is not assumed from theory:
     every baseline pass is scored against the other baseline passes
     (leave one out), and the threshold is the score that 1 cell in 100
     exceeded there. Radar engineers call this a constant false-alarm
     rate.
  5. Clusters only. A real change covers neighbouring cells; a single
     cell over the threshold is most often noise. A cell counts only if
     at least two of its eight neighbours are over the threshold too.
  6. What is ordinary here. The same rules are run on the baseline
     passes themselves (leave one out): the share of cells they flag is
     this place's own quiet level, and stands next to every result.
  7. Still changed? Where a later pass exists, the share of the flagged
     cells that are over the threshold again, against the same baseline.
     A flood that drains is gone; a burn or a clearing stays.

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

Writes data/measured/<site>_detect.json, <site>_stood.png (the flagged
cells of one pass, for the globe) and data/measured/detect.json (one
line a site); with --sensitivity, data/detection/sensitivity.json.
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
MIN_BASE = 3  # passes a baseline needs
MAX_BASE = 10  # and the most it takes: the latest ten
PRIOR = 4.0  # how many passes the window's usual spread counts for
FALSE_ALARM = 0.01  # share of cells the threshold lets through on a quiet pass
NEIGHBOURS = 2  # flagged neighbours a flagged cell needs
ENOUGH = 0.5  # share of cells a channel must have to be used in a pass
FLOOR_DB = 0.05  # no spread is taken to be smaller than this


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


def score(rels: list[np.ndarray], base: list[int], row: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """How far a pass lies from the baseline, in spreads, over the
    channels given: `rels` are the channels' relative levels, `base` the
    baseline passes, `row` the pass to judge (one array a channel).
    Returns the combined score and the signed score of the channel that
    moved most (its sign says rose or fell)."""
    total = np.zeros(row[0].shape)
    lead = np.zeros(row[0].shape)
    for rel, new in zip(rels, row):
        centre, spread = usual(rel[base])
        z = (new - centre) / spread
        total = total + z**2
        lead = np.where(np.abs(z) > np.abs(lead), z, lead)
    return np.sqrt(total), lead


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
        if len(both) >= MIN_BASE:
            return [hh, hv], both
    return [hh], base


def quiet(rels: list[np.ndarray], base: list[int], n: int) -> tuple[float, float, float]:
    """The threshold for this baseline, and what the rules flag on the
    baseline passes themselves: each one is judged against the others.
    Returns (threshold, share over it, share over it and in a cluster)."""
    scores = [score(rels, [x for x in base if x != b], [rel[b] for rel in rels])[0] for b in base]
    pooled = np.concatenate(scores)
    pooled = pooled[np.isfinite(pooled)]
    if not len(pooled):
        return np.nan, np.nan, np.nan
    threshold = float(np.quantile(pooled, 1 - FALSE_ALARM))
    raw = [float((s > threshold)[np.isfinite(s)].mean()) for s in scores]
    kept = [float(clustered(np.nan_to_num(s, nan=0.0) > threshold, n)[np.isfinite(s)].mean()) for s in scores]
    return threshold, float(np.mean(raw)), float(np.mean(kept))


def judge(hh: np.ndarray, hv: np.ndarray | None, base: list[int], t: int, n: int, row: tuple | None = None) -> dict | None:
    """Pass t against the baseline passes: which cells stood out. `row`
    replaces the pass's own values (the sensitivity test puts a change
    in that way); it is given as (hh, hv) in dB."""
    if len(base) < MIN_BASE:
        return None
    use, base = channels(hh, hv, base, t)
    rels = [relative(x) for x in use]
    threshold, quiet_raw, quiet_kept = quiet(rels, base, n)
    if not np.isfinite(threshold):
        return None
    if row is None:
        new = [rel[t] for rel in rels]
    else:
        new = [relative(x[None, :])[0] for x in row[: len(use)]]
    total, lead = score(rels, base, new)
    valid = np.isfinite(total)
    over = np.nan_to_num(total, nan=0.0) > threshold
    kept = clustered(over, n)
    return {"valid": valid, "over": over, "kept": kept, "lead": lead, "threshold": threshold, "quietRaw": quiet_raw, "quiet": quiet_kept, "channels": len(use), "baseline": len(base)}


def stood_rgba(kept: np.ndarray, lead: np.ndarray, n: int) -> np.ndarray:
    """The flagged cells as a picture, north at the top: orange where the
    echo rose against the cell's usual value, blue where it fell (by the
    channel that moved most). Everything else is see-through."""
    out = np.zeros((n, n, 4), dtype=np.uint8)
    k, z = kept.reshape(n, n), lead.reshape(n, n)
    for mask, colour in ((k & (z > 0), F.STRONGER), (k & (z < 0), F.WEAKER)):
        out[mask, :3] = colour
        out[mask, 3] = 235
    return out.repeat(F.STOOD_PIXELS, axis=0).repeat(F.STOOD_PIXELS, axis=1)


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


def detect(grid: dict, event: int | None = None) -> dict | None:
    """Every pass that has a baseline, judged. At an event the baseline
    is the passes before it, for every pass after it; elsewhere it is the
    passes before the pass judged (the latest MAX_BASE)."""
    times, n = grid["times"], grid.get("n")
    hh, hv = read(grid)
    if not n or n * n != hh.shape[1]:
        return None
    made = F.versions(grid.get("files"), len(times))
    before = [i for i, t in enumerate(times) if event is None or t < event]
    rows, results = [], {}
    for t in range(len(times)):
        base = [i for i in before if i < t][-MAX_BASE:]
        r = judge(hh, hv, base, t, n)
        if not r:
            continue
        results[t] = (r, base)
        valid = r["valid"]
        row = {
            "time": times[t],
            "date": F.day(times[t]),
            "baseline": r["baseline"],
            "channels": r["channels"],
            "threshold": round(r["threshold"], 2),
            "over": round(float(r["over"][valid].mean()), 4),
            "stood": round(float(r["kept"][valid].mean()), 4),
            "quiet": round(r["quiet"], 4),
            "rose": round(float((r["kept"] & (r["lead"] > 0))[valid].mean()), 4),
            "fell": round(float((r["kept"] & (r["lead"] < 0))[valid].mean()), 4),
        }
        if event is not None:
            row["afterEvent"] = times[t] >= event
        if made[t] and made[t - 1] and made[t] != made[t - 1]:
            row["newVersion"] = {"from": made[t - 1], "to": made[t]}
        # Still changed a pass later, against the same baseline?
        if t + 1 < len(times) and r["kept"].any():
            later = judge(hh, hv, base, t + 1, n)
            if later:
                both = r["kept"] & later["valid"]
                if both.any():
                    row["stillNext"] = round(float(later["over"][both].mean()), 3)
        rows.append(row)
    if not rows:
        return None
    after = next((r for r in rows if r.get("afterEvent")), None)
    most = max(rows, key=lambda r: r["stood"])
    shown = after if event is not None else most
    picture = None
    if shown:
        t = times.index(shown["time"])
        r, base = results[t]
        picture = {"date": shown["date"], "time": shown["time"], "baselineFrom": F.day(times[base[0]]), "baselineTo": F.day(times[base[-1]]), "stood": shown["stood"], "quiet": shown["quiet"], "n": n, "image": f"{grid['id']}_stood.png", "_rgba": stood_rgba(r["kept"], r["lead"], n)}
    cells = int(np.isfinite(hh).all(axis=0).sum())
    if after:
        summary = (
            f"On NISAR's first pass after the event of {F.day(event)} ({after['date']}), {pct(after['stood'])} of the cells stood out from what they had read on the {after['baseline']} passes before it. "
            f"On those passes themselves the same rules flag {pct(after['quiet'])}."
            + (f" A pass later, {pct(after['stillNext'])} of the flagged cells were still changed." if "stillNext" in after else "")
        )
    elif event is not None:
        summary = f"No pass after the event of {F.day(event)} can be judged yet."
    else:
        summary = f"The pass that stood out most was that of {most['date']}: {pct(most['stood'])} of the cells differed from what they had read on the {most['baseline']} passes before it. On those passes themselves the same rules flag {pct(most['quiet'])}."
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
        "event": None if event is None else {"time": event, "date": F.day(event), "firstPassAfter": after and after["date"], "stood": after and after["stood"], "quiet": after and after["quiet"], "stillNext": (after or {}).get("stillNext"), "newVersion": (after or {}).get("newVersion"), "baseline": after and after["baseline"]},
        "most": {"date": most["date"], "time": most["time"], "stood": most["stood"], "quiet": most["quiet"]},
        "picture": picture,
        "byDate": rows,
        "summary": summary,
        "method": (
            f"NISAR L2 GCOV backscatter in cells of {grid['cellM']:.0f} m. From each pass the middle of all cells is taken away, so that what moved the whole area alike drops out. "
            f"Each cell is then set against its own usual value and spread over the passes before (at an event: before the event; at least {MIN_BASE}, at most {MAX_BASE}), in HH and, where recorded, HV. "
            f"The threshold is the score that {FALSE_ALARM:.0%} of the cells exceeded when each baseline pass was judged against the others. A cell counts only if at least {NEIGHBOURS} of its eight neighbours are over the threshold too."
        ),
        "limits": "It says that the ground changed and where, not why. A baseline of a few passes knows nothing of the season: a crop growing or ground freezing stands out as well. Cells next to each other share speckle and weather, so a cluster is weaker evidence than its size suggests.",
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


def sensitivity(grids: list[tuple[dict, int | None]], seed: int = 2026) -> dict:
    """Puts a change of a known size into a patch of a real pass and
    counts what the detector, and the rule used before, make of it. Only
    passes before any reported event are used, so that what is flagged
    outside the patch is a false alarm as far as anyone knows.

    The places fall into two groups by one rule: "quiet" where the
    detector, with nothing put in, flags no more than its own false-alarm
    rate, and "changing" where it flags more (a crop growing, a reservoir
    filling, a glacier moving: the place itself is changing, pass after
    pass). The figures are given for each group and for all."""
    rng = np.random.default_rng(seed)
    keys = [(db, size, who) for db in CHANGES_DB for size in PATCHES for who in ("new", "old")]
    sites = []
    for grid, event in grids:
        times, n = grid["times"], grid.get("n")
        hh, hv = read(grid)
        if not n or n * n != hh.shape[1]:
            continue
        tally = {k: np.zeros(3) for k in keys}  # found in the patch, flagged outside it, put in
        still = {"new": [], "old": []}
        for t in range(MIN_BASE, len(times)):
            if event is not None and times[t] >= event:
                break
            base = list(range(max(0, t - MAX_BASE), t))
            plain = judge(hh, hv, base, t, n)
            limit = old_rule(hh, t)
            if not plain or limit is None:
                continue
            valid = plain["valid"]
            if not valid.any():
                continue
            still["new"].append(float(plain["kept"][valid].mean()))
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
                        got = judge(hh, hv, base, t, n, (row_hh, row_hv))["kept"]
                        tally[(db, size, "new")] += (int((got & patch).sum()), int((got & ~patch & valid).sum()), int(patch.sum()))
                        step = row_hh - hh[t - 1]
                        with np.errstate(invalid="ignore"):
                            was = np.abs(step - np.nanmedian(step)) > limit
                        tally[(db, size, "old")] += (int((was & patch).sum()), int((was & ~patch & valid).sum()), int(patch.sum()))
        if still["new"]:
            flagged = float(np.mean(still["new"]))
            sites.append({"id": grid["id"], "name": grid["name"], "passes": len(still["new"]), "new": flagged, "old": float(np.mean(still["old"])), "group": "quiet" if flagged <= FALSE_ALARM else "changing", "tally": tally})

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
            "flaggedWithNothingPutIn": {who: round(sum(m[who] * m["passes"] for m in members) / weight, 4) for who in ("new", "old")},
            "rows": [{"db": db, "cells": size, "km": size * grids[0][0]["cellM"] / 1000, "new": figures(total[(db, size, "new")]), "old": figures(total[(db, size, "old")])} for size in PATCHES for db in CHANGES_DB],
        }

    return {
        "what": "A test with changes put in by tools/detect.py, not a measurement: a square patch of cells in a real NISAR pass is raised or lowered by a set amount in both channels, and the detector is run on it.",
        "trialsEach": TRIALS,
        "falseAlarm": FALSE_ALARM,
        "groups": {
            "quiet": {"what": f"Places where the detector, with nothing put in, flags no more than its false-alarm rate ({FALSE_ALARM:.0%}) of the cells", **group([m for m in sites if m["group"] == "quiet"])},
            "changing": {"what": "Places that are themselves changing from pass to pass (the detector flags more than that with nothing put in)", **group([m for m in sites if m["group"] == "changing"])},
            "all": {"what": "All places", **group(sites)},
        },
        "sites": [{k: (round(m[k], 4) if isinstance(m[k], float) else m[k]) for k in ("id", "name", "passes", "new", "old", "group")} for m in sites],
        "names": {"new": "This detector (baseline per cell, both channels, clusters)", "old": "The rule used before (step against the neighbours' step, HH)"},
        "limits": "Only passes before any reported event are used. What is flagged outside the patch counts as a false alarm, though some of it may be real change nobody reported, so precision is a lower bound. Precision also depends on how much of the window the patch fills (a patch of 5 by 5 cells is 0.7 to 4 % of it). A real change is not a square and not the same in both channels. The two groups are told apart by the detector's own behaviour on the same passes, after the fact.",
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
            print(f"\n{key}: {len(g['places'])} places, {g['passes']} passes; flagged with nothing put in: new {g['flaggedWithNothingPutIn']['new']:.2%}, old {g['flaggedWithNothingPutIn']['old']:.2%}")
            for r in g["rows"]:
                print(f"  {r['db']:+.0f} dB, {r['cells']}x{r['cells']} cells: new recall {r['new']['recall']} precision {r['new']['precision']} F1 {r['new']['f1']} | old recall {r['old']['recall']} precision {r['old']['precision']} F1 {r['old']['f1']}")
        return
    lines = []
    for grid in grids:
        if args and grid["id"] not in args:
            continue
        event = event_of(grid["id"])
        result = detect(grid, event)
        files = [OUT_DIR / f"{grid['id']}_detect.json", OUT_DIR / f"{grid['id']}_stood.png"]
        if not result:
            print(f"{grid['id']}: too few passes for a baseline ({len(grid['times'])}; {MIN_BASE + 1} are needed, {MIN_BASE} of them before the event)")
            for f in files:
                if f.exists():
                    f.unlink()
            continue
        if result["picture"]:
            site = json.loads((OUT_DIR / f"{grid['id']}.json").read_text())
            files[1].write_bytes(F.png(result["picture"].pop("_rgba")))
            result["picture"]["bounds"] = F.window_bounds(site["lat"], site["lon"], grid["radiusM"])
        elif files[1].exists():
            files[1].unlink()
        files[0].write_text(json.dumps(result, indent=1) + "\n")
        print(f"{result['name']}: {result['summary']}")
        lines.append({k: result[k] for k in ("id", "name", "cells", "passes", "event", "most")})
    if not args:
        (OUT_DIR / "detect.json").write_text(json.dumps(lines, indent=1) + "\n")
    print(f"\n{len(lines)} site(s) judged")


if __name__ == "__main__":
    main()
