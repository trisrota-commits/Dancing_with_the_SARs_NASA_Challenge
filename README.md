# Dancing with the SARs

Our entry for the NASA Space Apps Challenge 2026, "Dancing with the SARs".

A 3D globe that shows natural events as they are reported and cross-references
each one with radar imagery from the NASA-ISRO NISAR mission.

## What it does

- Plots earthquakes, wildfires, floods, storms and other events from three
  live feeds (USGS, NASA EONET, GDACS) on a 3D globe with real terrain, and
  merges reports of the same event into one dot.
- **Replays what happened** when you click an event, built only from data:
  - Earthquake: wave fronts spreading through the published shaking-intensity
    outlines, then the later quakes nearby in the order they struck.
  - Storm: a vortex travelling the dated track, sized by wind speed.
  - Wildfire: the satellite fire detections of each day, building up.
  - Flood: water the radar saw on land, pass by pass, inside the affected area.
- Labels every part of a replay as **observed** (measured or catalogued),
  **analysis** (worked out and published by an agency) or **computed** (drawn
  here by a stated rule), with its source.
- Searches the NISAR archive over the event and shows **what NISAR saw
  change** between two passes in plain colours (echo got weaker / stronger),
  with the source radar image one tick box underneath and a before/after
  divider for the raw images.
- Plays a **NISAR time-lapse for any spot on Earth**: click the ground (or
  search a place) to step through every placeable pass of one repeat track,
  switch between the colour composite, HH only and HV only, and read a chart
  of both channels at that point over time.
- Marks **changing places** with diamonds: slow changes that no event feed
  reports. There are 13 glaciers around the world (Greenland, Alaska, Canada,
  Iceland, the Alps, the Himalaya, Patagonia, New Zealand and Antarctica),
  plus sinking cities, wetland flood pulses, forest clearing and monsoon
  farming. Each one explains what NISAR can show there and plays its passes.
  Glaciers link to ones in the other hemisphere, to compare seasons.
- Shows where NISAR looked recently, and rings every event inside a pass.
- Estimates the **next NISAR overpass** for any event or spot, with a live
  countdown, clearly labelled as computed from the 12-day repeat cycle.
- A **reports bar** cycles through new and ongoing events from the feeds;
  click one to fly there. It can be paused or hidden.
- A **"Since NISAR data began"** time window loads larger events back to
  17 June 2026, so older events have radar passes on both sides.
- Drapes daily NISAR backscatter and other satellite layers over the terrain.
- One search box for events (fuzzy match, no keyword list) and places.

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
- `js/change.js` – what changed between two NISAR passes
- `js/places.js` – the changing places and what NISAR can show at each
- `js/timelapse.js` – loads the passes of one repeat track, splits HH and HV
- `js/chart.js` – the HH/HV history chart
- `js/replay/replay.js` – event replay templates and player
- `js/replay/sources.js` – per-event data: shaking contours, nearby quakes,
  agency outlines, daily fire detections
- `js/replay/mvt.js` – small vector-tile reader for the fire detections
- `js/search.js` – fuzzy event search and place lookup
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
- `docs/DATA_RULES_AND_DEMO_PLAN.md` – which data the challenge allows besides
  NISAR, and how to solve the remaining gaps

## Data and credits

NISAR data: NASA/ISRO, distributed by the Alaska Satellite Facility DAAC.
Tiles: NASA GIBS. Events: USGS, NASA EONET, GDACS. Basemap: Esri World Imagery.
Fire detections: VIIRS on NOAA-20 via NASA GIBS. Surface water: OPERA DSWx.
Elevation: Mapzen Terrain Tiles (AWS Open Data). Place search: Photon
(OpenStreetMap). Rendering: three.js.

## How honest the pictures are

- Replays never draw anything between data points without saying so; the
  panel lists each element with its source and whether it is observed,
  agency analysis or computed here.
- The NISAR change view is computed in the browser from NASA's 8-bit preview
  images, not the full-resolution products. It ignores differences that a
  two-pixel offset between the images would explain, and it marks where to
  look rather than measuring anything. The source images stay one click away.
