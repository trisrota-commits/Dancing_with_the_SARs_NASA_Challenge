"""Renders the frames of the clickable README tour from the running app.

Two branches from one home view: left to the flood in Italy, right to the
earthquake in Pakistan. Each branch: turn, zoom, play the NISAR passes.
The earthquake also gets its two seismic wave fronts, as in the app.
Frames go to .tour/frames/<scene>/NNN.png with a captions.json.
Needs the app served on http://localhost:8765/ and Playwright with Chromium.
Usage: python3 tools/tour/render.py [scene ...], then tools/tour/assemble.py.
"""
import asyncio, base64, io, json, math, shutil, sys
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from matplotlib import colormaps
from PIL import Image
from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / ".tour" / "frames"
HIDE = "body > *:not(#globe) { display: none !important; }"
HOME = dict(lat=30.0, lon=38.0, alt=2.2)
EVENTS = {
    "left": dict(id="event-gdacs-fl1104220", cat="flood"),
    "right": dict(id="event-usgs-us6000u2y1", cat="earthquake"),
}
only = sys.argv[1:]  # optional scene names


def load(eid):
    m = json.load(open(REPO / f"data/measured/{eid}.json"))
    g = json.load(open(REPO / f"data/measured/{eid}_grid.json"))
    d = json.load(open(REPO / f"data/measured/{eid}_detect.json"))
    return m, g, d


