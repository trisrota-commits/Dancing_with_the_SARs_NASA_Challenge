# Data rules and remaining gaps

This note covers two things:

1. Which data we may use, besides NISAR.
2. The gaps that remain in the app, and how to solve each one.

## 1. Which data we may use

**Short answer: NISAR must be the core, but other data is allowed as context.**

The challenge text says so directly:

- It suggests downloading "supplemental data such as optical images or GIS
  (geographic information systems) layers to contextualize the SAR imagery".
- Under "Potential Considerations", it suggests analysing NISAR "with different
  polarizations and/or different frequencies (from other sensors)".
- It also suggests ancillary datasets "(population, vegetation type, etc.)".

So Sentinel-1, optical imagery, fire detections and elevation are all fine.
The one rule is that NISAR must do the main work. Other data explains or
backs up what NISAR shows; it never replaces it.

### What we use now, and its role

| Data | Role | Fine to use? |
|---|---|---|
| NISAR GCOV backscatter (previews, GIBS tiles) | Core: what changed on the ground | Yes, core |
| NISAR GUNW interferograms | Core: ground movement, e.g. earthquakes | Yes, core |
| USGS, NASA EONET, GDACS event feeds | Tells us *where* to look | Yes, context |
| OPERA DSWx and RTC (Sentinel-1, C-band) | Second radar frequency; fills gaps between NISAR passes | Yes, and it answers the "different frequencies" suggestion |
| VIIRS fire detections | Context for wildfires | Yes, context |
| Esri imagery, Mapzen terrain, Photon place search | Basemap and navigation | Yes, background |

### How to keep this clear for the judges

- In every event panel, show the NISAR section first.
- Label anything else as **context**, with its sensor name. The replay
  labels already do this well.
- When we show Sentinel-1 next to NISAR, say why. C-band (about 5.6 cm
  wavelength) and L-band (about 24 cm) see different things. L-band passes
  further through vegetation and dry snow. That comparison is a strength.

## 2. Remaining gaps and how to solve them

The judging criteria are Impact, Creativity, Validity, Relevance and
Presentation. Each gap below maps to one or more of them.

### Gap 1: fresh events often have no "after" scene

**The problem.** The event list reaches back 14 days at most. NISAR revisits
the same track and frame every 12 days, and products arrive hours to two days
after acquisition. So most fresh events have a "before" scene but no "after"
scene yet. Interferograms (GUNW) currently end around 9 October 2026 (see
`DATA_SOURCES.md`), so recent earthquakes have none at all. A judge clicking
a fresh event will often see "no repeat pass". That is honest, but weak.

**Fix 1a: a "Since NISAR data began" time window.** Calibrated NISAR data
starts on 17 June 2026. Add a time-window option that reaches back to that
date. Most events from June to October will then have both scenes, and older
earthquakes will have interferograms. The live feeds only cover recent days,
so this needs their archive versions:

- USGS: the FDSN event query API takes `starttime`, `endtime` and
  `minmagnitude` (for example M6+ to keep the globe readable).
- NASA EONET v3: `events` accepts `start`, `end` and `status=all`.
- GDACS: the `SEARCH` endpoint accepts from and to dates.

Check first that each archive endpoint answers from the browser (CORS), as
`DATA_SOURCES.md` did for the live ones.

**Fix 1b: predict the next NISAR pass.** Turn the dead end into something
useful. NISAR repeats each track every 12 days, so the next pass can be
estimated from the scenes already found:

1. Group the scenes over the event by track, direction and frame (the
   existing `stack` field).
2. For each group, take the newest scene time.
3. Add 12 days. If that date is already past (a missed acquisition), keep
   adding 12 days until it is in the future.
4. Show the earliest result across groups.

Suggested panel text:

> ✓ Before scene: 8 Nov 2026 (track 12, frame 34)
> ⏳ Next NISAR pass over this spot: expected around 20 Nov 2026
>
> NISAR revisits each spot every 12 days. Not every planned pass is
> acquired, so this date is an estimate.

**Fix 1c: offer Sentinel-1 while we wait.** The OPERA Sentinel-1 layers are
already in the app. When there is no NISAR "after" scene, offer them in the
panel:

> Sentinel-1 (C-band) imaged this area on 12 Nov. NISAR (L-band) is expected
> around 20 Nov.

### Gap 2: the change view is a guide, not a measurement

**The problem.** The change view works on NASA's 8-bit preview images. The
README already says this honestly. But a SAR expert on the judging panel will
still ask whether the brightness differences are real backscatter change.
This affects the Validity score.

