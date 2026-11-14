# Dancing with the SARs

Our entry for the NASA Space Apps Challenge 2026, "Dancing with the SARs".

A 3D globe that shows natural events as they are reported and cross-references
each one with radar imagery from the NASA-ISRO NISAR mission.

## What it does

- Plots earthquakes, wildfires, floods, storms and other events from three
  live feeds (USGS, NASA EONET, GDACS) on a 3D globe with real terrain, and
  merges reports of the same event into one dot.
- **Clicking an event opens a small card**, not a wall of data: what it is,
  the news about it, one line on what NISAR has seen there, and a button
  for the NISAR image. "Show details" opens the panel.
- **The details start with one plain text** that explains the event and
  names every source as a link: hover one to see what it is (for NISAR,
  the newest pass itself), click it to open what was taken from it. A
  small timeline sets the event against NISAR's passes. Everything else
  is folded away, NISAR first. The sentences are fixed templates filled
  from the data; a sentence only appears when its data has arrived.
- **Replays what happened** when you click an event, built only from data:
  - Earthquake: wave fronts crossing the terrain as a glow and a ripple in
    the ground, through the published shaking-intensity outlines, then the
    later quakes nearby in the order they struck.
  - Storm: a cloud spiral travelling the dated track above the terrain,
    turning the right way for its hemisphere, sized and spun by wind speed.
  - Wildfire: the satellite fire detections of each day as glowing embers
    that ignite through the day and cool to a dull red. Zoom in and each
    one is a soft spot on the exact position of its detection, at true
    size, reddest at its centre.
  - Flood: water the radar saw on land, fading in pass by pass, with moving
    ripples and waves along its edge whose detail grows as you zoom in.
- While a replay plays, the map around it dims a little, the camera drifts
  slowly closer, and a few data labels appear on the globe: the shaking
  level on each earthquake outline, the magnitude of the strongest later
  quakes, the wind speed travelling with a storm.
- A NISAR picture is uncovered by a line sweeping the way the satellite
  flew, and the "what changed" picture fades in over the ground.
- Labels every part of a replay as **observed** (measured or catalogued),
  **analysis** (worked out and published by an agency) or **computed** (drawn
  here by a stated rule), with its source.
- Searches the NISAR archive over the event and shows **what NISAR saw
  change** between two passes in plain colours (echo got weaker / stronger),
  with the source radar image one tick box underneath and a before/after
  divider for the raw images.
- **Five curated stories** (ice, wetland, farmland, earthquake, ground
  movement), each answering what to look at, why it happens, which
  polarisation shows it, what a camera would miss and what it is useful for.
  The places and explanations are ours; every number is computed live.
- Features **interferograms**: any earthquake with a pair of passes either
  side of it gets a "Show ground movement" card.
- Plays a **NISAR time-lapse for any spot on Earth**: click the ground (or
  search a place) to step through every placeable pass of one repeat track,
  switch between the colour composite, HH only and HV only, and read a chart
  of both channels at that point over time.
- Marks **changing places** with diamonds: slow changes that no event feed
  reports. There are 13 glaciers around the world (Greenland, Alaska, Canada,
  Iceland, the Alps, the Himalaya, Patagonia, New Zealand and Antarctica),
  plus sinking cities, wetland flood pulses, forest clearing, monsoon
  farming, volcanoes, moving slopes and a filling reservoir: 33 places in
  all. Each one explains what NISAR can show there and plays its passes.
  Glaciers link to ones in the other hemisphere, to compare seasons.
- Shows **calibrated NISAR measurements** where we have made them: a time
  series in dB, a change map and a one-sentence result, with the method
  stated. These come from the full-resolution GCOV products, not the
  previews (see "Measuring with NISAR" below).
- **NISAR flies live** around the globe: its real position now, worked out
  in the browser from public orbit elements (SGP4), with its orbit, the
  edges of its 242 km radar swath on the left of its track, and beams to
  the ground. Click it for its height, speed and position.
