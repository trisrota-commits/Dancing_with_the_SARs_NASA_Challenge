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
  title, when, size, what the agencies report about it (press was
  removed, see below), one computed NISAR line, "Show details" and "Show
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
- **A first visit starts clean** (lead, 14 Nov, late): the menu is folded
  behind its button, which is labelled "☰ Menu" and ringed in teal while
  the opening card points at it. "Explore the globe" slides the menu in
  (it holds the stories, the filters and the key to the dots); the live
  event and the story keep it folded until the visitor closes them. A
  returning visitor gets no card and an open menu. On a phone the menu
  stays shut.
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

### Nobody presents the app: it has to explain itself (lead, 14 Nov, night)

The lead: there is no live demonstration or pitch. Judges try the app by
themselves, and we have no say in what they click. So every view has to
say what it shows without us.

- **The key on the globe covers everything drawn.** It used to explain
  only the radar picture. Each event type now lists its own marks in
  `plan.key` (`js/replay/replay.js`): fire spots, burnt-area outline,
  shaking outlines, later and earlier quakes, storm path and spiral, flood
  water. `main.js` adds the dashed lines to neighbouring events and the
  teal frame of a radar pass (`setEventKey`, `drawLegend`). The measured
  change map has its own key. A new mark on the globe needs a line there.
- **Press is gone; the agencies are the signal** (lead, 14 Nov, late).
  Press headlines kept being about something else (a restaurant under a
  forest fire, Bangkok under a flood in France), and they are not part of
  the challenge. `js/news.js` and everything that showed press were
  removed. The card leads with what the agencies report: depth, estimated
  impact, felt reports, burnt hectares, alert level, each with its source
  and a link to the official page. Do not bring press back. A curated
  board exists (ReliefWeb, UN), but its API only answers apps with an
  approved name, which has to be requested from them.