**Fix 2a: full-resolution analysis for a few showcase events.** For three or
four events (see Gap 3), process the full GCOV files offline:

1. Download the before and after GCOV HDF5 files from ASF (free Earthdata
   login).
2. Read the HHHH and HVHV covariance layers, which are calibrated backscatter.
3. Convert to decibels: `10 * log10(value)`.
4. Apply a speckle filter (for example a 5×5 boxcar or Lee filter).
5. Compute the difference in dB (after minus before), per polarization.
6. Export the result as a PNG with its lat/lon bounds, in the same format the
   app already uses for previews.

Then the showcase can say, for example, "HV dropped by 6 dB over the burn
scar". That is a real, checkable measurement.

**Fix 2b: state the method in the app.** Next to each processed result, add a
short line: product, dates, polarization, filter, threshold. Judges trust
teams that show their method.

### Gap 3: the app shows data but does not yet explain it

**The problem.** The brief asks teams to "hypothesize the physical drivers
behind what you see (or don't see) in the SAR data". It also asks which
polarizations highlight the changes. The app's radar notes are good, but they
are general. No event yet has a specific, worked explanation. This affects
Impact, Relevance and Validity.

**Fix 3a: curated showcase events.** Pick three or four past events with good
NISAR data, each a different kind of change. Candidates to check in ASF
Vertex:

- **Venezuela earthquakes, 24 June 2026.** NASA has published NISAR ground
  displacement for these, so a GUNW interferogram should span the event.
- **A flood** between June and October with a clean before/after pair. Open
  water should darken, and flooded vegetation should brighten (double bounce).
- **A wildfire scar.** HV backscatter should drop where the canopy burned,
  while HH changes less.
- **Optional, cryosphere:** the Greenland melt season (June to October). Wet
  snow absorbs the signal, so backscatter drops during melt and recovers on
  refreeze.

**Fix 3b: answer the brief's questions for each showcase event.** Each
showcase panel should cover:

1. What changed, with numbers where possible (from Fix 2a)?
2. What is the physical driver?
3. Which polarization shows it best (HH or HV), and why?
4. What did NISAR see that optical imagery could not (cloud, smoke, night)?
5. Who is affected, and what could NISAR be used for next?

**Fix 3d: changing places (done).** Slow changes such as glacier loss never
appear in event feeds. The app now marks 27 places with diamonds: 13 glaciers
worldwide, plus sinking cities, wetlands, forest loss and farming seasons.
Each place says what NISAR can show there and plays the time-lapse. The list
is in `js/places.js`, so swapping or adding a place is one entry. Check each
place in the app: if the time-lapse finds few passes, replace it.

**Fix 3c: a "Showcase" entry point.** Add a button or menu that flies to each
showcase event in turn. This gives the demo a reliable path and makes the
science easy to find for anyone using the app after the hackathon.

### Gap 4: the demo itself

**The problem.** A live app depends on live feeds and venue internet. Clicking
random dots in front of judges is risky.

**Fix: script and rehearse the demo.**

1. **About 20 seconds:** the live globe, with events arriving. This is the
   wow moment.
2. **About 30 seconds:** click one fresh event. Show the before scene, the
   next-pass prediction and the Sentinel-1 context.
3. **The rest:** a showcase event with the before/after, the measured change
   and the explanation.

Rehearse it at least twice. Record a backup video in case the internet is
slow.

### Optional: make the name pay off

"Dancing with the SARs" fits the brief's music theme ("wherever the music
calls you"). Nothing in the app plays on it yet. One idea, only if time
allows: in the showcase, play a backscatter time series as sound, so a melt
season or a flood has an audible rhythm. The Web Audio API is enough for this.

## Checklist

- [ ] 1a: archive endpoints checked for CORS
- [x] 1a: "Since NISAR data began" window added
- [x] 1b: next-pass prediction in the event panel
- [x] 1c: Sentinel-1 offer when there is no after scene
- [ ] 2a: full-resolution dB difference maps for the showcase events
- [ ] 2b: method line next to each processed result
- [ ] 3a: showcase events chosen and data checked in Vertex
- [ ] 3b: explanation written for each showcase event
- [x] 3c: entry point for curated places (the "Changing places" list)
- [x] 3d: changing places: glaciers worldwide and other slow changes
- [ ] 4: demo script rehearsed, backup video recorded
- [ ] README: short "Data we use and why" section linking to this file
