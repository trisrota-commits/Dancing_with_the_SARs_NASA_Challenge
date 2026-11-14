# Visual rules

Nobody presents this app. A judge opens it alone, so every colour and every
mark has to mean one thing, mean it everywhere, and be explained on screen.
These are the rules the app follows, where each one comes from, and where
it lives in the code. A change that breaks a rule is a bug.

## Where the rules come from

NASA does not publish one colour standard for apps like this. What exists,
and what we follow:

1. **NASA Earth Observatory, "Subtleties of Color"** (Robert Simmon, 2013,
   six parts). NASA's own guidance on choosing colours for data:
   - Three kinds of data need three kinds of palette. *Sequential* data:
     "vary evenly from light to dark". *Divergent* data: "two different
     hues that vary from a central neutral color". *Categories*: "colors
     as distinct from one another as possible", at most "about 12
     (practically speaking, probably fewer)"; beyond that, group classes
     or add symbols and "label each element directly".
   - "Whenever possible, make intuitive palettes." Water is blue,
     vegetation green, "red, orange, and yellow are hot".
   - No rainbow palette "unless there's a reason more compelling than
     'that's how we've always done it'".
   - Missing data is grey, distinct from the data next to it.
   - Red against green is the pair colour-blind readers cannot tell apart.
   https://science.nasa.gov/blogs/earth-matters/2013/08/12/subtleties-of-color-part-3-of-6/
   https://science.nasa.gov/blogs/earth-matters/2013/08/19/subtleties-of-color-part-4-of-6/
2. **The NISAR picture convention** (Alaska Satellite Facility, NASA's
   archive for NISAR): the same-polarisation echo (HH or VV) goes into the
   red and blue channels, the cross-polarisation echo (HV or VH) into
   green. Strong HH alone therefore looks magenta, strong HV green, both
   together white. We did not choose these colours; they are in NASA's
   preview pictures. https://nisar-docs.asf.alaska.edu/worldview/
3. **The colours an agency gives its own data.** Where the data arrives
   with a colour, we use it and do not invent one:
   - USGS shaking outlines carry their ShakeMap colour in the file itself
     (the `color` of each contour in `cont_mmi.json`).
   - GDACS alert levels are green, orange and red.
4. **Colour-blind safety is computed, not judged by eye.** Palettes are
   checked with a validator (lightness, chroma, separation under the three
   common kinds of colour blindness).

## The rules

### 1. One colour family, one meaning

All of these live in `PALETTE` in `js/config.js`. A colour that means
something is taken from there, never typed in where it is used.

| Colour | Means, everywhere | Why this colour |
|---|---|---|
| Teal | NISAR: footprints, the frame of a pass, pass ticks on timelines, the orbit and the satellite, the ring on an event NISAR has imaged | The app's own colour; nothing else on the map may use it |
| Magenta and green | The two radar channels: same-polarisation echo (HH or VV) and cross-polarisation echo (HV or VH), in pictures, keys and charts | NASA's preview pictures (source 2) |
| Blue to orange | Change between two passes: the echo got weaker, or stronger. "No change" is the neutral middle and is not drawn | A divergent pair as source 1 asks for, and one that colour-blind readers can tell apart (not red against green) |
| White | The reader's own focus: the selection ring, the divider, the handle, "today", the current position on a path | |
| Grey | Context that is not the subject: quakes before the event, links to other events, missing data | Source 1: missing data is grey |
| Seven family colours | The kind of event or place (rule 2) | Intuitive where an association exists (source 1): water blue, fire orange, vegetation green, ice white |

### 2. Kinds of event and place: seven families, and always in words

Thirteen event types and eight kinds of place each had a colour of their
own. Measured, they could not be told apart: wildfire, drought, heat and
dust were closer than 7 on a scale where 15 is the minimum for full
colour vision, and no set of thirteen survives colour blindness. NASA's
guidance says the same: about twelve at most, "probably fewer", otherwise
group classes and label directly.

So kinds are grouped by what physically happens, and events and places
share the families:

| Family | Colour | Event types | Places |
|---|---|---|---|
| The ground moves | red | earthquake, volcano, landslide | sinking ground, volcanoes, moving slopes |
| Fire | orange | wildfire | |
| Water | blue | flood | wetlands |
| Weather | violet | storm, drought, dust and haze, extreme heat or cold | |
| Ice and snow | ice white | sea and lake ice, snow | glaciers |
| Vegetation | yellow-green | | forest loss, farming seasons |
| Human-made and other | slate grey | human-made, other | human-made change |

