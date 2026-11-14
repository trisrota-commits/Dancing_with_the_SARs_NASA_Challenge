# Handoff

Written on Saturday 14 November 2026, mid-hackathon, so that anyone (a
teammate or a fresh AI session) can pick the project up without the chat
history. Read this first, then `README.md` and
`docs/DATA_RULES_AND_DEMO_PLAN.md`.

## What we are building

An entry for the NASA Space Apps Challenge 2026, "Dancing with the SARs".
The brief asks for an interactive application that uses NISAR radar data to
track and visualise surface change around the world, for a broad audience,
with storytelling and hypotheses about what causes the changes.

Our app is a 3D globe that shows natural events as they are reported,
cross-references each one with NISAR, replays what happened from data, and
lets anyone play a NISAR time-lapse for any spot on Earth.

**Deadline:** Sunday 15 November 2026, 23:59 (the project lead's local time).

## What the project lead wants

These came out of the conversation and override anything else in this file.

1. **Accuracy first.** The most accurate depiction and interpretation
   possible. Numbers and dates are computed from the data, never typed in.
   Hand-written text is allowed where it has to be (the choice of places,
   explanations), and explanations of cause are labelled as hypotheses.
2. **Proof stays in the app.** Every friendly visual keeps the source
   imagery one click away, so nobody can say we made things up.
3. **The animated globe is the "gamified" view.** On 14 November the lead
   settled this: there is no separate simple mode to build. Zooming into an
   event and getting proper animations about it is the game layer. Do not
   ask about "gamified" again.
   - **Look:** clean, dark and glowing. Light, small particles and soft
     smoke on the real terrain. Never drawn or cartoon shapes: the lead
     rejected flame-tongue sprites as ugly and style-breaking.
   - **Zoom:** coming closer adds finer detail in the same style; it never
     just enlarges what was there.
   - **Motion:** everything builds up and fades; nothing pops in or cuts.
4. **Stunning.** It should impress: real terrain, real effects, driven by
   real data. Our own three.js engine, fast.
5. **Low entry bar.** Foldable menus, plain words, search without keyword
   lists.

On 14 November the lead accepted a teammate's live NISAR satellite (real
position, orbit and swath edges), which reverses the earlier "no live
satellite". Real day and night are now on from the start.

Things the lead ruled out: a global time scrubber,
and making Google's photorealistic 3D tiles the core (they cannot take our
radar overlays easily, need a paid key and show one fixed date).

### The event card and the details panel (team decision, 14 Nov)

The team asked for less on screen, in a voice note the lead passed on:

- **Open the app:** globe and event points, little else. The left menu
  now opens with only Stories and Events unfolded.
- **Click an event:** a small card (`#card`, `renderCard` in `main.js`):
  title, when, size, the news about it (or what the feeds report when
  there is no press), one computed NISAR line, "Show details" and "Show
  the NISAR image". The image is not shown automatically: it is about
  1 MB and would cover the replay.
- **Show details:** the right panel. It starts with one plain text
  (`narrate` in `js/narrative.js`) built from fixed sentence templates,
  never free writing; sources in it are links (`.src`) that explain
  themselves on hover and open the matching folded section on click.
  Then a timeline of the event against NISAR's passes, then folded
  sections with NISAR first and open.
- The panel is always filled when an event is selected, even while shut,
  so the code that fills it did not change; only the pass-by-pass history
  waits for "Show details", because it downloads several previews.
- Stories, places and spots still open the panel directly.

### The event timeline replaced the replay (lead's decision, 14 Nov)

The looping "replay" was the least on-brief thing in the app: it drew
other missions' data (fire detections, Sentinel-1 water, USGS) and played
itself. The lead had it rebuilt under one question: what would a NASA
judge of this challenge need to see?

- An event opens on its **latest state and stands still**. No loop, no
  moving camera (the orbit and push-in were removed).
- The bar at the bottom is a **timeline in real dates**, from before the
  event to now. Drag it, use the arrow keys, or press play to run it once.
  "Latest" jumps back to now.
- **NISAR's passes are ticks on that timeline** (`timelinePasses` in
  `main.js`: one repeat track, the one of the best before/after pair). The
  radar picture of the newest pass up to the handle is on the globe by
  default (`syncNisar`), under the event data: the first one by the sweep,
  later ones by cross-fade. The card's button switches it off.
