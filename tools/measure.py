#!/usr/bin/env python3
"""Measure calibrated NISAR backscatter at chosen places.

For each site in tools/measure_sites.json this script:

1. finds every NISAR GCOV pass over the site (NASA Earthdata search);
2. keeps the repeat track and frame with the most passes, so every pass
   sees the ground from the same angle;
3. reads only a small window around the site from each file (a few MB,
   not the whole 1-5 GB file);
4. computes the mean HH and HV backscatter in dB inside a small circle,
   pass by pass: a calibrated time series;
5. maps the change in dB between a "before" and an "after" pass;
6. writes data/measured/<site>.json, data/measured/<site>_change.png
   and data/measured/index.json, which the app reads.

Values are GCOV terrain-corrected gamma-naught backscatter, read from the
full-resolution product, not from the preview images.

Usage:
    pip install earthaccess h5py numpy pyproj pillow
    python tools/measure.py                  # every site in the list
    python tools/measure.py aletsch okavango # only these sites
    python tools/measure.py --list aletsch   # show the tracks found (no login)
    python tools/measure.py --local DIR site # use .h5 files already in DIR

    # Any event or place, without editing the list. --event puts the change
    # map across that date: last pass before it against first pass after.
    python tools/measure.py --point 21.9 78.2 --name "Forest fires in India" --event 2026-11-05
    # ... --save also adds it to the list, so later runs keep it up to date.

Reading the data needs a free NASA Earthdata login
(https://urs.earthdata.nasa.gov/users/new). It is taken from, in this order:
EARTHDATA_TOKEN (a token made on that site under "Generate Token"),
EARTHDATA_USERNAME and EARTHDATA_PASSWORD, ~/.netrc, or a prompt on a
terminal. Searching (--list) needs no login.

A site that was measured before is brought up to date: passes already in
its file are kept, and only new ones are read.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import h5py
import numpy as np
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
SITES_FILE = ROOT / "tools" / "measure_sites.json"
OUT_DIR = ROOT / "data" / "measured"

GRID = "/science/LSAR/GCOV/grids/frequencyA"
# Validated first, then provisional, then urgent response (same passes,
# published earlier). Duplicates of one pass are reduced to the best one.
SHORT_NAMES = ["NISAR_L2_GCOV_V1", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_UR_L2"]
NISAR_START = "2026-06-17"

# Colours match the app's change view: blue = echo got weaker, orange = stronger.
WEAKER = np.array([64, 170, 255])
STRONGER = np.array([255, 170, 60])
MAP_SCALE_DB = 3.0  # full colour at a change of 3 dB or more
MAP_PIXELS = 360  # width and height of the change map


# ---------------------------------------------------------------- passes


def parse_name(name: str) -> dict | None:
    """Track, frame, direction and start time from a NISAR GCOV file name.

    Example: NISAR_L2_PR_GCOV_006_172_A_008_2005_DHDH_A_20251204T024618_...
    """
    parts = Path(name).name.split("_")
    if len(parts) < 9 or parts[3] != "GCOV":
        return None
    stamp = re.search(r"_(\d{8}T\d{6})_", name)
    if not stamp:
        return None
    time = datetime.strptime(stamp.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
    # The polarisation mode (e.g. DHDH = HH+HV, DVDV = VV+VH) is part of the
    # stack, so a time series never mixes modes.
    mode = parts[9] if len(parts) > 9 else "?"
    return {
        "name": Path(name).name,
        "track": parts[5],
        "direction": "Ascending" if parts[6] == "A" else "Descending",
        "frame": parts[7],
        "mode": mode,
        "stack": f"{parts[5]}-{parts[6]}-{parts[7]}-{mode}",
        "time": time,
    }


def choose_stack(passes: list[dict], wanted: str | None, around: datetime | None = None) -> list[dict]:
    """One repeat track and frame, oldest pass first, one file per pass.

    With `around` (an event's date), a track that has passes on both sides
    of it is preferred over one with more passes on one side only.
    """
    stacks: dict[str, dict[str, dict]] = {}
    for p in passes:
        # Keep one file per acquisition; the list is ordered best product first.
        key = p["time"].strftime("%Y%m%dT%H%M")
        stacks.setdefault(p["stack"], {}).setdefault(key, p)
    if not stacks:
        return []
    if wanted:
        chosen = stacks.get(wanted, {})
    else:

        def score(stack: dict[str, dict]) -> tuple[bool, int]:
            times = [p["time"] for p in stack.values()]
            return (bool(around) and min(times) < around <= max(times), len(stack))

        chosen = max(stacks.values(), key=score)
    return sorted(chosen.values(), key=lambda p: p["time"])


_auth = None


def login():
    """Logs in to NASA Earthdata once; only reading data needs it."""
    global _auth
    if _auth is None:
        import earthaccess  # only needed for remote runs

        given = os.environ.get("EARTHDATA_TOKEN") or (os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"))
        if not given and not (Path.home() / ".netrc").exists() and not sys.stdin.isatty():
            sys.exit("No Earthdata login found. Set EARTHDATA_TOKEN, or EARTHDATA_USERNAME and EARTHDATA_PASSWORD (see the top of this file).")
        _auth = earthaccess.login()
        if not getattr(_auth, "authenticated", False):
            sys.exit("The Earthdata login was not accepted. A token is valid for 60 days; make a new one if it has run out.")
    return _auth


def remote_passes(site: dict, start: str, end: str) -> list[dict]:
    import earthaccess  # only needed for remote runs

    # Searching the archive is open to everyone; only reading needs a login.
    found = []
    for short_name in SHORT_NAMES:
        try:
            granules = earthaccess.search_data(
                short_name=short_name,
                point=(site["lon"], site["lat"]),
                temporal=(start, end),
                count=500,
            )
        except Exception as err:  # a collection may not exist yet
            print(f"  search {short_name}: {err}", file=sys.stderr)
            continue
        for g in granules:
            links = [u for u in g.data_links() if u.endswith(".h5")]
            if not links:
                continue
            info = parse_name(links[0])
            if info:
                info["granule"] = g
                found.append(info)
    return found


def local_passes(folder: Path) -> list[dict]:
    found = []
    for path in sorted(folder.glob("*GCOV*.h5")):
        info = parse_name(path.name)
        if info:
            info["path"] = path
            found.append(info)
    return found


def open_pass(p: dict):
    if "path" in p:
        return h5py.File(p["path"], "r")
    import earthaccess

    login()
    handle = earthaccess.open([p["granule"]])[0]
    return h5py.File(handle, "r")


# ---------------------------------------------------------------- reading


def read_window(f, lat: float, lon: float, radius_m: float) -> dict | None:
    """HH and HV (linear power) in a square window around a point."""
    grid = f[GRID]
    epsg = int(np.asarray(grid["projection"].attrs["epsg_code"]).item())
    to_map = Transformer.from_crs(4326, epsg, always_xy=True)
    cx, cy = to_map.transform(lon, lat)
    xs = grid["xCoordinates"][:]
    ys = grid["yCoordinates"][:]

    def span(coords, lo, hi):
        ascending = coords[-1] > coords[0]
        order = coords if ascending else coords[::-1]
        i0 = int(np.searchsorted(order, lo, "left"))
        i1 = int(np.searchsorted(order, hi, "right"))
        if not ascending:
            i0, i1 = len(coords) - i1, len(coords) - i0
        return max(0, i0), min(len(coords), i1)

    x0, x1 = span(xs, cx - radius_m, cx + radius_m)
    y0, y1 = span(ys, cy - radius_m, cy + radius_m)
    if x1 - x0 < 3 or y1 - y0 < 3:
        return None
    # "co" is the same-polarisation channel (HH or VV), "cross" the other
    # one (HV or VH), whichever this pass recorded.
    bands, labels = {}, {}
    for role, keys in (("co", ("HHHH", "VVVV")), ("cross", ("HVHV", "VHVH"))):
        key = next((k for k in keys if k in grid), None)
        if key:
            band = grid[key][y0:y1, x0:x1].astype("float64")
            band[~np.isfinite(band) | (band <= 0)] = np.nan
            bands[role] = band
            labels[role] = key[:2]
    if "co" not in bands:
        return None
    return {"epsg": epsg, "x": xs[x0:x1], "y": ys[y0:y1], "cx": cx, "cy": cy, "labels": labels, **bands}


def to_db(linear):
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(linear)


def circle_mean_db(win: dict, pol: str, radius_m: float) -> tuple[float | None, int]:
    """Mean backscatter inside a circle, averaged in linear power, in dB."""
    band = win.get(pol)
    if band is None:
        return None, 0
    xx, yy = np.meshgrid(win["x"], win["y"])
    inside = (xx - win["cx"]) ** 2 + (yy - win["cy"]) ** 2 <= radius_m**2
    values = band[inside]
    good = values[np.isfinite(values)]
    # Need at least half the circle, or the pass only grazed the site.
    if inside.sum() == 0 or good.size < 0.5 * inside.sum():
        return None, int(good.size)
    return float(to_db(good.mean())), int(good.size)


def boxcar(a: np.ndarray, size: int = 5) -> np.ndarray:
    """Mean filter that ignores gaps, to calm radar speckle."""
    valid = np.isfinite(a)
    filled = np.where(valid, a, 0.0)
    pad = size // 2

    def window_sum(m):
        p = np.pad(m, pad, mode="constant")
        c = p.cumsum(0).cumsum(1)
        c = np.pad(c, ((1, 0), (1, 0)))
        return c[size:, size:] - c[:-size, size:] - c[size:, :-size] + c[:-size, :-size]

    total = window_sum(filled)
    count = window_sum(valid.astype(float))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = total / count
    out[count == 0] = np.nan
    return out


def lonlat_grid(lat: float, lon: float, radius_m: float, n: int):
    dlat = radius_m / 111_320
    dlon = radius_m / (111_320 * max(0.05, math.cos(math.radians(lat))))
    bounds = {"west": lon - dlon, "east": lon + dlon, "south": lat - dlat, "north": lat + dlat}
    lons = np.linspace(bounds["west"], bounds["east"], n)
    lats = np.linspace(bounds["north"], bounds["south"], n)
    return np.meshgrid(lons, lats), bounds


def resample(win: dict, band: np.ndarray, glon, glat) -> np.ndarray:
    """Nearest-neighbour resampling of a map-projected window onto lon/lat."""
    to_map = Transformer.from_crs(4326, win["epsg"], always_xy=True)
    gx, gy = to_map.transform(glon, glat)
    dx = win["x"][1] - win["x"][0]
    dy = win["y"][1] - win["y"][0]
    ix = np.rint((gx - win["x"][0]) / dx).astype(int)
    iy = np.rint((gy - win["y"][0]) / dy).astype(int)
    ok = (ix >= 0) & (ix < band.shape[1]) & (iy >= 0) & (iy < band.shape[0])
    out = np.full(glon.shape, np.nan)
    out[ok] = band[iy[ok], ix[ok]]
    return out


def change_png(delta_db: np.ndarray, path: Path) -> None:
    strength = np.clip(np.abs(delta_db) / MAP_SCALE_DB, 0, 1)
    strength[~np.isfinite(delta_db)] = 0
    rgb = np.where((delta_db < 0)[..., None], WEAKER, STRONGER).astype(float)
    alpha = np.where(np.abs(np.nan_to_num(delta_db)) < 1.5, 0, strength * 235)
    img = np.dstack([rgb, alpha]).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(path)


# ---------------------------------------------------------------- one site


def to_ms(date: str) -> float:
    return datetime.fromisoformat(date).replace(tzinfo=timezone.utc).timestamp() * 1000


def day(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def setup_of(site: dict) -> dict:
    """Everything a measurement depends on besides the passes themselves."""
    return {
        "lat": site["lat"],
        "lon": site["lon"],
        "seriesRadiusM": site.get("seriesRadiusM", 500),
        "mapRadiusM": site.get("mapRadiusM", 6000),
        "mapPol": site.get("mapPol", "co"),
    }


def measure(site: dict, passes: list[dict], previous: dict | None = None) -> dict | None:
    """Measures one site. `previous` is the site's earlier result, if any:
    passes it already holds are kept as they are and not read again."""
    series_r = site.get("seriesRadiusM", 500)
    map_r = site.get("mapRadiusM", 6000)
    event = to_ms(site["event"]) if site.get("event") else None
    around = datetime.fromtimestamp(event / 1000, timezone.utc) if event else None
    stack = choose_stack(passes, site.get("stack"), around)
    if len(stack) < 2:
        print(f"  only {len(stack)} usable pass(es); need at least 2")
        return None
    print(f"  track {stack[0]['stack']}: {len(stack)} passes, {stack[0]['time']:%Y-%m-%d} to {stack[-1]['time']:%Y-%m-%d}")

    # An earlier result counts only if it was made the same way on the same track.
    if previous and (previous.get("setup") != setup_of(site) or previous.get("track") != stack[0]["stack"]):
        previous = None
    known = {s["file"]: s for s in previous["series"]} if previous else {}
    by_time = {int(p["time"].timestamp() * 1000): p for p in stack}

    def read(p: dict) -> dict | None:
        try:
            with open_pass(p) as f:
                win = read_window(f, site["lat"], site["lon"], map_r)
        except Exception as err:
            print(f"    {p['name']}: could not read ({err})")
            return None
        if win is None:
            print(f"    {p['time']:%Y-%m-%d}: site outside the image")
        return win

    series, windows, reused = [], {}, 0
    for p in stack:
        when = int(p["time"].timestamp() * 1000)
        if p["name"] in known:
            series.append(known[p["name"]])
            reused += 1
            continue
        win = read(p)
        if win is None:
            continue
        hh, n = circle_mean_db(win, "co", series_r)
        hv, _ = circle_mean_db(win, "cross", series_r)
        if hh is None:
            print(f"    {p['time']:%Y-%m-%d}: too little valid data at the site")
            continue
        series.append({"time": when, "hh": round(hh, 2), "hv": None if hv is None else round(hv, 2), "pixels": n, "file": p["name"]})
        windows[when] = win
        co_l, cross_l = win["labels"]["co"], win["labels"].get("cross", "-")
        print(f"    {p['time']:%Y-%m-%d}: {co_l} {hh:6.2f} dB" + (f", {cross_l} {hv:6.2f} dB" if hv is not None else ""))
    if reused:
        print(f"    {reused} pass(es) kept from the earlier measurement, {len(windows)} new")

    if len(series) < 2:
        print("  fewer than two passes with data; nothing written")
        return None

    if windows:
        labels = next(iter(windows.values()))["labels"]
        co_l, cross_l = labels["co"], labels.get("cross", "")
    else:
        co_l, cross_l = (previous["pols"] + [""])[:2]
    first = series[0]
    # The two passes for the change map. For an event: the last pass before
    # it and the first after it. Otherwise the dates given in the site list,
    # else the first pass against the one that differs most from it in HH.
    # The method text says which rule was used.
    spans_event = False
    before, after = first, None
    earlier = [s for s in series if event and s["time"] < event]
    later = [s for s in series if event and s["time"] >= event]
    if earlier and later:
        before, after = earlier[-1], later[0]
        spans_event = True
        after_rule = f"the first pass after the event of {site['event']}, and 'before' the last pass before it"
    elif site.get("after"):
        target = to_ms(site["after"])
        after = min(series[1:], key=lambda s: abs(s["time"] - target))
        after_rule = f"the pass closest to {site['after']}"
    else:
        after = max(series[1:], key=lambda s: abs(s["hh"] - first["hh"]))
        after_rule = f"the pass that differs most from the first in {co_l}"
        if event:
            after_rule += f" (this track does not have a pass on both sides of the event of {site['event']} yet)"
    if not spans_event and site.get("before"):
        target = to_ms(site["before"])
        before = min([s for s in series if s["time"] < after["time"]] or [first], key=lambda s: abs(s["time"] - target))

    want_cross = site.get("mapPol", "co") in ("hv", "vh", "cross") and cross_l
    pol_label = cross_l if want_cross else co_l
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image = f"{site['id']}_change.png"
    old = previous["change"] if previous else None
    if old and old["before"] == before["time"] and old["after"] == after["time"] and old["pol"] == pol_label and (OUT_DIR / image).exists():
        # Same two passes as last time: the map on disk is still right.
        change = old
    else:
        pol = "cross" if want_cross else "co"
        for s in (before, after):
            if s["time"] not in windows:
                win = read(by_time[s["time"]])
                if win is None:
                    print("  could not read a pass needed for the change map; nothing written")
                    return None
                windows[s["time"]] = win
        (glon, glat), bounds = lonlat_grid(site["lat"], site["lon"], map_r, MAP_PIXELS)
        a = resample(windows[before["time"]], to_db(boxcar(windows[before["time"]][pol])), glon, glat)
        b = resample(windows[after["time"]], to_db(boxcar(windows[after["time"]][pol])), glon, glat)
        delta = b - a
        change_png(delta, OUT_DIR / image)
        finite = delta[np.isfinite(delta)]
        change = {
            "before": before["time"],
            "after": after["time"],
            "pol": pol_label,
            "image": image,
            "bounds": bounds,
            "weakerPct": round(float((finite <= -3).mean() * 100), 1) if finite.size else None,
            "strongerPct": round(float((finite >= 3).mean() * 100), 1) if finite.size else None,
        }
    change["spansEvent"] = spans_event

    # First pass at least 3 dB below the first pass, co-polarised: for glaciers
    # this marks the start of surface melt; for fields, flooding.
    drop = next((s for s in series[1:] if s["hh"] <= first["hh"] - 3), None)

    dhh = after["hh"] - before["hh"]
    summary = (
        f"Between {day(before['time'])} and {day(after['time'])}, {co_l} backscatter here changed by "
        f"{dhh:+.1f} dB"
        + (f" and {cross_l} by {after['hv'] - before['hv']:+.1f} dB" if after["hv"] is not None and before["hv"] is not None else "")
        + f" (mean within {series_r} m)."
    )
    if spans_event:
        summary = f"Across the event of {site['event']}: " + summary[0].lower() + summary[1:]
    if change["weakerPct"] is not None:
        summary += f" Across the mapped area, {change['weakerPct']:.0f}% got at least 3 dB weaker and {change['strongerPct']:.0f}% at least 3 dB stronger."
    if drop and not event:
        summary += f" {co_l} first fell 3 dB or more below its starting level on {day(drop['time'])}."

    return {
        "id": site["id"],
        "name": site["name"],
        "lat": site["lat"],
        "lon": site["lon"],
        "radiusKm": site.get("matchKm", 25),
        "track": stack[0]["stack"],
        "setup": setup_of(site),
        "event": event,
        # Series keys stay "hh"/"hv"; these say which channels they really are.
        "pols": [co_l, cross_l] if cross_l else [co_l],
        "series": series,
        "change": change,
        "firstDrop": drop["time"] if drop else None,
        "summary": summary,
        "method": (
            f"NISAR L2 GCOV (terrain-corrected gamma-naught), frequency A, {len(series)} passes on track "
            f"{stack[0]['stack']}. Time series: mean linear power within {series_r} m of the point, in dB. "
            f"Change map: {pol_label} after minus before, 5×5 mean filter against speckle, "
            f"changes under 1.5 dB not drawn; 'after' is {after_rule}."
        ),
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def write_index() -> None:
    entries = []
    for path in sorted(OUT_DIR.glob("*.json")):
        if path.name == "index.json":
            continue
        d = json.loads(path.read_text())
        entries.append({"id": d["id"], "name": d["name"], "lat": d["lat"], "lon": d["lon"], "radiusKm": d["radiusKm"], "event": d.get("event"), "file": path.name})
    (OUT_DIR / "index.json").write_text(json.dumps(entries, indent=1) + "\n")
    print(f"index: {len(entries)} measured site(s)")


def point_site(args) -> dict:
    """A site made from --point, --name, --id and --event."""
    lat, lon = args.point
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        sys.exit("--point takes a latitude (-90 to 90) and a longitude (-180 to 180)")
    name = args.name or f"{lat:.3f}, {lon:.3f}"
    site_id = args.id or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "point"
    site = {"id": site_id, "name": name, "lat": lat, "lon": lon}
    if args.event:
        to_ms(args.event)  # fails early on a date that cannot be read
        site["event"] = args.event
    return site


def save_site(site: dict) -> None:
    """Adds the site to the list (or replaces the one with the same id)."""
    data = json.loads(SITES_FILE.read_text())
    data["sites"] = [s for s in data["sites"] if s["id"] != site["id"]] + [site]
    SITES_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"saved '{site['id']}' to {SITES_FILE.relative_to(ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sites", nargs="*", help="site ids from tools/measure_sites.json (default: all)")
    ap.add_argument("--local", type=Path, help="folder with GCOV .h5 files to use instead of searching")
    ap.add_argument("--list", action="store_true", help="only list the tracks found over each site (needs no login)")
    ap.add_argument("--point", nargs=2, type=float, metavar=("LAT", "LON"), help="measure this point instead of sites from the list")
    ap.add_argument("--name", help="with --point: what to call it")
    ap.add_argument("--id", help="with --point: file name to use (default: made from the name)")
    ap.add_argument("--event", metavar="YYYY-MM-DD", help="with --point: the change map compares the last pass before this date with the first after it")
    ap.add_argument("--save", action="store_true", help="with --point: also add it to the site list")
    ap.add_argument("--fresh", action="store_true", help="read every pass again instead of keeping earlier values")
    ap.add_argument("--start", default=NISAR_START)
    ap.add_argument("--end", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    args = ap.parse_args()

    if args.point:
        if args.sites:
            sys.exit("give either site ids or --point, not both")
        sites = [point_site(args)]
        if args.save:
            save_site(sites[0])
    else:
        sites = json.loads(SITES_FILE.read_text())["sites"]
        if args.sites:
            unknown = set(args.sites) - {s["id"] for s in sites}
            if unknown:
                sys.exit(f"unknown site(s): {', '.join(sorted(unknown))}")
            sites = [s for s in sites if s["id"] in args.sites]

    written = 0
    for site in sites:
        print(f"\n{site['name']} ({site['lat']}, {site['lon']})")
        passes = local_passes(args.local) if args.local else remote_passes(site, site.get("start", args.start), site.get("end", args.end))
        if args.list:
            counts: dict[str, int] = {}
            for p in passes:
                counts[p["stack"]] = counts.get(p["stack"], 0) + 1
            for stack, n in sorted(counts.items(), key=lambda kv: -kv[1]):
                print(f"  {stack}: {n} files")
            continue
        out = OUT_DIR / f"{site['id']}.json"
        previous = None
        if out.exists() and not args.fresh:
            try:
                previous = json.loads(out.read_text())
            except ValueError:
                previous = None
        # One site that fails must not stop the others.
        try:
            result = measure(site, passes, previous)
        except Exception as err:
            print(f"  failed: {err}")
            continue
        if result:
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(result, indent=1) + "\n")
            written += 1
            print(f"  → {result['summary']}")

    if not args.list:
        write_index()
        print(f"{written} of {len(sites)} site(s) measured")


if __name__ == "__main__":
    main()
