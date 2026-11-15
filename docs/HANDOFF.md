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
  and archive and found events. The secret was added on 15 November and
  the first run on real data worked (see "The first measurements from
  real NISAR products"). A token lasts 60 days.

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

### The passes of a place use the event timeline (lead's QA, 14 Nov, night)

The lead's three complaints about "a year of NISAR here": it took forever
to start, it looped without end, and it had its own player instead of the
timeline events have. All three had one cause: it was a separate looping
player that loaded fourteen full pictures before showing anything.

- **One timeline for both.** `Replay.open(plan, marks)` in
  `js/replay/replay.js` opens a timeline that is not an event's. The
  looping player (`run`) is gone. A place's plan carries `lapse: true`;
  the bar then hides the event's stretch and its key entry
  (`renderReplay` in `js/main.js`). It stands on the latest pass, every
  pass is a mark, dragging goes back, play runs once.
- **Nothing waits for the year** (`startLapse`, `showLapsePass`,
  `readLapse`). The newest pass goes up at once, its 15 KB picture first,
  then the full one, exactly as for an event. The other passes are read
  in the background, two at a time, oldest first, only for the brightness
  chart (`sampleAt` reads 25 pixels of each). At most 14 are read unless
  "Read all" is ticked; a pass the handle stands on is fetched then and
  joins the chart. The search itself starts when the offer appears on a
  click (`stacksAt`), before it is taken.
- **The chart** shows only passes that were read, so one not read yet is
  not drawn as a gap, and says how many it has.
- **Pictures** come through `loadPicture` like an event's (worker, kept on
  disk), at full size; the one-channel views are made at 900 px
  (`channelView`).
- **Inside an event** the bar gets a second button, "Back to the event".
  Anything else that takes the globe (the change picture, the divider)
  ends the place's timeline, as before.
- Measured headless from page load, Colorado, 21 passes: timeline open
  after 6.9 s, first picture 8.3 s, sharp 9.4 s, chart from 14.7 s, all
  14 read after 25.6 s. Before, nothing showed until all 14 were loaded.

### Signals for recent events, and earthquake rings that stay (lead's QA, 14 Nov, night)

- **A soft ring every five seconds** on every event first reported in
  the last 24 hours (`RECENT_MS` in `js/config.js`, the reports bar's own
  rule). It is the dot shader's existing pulse with a second trigger
  (`aPing` in `js/engine/marks.js`; `PING_EVERY`, `PING_LASTS`). Each dot
  starts up to 0.7 s apart from the others, always the same for the same
  event, so the globe does not blink as one. The quick pulse of an event
  that arrived in the last minutes is unchanged and takes precedence.
  Cost: the globe now draws frames while rings spread, about 2.6 of
  every 5 seconds, where an idle globe used to draw none.
- **The earthquake's two wave rings rest** where they stood when the
  opening ended, fainter, each labelled with the wave and the seconds
  after the quake it stands for (`atRest`, `waveLabels` in the `quake`
  template of `js/replay/replay.js`). The lead asked for them because an
  earthquake without a published shaking map had nothing left on the
  globe after the opening. The key and the "computed" line say what they
  are. Before the earthquake on the timeline they are off, like
  everything else of the event.

### All context layers on at once (lead's QA, 14 Nov, night)

The lead switched on every "other satellite layer" and got "a disco ball
with glitches". Three separate causes, each fixed where it arose:

- **Six layers paint the whole land surface** (soil moisture, land cover,
  croplands, population, built-up areas, city lights; measured: 77 to
  100 % of a tile over land is drawn). Stacked, each hides the ones under
  it. They carry `fills: true` in `js/config.js`; switching one on
  switches the others off, they are drawn underneath, and the partial
  layers lie on top in the menu's order (`applyLayers` in `js/globe.js`).
  This is rule 3 of the visual rules applied to NASA's layers.
- **Two daily layers had no data for the chosen day.** NASA runs behind
  on them (soil moisture two days, vegetation alerts a week), and every
  tile of a day it does not have is an error: 280 failed requests in one
  view, each tried again. `overlayDay` in `js/main.js` asks for one tiny
  tile to learn whether the day exists, and otherwise takes the newest of
  the twelve days before it; the menu says which day is shown.
- **The population layer never worked.** NASA publishes it without a
  date and refuses a request that names one (403). Its date is now
  `'default'`.
- **In the engine**, an overlay tile is fetched with its status: "does
  not exist" (404, 400, 403) is final and never asked for again, a
  server failure is tried again (`gone` in `download` and `dueAgain`,
  `js/engine/tiles.js`). Before, every missing overlay tile was retried
  three times.
- Measured headless with everything switched on: far view complete after
  10.6 s (was 31.5 s), failed requests 11 (was 157), no tile left
  standing in (was all 29).

### Bug hunt: three reviews and four stress tests (15 Nov, night)

No features: the lead asked for a night of finding and fixing. Three
independent code reviews (map engine, app state, data and timelines) and
hands-on tests: each outside service cut off in turn, laptop-size
windows, a long session, share links opened cold.