def data_url(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def grid_images(g):
    n = g["n"]
    stack = np.array([[np.nan if v is None else v for v in f] for f in g["hh"]], dtype=float)
    lo, hi = np.nanpercentile(stack, 2), np.nanpercentile(stack, 98)
    cmap = colormaps["magma"]
    out = []
    for f in stack:
        a = ((f - lo) / (hi - lo)).clip(0, 1).reshape(n, n)
        rgba = (cmap(a) * 255).astype(np.uint8)
        rgba[np.isnan(f.reshape(n, n)), 3] = 0
        out.append(Image.fromarray(rgba, "RGBA").resize((n * 10, n * 10), Image.NEAREST))
    return out, (round(lo, 1), round(hi, 1))


def ease(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto("http://localhost:8765/", wait_until="domcontentloaded")
        await pg.wait_for_timeout(6000)
        await pg.add_style_tag(content=HIDE)
        await pg.evaluate("""() => { const g = window.app.globe; g.controls.stop();
            // The app's feeds would replace the tour's markers after a while.
            g._tourRender = g.renderIncidents.bind(g); g.renderIncidents = () => {}; }""")

        markers = []
        for side, e in EVENTS.items():
            m, _, _ = load(e["id"])
            markers.append(dict(id=side, category=e["cat"], lat=m["lat"], lon=m["lon"], severity=0.8,
                                reports=[{"source": "usgs"}], nisarScenes=[1], related=[], time=0))
        await pg.evaluate("(L) => window.tourMarkers = L", markers)

        async def show_markers(on, selected=None):
            await pg.evaluate("""([on, sel]) => { const g = window.app.globe;
                g._tourRender(on ? window.tourMarkers : [], [], new Set(on ? ['left','right'] : []));
                g.select(sel ? window.tourMarkers.find(m => m.id === sel) : null); g.dirty = true; }""", [on, selected])

        async def cam(lat, lon, alt):
            await pg.evaluate("""([lat, lon, alt]) => { const g = window.app.globe, c = g.controls;
                c.flight = null; c.lat = lat; c.lon = lon; c.alt = alt; c.apply(); g.dirty = true; }""", [lat, lon, alt])

        async def shot(scene, i, wait):
            await pg.wait_for_timeout(wait)
            d = OUT / scene
            d.mkdir(exist_ok=True)
            await pg.screenshot(path=str(d / f"{i:03d}.png"))

        captions = {}
        want = lambda s: not only or s in only

        # Home: still camera, both markers pinging.
        if want("home"):
            await show_markers(True)
            await cam(**HOME)
            await pg.wait_for_timeout(4000)
            for i in range(16):
                await shot("home", i, 180)

        for side, e in EVENTS.items():
            m, g, d = load(e["id"])
            lat, lon = m["lat"], m["lon"]
            alt_end_turn, alt_close = 0.9, 0.0042

            if want(f"turn-{side}"):
                await show_markers(True)
                n = 22
                for i in range(n):
                    t = ease(i / (n - 1))
                    await cam(HOME["lat"] + (lat - HOME["lat"]) * t, HOME["lon"] + (lon - HOME["lon"]) * t,
                              math.exp(math.log(HOME["alt"]) + (math.log(alt_end_turn) - math.log(HOME["alt"])) * t))
                    await shot(f"turn-{side}", i, 1400)
                for j in range(8):  # end hold with the marker pinging
                    await shot(f"turn-{side}", n + j, 160)

            # Earthquake only: the two seismic wave fronts spreading from the
            # epicentre, drawn with the app's own replay code and numbers
            # (P 6 km/s, S 3.5 km/s, 120 km reach with no shaking map).
            alt_waves = 0.14
            if e["cat"] == "earthquake" and want(f"waves-{side}"):
                await show_markers(False)
                n = 16  # camera moves in from the turn's end to the wave view
                for i in range(n):
                    t = ease(i / (n - 1))
                    await cam(lat, lon, math.exp(math.log(alt_end_turn) + (math.log(alt_waves) - math.log(alt_end_turn)) * t))
                    await shot(f"waves-{side}", i, 1600)
                await pg.wait_for_timeout(3000)
                rmax, WAVE, mag = 120.0, 5.5, 5.7
                steps = 34
                for j in range(steps + 10):
                    tt = min(j, steps) / steps * (WAVE + 0.5)
                    await pg.evaluate("""([c, t, rmax, WAVE, mag]) => { const g = window.app.globe, RAD = Math.PI / 180;
                        const circle = (km, n = 96) => { const d = km / 6371, la = c.lat * RAD, out = [];
                          for (let i = 0; i < n; i++) { const b = i / n * 2 * Math.PI;
                            const l2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
                            const o2 = c.lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(l2));
                            out.push({ lat: l2 / RAD, lon: o2 / RAD }); } return out; };
                        const s = Math.min(1, t / WAVE) * rmax, p = Math.max(1, Math.min(s * 6 / 3.5, rmax * 1.72));
                        const settle = Math.max(0, t - WAVE) * 2;
                        g.setEffectLines([
                          { points: circle(Math.max(1, s)), color: [1, 0.32, 0.28, 0.95 - 0.45 * settle], closed: true },
                          { points: circle(p), color: [1, 1, 1, 0.5 - 0.24 * settle], closed: true }]);
                        const fade = Math.max(0, Math.min(1, 1 - (t - WAVE) * 2));
                        g.setShockwave(fade > 0 ? { ...c, sKm: Math.max(1, s), pKm: p, widthKm: rmax * 0.03, strength: fade, rippleKm: rmax * 0.1, heightM: rmax * 8 } : null);
                        const flash = Math.max(0, 1 - t / 1.4);
                        g.setEffectGlow(flash > 0 ? [{ ...c, color: [flash, 0.55 * flash, 0.3 * flash], size: 10 + mag * 4 }] : []);
                        g.setEffectDots([{ ...c, color: [1, 0.32, 0.28], size: 7 }]);
                        const south = (r) => r.reduce((a, b) => (b.lat < a.lat ? b : a));
                        const secs = Math.round(s / 3.5);
                        g.setLabels(t >= WAVE + 0.5 ? [
                          { ...south(circle(rmax)), text: `Slower wave (S), ${Math.round(rmax / 3.5)} s after`, color: '#ff5247' },
                          { ...south(circle(rmax * 1.71)), text: `Faster wave (P), ${Math.round(rmax / 3.5)} s after`, color: '#e8edf5' }] : []);
                        g.dirty = true; }""", [dict(lat=lat, lon=lon), tt, rmax, WAVE, mag])
                    await shot(f"waves-{side}", n + j, 900)
                await pg.evaluate("() => { const g = window.app.globe; g.setShockwave(null); g.setEffectLines([]); g.setEffectGlow([]); g.setEffectDots([]); g.setLabels([]); g.dirty = true; }")

            if want(f"zoom-{side}"):
                await show_markers(True, side)
                start_alt = alt_waves if e["cat"] == "earthquake" else alt_end_turn
                n = 26
                for i in range(n):
                    t = ease(i / (n - 1))
                    await cam(lat, lon, math.exp(math.log(start_alt) + (math.log(alt_close) - math.log(start_alt)) * t))
                    await shot(f"zoom-{side}", i, 2200)

            if want(f"play-{side}"):
                # Every pass in turn. Where the detector judged a pass, its
                # cells that stood out are drawn on top (orange rose, blue fell).
                await show_markers(False)
                await cam(lat, lon, alt_close)
                images, scale = grid_images(g)
                bounds = d["bounds"]
                after = d["event"]["firstPassAfter"]
                rows = {r["date"]: r for r in d["byDate"]}
                caps = []
                shutil.rmtree(OUT / f"play-{side}", ignore_errors=True)
                for k, (img, ms) in enumerate(zip(images, g["times"])):
                    day = datetime.fromtimestamp(int(ms) / 1000, timezone.utc).strftime("%Y-%m-%d")
                    row = rows.get(day)
                    layers = [img.convert("RGBA")]
                    if row and row.get("image"):
                        stood = Image.open(REPO / "data/measured" / row["image"]).convert("RGBA")
                        layers = [img.convert("RGBA").resize(stood.size, Image.NEAREST), stood]
                    await pg.evaluate("""async ([urls, b]) => { const g = window.app.globe; g.clearScenes();
                        for (const u of urls) { const im = new Image(); im.src = u; await im.decode(); g.addPicture(im, b); }
                        g.dirty = true; }""", [[data_url(x) for x in layers], bounds])
                    await shot(f"play-{side}", k, 2500)
                    caps.append(dict(frame=k, date=day, after=day >= after, first_after=day == after,
                                     judged=row is not None, stood=row["stood"] if row else None,
                                     fell=row.get("fell") if row else None, rose=row.get("rose") if row else None,
                                     newVersion=bool(row and row.get("newVersion")), outlines=bool(row and row.get("image"))))
                captions[side] = dict(caps=caps, scale=scale, event=d["event"]["date"], after=after, name=m["name"])
        if captions:
            old = json.load(open(OUT / "captions.json")) if (OUT / "captions.json").exists() else {}
            old.update(captions)
            json.dump(old, open(OUT / "captions.json", "w"), indent=1)
        await b.close()


asyncio.run(main())
