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

*Being written: the inventory of every colour and mark in the app is in
progress. Until this section is filled in, treat the sources above as the
rules.*