- **The real sky:** the ~4,100 brightest stars of the Yale Bright Star
  Catalogue at their true positions, turning with the Earth, and the Sun
  where it actually is. Day and night are on from the start.
- **Wildlife sightings** from GBIF, played by month of the year, so
  migrating whales, rays, sharks, turtles, terns, kob and wildebeest appear
  and disappear where they were really seen. Wetland places explain how
  animals follow the floods that NISAR maps.
- **Decorations**, clearly labelled and switchable: shooting stars, splash
  rings when whales appear, and three ocean landmarks (the Titanic wreck,
  Challenger Deep, Point Nemo).
- Event types include landslides, snow, dust and haze, extreme heat or cold,
  and human-made events from NASA EONET, as well as earthquakes, fires,
  floods, storms, volcanoes, ice and drought.
- Shows where NISAR looked recently, and rings every event inside a pass.
- Estimates the **next NISAR overpass** for any event or spot, with a live
  countdown, clearly labelled as computed from the 12-day repeat cycle.
- A **reports bar** cycles through new and ongoing events from the feeds;
  click one to fly there. It can be paused or hidden.
- A **"Since NISAR data began"** time window loads larger events back to
  17 June 2026, so older events have radar passes on both sides.
- Drapes daily NISAR backscatter and other satellite layers over the terrain.
- One search box for events (fuzzy match, no keyword list) and places.
- **Press coverage** per event: articles GDACS has linked to it, or a
  place-and-type search of the GDELT news index, labelled as unverified.
- **Share links:** the address bar always points at the open event, story,
  place or spot, with a "Copy link" button.
- **Two radar wavelengths side by side:** NISAR (L-band) left of a divider,
  Sentinel-1 (C-band) right of it.
- Twelve context layers in three groups: radar and water, weather and ice,
  land and people (population, built-up areas, croplands, land cover, city
  lights).
- A time-lapse can be **played as sound**: pitch follows the brightness at
  the chosen point.

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
- All event dots are a single draw call, and so are their light beams,
  which rise as the view tilts: taller for stronger events.
- Replay effects live in shaders: the earthquake front is drawn and lifted
  in the terrain shader itself, the storm is a procedural cloud shader, and
  the camera slowly circles a replay until you touch the globe.
- Effects have levels of detail and never pop: a fire is one instanced
  system that shows embers from afar and soft, exactly placed spots up
  close; flood
  water is a mask the terrain shader animates; radar pictures cross-fade.
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

### Hosting

The site is static with relative paths, so GitHub Pages can serve it as is:
Settings → Pages → Deploy from a branch → `main` / root. `.nojekyll` is
already in place.

### Tests

```bash
node --test tests/*.test.mjs
```

```bash
node tools/smoke.js
```

The second one needs Playwright and the local server running; it loads the
app in headless Chromium against the live services.

## Layout

- `index.html`, `css/style.css` – page and styling
- `js/config.js` – categories, feed URLs, map layers
- `js/feeds.js` – fetches and normalises the event feeds
- `js/incidents.js` – merges duplicate reports, links nearby events
- `js/nisar.js` – NISAR scene search and preview handling
- `js/change.js` – what changed between two NISAR passes
- `js/places.js` – the changing places and what NISAR can show at each
- `js/measured.js` – shows the calibrated measurements: card, dB chart and
  change map
- `tools/measure.py` – makes the calibrated measurements from NISAR GCOV
  files; `tools/measure_sites.json` lists the sites
- `data/measured/` – the measurement results the app reads
- `js/timelapse.js` – loads the passes of one repeat track, splits the
  polarisation channels and describes a point history in plain statements
- `js/stories.js` – the curated stories (places and explanations only)
- `js/chart.js` – the HH/HV history chart
- `js/replay/replay.js` – event replay templates and player
- `js/replay/sources.js` – per-event data: shaking contours, nearby quakes,
  agency outlines, daily fire detections
