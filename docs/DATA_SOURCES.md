# Data source survey

Checked 2026-11-13 from a cloud container. "Browser-ready" means the endpoint
answered without a login and sent an `Access-Control-Allow-Origin` header, so a
static web page can call it directly with no backend.

## Challenge resource links

| Link | What it is | Live access | Login |
|---|---|---|---|
| search.earthdata.nasa.gov | Web UI over NASA's CMR catalogue | **Yes**, via the CMR API (below) | No for search |
| search.asf.alaska.edu | Web UI (Vertex) over the ASF archive | **Yes**, via the ASF search API (below) | No for search |
| nisar-docs.asf.alaska.edu | NISAR product documentation | Docs only; points to Worldview/GIBS, `asf_search`, `earthaccess`, HyP3 | – |
| earthdata.nasa.gov/learn/… (basics, SAR) | Background reading | Docs only | – |
| earthdata.nasa.gov/data/projects/arset | ARSET training catalogue | Docs only | – |
| science.nasa.gov/mission/nisar/arcgis-storymaps | NISAR story maps | Docs only, good for story text | – |
| science.nasa.gov/mission/nisar/societal-benefits | NISAR application areas | Docs only | – |
| uavsar.jpl.nasa.gov/education/postcards.html | ~15 static UAVSAR example images | Static images only; UAVSAR scenes are searchable through the ASF API | No |
| donnees-data.asc-csa.gc.ca (RCM, RADARSAT-1) | Canadian Space Agency open-data portal | **Unreachable from this container** (connection dropped, cause unknown). Public AWS buckets `rcm-ceos-ard` and `radarsat-r1-l1-cog` do respond | No for the buckets |
| github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial | CSA Jupyter tutorial | Reference only | – |
| catalogos.conae.gov.ar (SAOCOM) | Argentine L-band SAR catalogue | Search and thumbnails are open in their web UI; no documented public API found; downloads need registration and a licence | Yes for data |
| argentina.gob.ar news item | Announcement about SAOCOM archive access | Reference only | – |

## NISAR: what is actually available

All of this is served by ASF. Search needs no login; full-resolution HDF5
downloads redirect to Earthdata Login.

| Product | Granules | Date range | Typical size | Public preview PNG |
|---|---|---|---|---|
| Urgent Response L2 (`NISAR_UR_L2`) | 6,677 | 2026-06-17 → 2026-11-13 | ~1.9 GB | Yes |
| GCOV validated (`NISAR_L2_GCOV_V1`) | 13,064 | 2026-10-21 → 2026-11-11 | ~5 GB | Yes |
| GCOV provisional | 163,672 | 2025-10-29 → 2026-10-21 | ~0.9 GB | Yes |
| GCOV beta | 23,527 | 2025-10-12 → 2026-01-20 | ~1.1 GB | not checked |
| GUNW (interferogram) provisional + validated | 94,290 | 2025-10-29 → 2026-10-09 | ~0.8–1.3 GB | Yes |
| GOFF (pixel offsets) provisional | 27,717 | 2025-10-29 → 2026-10-09 | ~1.1 GB | not checked |
| SME2 (soil moisture) provisional | 103,943 | 2025-10-29 → 2026-10-21 | ~24 MB | No |
| GSLC, RSLC and other L1 | 160k+ each | from 2025-10 | 3–8 GB | not checked |

The newest Urgent Response granule was acquired 2026-11-13 00:40 UTC and
published about eight hours later, so "live" for NISAR means a lag of hours to
two days.

### Three ways to get NISAR into a browser without a login

1. **NASA GIBS tiles** – `NISAR_L2_Geocoded_Polarimetric_Covariance`, a daily
   false-colour backscatter layer, 2026-04-01 → 2026-11-10, down to 15.6 m.
   Drapes directly onto a globe as a tile layer.
   `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/{date}/15.625m/{z}/{y}/{x}.png`
   (also in `epsg3857` with `GoogleMapsCompatible_Level13`). Companion layers:
   `OrbitTracks_NISAR_Ascending` / `_Descending` (vector tiles, daily to today).
2. **Per-granule browse images** – every GCOV/GUNW granule lists PNG previews
   (`_LATLON.png`, a thumbnail, and one per polarisation such as `_A_HHHH`,
   `_A_HVHV`) plus a KML holding the four corner coordinates. A 1948×1926 px
   sample was 1 MB. These can be placed on the globe as image overlays, and two
   dates of the same track/frame give a before/after pair.
3. **Granule metadata** – footprint polygon, time, track, frame, polarisations
   and direction for every granule, from either API below.

### Search APIs (both browser-ready)

- CMR: `https://cmr.earthdata.nasa.gov/search/granules.umm_json?short_name=NISAR_UR_L2&point={lon},{lat}&temporal={start},{end}&sort_key=-start_date`
  (also `bounding_box=`, `polygon=`, and a STAC endpoint at `/stac/ASF`).
- ASF: `https://api.daac.asf.alaska.edu/services/search/param?dataset=NISAR&processingLevel=GCOV&intersectsWith=POINT({lon} {lat})&output=geojson`
  – the same API also searches UAVSAR, Sentinel-1 and OPERA products.

## Live event feeds to cross-reference (not on the challenge list)

All browser-ready, no key.

| Feed | Content | Snapshot on 2026-11-13 |
|---|---|---|
| NASA EONET v3 `eonet.gsfc.nasa.gov/api/v3/events` | Curated natural events with coordinates and source links | 500+ open events, almost all wildfires, plus storms and sea ice; newest 2026-11-12 |
| USGS `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson` | Earthquakes, updated every minute | 108 M4.5+ in the past week |
| GDACS `gdacs.org/gdacsapi/api/events/geteventlist/SEARCH` | Disaster alerts with severity: earthquakes, floods, cyclones, wildfires, volcanoes, drought | 100 events: 74 wildfire, 20 earthquake, 5 flood, 1 cyclone |
| Smithsonian GVP `volcano.si.edu/news/WeeklyVolcanoRSS.xml` | Weekly volcanic activity report | reachable (no CORS check done) |
| NASA FIRMS | Active-fire hotspots | Unreachable from this container; also needs a free map key |

## Context layers on GIBS (same tile scheme, no login)

- `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` – radar-derived surface water, daily to today
- `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1` – C-band backscatter to compare with NISAR L-band
- `OPERA_L3_DIST-ALERT-HLS_Color_Index` – vegetation disturbance alerts
- `SMAP_L4_Analyzed_Surface_Soil_Moisture`, MODIS/VIIRS flood layers, Blue Marble and daily true-colour imagery

## Not usable live

- NISAR full-resolution HDF5 (login, 1–8 GB each) – offline processing only.
- SAOCOM data – registration, licence, no public API found.
- CSA portal and EODMS STAC (503) – could not be evaluated from here.