**Accuracy (the project's first rule)**
- A merged earthquake showed GDACS's magnitude under the label USGS,
  because the lead report was picked by "severity", which is an alert
  level for one feed and a magnitude for the other. Indonesia read 7.7;
  USGS says 7.8. Now the USGS report leads an earthquake when there is
  one (`js/incidents.js`), and the line names the feed it really is from.
- Two earthquakes minutes apart could merge into one once a second feed
  reported both. A group now never holds two reports from one feed.
- A fire or flood longer than the days of satellite data shown (15 and
  22) read "Before the event" for its first weeks. Plans carry `began`,
  and the bar says "Under way · the satellite data shown here starts on …".
- Flood water appeared a day before its map's date. It now starts on its
  own day and is all there a day later (the `+ 0.5` in the flood clock is
  gone; the shader's fade is `smoothstep(0.0, 0.5, …)`).
- A failed request read as "none": "0 later quakes", "No shaking map has
  been published", "No satellite fire detections". Failures are now told
  apart and worded as "could not be loaded".
- "3 days after" was said of a pass on day 3 of a 59-day flood. For an
  event that lasts the text says "after it began", and an interferogram
  "spans the start of the event" unless it reaches past its end.
- GDACS shaking zones whose level is only in their label were dropped.

**Things that broke or got stuck**
- Inside an event, opening the place's passes and then anything that
  takes the globe left the event with no timeline. `take()` now brings it
  back where the camera is (`Replay.start(…, { still: true })`), and
  `startLapse` takes the globe only once it has passes to show.
- The opening card stayed on screen after a click on a dot, a report or
  a share link. `openPanel` closes it; Escape closes it first.
- Pass marks were missing when the same event was opened twice.
- With "Compare with Sentinel-1" on, NISAR's strips showed on Sentinel-1's
  side; the divider jumped back to the middle on every date step.
- A place did not drop the answers still on their way for the event open
  before it.
- An emptied date field threw on every step.

**Reliability**
- If the Esri basemap cannot be reached the globe was black. The engine
  reports it (`onBaseFailed`), NASA's Blue Marble takes over and the menu
  says so.
- With no feed reachable the reports bar said "Loading the feeds…" for ever.
- Height tiles: a request dropped while its tile was off screen was never
  asked for again, and a failed one was final. Both are retried now.
- Sentinel-1: its empty tiles vary in size and its tiles have soft edges,
  so the soundness check cost extra requests and could reject sound
  tiles. A blank answer counts like the empty tile; the transparency rule
  is 20 % for NISAR and 35 % for other layers.
- The picture memory cache miscounted pictures evicted while loading.

**Speed**
- The search made when an event is pointed at never matched the one made
  on the click, because the end time was the current millisecond. Both
  now end on the hour (`searchUntil`), so the click finds the answer.
- The archive window downloaded all of EONET (4,773 events back to 1980,
  23 MB), because EONET ignores a start date given without an end date.
  With both it is 355 events and 10 MB. Checked: the app keeps the same
  111 events from either answer, so nothing is capped.
- Nothing is fetched ahead of need for levels the world picture covers.

**Layout**
- On a wide screen the opening card stands at the left, beside the globe,
  instead of on top of it; on a short screen it no longer covers the
  reports bar.
- With menu and details both open the timeline bar sits between them.

**Fixed a little later the same night, after the lead asked why they were left**
- **Scenes across the date line.** 108 scenes around Fiji and Chukotka
  come from the catalogue as two polygons cut along 180°, and only the
  first was read: half the scene, no brightness sample in the other half,
  and the picture cut off at the line. `sceneOutline` (`js/nisar.js`)
  joins the two into one outline whose longitudes run past 180°, the way
  the preview's corner file already counts them. `lonNear`
  (`js/incidents.js`) brings a point into that count for the inside test,
  the edge margin and the brightness sample, and the engine drapes a
  picture one turn of the globe west or east as well (`placements` in
  `js/engine/tiles.js`). Checked on both sides of the line near Fiji:
  11 of 11 and 10 of 10 passes read, picture and frame whole.
- **A share link to an event that is gone** now says so in a short notice
  (`notice` in `js/main.js`).

**Found and left**
- 244 of 280 archive floods from EONET carry an outline and no point, and
  are skipped (`js/feeds.js`). Showing them needs a decision on where to
  put the dot.
- A world picture that fails to load is only asked for again when
  something repaints. The layer still shows through its tiles meanwhile.

Tests: 30 unit tests (5 new, four of them in `tests/events.test.mjs`), smoke test, and
the zoom-and-drag over Colorado (111 damaged tiles, 111 replaced).

### The whole planet as NISAR sees it (lead's idea, 15 Nov, night)

The lead asked whether there are enough pictures in total to cover the
planet. Measured on NASA's whole-world pictures of the last 120 days,
newest on top: 12 days cover 25 % of the map picture, 24 days cover
59.9 %, and 120 days cover 60.2 %. So the map is complete after 24 days
and nothing is gained after that. Twelve days are strips because NASA
publishes passes up to two weeks late: the newest days are thin, and the
last complete round is 12 to 24 days old.

- "Days stacked" has a fifth choice, **24 days, whole planet**, with a
  note beside it saying what it is and that it loads longer. The default
  stays 12 days.
- **Hidden days are not fetched** (`drawLayers`, `exactOf`, `full` in
  `js/engine/tiles.js`). Over most land several passes lie on top of each
  other. A tile that is here and solid from edge to edge hides every
  earlier day, so those are neither drawn nor asked for, and what the
  tile had asked of them is let go. NASA's radar tiles count pure black
  as see-through, which leaves scattered single holes in nearly every
  tile, so "solid" means 99.5 % (`FULL_SHARE`). Within a stack the newest
  day is fetched first (`age`).
- While 24 days are shown the day and night shading eases back, as it
  does under a radar picture: the radar works at night.
- Measured headless, Alps at 150 km: 24 days needed 236 requests and
  30 MB without the rule, 118 requests and 14 MB with it (12 days: 80
  requests, 10 MB). The far view takes 6 s against 3 s, a continent at
  2,500 km 45 s against 18 s: at that distance few tiles are solid, so
  the rule helps little there.

### Black squares, blinking and sharp-then-blurry (lead's three videos, 15 Nov, night)

Filmed in the whole-planet view, where every tile composites 25 layers.
Three causes in the engine, and one that is NASA's.

- **Black squares: a tile was shown before it had been painted.** A tile
  turns visible the moment the view needs it, but painting takes its turn
  (a few tiles a frame). Measured right after a fast zoom-out: 50 of 65
  visible tiles not painted yet. Now a new tile is never empty
  (`prepaint` in `js/engine/tiles.js`): it borrows from its relatives
  until its turn comes, the four finer tiles put together, or its
  quarter of the coarser one, or failing both the basemap with each radar
  layer's world picture over it.
- **Sharp, then blurry: zooming out fell back to a coarser picture.**
  While a level's own tile is on its way, the stand-in was always looked
  for among coarser levels. `drawFiner` now takes the level finer first,
  if it is all here, which after zooming out it is.
- **Blinking: the picture cache dropped pictures the screen was showing.**
  With this many layers the cache (900 pictures) filled, the least
  recently *drawn* went first, and a tile painted a while ago had its
  pictures dropped; its next repaint found them gone, showed a blurred
  stand-in and fetched them again. Each tile now records what it is made
  of (`tile.used`), and `trim` never drops a picture of a visible tile.
- **Hard edges between strips: NASA's.** Each pass is rendered on its
  own. And a whole strip in orange beside green ones was recorded in one
  channel only. Checked for the Amazon, 20 Oct to 6 Nov: of 59 scenes, 22
  are single-polarisation (`SHSH`) and come out orange in the map layer,
  37 are dual (`DHDH`) and come out green. The menu's key used to say
  orange means "towns and thinly vegetated ground", which is not true of
  those strips; it now explains them.
- **Where the time goes** (profiled, 24 days, Europe at 2,500 km): 1,059
  tile paints took 0.9 s in all, of a 51 s load. The engine's own work is
  about 2 %; the rest is waiting for NASA's answers (494 of them at that
  distance). (Written here at first: "there is no ready-made mosaic at
  NASA". That was wrong: see "Has a whole-planet NISAR picture been done
  before?")
- Checked headless: no unpainted tile on screen in any frame of a fast
  zoom in and out; zooming back to a place already loaded completes in
  2.4 s with 34 requests (first time: 37 s, 353 requests).

### A ready-made mosaic of the whole planet (lead's idea, 15 Nov, early morning)

NASA's map service holds NISAR as a daily layer only (NASA Worldview
stacks 12 days of it in the browser; see "Has a whole-planet NISAR
picture been done before?"), so the whole-planet view stacked 24 daily
layers live: up to 24 pictures per map tile, about
500 requests for a continent. The lead asked why the engine does not
assemble the pieces itself. It does now, once, ahead of time.

- **`tools/mosaic.py`** takes each day's tiles (about 10,000 small
  requests, five and a half minutes, no login), stacks them oldest first
  so the newest pass ends on top, and writes one tile set to
  `data/mosaic/`: levels 0 to 5, 1,068 tiles, 10 MB as WebP (since the
  morning of 15 Nov it stacks 48 days: 1,069 tiles, see "Once sharp, it
  stays sharp"). It checks
  every tile the way the engine does and takes damaged ones from NASA's
  map service (6 of 10,379 in the first build). `about.json` says which
  days it holds, when it was built, which tiles exist, and carries a
  fingerprint of every day.
- **In the app** ("Whole planet" under "Days stacked"): the mosaic is one
  layer under the daily ones. The daily layers it was made from carry
  `minLevel` 7 and `backed`: they are neither fetched nor drawn until the
  view is close enough for them to be sharper than the mosaic, and until
  their own tile is here the mosaic is their stand-in. Their world
  pictures are fetched behind everything else (`lazy`).
- **What the mosaic is, and is not.** It is a picture with a date on it:
  the far and the continent view as they stood when it was built. It
  does not have to be current to be right, because everything else comes
  live from NASA, and only for what is on screen (the lead's point: why
  hold the whole planet in full detail when nobody can see all of it).
  - Days flown after the mosaic's last are drawn live on top, at every
    distance.
  - Close up it is always NASA's own tiles.
  - For a date before the mosaic's last day the mosaic is not used: it
    would show passes not yet flown.
  - Without `data/mosaic/` the app stacks live, as before.
  - Where the newest pass is not in it, it shows the one before. NASA
    publishes passes late for two weeks and more (half an hour after the
    first build it added one to 31 October), so some such place always
    exists. Close up the late pass is there at once; in the far view it
    is there after the next build. Nothing is done about it in between,
    and nothing needs to be.
  - A page left open for days looks every ten minutes whether a newer
    mosaic has been put online and takes it (`refreshMosaic`). The
    build's time is part of each tile's address, so the new tiles are
    fetched and the old ones let go.
  - Three stricter schemes were built and dropped the same night: from
    the oldest changed day on, draw every day live (one late pass
    switched 13 days to live, so the mosaic was hardly used); strict
    only once the mosaic is older than 36 hours (made a nightly rebuild a
    requirement and brought the blurred stand-ins back when it was
    missed); and counting the late passes in the menu (noise: the far
    view showing the pass before is not an error). `about.json` still
    carries a fingerprint of each day, unused by the app.
- **Rebuilding** is `python tools/mosaic.py`, then commit `data/mosaic/`:
  five minutes, no login. Nothing depends on it; it is done when someone
  wants the far view brought up to date. It builds afresh and never
  patches the mosaic in place, so the newest pass ends on top without
  bookkeeping and the tiles are compressed once. A build with under 80 %
  of the tiles of the mosaic in place (NASA's services failing) is
  refused. The lead decided on 15 November that no scheduled job is
  wanted for this.
- **Measured headless, Europe at 2,500 km:** 72 requests to NASA and 12 s
  with the mosaic, 494 and 45 s without; and the picture is whole from
  the first second, where it used to start as a blur. Close up it is as
  before (NASA's tiles).
- Engine pieces, all in `js/engine/tiles.js`: a layer may bring a list of
  its tiles (`has`), a level it starts at (`minLevel`), and say that
  something better lies under it (`backed`).
- Tests: `python tests/test_mosaic.py` (the build's arithmetic, offline).

### What an idle page asks for (lead's question, 15 Nov, early morning)

The lead asked whether the regular checks could add up to spam. Counted
over six idle minutes with the 12-day view: 27 requests, about 270 an
hour, 120 of them to NASA's map service (one small fingerprint tile per
day on the globe, every five minutes). That is about what one zoom asks
for. The mosaic check is one 9 kB file from our own site every ten
minutes.

- **The real waste was elsewhere.** The list of the newest passes from
  NASA's catalogue is 10 MB and is not compressed, and the app fetched it
  whole every five minutes: about 120 MB an hour for a page nobody
  touches. Now it is fetched whole once; after that only what the
  catalogue has added since the last look (`updated_since`, with two
  minutes of overlap) is fetched and merged in (`latestScenes` in
  `js/nisar.js`, `refreshNisar` in `js/main.js`). NASA adds about 170
  passes an hour, so that is one to two megabytes a look. The look is
  every fifteen minutes, not five: a pass reaches the catalogue hours
  after it was flown. After six hours without a look, the whole list
  again.
- **A hidden tab asks for nothing.** Every regular check waits while the
  page is in a tab nobody is looking at, and runs once when it is seen
  again (`whileSeen`). The map engine's own checks ride on the drawing
  loop, which browsers stop in a hidden tab anyway.
- The only bulk job in the project is `tools/mosaic.py` (about 10,000
  requests in five minutes). It runs when a person runs it, never in the
  app.

### Once sharp, it stays sharp (lead's QA of the mosaic build, 15 Nov, morning)

The lead's report: a place that had loaded sharp loaded again after
zooming out, moving about and coming back; after a while close in, a fast
zoom out showed the bare basemap first and then a coarse radar picture;
and there were sand-coloured slivers in the Sahara.

- **Cause of the reloading.** The engine kept the *ingredients* (up to
  900 pictures) and a few hundred finished tiles as canvases, and threw
  finished tiles away beyond that. Coming back meant fetching the
  ingredients again (from the browser's store at best) and putting the
  tile together again, blurred stand-in first.
- **Finished tiles are kept** (`keep`, `recall` in `js/engine/tiles.js`).
  A tile is `whole` once every layer has given its final answer for it.
  When a whole tile leaves the live set it is compressed without loss
  (PNG, about 150 to 190 kB close up) and held in memory, up to 480 MB
  on a desk computer with 8 GB or more, 288 MB otherwise, 96 MB on a
  phone, oldest out first. A tile that is built again takes its kept
  picture instead of being painted: no request, no compositing. Lossy
  WebP at a quarter of the size was tried and dropped: it washed out the
  red and orange speckle visibly (pixels off by up to 100 of 255).
- A kept tile belongs to one **look**: the exact list of layers, as text.
  The same layers set again are recognised (`setLayers` now returns at
  once when nothing changed), and a look the reader stayed on for three
  seconds is kept before other layers are painted over it, so opening
  and closing an event brings the view back without a request.
- **Layers and what lies over them are painted separately** (`paint`).
  Outlines and single pictures no longer cause the layers to be put
  together again: the layers as painted are copied aside (`base`, only
  for tiles under an outline or picture) and the top is redrawn.
  `setOutlines` and `setPictures` touch only the tiles under the old or
  new shapes.
- **A finished tile is not disturbed** by a download that no longer
  matters to it (a day that turned out to be hidden, a world picture, a
  pinned stand-in): `repaintUnfinished`, and the `whole` checks in `done`
  and `putDown`. Looking ahead (`prefetch`) skips places that are
  finished or kept.
- **When NASA adds a pass to a day** (many times an hour), only the tiles
  under it are done again. Each day's world picture gets a mark per cell
  (`marks` in `fetchSheet`); when the day's fingerprint changes, the new
  picture's marks are compared with the old (`refresh`) and only live
  and kept tiles over the cells that differ are dropped. (The first
  version of this change forgot everything kept on every such change;
  the storm test showed 287 kept tiles going to 0.)
- **The mosaic's coarse levels are held** (levels 0 to 3, 77 pictures,
  `held`), like the basemap's coarsest tiles, so a tile that comes into
  view after a fast zoom out shows radar at once. The rest of the mosaic
  (levels 4 and 5, about 9 MB as bytes) is fetched in the background
  once the view is complete, nearest the view first, and held as bytes
  (`fill`, `filled`); not on a phone, nor with the browser's data saver.
- **The slivers.** They are real: thin lens shapes between passes that
  NISAR did not image in the 24 days (0.30 % of the Sahara's interior,
  0.43 % of Arabia, 0.21 % of the US plains). The mosaic now stacks **48
  days** (`tools/mosaic.py` default; 26,689 day-tiles, 14 minutes): that
  closes the US plains and Arabia (0.03 %) and a third of the Sahara's
  (0.19 %). 96 days was baked too and closes hardly more on land
  (0.17 %) while adding a triangle of the Arabian Sea from August, so it
  was not used. The 48-day picture only adds: where the 24-day one had
  data, the same newest pass is on top. Close up the app still loads the
  last 24 days live, so a sliver filled from an older pass stays at the
  mosaic's detail. The menu note says what shows through where NISAR has
  no picture.
- **Whether the ready-made mosaic is needed** (the lead asked twice). A
  visitor never downloads the 10 MB at once: it is 1,069 small pictures,
  and the opening view takes the coarsest 21 (0.3 MB). Without it the
  coarse planet is 24 daily world pictures from NASA, about 10 MB, and a
  continent is up to 24 pictures per map tile (494 requests against 72).
  So the mosaic is the small, fast start, and the kept tiles are what
  grows sharper from there.
- **Measured headless** (software rendering, slow proxy; whole planet).
  Alps at 150 km: first visit 14.7 s, 284 requests; back after six other
  places 1.0 s, all 43 tiles from the kept store, no NISAR request beyond
  those of the flight there. Bolivia 82 of 82, Japan 61 of 61, Europe at
  3,000 km 87 of 90 (the other three were still live). Opening and
  closing an earthquake, a fire and a flood over a sharp view: 0 NISAR
  requests on closing, about 1 s. After 6 places close in over the
  Sahara, a fast zoom out to 6,000 km shows radar on every tile in the
  first frame checked (0.2 s) and is finished after 0.8 s.
- Test scripts for these live in the session's scratch folder
  (`stay.js`, `stay2.js`, `out.js`, `event.js`, `refresh.js`); they are
  not in the repository.
- Not verified: behaviour on a real GPU and in Safari, where keeping a
  tile compresses on the page's own thread (at most 12 tiles a frame are
  let go to bound that).

### A dead square at one zoom step (lead's QA, 15 Nov, morning)

The lead found a dark grey square over north-east China that showed for
one or two zoom steps only (far and close were fine).

- **What it was.** Tile 9/425/182 of 22 October 2026 and its neighbours.
  NASA's tile service delivers every sound NISAR tile as one kind of PNG
  (colour type 2: colour, with pure black as the see-through colour). For
  some days, places and levels it delivers the same tile as another kind
  (0, 3, 4 or 6), and that file decodes as noise, as solid black, as
  blank, or as a dark grey square. Measured over that region at level 9,
  26 days: 563 tiles, 388 of kind 2 and all sound, 175 of other kinds and
  all damaged. Levels 6 and 7 there: 1,044 tiles, all kind 2.
- **Why the engine let it through.** It judged tiles by their pixels
  (`inspect`): noise in the transparency, solid black, grey. The grey
  rule ignores dark pixels (real dark ground must not count as grey), and
  this square is dark grey. Pixel rules will always have such a hole.
- **Root fix.** A tile of a layer marked `colour` is judged by what the
  file says it is (`pngKind` in `js/engine/tiles.js`, used in
  `fetchTile`): anything but kind 2 from the tile service, or from the
  browser's store of earlier visits, is refused and NASA's map service
  is asked instead, which is sound. This holds at every level, for every
  day and place. The pixel rules stay as a second net. `tools/mosaic.py`
  has used the same rule since it was written (`sound`), which is why
  the far view never showed such squares.
- Sentinel-1's sound tiles are kind 6 and its blank ones kind 3, so the
  rule is for NISAR's layer only; Sentinel-1 keeps the pixel rules.
- **Checked** by zooming in slowly over the spot (1,500 km to 100 km in
  eight steps): the engine before the fix shows two grey tiles at level
  9; after it none, with 389 damaged answers replaced from the map
  service. Unit test: `tests/engine.test.mjs`.

### Which NISAR tiles are sound: a census of the planet (lead's question, 15 Nov, morning)

The lead asked whether "kind 2 is the only sound kind of file" holds
everywhere, or whether the list of sound kinds needs extending.

- **`tools/census.py`** samples tiles over the whole planet (26 days, 300
  places a day, levels 7, 9, 11 and 13) and compares them with NASA's map
  service: every tile of another kind, and 600 of kind 2. About 27,000
  requests to the tile service, 5,000 to the map service, half an hour;
  run by hand.
- **Result, 15 November:** of 10,421 tiles holding a picture, 5,974 were
  kind 2 and 4,447 another kind (0, 3, 4, 6). All 4,447 were damaged;
  none was sound. Of the 600 kind-2 tiles compared, 591 were the same
  picture as the map service's and 6 were empty in both. So the list is
  complete as it is: kind 2, nothing else.
- **How much is damaged** grows with the level: 10 % of tiles at level 7,
  45 % at level 9, 65 % at level 11, 72 % at level 13. Close up, most
  NISAR tiles the app shows come from the map service.
- **The same tile is not always the same file.** Asked for again an hour
  later, 3 of 35 kind-2 tiles came back as a damaged kind, and damaged
  ones came back as another damaged kind. The engine judges every answer
  on its own, so this does not matter to it; a sound answer is kept in
  the browser's store.
- **A second fault, of the right kind.** Three kind-2 tiles of 1 November
  held 1 %, 5 % and 24 % of the tile where the map service showed 100 %,
  100 % and 29 %. Twenty minutes later the same tiles were complete: NASA
  was adding a pass to that day, and the tile service still handed out
  the tiles from before. The engine now refuses such a tile
  (`expectedCover`, used in `fetchTile`): each day's picture of the world
  carries how much of each cell is solid, and a tile holding less than
  half of what that shows at its place is taken from the map service.
  Further in than level 7 this is only said where the cell and all eight
  around it are solid throughout. Checked for false alarms in nine views
  (far views in the 12-day mode; Finnish lakes, the Amazon, Lake
  Victoria's shore and the Dutch coast close up): none refused. The
  fault itself could not be reproduced on demand (NASA was no longer
  adding to that day); the rule has unit tests only.
- A caution from the census: colour difference alone does not tell a
  damaged tile from a sound one over dark ground (a damaged grey tile
  comes within 20 of a dark blue picture). The script compares what the
  two pictures show in blocks of 4 x 4 pixels (`alike`): sound tiles
  score 0.69 to 1.0, damaged ones 0.11 or less.

### The whole planet opens the app, and is rebuilt weekly (lead's decisions, 15 Nov, midday)

- **Opening view.** "Days stacked" starts on "Whole planet" (it was "12
  days"). The challenge asks to make NISAR accessible to a broad
  audience and the judges test alone: a complete radar Earth reads at
  once, where the strips of one cycle with gaps between them can look
  broken. It opens from the mosaic, a third of a megabyte for the first
  view. `start` in `js/main.js` waits up to 2.5 s for the mosaic's list
  of tiles before it sets the layers (asking NASA for 24 daily layers
  first would be wasted). A copy without the mosaic, or one that cannot
  reach it, opens on 12 days; if the mosaic arrives late the view goes to
  the whole planet, unless the reader has chosen for themselves
  (`state.stackChosen`).
- **Why a weekly rebuild after all.** The lead decided against a nightly
  job in the morning, when the question was whether the mosaic must be
  current to be right (it need not). The reason now is speed over the
  weeks of judging: every day after the mosaic's last is drawn live on
  top of it, and after 24 days the mosaic saves nothing: the continent
  view is back to about 494 requests where it took 72.
  `.github/workflows/mosaic.yml` runs `tools/mosaic.py` on Mondays at
  04:41 UTC and on request (Actions → "Rebuild the planet picture" → Run
  workflow), and commits `data/mosaic/`: a quarter of an hour, about
  10 MB a run. A build with far fewer tiles than the one in place is
  refused by the script. To stop it, disable the workflow or delete the
  file.
- **A commit made by a job is not published by "Deploy from a branch".**
  GitHub's documentation says so in as many words. That would have kept
  the weekly picture, and the measurements of `measure.yml`, off the
  site. `.github/workflows/pages.yml` publishes the site itself: on every
  push to `main`, and called by the two jobs after they commit. It needs
  the Pages source set to "GitHub Actions"; until then it stops early
  with a notice.
- Not verified: the publishing job has not run with Pages switched on.

### The first measurements from real NISAR products (15 Nov, midday)

The team added the Earthdata token on 15 November and `measure.yml` ran
on real GCOV files for the first time: 13 sites (7 listed places, 6
picked events) in 20 minutes, committed by the job itself.

- **It works.** Twelve results are plausible: backscatter between -25
  and 0 dB, steady from pass to pass where nothing changed. The app shows
  them ("Measured with NISAR · calibrated data", chart, change map).
- **The clearest result: rice fields of Bardhaman, West Bengal**
  (`#place=west-bengal`), 12 passes on one track, 20 June to 11 November
  2026. HH: -8.8 dB in June, down to -10.9 dB in mid-July (flooded
  paddies), up to -3.7 dB by 18 October (standing rice), -6.3 dB on 11
  November (harvest). HV: -16.5 to -14.1 dB. 66 % of the mapped area got
  at least 3 dB stronger from June to October. The place's hand-written
  text predicted this pattern before any measurement existed.
- **One result was wrong: Perito Moreno**, -135 dB HH and -145 dB HV on
  all 11 passes, with a believable difference between the two channels.
  The values in those files are scaled differently; the cause is not
  found (it needs a look into one of the files, which takes the token).
  `tools/measure.py` now leaves out any pass outside -50 to +20 dB
  (`plausible`) and never carries such a value over from an earlier
  result; the Perito Moreno files were taken out of `data/measured/`.
- **The job could lose a whole run.** It committed only after the last
  site, so a run that hit the two-hour limit would have kept nothing.
  Now the script begins no further site after 85 minutes (`--budget`),
  writes the app's list after every site, and the commit step runs even
  when the measuring step failed or was cut off.
- Not verified: the budget and the cut-off on GitHub; why Perito Moreno
  reads as it does.

### Has a whole-planet NISAR picture been done before? (team's question, 15 Nov, afternoon)

Yes. The team assumed not, and so did this document and the submission
text ("NASA has no mosaic"). A search and a look at the primary sources
on 15 November found otherwise. Do not claim a first.

- **NASA Worldview has a "rolling 12-day" NISAR layer** since July 2026:
  `NISAR_L2_Geocoded_Polarimetric_Covariance_12Day` in
  `https://worldview.earthdata.nasa.gov/config/wv.json` ("layer":
  the daily layer, "dayRange": 12). It stacks the last 12 days of the
  same GIBS layer this app uses, in the browser, on a flat map. Read
  first-hand here. ASF's documentation says each 12-day mosaic "should
  provide global coverage".
- **JPL has shown per-cycle global mosaics of NISAR's HH backscatter**
  as figures in talks (Fringe 2026, an ARSET course); not browsable.
  (From the search; the slides were not opened here.)
- **Others have built global NISAR mosaics offline** (a pipeline on
  GitHub, `fastice/globalMosaic`); no public viewer was found. (From the
  search.)
- **What is ours, and measured.** (1) 48 days, not 12. Because NASA
  publishes passes up to two weeks late, the 12 days ending on the
  newest day (12 November) cover 25.1 % of the map picture, which is
  41.8 % of what the 48-day picture covers; 12 days ending three weeks
  earlier cover 97.7 %. (From the daily world pictures fetched on 14 and
  15 November.) (2) On a 3D globe with terrain. (3) Damaged tiles
  replaced: 43 % of NASA's tiles in a worldwide sample; another team's
  viewer (`OPERA-Cal-Val/nisar-water-viewer`) warns of the same damage
  at fine zoom. (4) Ready-made, so the opening view is a third of a
  megabyte.
- **The claim to make:** "NASA Worldview offers a rolling 12-day NISAR
  mosaic on a flat map. This app takes the same NASA layer, stacks 48
  days so the picture is whole on any date, repairs the damaged tiles,
  and puts it on a 3D globe." **Not to say:** "the first global NISAR
  map" or "nobody has assembled this before".
- Also learnt: NASA's layer starts on 29 October 2025, not in 2026; the
  app's date picker starts on 1 April 2026.

### Can the next pass be predicted? (team discussion, 15 Nov, afternoon)

The idea is Trisrota's: predict what NISAR's next pass over a place will
read, and judge the prediction by its measured error (RMSE, MAE, R²,
Spearman; accuracy, precision, recall and F1 for rare events) before
building anything on it. The lead added: what is the error margin for
the paddy's November value?

- **Data.** `tools/measure.py --grid 500` writes every pass cell by cell
  (`<site>_grid.json`); the scheduled job does so now. Bardhaman: 1,024
  cells of 500 m, 12 passes.
- **`tools/forecast.py`** predicts each pass from the fifth on, from the
  passes before it only, three ways: the same as last time; a straight
  line on; and a ridge regression on the last three passes of both
  channels, fitted on every cell's history so far ("learnt"). It writes
  `<site>_forecast.json` for sites with eight passes or more (six sites
  on 15 November) and the app shows it under the measurements
  (`forecastHtml` in `js/measured.js`). Test: `python
  tests/test_forecast.py` (made-up cells whose behaviour is known; a
  check that nothing of the future goes into a prediction).
- **What it found, rice fields of Bardhaman.** Learnt: RMSE 1.62 dB, MAE
  1.19, nine cells in ten within 2.61 dB, R² 0.81, Spearman 0.92. Same
  as last time: RMSE 1.95, MAE 1.54. While the crop grew (12 September
  to 18 October) the learnt way had the area's mean right to within
  0.3 dB. At the harvest pass (11 November) it predicted -4.4 dB and
  NISAR measured -6.1 dB: 1.7 dB off, RMSE 1.92. It had never seen a
  harvest. "A change of 3 dB or more by the next pass" happened in
  11.9 % of cell readings; the learnt way called it with precision 0.41
  and recall 0.15 (F1 0.22). That is poor.
- **What it found elsewhere.** Aletsch, the GERD reservoir, Jakobshavn,
  the Okavango and Rondônia: nothing beats "the same as last time", off
  by 0.4 to 0.8 dB on average, nine cells in ten within 0.9 to 1.9 dB.
  That figure is the yardstick for calling a change real there.
- **What the prediction is good for.** Not for foretelling. For telling
  a change from the ordinary: the share of cells outside the range nine
  in ten had kept to on the passes before. Bardhaman: 1, 0, 4, 1 and 0 %
  on the five passes of the growing crop, 16 % at the harvest pass.
  Okavango: 25 % on 24 October. Jakobshavn: 36 % on 29 September.
- **What must not be claimed.** That the app predicts harvests, floods
  or fires. There is one season of data, so no model here has seen a
  turning point before it happened; a seasonal forecast needs a second
  year. Cells next to each other change together, so the thousands of
  cell readings are fewer independent samples.
- Events with fewer than eight passes get no prediction check (with five
  passes the learnt way is fitted on one or two steps and its numbers
  mean nothing; on the M 7.0 near Nagqu it was three times worse than
  "the same as last time").

### The planet-wide change picture, baselines, and a film tool (15 Nov, late afternoon)

- **`tools/change.py` and `data/change/`** (970 tiles, 14 MB): each pass
  of 20 October to 12 November against the same pass 48 days earlier.
  The method, the two rules that leave pairs out, the numbers and the
  limits are in the script's header and in `about.json`. In the app: a
  switch "What changed in 48 days, whole planet" in the NISAR menu
  (`loadChange`, `globe.showChange`); a veil layer (`fill`, new in the
  engine) dims the basemap under it and the radar picture is hidden
  while it is on. A helper session did the feasibility step; comparing
  two mosaics, tried first, gives false strips.
- **Checked against the calibrated measurements** where the picture and
  a measurement are the same two passes (6 places): same direction at 5,
  at 7 to 10 picture units per dB. Not at Bardhaman at harvest, where HH
  fell and HV rose: the picture mixes both channels. The key says so.
- **Baselines for the prediction check** (asked for by the team's data
  analyst): persistence, the mean of the earlier passes, a line through
  the last two, a least-squares trend through the last four; the model
  is judged against the best of them. A three-way question (down, stay,
  up; 1 dB is a move) gives a flat-out accuracy next to the accuracy of
  always naming the commonest answer. Bardhaman: model RMSE 1.62 dB
  against 1.79 for the best baseline; direction accuracy 0.57 against
  0.44 for the commonest answer and 0.56 for the two-point line. At the
  five other places no model beats the best baseline.
- **Past data for the model** (the lead's question): Bardhaman is
  measured from 29 October 2025 on and three more rice regions are
  added, to see whether a model that has seen a harvest predicts one.
  Result: NASA has nothing earlier for Bardhaman's track (its 12 passes
  start on 20 June 2026). Punjab and the Sacramento Valley have a full
  year (26 and 28 passes from late November 2025), the Mekong 11 passes.
  Training the same model on those regions' history as well made
  Bardhaman's predictions worse, not better: RMSE 1.70 dB against 1.62
  with its own past alone, and 2.38 against 1.92 at the harvest pass. The
  regions differ too much for a model that only looks three passes back.
  What would help is a second year at the same place. Not built in.
  (The point measured for "Punjab plains" lies in a town: its HH is near
  0 dB all year. It should be moved onto fields.)
- **Does such a model exist already?** (the lead's question.) Yes, for
  another satellite: NASA/JPL's OPERA DIST-ALERT-S1 (Sentinel-1) "uses
  the per-pixel temporal change in radar backscatter to infer surface
  disturbance events" (NASA's Earthdata catalogue, read here). A helper's
  search adds: released 27 October 2026; a baseline of ten passes from
  the three years before; a transformer estimates what the new pass
  should read and a pass 2.5 deviations off is flagged; no NISAR version
  is on OPERA's public product list. (Those details were not opened
  here.) NISAR's own disturbance, cropland and inundation methods are
  science-team algorithms, not next-pass predictors. So: say "the same
  logic as OPERA DIST-S1, applied to NISAR as a prototype"; do not say
  "the first model that predicts NISAR". One year is too little for a
  seasonal model; the helper suggests a peer baseline (the last pass
  plus the median step of similar cells in the same pass), which tells
  a field that departs from its neighbours. Not built.
- **`tools/film.js`** films the app frame by frame with a stepped clock;
  its header holds what was learnt. The 30-second demo of the Bardhaman
  case is made with it.
- The measuring job's Earthdata token lasts 60 days.

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

## Detection, not prediction (15 November 2026, evening)

The team settled the direction: the app **detects** change, it does not
foretell it. One sentence: *it learns what a place normally reads on
radar and shows where the ground did something else.* The named user is
a disaster or aid organisation; the rice fields of Bardhaman are the
proof that the method reads real ground.

What was built for it:

- **Neighbour comparison** (`tools/forecast.py`, the way called `peers`):
  a cell's step between two passes against the median step of all cells
  of the window in the same pass. What hits every cell alike (rain, a
  season, a shift in calibration) drops out. It is closer than every
  forecast at 12 of the 13 places tested (not Rondônia). It needs the
  new pass, so it is not a forecast, and it is never named "best".
- **Events with five to seven passes** are tested too (`MIN_SHORT`),
  with the simplest ways only. Their "usual range" rests on two or three
  earlier steps and is rough; the card says so, and the cell's own range
  is not quoted for them.
- **In the app:** the opening card offers the measured lead cases first
  (`renderProof`, sentence built from the files); the menu starts with
  "Measured by NISAR" (`renderMeasuredList`, from `data/measured/index.json`
  and `forecast.json`), sorted by the share that stood out; the card
  under a measurement is headed "What stood out here?" and shows the
  pass-by-pass table first, baselines and error measures one fold below.

Results as of this evening (first pass after the event; about 10 % is
ordinary):

| Event | Stood out | Can it be read? |
|---|---|---|
| Flood in Italy, 7 Oct | 31 % (then 2 %, 18 %) | yes |
| Prescribed fire, Utah, 3 Nov | 4 % | yes |
| M 5.7 Khuzdar, 17 Oct | 25 % | no: first pass of a new processing version |
| Flood in Indonesia, 24 Oct | 8 % | no: same |
| M 7.0 Nagqu, 22 Oct | 4 % | no: same |

So one clear case out of two that can be read. That is a demonstration,
not a detection rate, and nothing in the app or the submission says
more.

Two findings about NASA's data, both handled at the root:

- **A strip with no signal.** At a wildfire in Wyoming a diagonal band
  across the window read -145 dB in the same cells on every pass, and
  the point itself -43 to -48 dB, which the first guard (-50 dB) let
  through. Perito Moreno's -135 dB is the same kind. The guard is now
  -40 dB (15 dB under NISAR's noise), applied to grid cells as well, and
  `forecast.py` drops any cell that ever read an impossible value. Why
  the files hold such strips is not established (our guess: the radar
  cannot listen while it transmits).
- **A step at a new processing version.** NASA's processing went from
  P05023 to P05036 with the passes from about 21 October 2026 (the part
  of the file name like `P05036`). At that pass the window mean fell at
  12 of 15 places, by 0.4 dB in the middle, and by 0.78 dB in a desert
  that had moved 0.00 to 0.07 dB on the three steps before. Whether it
  is a calibration change we could not confirm from NASA's notes.
  `forecast.py` marks such a pass (`newVersion`), the table tags it, and
  an event whose first pass afterwards is one gets a sentence saying the
  figure cannot be put down to the event. It is also the likely reason
  for the uniform darkening of a few units in the planet-wide change
  picture (rainforest 5 to 7 units), which compares September (old
  version) with late October and November (mostly new).

PR 78 (MadhuraSaha02, why preview brightness is relative) is merged,
with three corrections after checking NASA's sources: the previews are
not shown to be converted to dB, the stretch limits are "not stored in
the picture" (not "cannot be undone"), and the unsourced "about 1 dB"
is dropped. The planet-wide change picture is built from NASA's map
picture instead, which is on one fixed scale for every date (checked:
its green channel follows the calibrated HV values on one line at two
places over 20 passes), though not a decibel scale.

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
  Windows and macOS launchers and keyboard use are unverified. (The sound
  for time-lapses was taken out on 15 November: the team found it added
  nothing, and a judge who clicked it would be disappointed.)
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
2. **Hosting.** Every path is relative, so GitHub Pages works with one
   setting by a repo admin: Settings → Pages → Build and deployment →
   Source: **GitHub Actions** (not "Deploy from a branch": see "The whole
   planet opens the app, and is rebuilt weekly"). The job
   `.github/workflows/pages.yml` then publishes `main` on every push. The
   address would be
   `https://trisrota-commits.github.io/Dancing_with_the_SARs_NASA_Challenge/`.
   Not yet switched on; until it is, the job says so and does nothing.
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