- Each template in `js/replay/replay.js` now returns `from`, `to` and
  `timeOf(ms)` besides `draw(t, started, ms)`. The earthquake's wave
  fronts are an `intro` played once on opening.
- An event the feeds say nothing more about still gets a timeline
  (`still()`), because NISAR's passes are shown on it.
- When the feeds bring new reports for the open event and the handle is at
  "Latest", the timeline is rebuilt without moving the camera.
- The NISAR time-lapse for a place still uses the looping player
  (`replay.run`); that one is NISAR's own time series and is started by
  the reader.
- Extras were demoted: decorations (shooting stars, ocean landmarks) are
  off until ticked, and the page's subtitle now names the subject.

### Ease of understanding (judge's walkthrough, 14 Nov)

Changes made after going through the app as a first-time visitor:

- **A key on the globe** (`setLegend` in `main.js`, `#legend`) whenever a
  radar picture, an interferogram or a change picture is up: what it is,
  what the colours mean, in plain words, with the channel names in small
  print. It follows the polarisation mode of the picture shown.
- **"Show what changed" on the event card** when two comparable passes
  exist: the change colours go over the newer radar picture and the
  timeline stays (`toggleCardChange`).
- **Stories put the data right after "What to look at"**, and the
  time-lapse box leads with the picture controls and the chart; the fine
  print follows.
- **The timeline has a key** (the event, a NISAR pass, "drag to go back").

### Focus layout and the code review (14 Nov, night)

The lead asked for a critical pass over the code by four reviewers (state
and flows, the timeline player, engine speed, ease of use) and proposed
the layout below. Both went into one pull request.

- **Layout.** The left menu is open when the app starts (stories, events,
  search). Selecting an event, place or spot folds it away and the card or
  the details panel takes the stage; closing the selection brings the
  menu back. The ☰ button always opens it, and a menu opened by hand
  stays open (`focusLayout`, `menu = { folded, byHand }` in `main.js`).
  The trigger is selection, never zoom level.
- **Stepping back.** ✕ on the details panel and Escape return to the
  card; ✕ on the card or a second Escape clears the selection (`stepBack`).
- **Who owns the picture on the globe.** Six things can put a radar
  picture on the globe, and they used to overwrite each other silently.
  `main.js` now has one owner at a time: `stage = { owner, token }` with
  owners `none`, `timeline`, `manual`, `change`, `compare`, `chart` and
  `lapse`. Every path calls `take(owner)` first, which clears the previous
  owner's pictures, legend, divider and button labels, and returns a
  token. Anything asynchronous checks the token before it draws.
  `backToTimeline()` hands the globe back to the event's timeline. Use
  these two; do not call `globe.clearScenes()` directly for a new feature.
- **Timeline player.** A feed refresh rebuilds the open event's plan in
  the background and swaps it in (`Replay.start(inc, { keepView: true })`)
  instead of restarting it. Requests for a closed event are aborted
  (`useSignal` in `sources.js`, 15 s timeout). Fire and flood windows
  follow the event's own dates, so an archive event no longer shows the
  last few weeks. Published outlines are off while the handle stands
  before the event (`outlines()` helper). Storm time is a 0..1 fraction.
- **Speed.** See "A frame is only drawn" below. Also: tile painting stops
  after 6 ms per frame; `setPictures` repaints only the tiles under the
  old or new pictures; a tile's second and water canvases are released
  when unused and emptied when a tile is dropped; phones get smaller
  caches and a pixel ratio of at most 1.5; dry ground skips the water
  wave maths; effect lines no longer show through the Earth.
- **Left alone on purpose:** track and frame numbers and the product
  names (GCOV, GUNW, HDF5) stay in the details panel, because that panel
  is the proof layer and a NASA reader needs them to find the granule;
  the phone header still drops the subtitle for lack of room; "Load all
  passes" is not capped on phones because it is opt-in and states its
  size; `main.js` was not split so close to the deadline.

### The awards the lead is aiming at (told 14 Nov)

Space Apps gives these across all challenges: Best Use of Science, Best
Use of Data, Galactic Impact, Most Inspirational. Weigh further work
against them, not only against this challenge's text.

- **Data** is our strongest lane: live NISAR for anywhere, no login,
  readable by a newcomer.
- **Science** rests on the observed / computed / hypothesis labelling and
  on calibrated numbers, which still wait on a teammate's run of
  `tools/measure.py`. `channelReading` in `js/narrative.js` adds a
  rule-of-thumb reading of how the two radar channels moved between the
  pass before an event and the one after, labelled as a hypothesis; the
  event type plays no part in it.