- `js/replay/mvt.js` – small vector-tile reader for the fire detections
- `js/search.js` – fuzzy event search and place lookup
- `js/news.js` – press coverage per event
- `js/narrative.js` – the plain-text account of an event with its source
  links, the one-line NISAR summary and the event timeline
- `js/sound.js` – plays a time-lapse as notes
- `tools/smoke.js` – browser smoke test against the live services
- `docs/HANDOFF.md` – where the project stands and how to continue it
- `js/globe.js` – the globe the app talks to
- `js/engine/` – our own globe engine on three.js
  - `tiles.js` – streams map tiles, shapes terrain, composites layers,
    animates flood water and cross-fades pictures
  - `marks.js` – event dots and beams, lines, storm spiral, atmosphere, stars
  - `fire.js` – the wildfire particle system
  - `controls.js` – pan, zoom, tilt, turn and fly-to camera
  - `geo.js` – coordinate maths
- `js/orbit.js` – NISAR's live position, ground track and swath edges
- `js/sky.js`, `js/stars-data.js` – the real star sky, the Sun and the
  shooting stars
- `js/wildlife.js` – GBIF sightings by month, and the ocean landmarks
- `vendor/satellite.es.js` – satellite.js 5.0 (MIT), the SGP4 orbit model
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
NISAR orbit elements: CelesTrak (fallback: tle.ivanstanojevic.me), propagated
with satellite.js. Stars: Yale Bright Star Catalogue, 5th edition (Hoffleit &
Warren), public domain. Wildlife sightings: GBIF.org and the datasets it
publishes, each credited in its record's panel.

## Measuring with NISAR

The previews are pictures for people: 8-bit, contrast-stretched and reduced
in resolution. To measure, `tools/measure.py` reads the full-resolution
GCOV products (terrain-corrected gamma-naught backscatter) instead. For each
site in `tools/measure_sites.json`, it:

1. finds every NISAR pass over the site and keeps the repeat track, frame
   and polarisation mode with the most passes;
2. reads only a small window around the site from each file (a few MB, not
   the whole 1–5 GB file);
3. computes the mean backscatter in dB within a small circle, pass by pass;
4. maps the change in dB between a "before" and an "after" pass;
5. writes the results to `data/measured/`, where the app picks them up.

To run it, you need a free NASA Earthdata login
(https://urs.earthdata.nasa.gov/users/new) and Python 3:

```bash
pip install earthaccess h5py numpy pyproj pillow
python tools/measure.py --list aletsch     # which tracks cover the site
python tools/measure.py aletsch perito-moreno
```

Then commit the new files in `data/measured/`. Check each change map in the
app: if the measurement point is not on the feature (ice, water, a field),
move it in `tools/measure_sites.json` and run the site again.

`python tests/test_measure.py` checks the script on simulated files with
the same layout as real GCOV products.

## How honest the pictures are

- NISAR records in several polarisation modes, and the preview colours mean
  different things in each. The app reads each pass's mode from its name,
  labels the channels accordingly (HH/HV, VV/VH, or one channel), and never
  mixes modes in a time-lapse or a before/after pair.
- Stories contain no typed-in measurements. Their numbers come from the
  passes loaded at that moment, by fixed rules: highest, lowest and latest
  value of each channel with dates, and where the channels sit furthest apart.
- Explanations of cause are marked as hypotheses.

- Replays never draw anything between data points without saying so; the
  panel lists each element with its source and whether it is observed,
  agency analysis or computed here. Decoration is named as decoration: the
  shape and shimmer of a fire's glow and its smoke, the ripples and edge waves of flood
  water, the height of the ground ripple and the look of the storm spiral
  follow fixed rules and are not measurements.
- The NISAR change view is computed in the browser from NASA's 8-bit preview
  images, not the full-resolution products. It ignores differences that a
  two-pixel offset between the images would explain, and it marks where to
  look rather than measuring anything. The source images stay one click away.
