# Submission text

Text for the NASA Space Apps Challenge 2026 project page, challenge
"Dancing with the SARs". Each section below matches one field of the
form. Lines in [square brackets] are for the team to fill in or decide;
everything else can be pasted as it is.

Everything stated here was checked against the code and the commit
history on 14 November 2026. If the app changes, change the text.

---

## Project name

Dancing with the SARs: a live globe of Earth's changing surface, seen by NISAR

## High-level summary

Radar satellites see the ground through cloud, smoke and darkness, but a
radar picture means little to most people. Our app puts the NISAR radar
mission on a 3D globe next to the natural events the world's agencies
report as they happen: earthquakes, fires, floods, storms, volcanoes.
Click an event and you see what NISAR saw there before and after, what
changed between the two passes, and a labelled hypothesis of why. Click
any other spot on Earth and you get a NISAR time-lapse of it. Every
number is computed from the data, every source is one click away, and
nothing needs a login, a key or an installation.

## Link to the project

[Team: the GitHub Pages address once hosting is switched on, and the
repository: https://github.com/trisrota-commits/Dancing_with_the_SARs_NASA_Challenge]

## Link to the demo

[Team: the 30-second video or the slides]

## Project details

### What it does

- **Events meet radar.** Three live feeds (USGS, NASA EONET, GDACS) are
  merged into one set of events on a globe with real terrain. Every event
  NISAR has imaged carries a teal ring. The opening card offers the
  strongest recent event that NISAR has flown over, one click away.
- **Before and after.** An event opens on a timeline that runs from
  before the event to now, with NISAR's passes marked on it. Dragging the
  timeline puts the radar picture of each pass on the ground. "Show what
  changed" colours where the echo got weaker or stronger between the two
  passes either side of the event.
- **A hypothesis, labelled as one.** For an event with a pass before and
  a pass after, the app says how each of the two radar channels moved and
  what that pattern is typical of, by fixed rules of thumb. It never
  presents a cause as a fact.
- **Ground movement.** An earthquake with a pair of passes either side of
  it gets NISAR's interferogram, with a key that says what one colour
  cycle means.
- **A time-lapse for any place on Earth.** Click the ground or search a
  place: the newest NISAR pass is on the globe at once, and every pass of
  that repeat track is a mark on the same timeline an event has. Drag it
  back or play it once, in the colour composite or in one channel, with a
  chart of both channels over time.
- **Five stories and 33 changing places.** Glaciers, sinking cities,
  wetlands, forest clearing, farming seasons, volcanoes and moving
  slopes: slow change that no event feed reports. Each explains what to
  look at, why it happens, which polarisation shows it and what a camera
  would miss.
- **Two wavelengths side by side.** NISAR's L-band on the left of a
  divider, Sentinel-1's C-band on the right, for the same days.
- **The whole 12-day cycle on the globe.** NASA's daily NISAR map layer
  is on from the start, stacked over the mission's full repeat cycle,
  with NASA's own colour description beside it.
- **NISAR itself, live.** The satellite's real position, its orbit, the
  edges of its radar swath, and an estimate of its next pass over any
  event, labelled as computed.

### Who it is for

Anyone. The challenge asks for a broad audience, so the app uses plain
words, folds detail away until it is asked for, and explains every mark
it draws in a key on the screen. Nobody has to present it: a judge, a
student or a journalist can open it alone and understand it.

### How it stays honest

- Numbers and dates are computed from the data when the page is open.
  None is typed in.
- Every part of an event's timeline is labelled **observed** (measured
  or catalogued), **analysis** (worked out and published by an agency) or
  **computed** (drawn here by a stated rule), with its source.
- Animation that is not data is named as animation: the shimmer of a
  fire, the ripples on flood water, the look of a storm's cloud spiral.
- The change view is computed in the browser from NASA's 8-bit preview
  pictures, not from the full-resolution products. The app says so; it
  marks where to look and does not claim to measure.