- **Inspiration** is the first ten seconds: the opening card (`#welcome`)
  says what the app is about and offers "Start with a story".
- **Impact:** every event's text ends with one hand-written line on who
  could use NISAR there (`WHO_USES` in `js/config.js`), badged "Our view";
  stories have "Who could use this, and for what". The award itself will
  turn more on the pitch and on the app being online than on this text.
- **Onboarding** is the opening card with three steps and "Start with a
  story". The lead and I agreed against a guided tour.
- **Feature freeze agreed 14 Nov:** after this, testing by hand, a phone
  pass, hosting and the submission come before anything new.

Tried and dropped: a human-driver story on the GERD reservoir or on forest
clearing in Rondônia. At the two points checked per site the pass-by-pass
values showed no clear, one-directional change, so no story was written.
A better point would have to be found by eye first.

## How we work

- **Branch:** all our work goes on `claude/peaceful-curie-4pexs2`, then a
  pull request into `main`, merged with a merge commit. After each merge the
  branch is fast-forwarded to `main`. The lead has asked for PR and merge
  each time a batch is done.
- **Teammates** open PRs and issues as requests. We integrate them: merge
  their branch into ours (their commits keep their authorship), resolve
  conflicts keeping both sides, test, PR to `main`, merge. Their PR then
  shows as merged. Comment on their PR or issue saying what was integrated,
  what was changed and what was not verified. Every GitHub comment ends
  with the "Generated by Claude Code" footer.
- **Check for new PRs and issues regularly**; teammates add them while we
  work. Teammates so far: `trisrota-commits` (repo owner account) and
  `MadhuraSaha02`.
- **Do not create a PR, merge, or close something unless the lead asked.**
  So far the lead has asked every time.
- **Report honestly.** Say what was tested and how, and what was not.

### Practical notes for an AI session

- The project lead tests on a Mac and wants a fresh zip of `main` after
  each batch (`index.html css js vendor data docs tests tools README.md
  LICENSE .nojekyll start.bat start.sh start.command`), sent as a file, plus
  a few screenshots of what changed.
- The lead writes casually and trusts our judgement; keep replies plain,
  lead with the result, and always say what was not verified.
- This session can push only to `claude/peaceful-curie-4pexs2`. It cannot
  delete branches; merged teammate branches were flagged in PR comments for
  someone to delete by hand.
- The merge tool needs the full 40-character commit ID of the branch head.
- After merging a teammate's branch into ours and landing it, their PR shows
  as merged on its own; if they pushed again in the meantime, merge again.
- The local server (`python3 -m http.server 8765`) stops when the container
  restarts; start it again before running `tools/smoke.js`.
- Headless tests need `--use-gl=swiftshader` and the proxy setting; both are
  in `tools/smoke.js`. A page-level `history` name clash once broke share
  links, so run the smoke test after touching `js/main.js`.
- Charts follow the dataviz rules: one axis, validated series colours
  (`#d55181` co-polarised, `#0ca30c` cross-polarised on the dark panel),
  crosshair tooltip, direct labels, table view.

## How to run and test

- No build step. Serve the folder and open it: `start.command` (macOS),
  `start.bat` (Windows), `./start.sh` (Linux), or
  `python3 -m http.server 8765` then `http://localhost:8765`.
- Opening `index.html` from disk does not work (ES modules need a server).
- `node --test tests/*.test.mjs` runs the unit tests (15).
- `python tests/test_measure.py` checks the measurement script on simulated
  files (needs `pip install h5py numpy pyproj pillow`).
- `node tools/smoke.js` loads the app in headless Chromium against the live
  services and checks the main paths. It needs Playwright and a server on
  port 8765. In a proxied cloud container set `HTTPS_PROXY`; headless
  rendering there is software-only, so frame rates are not representative.
- `node tools/frames.js` counts the frames the globe really draws, at rest
  and with the strongest live event of each kind open. About one a second
  at rest and on an earthquake that has played out; steady drawing with
  fire or flood water on the globe. Run it after touching `Globe.frame`.
- `window.app` in the browser console exposes `state`, `globe` and `replay`.

## Architecture

Static site: `index.html`, `css/style.css`, ES modules in `js/`, three.js
r170 vendored in `vendor/`. Everything loads from public servers at run
time; there is no backend and there are no keys.

