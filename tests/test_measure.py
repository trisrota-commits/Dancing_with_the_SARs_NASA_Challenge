"""Checks tools/measure.py on simulated GCOV files.

The files copy the real layout (/science/LSAR/GCOV/grids/frequencyA with
HHHH, HVHV, xCoordinates, yCoordinates and projection/epsg_code) but hold
made-up values: a "glacier" that loses 8 dB in HH during July, on a
background that stays the same. Run with: python tests/test_measure.py
"""

import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import h5py
import numpy as np
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import measure  # noqa: E402

LAT, LON = 46.5, 8.03
EPSG = 32632  # UTM zone 32N, as for a scene over the Alps
DATES = ["20260621T053000", "20260703T053000", "20260715T053000", "20260727T053000", "20260808T053000"]
HH_DB = [-8.0, -8.5, -16.0, -16.5, -15.5]  # melt starts between 3 and 15 July


def make_file(folder: Path, stamp: str, hh_db: float) -> None:
    cx, cy = Transformer.from_crs(4326, EPSG, always_xy=True).transform(LON, LAT)
    spacing = 20.0
    xs = np.arange(cx - 10_000, cx + 10_000, spacing)
    ys = np.arange(cy + 10_000, cy - 10_000, -spacing)  # north-up, like the products
    xx, yy = np.meshgrid(xs, ys)
    rng = np.random.default_rng(int(stamp[:8]))
    glacier = (xx - cx) ** 2 + (yy - cy) ** 2 < 3000**2
    hh = np.where(glacier, 10 ** (hh_db / 10), 10 ** (-9 / 10))
    hh *= rng.gamma(4, 1 / 4, hh.shape)  # speckle, about four looks
    hv = hh * 10 ** (-7 / 10)
    hh[:5, :] = np.nan  # a strip of no data, as at swath edges
    name = f"NISAR_L2_PR_GCOV_010_088_A_031_2005_DHDH_A_{stamp}_{stamp}_P05023_N_F_J_001.h5"
    with h5py.File(folder / name, "w") as f:
        g = f.create_group(measure.GRID)
        g["HHHH"] = hh.astype("float32")
        g["HVHV"] = hv.astype("float32")
        g["xCoordinates"] = xs
        g["yCoordinates"] = ys
        g["projection"] = np.int32(EPSG)
        g["projection"].attrs["epsg_code"] = np.int32(EPSG)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for stamp, db in zip(DATES, HH_DB):
            make_file(tmp, stamp, db)
        measure.OUT_DIR = tmp / "out"
        site = {"id": "test", "name": "Test glacier", "lat": LAT, "lon": LON, "mapRadiusM": 6000}
        result = measure.measure(site, measure.local_passes(tmp))

        assert result, "no result"
        got = [s["hh"] for s in result["series"]]
        assert len(got) == 5, got
        for want, have in zip(HH_DB, got):
            assert abs(want - have) < 0.6, (want, have)
        drop = datetime.fromtimestamp(result["firstDrop"] / 1000, timezone.utc).strftime("%Y-%m-%d")
        assert drop == "2026-07-15", drop
        assert result["change"]["weakerPct"] > 10, result["change"]
        assert result["change"]["strongerPct"] < 2, result["change"]
        png = measure.OUT_DIR / result["change"]["image"]
        assert png.exists() and png.stat().st_size > 1000
        b = result["change"]["bounds"]
        assert b["west"] < LON < b["east"] and b["south"] < LAT < b["north"]
        print("series (dB):", got)
        print("summary:", result["summary"])

        # A second run with the first result at hand reads nothing again.
        opened = []
        real_open = measure.open_pass
        measure.open_pass = lambda p: (opened.append(p["name"]), real_open(p))[1]
        again = measure.measure(site, measure.local_passes(tmp), result)
        assert opened == [], opened
        assert again["series"] == result["series"] and again["change"]["before"] == result["change"]["before"]

        # A new pass arrives: only that one is read, and the series grows.
        make_file(tmp, "20260820T053000", -15.0)
        grown = measure.measure(site, measure.local_passes(tmp), result)
        assert len(opened) == 1 and "20260820" in opened[0], opened
        assert len(grown["series"]) == 6 and abs(grown["series"][-1]["hh"] + 15.0) < 0.6

        # Moving the point makes the earlier values worthless: all are read again.
        opened.clear()
        moved = measure.measure({**site, "lat": LAT + 0.001}, measure.local_passes(tmp), result)
        assert len(opened) >= 6 and moved["series"], opened
        measure.open_pass = real_open

        # An event: the map compares the last pass before it with the first after.
        hit = measure.measure({**site, "id": "event", "event": "2026-07-10"}, measure.local_passes(tmp))
        day = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")
        assert hit["change"]["spansEvent"] and day(hit["change"]["before"]) == "2026-07-03" and day(hit["change"]["after"]) == "2026-07-15", hit["change"]
        assert hit["summary"].startswith("Across the event of 2026-07-10"), hit["summary"]
        print("event summary:", hit["summary"])
        # An event no pass has followed yet still gets its series, and says so.
        early = measure.measure({**site, "id": "early", "event": "2026-12-01"}, measure.local_passes(tmp))
        assert early and not early["change"]["spansEvent"] and "does not have a pass on both sides" in early["method"]

        # A pass whose values cannot be backscatter (as seen over Perito
        # Moreno on the first real run: -135 dB) is left out, not written;
        # and such a value in an earlier result is not carried on.
        make_file(tmp, "20260901T053000", -135.0)
        guarded = measure.measure(site, measure.local_passes(tmp))
        assert guarded and all(-50 <= s["hh"] <= 20 for s in guarded["series"]), guarded["series"]
        assert not any("20260901" in s["file"] for s in guarded["series"]), guarded["series"]
        tainted = {**guarded, "series": guarded["series"] + [{"time": 1, "hh": -135.0, "hv": -144.0, "pixels": 9, "file": "x.h5"}]}
        carried = measure.measure(site, measure.local_passes(tmp), tainted)
        assert all(-50 <= s["hh"] <= 20 for s in carried["series"]), carried["series"]
        assert measure.plausible(-25.0) and not measure.plausible(-135.38) and not measure.plausible(None)

        # With --grid the window is also written cell by cell.
        measure.GRID_M = 500
        gridded = measure.measure(site, measure.local_passes(tmp))
        grid = json.loads((measure.OUT_DIR / "test_grid.json").read_text())
        assert grid["n"] == 24 and len(grid["hh"]) == len(gridded["series"]) and len(grid["hh"][0]) == 24 * 24, (grid["n"], len(grid["hh"]))
        centre = grid["hh"][0][12 * 24 + 12]
        corner = grid["hh"][0][23 * 24 + 23]
        assert abs(centre - gridded["series"][0]["hh"]) < 1.0, (centre, gridded["series"][0]["hh"])  # on the glacier
        assert abs(corner + 9.0) < 1.0, corner  # off it
        assert grid["hv"] and abs(grid["hv"][0][12 * 24 + 12] - (centre - 7.0)) < 1.0
        # A second run reads nothing again, and the cells are kept.
        opened.clear()
        measure.open_pass = lambda p: (opened.append(p["name"]), real_open(p))[1]
        measure.measure(site, measure.local_passes(tmp), gridded)
        assert opened == [], opened
        assert json.loads((measure.OUT_DIR / "test_grid.json").read_text())["hh"] == grid["hh"]
        measure.open_pass = real_open
        measure.GRID_M = None
        (measure.OUT_DIR / "test_grid.json").unlink()

        measure.write_index()
        index = json.loads((measure.OUT_DIR / "index.json").read_text())
        assert index == [], index  # nothing was written to disk as a site file here
        print("ok")


if __name__ == "__main__":
    main()
