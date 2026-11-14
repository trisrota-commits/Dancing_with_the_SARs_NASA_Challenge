# Dancing with the SARs

Our entry for the NASA Space Apps Challenge 2026, "Dancing with the SARs".

A 3D globe that shows natural events as they are reported and cross-references
each one with radar imagery from the NASA-ISRO NISAR mission.

## What it does

- Plots earthquakes, wildfires, floods, storms and other events from three
  live feeds (USGS, NASA EONET, GDACS) and merges reports of the same event
  into one dot.
- Shows NISAR's latest radar passes as footprints, and rings every event that
  falls inside one.
- On click, searches the NISAR archive for scenes over that spot, lists them
  with previews, and offers a before/after comparison on the globe with a
  draggable divider when a repeat pass exists.
- Draws arcs to other events nearby in space and time.
- Drapes daily NISAR backscatter tiles on the globe, with a play button that
  steps through days, plus context layers (surface water, Sentinel-1
  backscatter, vegetation disturbance, soil moisture).

## The engine

The globe is a small custom engine rather than an off-the-shelf one, built for
this app's workload:

- A quadtree picks only the map tiles the camera needs, at the detail the
  screen can show.
- Tiles are shaped into real terrain from open elevation data (Mapzen Terrain
  Tiles on AWS), with a baked hillshade and an adjustable height stretch.
- Every active layer, radar preview and footprint outline is composited into
  one small canvas per tile, so the GPU draws one textured mesh per tile
  whatever is switched on, and everything drapes over the relief.
- All event dots are a single draw call.
- The camera orbits a point on the ground like Google Earth: drag to pan,
  wheel or pinch to zoom, right-drag or two-finger drag to tilt and turn.
- A frame is drawn only when something changed; an idle globe costs nothing.

## Run it

It is a static site with no build step and no keys. It needs Python 3 to
serve the files and internet access, because all imagery and data load from public
servers at runtime.

- Windows: double-click `start.bat`.
- macOS: double-click `start.command`. The first time, macOS may refuse
  because the file was downloaded; right-click it, choose Open, then Open.
- Linux: run `./start.sh`.

Either one serves the folder and opens http://localhost:8765. To do it by
hand:

```bash
python3 -m http.server 8765
```

Opening `index.html` directly from disk does not work; the page has to come
from a web server.

## Layout

- `index.html`, `css/style.css` – page and styling
- `js/config.js` – categories, feed URLs, map layers
- `js/feeds.js` – fetches and normalises the event feeds
- `js/incidents.js` – merges duplicate reports, links nearby events
- `js/nisar.js` – NISAR scene search and preview handling
- `js/globe.js` – the globe the app talks to
- `js/engine/` – our own globe engine on three.js
  - `tiles.js` – streams map tiles, shapes terrain, composites layers
  - `marks.js` – event dots, lines, atmosphere, stars
  - `controls.js` – pan, zoom, tilt, turn and fly-to camera
  - `geo.js` – coordinate maths
- `vendor/three.module.min.js` – three.js r170 (MIT), bundled so the engine
  has no CDN dependency
- `js/main.js` – wiring and panels
- `docs/DATA_SOURCES.md` – survey of every data source and what is reachable

## Data and credits

NISAR data: NASA/ISRO, distributed by the Alaska Satellite Facility DAAC.
Tiles: NASA GIBS. Events: USGS, NASA EONET, GDACS. Basemap: Esri World Imagery.
Elevation: Mapzen Terrain Tiles (AWS Open Data). Rendering: three.js.