| File | Role |
|---|---|
| `js/main.js` | All wiring and panels. Large; search it rather than read it. |
| `js/config.js` | Event categories, feed and archive URLs, map layers, radar notes |
| `js/feeds.js` | USGS, NASA EONET, GDACS: fetch and normalise; archive loader |
| `js/incidents.js` | Merges reports of one event; links nearby events |
| `js/nisar.js` | NASA CMR search for NISAR scenes, pairs, history, next pass, polarisation modes |
| `js/change.js` | "What changed" between two NISAR passes |
| `js/timelapse.js` | Loads passes of one repeat track, splits channels, describes a point history, ranks tracks by coverage |
| `js/chart.js` | The HH/HV history chart |
| `js/stories.js` | Five curated stories (places and explanations only) |
| `js/places.js` | 33 "changing places" in eight kinds (teammate) |
| `js/measured.js` | Shows calibrated measurements from `data/measured/`: card, dB chart, change map (teammate) |
| `tools/measure.py` | Offline: makes those measurements from full-resolution NISAR files; sites in `tools/measure_sites.json` (teammate) |
| `js/replay/replay.js` | Event replay templates and the player |
| `js/replay/sources.js` | Per-event data: shaking contours, nearby quakes, agency outlines, fire detections |
| `js/replay/mvt.js` | Vector-tile reader for the fire detections |
| `js/search.js` | Fuzzy event search and place lookup |
| `js/news.js` | Press coverage per event |
| `js/narrative.js` | Plain-text account of an event with source links, one-line NISAR summary, event timeline |
| `js/sound.js` | Plays a time-lapse as notes |
| `js/orbit.js` | NISAR's live position, track and swath edges from public orbit elements (teammate) |
| `js/sky.js`, `js/stars-data.js` | Real star sky, the Sun, shooting stars (teammate) |
| `js/wildlife.js` | GBIF wildlife sightings by month, ocean landmarks (teammate) |
| `js/globe.js` | The globe the app talks to |
| `js/engine/tiles.js` | Tile streaming, terrain, layer compositing |
| `js/engine/controls.js` | Camera: pan, zoom, tilt, turn, fly-to |
| `js/engine/marks.js` | Dots, lines, storm vortex, atmosphere, stars |
| `js/engine/geo.js` | Coordinate maths |

### Engine ideas worth knowing

- The globe is a unit sphere; tiles are Web Mercator (XYZ).
- Each visible tile composites every layer, radar picture and outline into
  one 256 px canvas, so the GPU draws one mesh per tile. That is why radar
  drapes over terrain and why adding layers costs no draw calls.
- "Sided" layers and pictures show only left or right of the divider; a
  tile then gets a second canvas and the shader picks by screen position.
- Terrain heights come from Mapzen Terrarium tiles; one elevation tile
  serves an 8×8 block of map tiles. Sea floor is flattened to sea level.
- A frame is only drawn when something changed (`globe.dirty`, tile
  changes, camera moves) or while something on the globe moves by itself:
  fire, a storm's clouds, flood water, a flickering glow, a mark popping
  in, a new arrival's pulse, and the selection ring for 4.5 s after a
  selection (it then rests). The list is in `Globe.frame` (`alive`).
  There is no `globe.animating` flag any more; a playing timeline marks
  the globe dirty each tick. Check with the frame counter described
  under "How to run and test" before adding anything that animates.
- Replay effects (added 14 Nov, afternoon): `globe.setShockwave` drives
  uniforms in the tile shader (glow per pixel, ripple per vertex);
  `Vortex` is a world-sized quad with a procedural cloud shader, floating
  at cloud-top height; `Glow` is additive points with a true ground size
  (fire embers, the epicentre flash); `Beams` are the light beams on event
  dots, scaled by `shared.uBeam` from camera tilt and distance. (The slow
  camera orbit and push-in were removed with the replay.)