- **The live way in.** The opening card names the strongest recent event
  that NISAR has flown over since it began (`spotlight()` in `main.js`,
  from the feeds and NISAR's newest footprints) with one button to go
  there. The lead's idea: the agency report is the signal that something
  happened, the pass is the reason to look.
- **The Earthdata token cannot live in the website**, because everything
  a static site ships can be read by anyone. The lead chose GitHub's
  scheduler (free for a public repository): `.github/workflows/measure.yml`
  runs twice a day, picks events with `tools/pick_events.mjs`, measures
  with `tools/measure.py` and commits `data/measured/`. **It does nothing
  until a repository admin stores the secret `EARTHDATA_TOKEN`** (steps at
  the top of the workflow file). The picker was run against the live feeds
  and archive and found events; the measuring step has never run on real
  data, so the first run needs watching. A token lasts 60 days.

### First hands-on test by the lead (14 Nov, evening, Windows PC)

What the lead found in ten minutes of use, and what was done:

- **Black triangles at the farthest zoom.** A dark sphere sits just under
  the map so gaps never show space. Tiles at level 2 used a 16-cell mesh,
  flat enough between vertices to dip under that sphere, which then
  showed through the middle of every cell. Level-2 tiles now use the full
  32 cells and the sphere sits lower (0.997). Not seen in software
  rendering before or after; the cause is geometric, so it should hold.
- **NISAR's map layer has to be prominent, fast and there at every zoom.**
  It is now on from the start with a full 12-day cycle, its menu section
  is second and open, and the opening card says what the strips are. The
  date starts on the newest day NASA really has data for
  (`latestTileDate` now looks at the size of the answer: the server
  answers every date, with an empty tile when it has nothing; NASA
  publishes about a week late, so "the last 3 days" was nearly empty).
- **Sparse layers** (`sparse: true`; see the top of `js/engine/tiles.js`).
  Twelve daily layers meant twelve requests per tile, nearly all for empty
  tiles. The engine now knows emptiness without asking: an empty answer is
  recognised by its size, and each picture's 8 × 8 cells say which tiles
  beneath it are empty, three levels down. One whole-world picture per
  day decides everything to level 3. Far away, a sparse layer is drawn
  one level coarser. Measured on the test connection: the opening view
  went from 459 requests and 22 s to 106 and 6 s; a zoom to South America
  from 462 and 39 s to 90 and 5 s.
- **The grey and white strips in the lead's screenshots were the
  Sentinel-1 layer**, not NISAR: the same strips appear with only that
  layer on. NISAR's map layer is green, orange and blue.
- **The click-anywhere offer** ("a year of NISAR radar here") appeared on
  every click, also at sea, and would not go away. It now shows on land
  only (`tiles.landAt`), and leaves after seven seconds, on its ✕, on
  Escape, or when the globe is touched.
- **The key folds upward**: it hangs from the top left now, so its title
  stays put when it is folded.
- **Dropdown lists were pale grey on white** on Windows. The page now
  declares a dark colour scheme for everything the browser draws itself
  (lists, tick boxes, date picker, scrollbars), dropdowns have a solid
  background and their options a dark one. Found by a search of the whole
  app for the same pattern; all four dropdowns were affected.

### Speed: what was found and how the engine stays fast (14 Nov, late)

The lead asked for a globe with "zero latency", for new data and old alike.
Measured first, then fixed. Do not undo these without measuring again
(`tools/` has no speed script; the method is in the pull request).

- **NASA's catalogue search took 7 to 8 seconds, now 0.3.** The one option
  `options[readable_granule_name][pattern]` (a wildcard on the file name)
  costs that much. `search()` in `js/nisar.js` no longer sends it; the
  kind of product is read from the file names that come back. Only the
  urgent-response collection mixes kinds, so twice as many entries are
  asked for when it is searched. Answers are remembered for five minutes.
  A unit test fails if the pattern comes back.
- **A pass has a 15 KB thumbnail and a 5 MB picture.** The thumbnail goes
  up first and the picture replaces it (`syncNisar`). Pictures are decoded
  and cleaned on a worker thread (`loadPicture` in `js/globe.js`), so the
  globe does not freeze while they arrive.
- **An event's radar picture no longer waits for the event's history.**
  The passes are searched for alone first (`passesAt`), and the picture
  goes up as soon as they are known (`placePasses`), not when fire
  detections or water maps have also loaded.
- **Events are got ready before they are clicked**: the one the pointer
  rests on, and the one the opening card offers (`warmIncident`).
- **Radar map layers start from one whole-world picture a day.** NASA's
  map service (WMS) draws the level-2 tiles as one 1,024-pixel picture in
  one request (`gibsSheet` in `js/config.js`). The tile engine fetches it
  first for every `sparse` layer (`sheetOf`): it is the layer from far
  away, it stands in for any tile still on its way, and its grid says
  where the layer has anything, down to level 7, so empty tiles are never
  asked for. Twelve days of NISAR are twelve requests for the whole
  globe. Read the comment at the top of `js/engine/tiles.js`.
- **Three tiers of keeping.** Painted tiles stay as they are when they
  leave the view (420 of them). Decoded pictures stay in memory. And the
  bytes of radar tiles and pass pictures are kept in the browser's own
  store (the Cache API: `radar-tiles-1`, `radar-pictures-1`), because
  NASA's servers tell browsers not to keep them. A second visit reads
  them from disk.
- **How new data is noticed.** Each day's smallest tile (a few hundred
  bytes) is the day's fingerprint. It is fetched fresh on every visit and
  again every five minutes (`recheck`). When it differs, everything kept
  for that day, in memory and on disk, is dropped and built up again. The
  newest day with data is looked for again every ten minutes.
- **Order of work.** Tiles are painted and downloaded from the middle of
  the view outwards (`urgency`). Where the camera has been sent comes
  next (`prefetch`, called by `flyTo`), then where a turning globe will be
  in a second (`lookAhead`), and last the level-3 tiles of the whole
  globe (`warm`), a few at a time once nothing on screen is waiting.