Checked with the validator: every pair is at least 15.5 apart for full
colour vision. The closest pair under colour blindness is weather against
water (7.4, where 8 is the target), which is only acceptable with a second
cue. That second cue is the rule: **the kind is always also in words**, in
the hover label of every dot, on the filter buttons, in the lists and on
the card. Colour never has to say it alone.

Events are round dots; places are diamonds.

### 3. The shape says what sort of thing it is

| Shape | Is always |
|---|---|
| Filled patch on the ground | Something a radar measured: a radar picture, a change map, water seen by radar |
| Outline | An area somebody published (burnt area, affected area, wind zones, shaking outlines), or in teal the area one NISAR pass covered |
| Dot or glowing spot | One observation at one point: an event, a quake, a fire detection |
| Solid line | A path really travelled: a storm track, the orbit flown |
| Dashed line | Not an observation: a link between events, the orbit ahead, the next expected pass, a reference date |
| Ring around a dot | The dot's state: teal = NISAR imaged it, white = selected, quick spreading rings = arrived in the last minutes, one soft ring every five seconds = first reported in the last 24 hours |

Two filled patches with different meanings are never on the ground
together: while a change map is up, the event's own water layer steps
aside (`globe.setEffectFillsShown`).

### 4. An agency's scale stays the agency's

- **Shaking strength** uses the USGS ShakeMap colours, taken from the
  `color` field USGS puts on each outline. It is a rainbow scale, which
  source 1 advises against; the compelling reason to keep it is that it
  is the published standard seismologists read, and it arrives with the
  data. The key shows the real ramp.
- **GDACS wind zones** use GDACS's green, orange and red.
- **NASA's map layers** (rain, soil moisture, land cover and so on) show
  NASA's own legend picture under the layer's switch, loaded from NASA
  (the `LegendURL` of each layer in the GIBS catalogue). We do not
  describe NASA's colours in our own words. Two layers are pictures and
  have no legend there; they get one plain line each.
- **NASA draws NISAR in two ways**, and the app says which is which. The
  single preview pictures shown for an event are magenta and green. The
  map layer is green, orange, blue and red, described in the words of
  NASA's archive. The menu's key used to describe the map layer with the
  preview's colours, which was wrong.
- **Fire** follows heat: bright yellow is hot, dark red has cooled.

### 5. Everything drawn is explained on screen, and animation is named

- The key on the globe lists the radar picture's colours and, under
  "Also on the globe", every mark the open event draws (`plan.key` in
  `js/replay/replay.js`).
- The key in the menu explains the event dots: colour, size, the three
  rings, the path line.
- What is animation and not data is said so in the key: fire smoke and
  shimmer, the storm's cloud spiral, the water's ripples.
- A key swatch shows the colour that is really drawn.

### 6. Status colours stay on the controls

Green for working, new or live, and red for failed, appear only on
buttons, lights and badges, always with a word, never on the map.

## Checked by the tests

`tests/visual.test.mjs` fails when:

- an event type or place kind has a colour that is not its family's;
- two families come closer than 15, or there are more than eight;
- teal comes close to a family colour;
- weaker/stronger or the two channel colours come close to each other;
- the change colours in the app and in `tools/measure.py` differ;
- one of the palette's colours is typed into the code outside the palette;
- an event type draws on the globe without a key.

## Known exceptions

- **Wildlife** (an optional layer) keeps nine species colours of its own.
  Each sighting is named on hover and on its button.
- **GDACS orange and red** are the same hues as the fire and ground
  families. They only appear as wind zones around a storm.
- **Flood blue and "echo got weaker" blue** are close. The flood colour is
  a dot and an outline, the change colour a filled patch, and the two
  fills never share the ground (rule 3).
- **The interferogram's colour cycle** is NASA's rendering of the preview
  picture; its key says what one cycle means.
- The validator's lightness band was not applied: it is meant for chart
  marks on a page, and these are lights on a dark globe. Contrast against
  the globe passes for every family.
- The four swatches for NASA's NISAR map layer are our reading of its
  colours from a sample tile; the words beside them are the archive's.
- The headline word lists and all key texts are English only.