- Level of detail and smooth build-up (added 14 Nov, evening). The lead's
  rule: effects gain detail as you zoom in, and nothing pops.
  - `js/engine/fire.js`: one instanced particle system per fire. Each
    detection has a `born` time on the replay clock; the shader fades it
    in, burns it and cools it, so scrubbing needs no new buffers. Detail
    is chosen in the vertex shader from the on-screen size of the 375 m
    detection pixel: a small ember from afar, then a soft spot at true
    size, deep red at the centre through orange to amber at the rim, with
    a fine shimmer, a pin of light on the exact coordinates and a little
    thin smoke. This spot look is the one the team chose on 14 Nov, after
    rejecting flame-tongue sprites and then ember veins; do not add
    shapes back.
  - Flood water: layers with a `mask` step are painted into a per-tile
    mask (`paintMask`; red = water, green = step first seen). The tile
    shader animates ripples (two wave sizes picked from screen-space
    derivatives, so detail follows zoom), edge waves and the fade-in.
  - `globe.fadeTo` cross-fades radar pictures using the second tile canvas;
    each tile times its own fade from when it was repainted (`uFadeAt`).
  - Later quakes pop in through the `pop` time on a dot.
- Added after the lead's answers on 14 Nov (keep these small; the lead
  warned against feature creep and deviating from the current style):
  - `globe.setLabels` / `js/engine/labels.js`: a few HTML data labels
    pinned to the globe (shaking level per outline, magnitude of the top
    later quakes from closer in, wind speed with a storm). Data only.
  - `globe.setFocus`: the tile shader dims and greys the map outside a
    replay's scene, mildly. Day and night shading eases back to a quarter
    while a replay or a radar picture is up (`globe.night`), because
    everything painted into the ground, radar included, was being dimmed
    on the night side.
  - `globe.sweepTo`: a single NISAR picture is uncovered along latitude in
    the pass direction (`uSweep`); `globe.fadeToAll` fades a stack of
    pictures, used for the "what changed" view.
  - Fire: soft spots only (see above).

## Data sources and what we learnt about them

All checked from a browser origin (CORS) unless noted.

| Source | Use | Gotchas |
|---|---|---|
| NASA CMR `granules.json` | NISAR scene search | No login for search. Entries are about 25 KB each uncompressed. |
| NISAR previews (ASF) | `_LATLON.png` plus `.kml` corners per scene | Public. Passes before about mid-June 2026 mostly lack public corner files, so they cannot be placed; we leave them out and say so. Iceland is an exception with a full year. |
| NISAR full HDF5 | Read offline by `tools/measure.py`, never by the app | Needs Earthdata login, 1 to 8 GB each; the script reads only a small window over HTTPS. Not yet run against real files. |
| NASA GIBS (EPSG:3857 tiles) | Basemaps, daily NISAR backscatter, context layers | Raster only on this endpoint. |
| NASA GIBS (EPSG:4326, `.mvt`) | VIIRS fire detections | Vector tiles are only served on the 4326 endpoint; tiles span 288°/2^z. |
| USGS feeds, FDSN query, ShakeMap `cont_mmi.json` | Earthquakes, nearby quakes, shaking contours | Fine. |
| NASA EONET v3 | Events and storm tracks | The full archive is 14 MB; we filter out wildfires. |
| GDACS | Alerts, per-event shapes, per-event news | List returns at most 100 events. |
| Mapzen Terrarium (AWS) | Elevation | Fine. |
| Photon (komoot) | Place search | Sometimes refuses; the app falls back to event matches. |
| GDELT doc API | News fallback | One request per 5 seconds; loose queries return unrelated news, so we keep only headlines naming the place. |
| NISAR observation plan (`NISAR_COP`) | Not used | Exists in CMR but files need a login, so the next-pass time is a labelled estimate. |

### Radar facts the code depends on

- **Polarisation modes.** The tenth field of a scene name gives the mode:
  `DHDH` (dual, HH and HV), `SHSH`/`SHNA` (single HH), `NASV` (single VV),
  `DVDV` (VV and VH), `QPDH` (quad). In dual previews red and blue carry
  the co-polarised echo and green the cross-polarised one; single-mode
  previews are one channel in grey. `polMode()` in `js/nisar.js` handles
  this. Never mix modes in a time-lapse or a before/after pair.
- **Repeat cycle:** 12 days, exact. Used for the next-pass estimate.
- **Interferogram colour cycle:** about 12 cm along the line of sight (half
  the 24 cm wavelength).
- Preview values are 0 to 255 brightness, not calibrated radar units, and we
  assume (unverified) that the scaling is the same from pass to pass.

## Honesty rules built into the app

- Replays label every element observed, analysis or computed, with source.
- The change view is computed from 8-bit previews, ignores differences a
  two-pixel offset would explain, and says it is a guide, not a measurement.
- The next-pass time is labelled computed and says an overpass is not a
  guaranteed acquisition.
