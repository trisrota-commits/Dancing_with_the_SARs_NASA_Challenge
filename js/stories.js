// Curated stories: one place per kind of surface change the challenge names.
//
// Only the choice of place and the explanations are written by hand, and the
// explanations are shown as hypotheses. No measurement appears in this file:
// every number a story shows is computed in the browser from the NISAR
// passes loaded at that moment (see describeSeries in timelapse.js) or read
// from the catalogue and feeds.

export const STORIES = [
  {
    id: 'vatnajokull',
    kind: 'Ice',
    title: 'A glacier through the seasons',
    place: 'Vatnajökull ice cap, Iceland',
    lat: 64.4,
    lon: -16.8,
    action: 'lapse',
    look: 'Watch the ice cap darken and brighten over the year, and compare the summer and winter values in the chart.',
    why: 'Summer melt. Dry winter snow lets the radar pulse in, where ice layers and coarse grains scatter it back strongly. Liquid water in melting snow absorbs the pulse instead, so the echo collapses. When the snow refreezes in autumn, the echo returns.',
    pol: 'Expect the twisted echo (cross-polarised, HV) to fall furthest in summer: it comes from scattering inside the snow, which wet snow shuts off.',
    beyond: 'Winter passes are made in polar darkness and many summer ones through cloud. A camera would see neither.',
    next: 'How long each glacier stays wet each year, measured every 12 days, feeds sea-level and river-flow forecasts. Meltwater from this ice cap feeds rivers used for hydropower.',
  },
  {
    id: 'okavango',
    kind: 'Wetland',
    title: 'A delta that floods in the dry season',
    place: 'Okavango Delta, Botswana',
    lat: -19.3,
    lon: 22.69,
    action: 'lapse',
    look: 'Watch the fan of channels brighten as the months go by, then check when the chart peaks.',
    why: 'The annual flood pulse. Rain that fell in Angola months earlier arrives and spreads through the fan during the local dry season. Water standing under reeds and grasses makes the pulse bounce off the water and then the stems, which brightens the image. The echo fades as the water recedes.',
    pol: 'Flooding under vegetation favours the straight echo (co-polarised, HH). If the twisted echo (cross-polarised, HV) rises just as much, growing vegetation is part of the signal too.',
    beyond: 'Water hidden under a canopy of reeds is invisible in a photograph. The long L-band wavelength gets through the vegetation and back.',
    next: 'Mapping where and when the water arrives each year helps manage a World Heritage wetland that wildlife, tourism and downstream communities depend on.',
  },
  {
    id: 'punjab',
    kind: 'Farmland',
    title: 'Two harvests a year, seen from orbit',
    place: 'Punjab, India',
    lat: 30.9,
    lon: 75.8,
    action: 'lapse',
    look: 'Watch the patchwork of fields change through the year, and look in the chart for months where the two channels pull apart.',
    why: 'A wheat and rice rotation. Wheat grows through the winter and is harvested in spring. Rice is planted into flooded fields in early summer; once the stems stand in water they send the pulse back strongly in the straight echo (co-polarised, HH). After the rice harvest, stubble and rough ground change both channels again.',
    pol: 'The gap between the two channels is the tell: a wide gap is the signature of stems standing in water.',
    beyond: 'The rice season is the monsoon, when cloud hides the fields from cameras for weeks.',
    next: 'Crop area and timing for a whole region every 12 days supports harvest forecasts and water planning.',
  },
  {
    id: 'venezuela',
    kind: 'Earthquake',
    title: 'The ground moves in a major earthquake',
    place: 'Coast of Venezuela',
    lat: 10.6,
    lon: -67.03,
    action: 'event',
    // Which archive event to open: the strongest earthquake near this point.
    category: 'earthquake',
    withinKm: 150,
    look: 'The picture on the globe is an interferogram made from one pass before the earthquake and one after. Find where the colour bands crowd together and count the cycles.',
    why: 'The fault slipped. Ground on one side moved relative to the other, and the movement fades with distance from the rupture, which draws bands of equal movement around it. Speckle is where the two passes do not match, as over the sea.',
    pol: 'Interferograms use the timing of the echo, so one polarisation is enough. For damage at the surface, compare the two backscatter images instead ("Show what changed" below).',
    beyond: 'Radar needs neither daylight nor clear sky, so the first pass after a quake is usable whatever the weather. No camera measures centimetres of ground movement from orbit.',
    next: 'A map of how far the ground moved, within days, shows which fault broke and where shaking damage is likeliest, so responders know where to look first.',
  },
  {
    id: 'mexico',
    kind: 'Ground movement',
    title: 'How to read an interferogram',
    place: 'Mexico City basin, Mexico',
    lat: 19.43,
    lon: -99.13,
    action: 'interferogram',
    look: 'This interferogram compares two passes weeks apart. Notice how broad the bands are compared with the tight ones in the earthquake story.',
    why: 'Most broad bands are not the ground moving. Water vapour and the electrically charged upper atmosphere delay the pulse by different amounts on the two days, which paints smooth bands across hundreds of kilometres. Real ground movement appears as tight bands that stay in the same place in every pair.',
    pol: 'Interferograms use the timing of the echo, not its strength, so one polarisation is enough.',
    beyond: 'No camera can measure centimetres of height change from orbit. Radar can, because it times its own pulse.',
    next: 'Parts of this basin are known to sink as groundwater is pumped out. Slow sinking moves only a fraction of one colour cycle between two passes, so it is measured by stacking many pairs, not from one picture.',
  },
];
