# Data rules and demo plan

Written on Saturday 14 November 2026, mid-hackathon. This note covers two things:

1. Which data we are allowed to use, besides NISAR.
2. How to make sure the demo never lands on an empty radar panel.

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
- Label anything else as **context**, with its sensor name (the replay
  labels already do this well).
- When we show Sentinel-1 next to NISAR, say why: C-band (about 5.6 cm
  wavelength) and L-band (about 24 cm) see different things. L-band passes
  through vegetation and dry snow further. That comparison is a strength.

## 2. The demo gap

### The problem

The event list only reaches back 14 days at most. NISAR revisits the same
track and frame every 12 days, and products arrive hours to two days after
acquisition. So most fresh events have a "before" scene but no "after" scene
yet. Interferograms (GUNW) currently end around 9 October 2026 (see
`DATA_SOURCES.md`), so recent earthquakes have none at all.

If a judge clicks a fresh event, the panel will often say there is no repeat
pass. That is honest, but it is a weak moment in a demo.

### Fixes, in priority order

#### Fix 1: a "Since NISAR data began" time window (code, highest value)

Calibrated NISAR data starts on 17 June 2026. Add a time-window option that
reaches back to that date. Most events from June to October will then have
both a before and an after scene, and older earthquakes will have
interferograms.

The live feeds only cover recent days, so this needs their archive versions:

- USGS: the FDSN event query API takes `starttime`, `endtime` and
  `minmagnitude` (for example M6+ to keep the globe readable).
- NASA EONET v3: `events` accepts `start`, `end` and `status=all`.
- GDACS: the `SEARCH` endpoint accepts from and to dates.

**Check first** that each archive endpoint answers from the browser
(CORS), the same way `DATA_SOURCES.md` checked the live ones.

#### Fix 2: predict the next NISAR pass (code, small change)

Turn the dead end into something useful. NISAR repeats each track every
12 days, so we can estimate the next pass from the scenes we already find.

Logic:

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

This shows the judges we understand how the mission works.

#### Fix 3: show Sentinel-1 while we wait (wording, mostly done)

The OPERA Sentinel-1 layers are already in the app. When there is no NISAR
"after" scene, offer them in the panel. For example:

> Sentinel-1 (C-band) imaged this area on 12 Nov. NISAR (L-band) is expected
> around 20 Nov.

#### Fix 4: curated showcase events (science, Madhura)

Pick three or four past events where we know the NISAR data is good, and give
each a short, careful explanation. Candidates to check in ASF Vertex:

- **Venezuela earthquakes, 24 June 2026.** NASA has published NISAR ground
  displacement for these, so a GUNW interferogram should span the event.
- **A flood** between June and October with a clean before/after pair. Open
  water should darken, and flooded vegetation should brighten (double bounce).
- **A wildfire scar.** HV backscatter should drop where the canopy burned.
- **Optional, cryosphere:** the Greenland melt season (June to October). Wet
  snow absorbs the signal, so backscatter drops during melt and recovers on
  refreeze.

For each showcase event, the panel should answer the questions in the brief:

1. What changed?
2. What is the physical driver?
3. Which polarization shows it best (HH or HV), and why?
4. Who is affected, and what could NISAR be used for next?

If time allows, process the full-resolution GCOV files for the showcase
events offline (calibrated values in dB) instead of the 8-bit previews. Then
the showcase change maps are real measurements, not just a guide to where to
look.

#### Fix 5: script the demo (everyone)

Do not click random live dots in front of the judges. Suggested order:

1. **About 20 seconds:** the live globe, spinning, with events arriving. This
   is the wow moment.
2. **About 30 seconds:** click one fresh event. Show the before scene, the
   next-pass prediction and the Sentinel-1 context.
3. **The rest:** a showcase event with a full before/after, the change view
   and the explanation.

Rehearse it at least twice, and record a backup video in case the
venue's internet is slow.

## Checklist

- [ ] Fix 1: archive endpoints checked for CORS
- [ ] Fix 1: "Since NISAR data began" window added
- [ ] Fix 2: next-pass prediction in the event panel
- [ ] Fix 3: Sentinel-1 offer in the panel when there is no after scene
- [ ] Fix 4: showcase events chosen and data checked in Vertex
- [ ] Fix 4: explanation written for each showcase event
- [ ] Fix 5: demo script rehearsed, backup video recorded
- [ ] README: short "Data we use and why" section linking to this file