- **Connections are opened early** (`preconnect` in `index.html`).

Measured in a headless browser with software rendering on a slow, proxied
connection, so the absolute numbers are far worse than on a real machine;
the comparison is what counts. Opening the offered event: first radar
picture after 3.5 s, was 13 s; sharp picture after 4.8 s, was 14 s. The
opening view complete: 8.9 s, was 9.6 s; on a second visit 6.6 s, was
9.3 s. Not measured on a real graphics card or connection.

### Damaged tiles from NASA's tile service (lead's video, 14 Nov, late)

The lead filmed grey dotted and black squares flickering over Colorado
while zooming in with the NISAR layer on. It looked like our bug. It was
not our drawing, but it was our engine's fault to show it.

- **What NASA sends.** For some days and places NASA's tile service
  (GIBS WMTS, `epsg3857`) answers the same tile address differently on
  every request. Seen for 6 and 7 November 2026 over Colorado at levels
  9 to 13: of the answers for a damaged spot only about one in ten was the
  real picture. The rest were a picture labelled as the wrong kind of PNG
  (it decodes as transparency noise, as solid black, or as nothing at all
  in a file of 60 kB) or a plain server error. Good tiles are the same
  bytes every time.
- **NASA's map service is sound.** The same areas asked from the map
  service (GIBS WMS, the one that already gives the whole-world picture)
  came back sound and identical on every request, in about 0.6 s. On
  tiles where both are sound the two services show the same picture.