- NISAR records in several polarisation modes. The app reads each pass's
  mode, labels the channels accordingly and never mixes modes in one
  comparison.
- Colours follow written rules taken from NASA where NASA has them
  (`docs/VISUAL_RULES.md`): NASA Earth Observatory's colour guidance, the
  NISAR picture convention, and the colours USGS, GDACS and NASA give
  their own data.

### How it works

- A static website: HTML, CSS and JavaScript modules, no build step, no
  server of our own, no keys. All data loads in the browser from public
  services at the moment it is needed.
- The globe is our own engine on three.js, written for this workload. A
  quadtree streams only the map tiles the camera needs, shapes them into
  real terrain and composites every active layer into one small canvas
  per tile, so the graphics card draws one mesh per tile whatever is
  switched on. A frame is drawn only when something changed.
- Radar layers are thin strips on an empty globe. One whole-world picture
  per day tells the engine where there is anything, so it never asks for
  empty tiles. Tiles and pictures are kept in the browser between visits,
  and a fingerprint per day tells when NASA has added data.
- Every radar tile is checked before it is drawn. While testing we found
  that NASA's tile service sometimes sends damaged pictures for freshly
  added days; the engine then takes that tile from NASA's map service,
  which draws the same data on request.
- A tool for calibrated measurements (`tools/measure.py`) reads a small
  window of NISAR's full-resolution GCOV products and computes
  backscatter in dB over time and between two passes. A scheduled job on
  GitHub is set up to run it for the strongest recent events.
  [Team: this job has not yet run on real NISAR files. If it has run by
  the time you submit, say what it produced. If not, keep this sentence:
  "It is built and tested on simulated files; it has not yet been run on
  real products."]
- 24 unit tests and a browser test against the live services guard the
  rules above.

### Tools and languages

JavaScript (ES modules), GLSL shaders, HTML and CSS; three.js r170;
satellite.js 5.0 (SGP4 orbit model); Python 3 with earthaccess, h5py,
NumPy, pyproj and Pillow for the measuring tool; Node.js test runner and
Playwright for tests; GitHub Actions and GitHub Pages.

### What we would do next

Run the calibrated measurements on real products and show them beside
the preview-based change view; add NISAR's soil-moisture and
pixel-offset products; translate the texts.

## How we made it

We built the app during the hackathon weekend, on Saturday 14 and Sunday
15 November 2026. The repository was opened the afternoon before, on 13
November, with a licence file and a written survey of which data sources
can be reached from a browser (`docs/DATA_SOURCES.md`). The first line
of the app was committed on 14 November. The full history is public in
the repository.

The whole team did the research: reading the challenge brief and its
resource list, NISAR's product documentation, and the feeds and map
services of each agency, and deciding which of them the app may rely on.
All three of us worked in the same repository, each on our own branches,
and every part went into the app through a pull request (see "Team" at
the end for who brought what).
[Team: add a sentence on research that left no trace in the repository,
if you want it named.]

The team set the rules the app follows (accuracy first, proof one click
away, nothing unexplained on screen), decided what to build and what to
leave out, and tested every version by hand on a Windows PC and a Mac.
Hands-on testing changed the app more than once: a video of flickering
squares over Colorado led us to the damaged tiles from NASA's tile
service and to the check described above.

The code was written with an AI coding assistant under the team's
direction; see the next section.

## Use of artificial intelligence

We used AI to build this project and we say so plainly.

- **What we used.** Claude Code, an AI coding assistant made by
  Anthropic, used by members of the team in their own sessions.
  [Team: add any other AI tool anyone used, for example for
  research, the video or the slides, and what for. If none, delete this
  bracket.]
- **What it did.** It wrote most of the code, the tests and the
  technical documentation in the repository, and ran the checks against
  the live data services. Its commits are marked as such in the public
  history.
- **What the team did.** The research, the choice of data, the rules for
  accuracy and for the visual language, every decision about what the
  app shows and how, and the hands-on testing of every version.
- **How its work was checked.** Each change went through a pull
  request, merged by the project lead or, on the lead's standing
  instruction, by the assistant once its checks had passed. Facts about
  data sources were tested against the live services before the app
  relied on them. The app's statements are checked by automated tests.
  Where something could not be verified, the documentation says so
  (`docs/HANDOFF.md`).
- **No AI in the running app.** The app does not call any AI model.
  Its sentences are fixed templates filled from data, and its hypotheses
  come from fixed, written rules.
- **No AI-generated images, video or sound.** Every picture on the globe
  comes from the data sources listed below. The event animations are
  drawn by our own code from that data, and the app labels what is
  animation.
- **No NASA branding** was created or altered with AI.

## NASA data and resources

**NISAR (NASA and ISRO), distributed by the Alaska Satellite Facility DAAC**

- NISAR L2 GCOV, geocoded polarimetric covariance (backscatter):
  validated (`NISAR_L2_GCOV_V1`), provisional and Urgent Response
  (`NISAR_UR_L2`) products. Used: the preview pictures and corner files
  of each pass, and the product metadata (time, track, frame,
  polarisation, footprint). The full-resolution files are read only by
  the measuring tool.
- NISAR L2 GUNW, geocoded unwrapped interferograms: validated and
  provisional. Used: preview pictures and metadata.
- NISAR documentation at ASF, including "NISAR in Worldview" for the
  colour convention of the map layer: https://nisar-docs.asf.alaska.edu/

**NASA Common Metadata Repository (CMR)**

- Granule search for all NISAR products:
  https://cmr.earthdata.nasa.gov/search/

**NASA Global Imagery Browse Services (GIBS)**, tile service, map
service and legend pictures: https://gibs.earthdata.nasa.gov/

- `NISAR_L2_Geocoded_Polarimetric_Covariance` (daily NISAR backscatter)
- `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1` (C-band
  backscatter)
- `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` (surface water from
  radar)
- `OPERA_L3_DIST-ALERT-HLS_Color_Index` (vegetation disturbance alerts)
- `VIIRS_NOAA20_Thermal_Anomalies_375m_All` (fire detections, vector
  tiles)
- `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (yesterday in true
  colour)
- `BlueMarble_ShadedRelief_Bathymetry` (Blue Marble basemap)
- `VIIRS_Black_Marble` (city lights at night)
- `SMAP_L4_Analyzed_Surface_Soil_Moisture`
- `IMERG_Precipitation_Rate`
- `GHRSST_L4_MUR25_Sea_Ice_Concentration`
- `MODIS_Terra_L3_NDSI_Snow_Cover_Daily`
- `MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual`
- `Agricultural_Lands_Croplands_2000`
- `GPW_Population_Density_2020`
- `Landsat_Human_Built-up_And_Settlement_Extent`

**NASA EONET** (Earth Observatory Natural Event Tracker), version 3:
events and storm tracks. https://eonet.gsfc.nasa.gov/

**NASA Earthdata Login and the `earthaccess` library**, for the
measuring tool only: https://urs.earthdata.nasa.gov/

**NASA Earth Observatory, "Subtleties of Color"** (Robert Simmon, 2013),
the guidance our colour rules follow:
https://science.nasa.gov/blogs/earth-matters/2013/08/12/subtleties-of-color-part-3-of-6/

**NASA ITS_LIVE** (glacier speeds), linked from the glacier places:
https://its-live.jpl.nasa.gov/

**Challenge resources we read:** NASA Earthdata Search, ASF Data Search
(Vertex), the Earthdata introductions to SAR, the ARSET training
catalogue, the NISAR story maps and the NISAR societal-benefits pages.

## Space agency partner data and resources

- **ISRO** (Indian Space Research Organisation): NISAR is a joint NASA
  and ISRO mission; all NISAR data above.
- **ESA and the European Commission (Copernicus)**: Sentinel-1 C-band
  radar, used through NASA's OPERA products on GIBS for the comparison
  of two wavelengths and for surface water.
- **JAXA**: the IMERG rainfall layer comes from the joint NASA and JAXA
  Global Precipitation Measurement mission.
- **Canadian Space Agency and CONAE (Argentina)**: we examined the
  RADARSAT and SAOCOM resources on the challenge list. They are not used
  in the app: the Canadian portal did not answer our requests, and the
  Argentine catalogue needs registration and has no documented public
  interface.

## Other data, services and software

**Events and hazards**

- USGS Earthquake Hazards Program: real-time GeoJSON feeds, the event
  catalogue (FDSN event service) for quakes near an event, ShakeMap
  intensity outlines, and the PAGER and "Did You Feel It?" facts carried
  in the feeds. https://earthquake.usgs.gov/
- GDACS (Global Disaster Alert and Coordination System, United Nations
  and European Commission): alerts, alert levels and per-event shapes
  such as wind zones and affected areas. https://www.gdacs.org/
- NOAA: the NOAA-20 satellite, whose VIIRS instrument makes the fire
  detections and the true-colour picture (through NASA GIBS).

**Maps and navigation**

- Esri World Imagery (Esri, Maxar, Earthstar Geographics): the satellite
  basemap.
- Mapzen Terrain Tiles on AWS Open Data: elevation for the 3D terrain.
- Photon by komoot, built on OpenStreetMap data (© OpenStreetMap
  contributors): place search. https://photon.komoot.io/

**The satellite and the sky**

- CelesTrak: NISAR's orbit elements. https://celestrak.org/ (fallback:
  the TLE API at tle.ivanstanojevic.me)
- Yale Bright Star Catalogue, 5th edition (Hoffleit and Warren), public
  domain: the star positions.

**Life**

- GBIF, the Global Biodiversity Information Facility, and the datasets
  it publishes: wildlife sightings, each credited in its own panel.
  https://www.gbif.org/

**Further reading linked from the places**

- Randolph Glacier Inventory (GLIMS): https://www.glims.org/RGI/
- World Glacier Monitoring Service: https://wgms.ch/
- Global Forest Watch: https://www.globalforestwatch.org/
- Smithsonian Global Volcanism Program: https://volcano.si.edu/

**Software**

- three.js r170 (MIT licence): rendering.
- satellite.js 5.0 (MIT licence): the SGP4 orbit model.
- Python: earthaccess, h5py, NumPy, pyproj, Pillow (measuring tool).
- Node.js and Playwright (tests); GitHub Actions and GitHub Pages.
- Claude Code by Anthropic (AI coding assistant; see "Use of artificial
  intelligence").

Our own code is published under the MIT licence.

## Team

Three people built this, all in the public repository. What each brought
in is taken from its pull requests and issues.

- **LucidPaths**, project lead. Set the direction and the rules the app
  follows, decided what was built and what was cut, and tested every
  version by hand on a Windows PC and a Mac. Brought in the globe engine,
  the live events and their merging, the event timeline and the event
  animations, the NISAR time-lapse for any spot, the stories, the change
  view, the visual rules and the speed work, and integrated the
  teammates' branches.
- **trisrota-commits**, repository owner. Opened the repository.
  Contributed the check of whether a before-and-after comparison is
  possible for an event, the radar history that loads when an event is
  selected, and the explanations of radar change by kind of event.
  Proposed the countdown to NISAR's next pass and the live reports bar,
  both of which are in the app.
- **MadhuraSaha02**. Wrote up which data the challenge allows besides
  NISAR and the plan for the remaining gaps. Contributed the changing
  places (glaciers worldwide and other slow changes), the calibrated
  measuring tool and its display, more kinds of events, and the live
  NISAR satellite with its orbit, the real star sky and the wildlife
  sightings.

[Team: replace the GitHub names with the names you want on the project
page, correct anything above that is not how you see it, and add anyone
who took part without a GitHub account.]