- Stories and places label hand-written background as hypothesis or context.
- The reports bar says it is not an official warning service.
- News is labelled as press coverage, not data, and says how it was matched.

## Status

### Done and in `main`

Custom three.js globe with terrain and tilt camera; live event dots from
three feeds with merging and links; event replays (earthquake, storm,
wildfire, flood); NISAR lookup with before/after divider and the "what
changed" view; interferogram cards for earthquakes; NISAR time-lapse for any
spot with channel views, chart, computed facts and optional sound; five
stories; 33 changing places; search; reports bar; next-pass countdown;
archive time window back to 17 June 2026; Sentinel-1 offer; event history
chart; a "Why might this have changed?" explainer per event type; news per
event; share links; 12 grouped context layers; L-band
versus C-band divider; launchers for macOS, Windows and Linux; thirteen
event types (landslides, snow, dust and haze, extreme heat or cold and
human-made events have their own category); a "Measured with NISAR" card
that appears on a place, or an event nearby, once results exist.

### Known problems

- **No calibrated measurements exist yet.** `tools/measure.py` has only run
  on simulated files. Someone with an Earthdata login has to run it and
  commit `data/measured/`; until then the card never shows. See "Measuring
  with NISAR" in the README.
- **Event history chart: fixed 14 Nov.** It was often empty because the
  track with the most passes was chosen even when the place sat in the
  empty strip along the frame edge. `historyAt` now puts tracks that hold
  the place at least 12 km inside their frame first (`edgeMarginKm`), and
  `bestPair` prefers such pairs. Checked on one event (8 of 8 samples,
  where it had 1 of 8); other places may still have gaps.
- **Live satellite and wildlife are barely checked.** In the test container
  CelesTrak is unreachable and the fallback orbit source and GBIF answer
  slowly or with 429, so the satellite was seen once and the wildlife
  sightings never finished loading.
- **The new effects have only been seen in software rendering**, as
  still frames. Their motion, and their cost on a real GPU, are unchecked.
- **Flood water vanishes on land at sea level.** To keep the open sea out,
  the mask is wiped wherever terrain height is under half a metre, which
  also removes river deltas and coastal plains (Bangladesh, for one). This
  predates the animated water. A proper land/sea mask would fix it.
- **The radar water product (OPERA DSWx-S1) has gaps:** no data over large
  regions, and NASA's tile server sometimes answers 500 for single tiles.
  The engine then falls back one level coarser. A flood replay loads up to
  11 dates of tiles at once, which is slow on a weak connection.
- **Nothing has been tried by hand.** All testing is scripted, in a
  container without a GPU. The feel of the camera, real frame rates, the
  Windows and macOS launchers, keyboard use and the sound are unverified.
- **Phone layout** has not been checked since the menu grew.
- **Bandwidth:** opening an event loads up to 8 previews of about 1 MB for
  the history chart; a time-lapse loads 14.
- The change view still shows a thin line on some coasts and speckle on
  steep ridges.
- Quad-polarisation passes are skipped.
- `js/main.js` is about 2,200 lines and should be split.

## Next steps, in order

1. **More and better event animation, in the agreed look (see above).**
   Done so far: earthquake shock front, storm spiral, fire (embers to soft
   spots), flood water, picture cross-fades, radar sweep
   reveal, focus dimming, camera push-in, data labels. The lead's rule for
   anything further: stay in the current style, do not overdo it, and ask
   whether it serves "an easy to understand, easy to use visualization of
   data" for this challenge before building it.
2. **Hosting.** The repo has `.nojekyll`, and every path is relative, so
   GitHub Pages works with one setting by a repo admin: Settings → Pages →
   Deploy from a branch → `main` / root. The address would be
   `https://trisrota-commits.github.io/Dancing_with_the_SARs_NASA_Challenge/`.
   Not yet switched on.
3. **Submission materials:** project description, a short demo video or
   slides, and the AI-use disclosure (this project was built largely with
   AI; Space Apps normally requires saying so). Check the submission form
   for exact requirements. The demo script is in
   `docs/DATA_RULES_AND_DEMO_PLAN.md`.
4. (Done) Event history chart.
5. **Phone layout pass** and a hands-on test on a real machine.
6. **Run the measurements** (plan item 2a): `tools/measure.py` is ready;
   it needs an Earthdata login. Check each change map in the app and move
   the point in `tools/measure_sites.json` if it misses the feature.
7. Split `js/main.js` into modules if time allows.