- **The rule the engine now follows** (`js/engine/tiles.js`): nothing is
  drawn that was not checked, and no failure is final.
  1. Every radar tile is looked at before use (`inspect`): in a sound
     tile each pixel is fully solid or fully see-through and what is solid
     is a picture. This runs on what the browser kept, too.
  2. A tile that fails is taken from the map service instead
     (`fetchTile`, `mapUrl`; the layer's `map` address in `js/config.js`).
     The sound answer is kept in the browser's store, so a damaged spot
     is mended once, not on every visit.
  3. If both fail the tile counts as not delivered: the picture beneath
     stands in and the tile is asked for again at growing intervals
     (`dueAgain`), woken by a clock because the map is drawn on demand
     (`wakeFor`). Other layers get the same retry, three times.
  4. The days of a radar layer are a `stack`: a day that only has a
     blurred stand-in is drawn under the sharp tiles of the other days,
     never over them (`drawLayers`).
  5. A request that nothing on screen needs is put down, and the tiles
     that had asked are marked to ask again when they return (`putDown`).
- **Why not use the map service for everything:** it draws each picture
  on request (0.6 s against 0.25 s, 200 kB against 60 to 170 kB) and
  NASA asks apps to use tiles.
- **Checked** with the same zoom-and-drag as in the video, headless: 112
  damaged answers, 112 replaced, no tile left standing in, at 288, 55,
  40, 15 and 8 km. `engine.faulty` and `engine.mended` count them
  (`window.app.globe.tiles`). Not yet seen on the lead's own machine.
- **A slip worth knowing about:** during this work one edit dropped the
  method that loads the whole-world picture (`fetchSheet`). Nothing
  failed loudly, because a missing world picture is a case the engine
  handles. It was found by listing the requests marked "not delivered".
  When the far view looks thin, look there first.

### Visual rules (lead, 14 Nov, night)

The lead, after one screenshot confused them: no arbitrary colours; one
general, explicit rule set, from NASA where NASA has one. It is in
`docs/VISUAL_RULES.md`, with the sources. Read it before adding anything
visible. In short: every meaningful colour comes from `PALETTE` in
`js/config.js`; teal is NISAR and nothing else; event types and place
kinds share seven colour families and are always also named in words;
shape says what sort of thing a mark is; agency scales stay the agencies'
own; NASA's legend pictures explain NASA's layers; and every mark is in a
key. `tests/visual.test.mjs` enforces what can be computed. An inventory
of all 91 colour uses found the clashes that led to these rules.

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

- The project lead tests on a Mac and on a Windows PC, and wants a fresh
  zip of `main` after each batch, sent as a file, plus a few screenshots
  of what changed. Make the zip with `tools/pack.sh <path>`: it stamps
  the app with the time (shown at the end of the credits line as "Version
  …"), runs the unit tests and zips. Commit the stamped `js/main.js`.
- **Always tell the lead the version stamp of a zip**, and ask for it when
  something looks old. On 14 Nov the lead tested a new zip and saw the
  old app: an older copy was still being served on the same port, or the
  browser kept old files. The launchers now run `tools/serve.py`, which
  forbids the browser to keep files and moves to a free port.
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
  `python3 tools/serve.py`. A plain `python3 -m http.server 8765` works
  too, but lets the browser keep old files.
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
| NASA GIBS (EPSG:3857 tiles) | Basemaps, daily NISAR backscatter, context layers | Raster only on this endpoint. For freshly added NISAR days it sometimes sends damaged tiles; the engine checks each one and falls back on the map service (see "Damaged tiles"). |
| NASA GIBS map service (WMS, EPSG:3857) | One whole-world picture per radar layer and day; any single tile the tile service sends damaged | Slower (drawn on request), but sound and the same on every request. Its empty picture is 334 bytes. |
| NASA GIBS (EPSG:4326, `.mvt`) | VIIRS fire detections | Vector tiles are only served on the 4326 endpoint; tiles span 288°/2^z. |
| USGS feeds, FDSN query, ShakeMap `cont_mmi.json` | Earthquakes, nearby quakes, shaking contours | Fine. |
| NASA EONET v3 | Events and storm tracks | The full archive is 14 MB; we filter out wildfires. |
| GDACS | Alerts, per-event shapes | List returns at most 100 events. |
| Mapzen Terrarium (AWS) | Elevation | Fine. |
| Photon (komoot) | Place search | Sometimes refuses; the app falls back to event matches. |
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

## Status

### Done and in `main`

Custom three.js globe with terrain and tilt camera; live event dots from
three feeds with merging and links; event replays (earthquake, storm,
wildfire, flood); NISAR lookup with before/after divider and the "what
changed" view; interferogram cards for earthquakes; NISAR time-lapse for any
spot with channel views, chart, computed facts and optional sound; five
stories; 33 changing places; search; reports bar; next-pass countdown;
archive time window back to 17 June 2026; Sentinel-1 offer; event history
chart; a "Why might this have changed?" explainer per event type; agency
facts per event; share links; 12 grouped context layers; L-band
versus C-band divider; launchers for macOS, Windows and Linux; thirteen
event types (landslides, snow, dust and haze, extreme heat or cold and
human-made events have their own category); a "Measured with NISAR" card
that appears on a place, or an event nearby, once results exist.

### Known problems

- **No calibrated measurements exist yet.** `tools/measure.py` has only
  read simulated files; its search has been run against the real archive
  (it finds 30 passes over the Aletsch site without a login), but reading
  needs an Earthdata login nobody has supplied yet. Everything else is in
  place (14 Nov, night): the login is taken from `EARTHDATA_TOKEN`;
  `--point LAT LON --name … --event DATE` measures any event across its
  date; a site measured before only reads its new passes; and the app
  leads with the result by itself (a line on the event card, a "Measured"
  sentence in the text, the series and map in the details; see
  `measuredStep` in `js/measured.js`). So the remaining step is one
  command and one commit. A GitHub Actions workflow that does this daily
  was drafted but not added: it would push to `main` by itself and needs a
  repository secret, which is the lead's decision. Never commit simulated
  results to `data/measured/`.
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
