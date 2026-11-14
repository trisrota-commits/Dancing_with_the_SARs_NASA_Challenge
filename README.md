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

## Run it

It is a static site with no build step and no keys. It needs Python 3 to
serve the files and internet access, because the globe library and all data
load from public servers at runtime.

- Windows: double-click `start.bat`.
- macOS or Linux: run `./start.sh`.

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
- `js/globe.js` – the CesiumJS globe
- `js/main.js` – wiring and panels
- `docs/DATA_SOURCES.md` – survey of every data source and what is reachable

## Data and credits

NISAR data: NASA/ISRO, distributed by the Alaska Satellite Facility DAAC.
Tiles: NASA GIBS. Events: USGS, NASA EONET, GDACS. Basemap: Esri World Imagery.
Globe: CesiumJS.
