"""Records the README's one-take globe GIF from the running app.

One full turn of the globe, slowing to a stop over the earthquake in
Pakistan; the camera dives in, the two seismic wave fronts spread as the
app draws them, then it rises back to where it began, so the loop has
no seam.

Needs the app served on http://localhost:8765/, Playwright with Chromium,
ffmpeg and the DejaVu fonts (gifsicle optional). Usage: python3 tools/tour/hero.py
Output: docs/img/globe-quake.gif
"""
import asyncio, json, math, shutil, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[2]
FR = REPO / ".tour" / "hero"
OUT = REPO / "docs" / "img" / "globe-quake.gif"
EVENT = "event-usgs-us6000u2y1"
W, H, FPS = 640, 360, 15
SPIN_LAT, SPIN_ALT, WAVE_ALT = 25.0, 2.2, 0.16
RMAX, WAVE, MAG = 120.0, 5.5, 5.7  # the app's numbers with no shaking map

WAVES_JS = """([c, t, rmax, WAVE, mag]) => { const g = window.app.globe, RAD = Math.PI / 180;
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
  g.dirty = true; }"""


def ease(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


def spin_progress(t, a=0.12, b=0.25):
    """0..1 with a gentle start (first a) and a longer slow-down (last b)."""
    v = 1 / (1 - a / 2 - b / 2)  # cruise speed so the total is 1
    if t < a:
        return v * t * t / (2 * a)
    if t > 1 - b:
        u = 1 - t
        return 1 - v * u * u / (2 * b)
    return v * (a / 2 + (t - a))


def font(size, bold=False):
    return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("-Bold" if bold else "") + ".ttf", size)


def caption(img, title, sub, alpha):
    """A small lower-third label that fades in and out."""
    if alpha <= 0:
        return img
    im = img.convert("RGBA")
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([14, H - 62, 14 + 380, H - 14], 8, fill=(5, 8, 14, int(190 * alpha)))
    d.text((26, H - 54), title, font=font(14, True), fill=(240, 244, 250, int(255 * alpha)))
    d.text((26, H - 33), sub, font=font(10), fill=(175, 186, 200, int(255 * alpha)))
    return Image.alpha_composite(im, layer).convert("RGB")


async def record():
    m = json.load(open(REPO / f"data/measured/{EVENT}.json"))
    lat, lon = m["lat"], m["lon"]
    shutil.rmtree(FR, ignore_errors=True)
    FR.mkdir(parents=True)
    plan = []  # (file, caption alpha, caption kind)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto("http://localhost:8765/", wait_until="domcontentloaded")
        await pg.wait_for_timeout(6000)
        await pg.add_style_tag(content="body > *:not(#globe) { display: none !important; }")
        marker = dict(id="quake", category="earthquake", lat=lat, lon=lon, severity=0.8,
                      reports=[{"source": "usgs"}], nisarScenes=[1], related=[], time=0)
        await pg.evaluate("""(mk) => { const g = window.app.globe; g.controls.stop();
            g._tourRender = g.renderIncidents.bind(g); g.renderIncidents = () => {};
            window.tourMarker = mk; }""", marker)

        async def markers(on, selected=False):
            await pg.evaluate("""([on, sel]) => { const g = window.app.globe;
                g._tourRender(on ? [window.tourMarker] : [], [], new Set(on ? ['quake'] : []));
                g.select(sel ? window.tourMarker : null); g.dirty = true; }""", [on, selected])

        async def cam(la, lo, alt):
            await pg.evaluate("""([la, lo, alt]) => { const g = window.app.globe, c = g.controls;
                c.flight = null; c.lat = la; c.lon = lo; c.alt = alt; c.apply(); g.dirty = true; }""", [la, lo, alt])

        async def shot(wait, alpha=0.0, kind=None):
            await pg.wait_for_timeout(wait)
            f = FR / f"{len(plan):04d}.png"
            await pg.screenshot(path=str(f))
            plan.append((f.name, alpha, kind))

        logalt = lambda a, z, t: math.exp(math.log(a) + (math.log(z) - math.log(a)) * t)

        # 1. One full turn, ending at rest over the earthquake.
        await markers(True)
        await cam(SPIN_LAT, lon, SPIN_ALT)
        await pg.wait_for_timeout(4000)
        n = 96
        for i in range(n):
            await cam(SPIN_LAT, lon - 360 + 360 * spin_progress(i / n), SPIN_ALT)
            await shot(1100)

        # 2. Dive in.
        await markers(True, True)
        n = 34
        for i in range(n):
            t = ease(i / (n - 1))
            await cam(SPIN_LAT + (lat - SPIN_LAT) * t, lon, logalt(SPIN_ALT, WAVE_ALT, t))
            await shot(1500, max(0, (i - n + 10) / 10), "title")

        # 3. The waves.
        await markers(False)
        await pg.wait_for_timeout(3000)
        steps, rest = 40, 22
        for j in range(steps + rest):
            t = min(j, steps) / steps * (WAVE + 0.5)
            await pg.evaluate(WAVES_JS, [dict(lat=lat, lon=lon), t, RMAX, WAVE, MAG])
            await shot(700, 1.0, "waves")
        await pg.evaluate("() => { const g = window.app.globe; g.setShockwave(null); g.setEffectGlow([]); g.dirty = true; }")

        # 4. Rise back to where the turn began; the rings fade on the way.
        n = 34
        for i in range(n):
            t = ease(i / (n - 1))
            if i == 6:
                await pg.evaluate("() => { const g = window.app.globe; g.setEffectLines([]); g.setEffectDots([]); g.dirty = true; }")
                await markers(True)
            await cam(lat + (SPIN_LAT - lat) * t, lon, logalt(WAVE_ALT, SPIN_ALT, t))
            await shot(1500, max(0, 1 - i / 8), "waves")
        await b.close()
    json.dump(plan, open(FR / "plan.json", "w"))


def assemble():
    plan = json.load(open(FR / "plan.json"))
    tmp = REPO / ".tour" / "hero-tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    title = "Earthquake M 5.7 · Khuzdar, Pakistan · 17 Oct 2026"
    subs = {"title": "Reported by USGS",
            "waves": "Seismic waves at typical crust speeds, sped up about 6×. Illustrated, not measured."}
    for k, (name, alpha, kind) in enumerate(plan):
        im = Image.open(FR / name).convert("RGB").resize((W, H), Image.LANCZOS)
        caption(im, title, subs.get(kind, ""), alpha).save(tmp / f"{k:04d}.png")
    # Shown at 560 px wide; gifsicle's lossy pass halves the file if present.
    pal = tmp / "pal.png"
    src = ["-framerate", str(FPS), "-i", str(tmp / "%04d.png")]
    scale = "scale=560:315:flags=lanczos"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *src, "-vf", f"{scale},palettegen=max_colors=192:stats_mode=full", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", *src, "-i", str(pal), "-lavfi",
                    f"{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", "-loop", "0", str(OUT)], check=True)
    if shutil.which("gifsicle"):
        subprocess.run(["gifsicle", "-O3", "--lossy=60", "-b", str(OUT)], check=True)
    print(OUT.name, len(plan), "frames", round(len(plan) / FPS, 1), "s", round(OUT.stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    import sys
    if "--assemble-only" not in sys.argv:
        asyncio.run(record())
    assemble()
