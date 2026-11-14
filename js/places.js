// Changing places: slow changes that no event feed reports, such as glacier
// loss, sinking cities, wetland flood pulses, forest clearing and farming
// seasons. Each place opens the NISAR time-lapse for that spot.
//
// The "story" text is long-term background, not something NISAR measured
// here; the panel labels it as context. The "look" text says what NISAR's
// first months of data (from June 2026) can show.

export const NISAR_START = '2026-06-17'; // first calibrated NISAR L-band data

export const PLACE_KINDS = {
  glacier: {
    label: 'Glaciers',
    color: '#cfe9ff',
    look: 'In the melt season, wet snow and ice absorb the L-band signal, so the glacier turns dark in the time-lapse. When it refreezes in autumn, it brightens again. At a calving front, watch the edge between bright ice and dark water move. HH carries most of the signal over ice; HV is weaker.',
    note: 'Northern glaciers melt from June to September, while southern ones are in winter. Compare a northern glacier with a Patagonian or New Zealand one to see the two hemispheres move out of step.',
    links: [
      ['NASA ITS_LIVE: glacier speeds worldwide', 'https://its-live.jpl.nasa.gov/'],
      ['Randolph Glacier Inventory (GLIMS)', 'https://www.glims.org/RGI/'],
      ['World Glacier Monitoring Service', 'https://wgms.ch/'],
    ],
  },
  subsidence: {
    label: 'Sinking ground',
    color: '#d08a4e',
    look: 'Sinking ground barely changes the radar brightness, so the backscatter time-lapse shows little here. The change shows up in interferograms instead: one full colour cycle is about 12 cm of movement towards or away from the satellite (half of NISAR’s 24 cm wavelength).',
    note: 'Most of this sinking comes from pumping groundwater faster than it refills, which compacts the clay layers underground.',
    links: [],
  },
  wetland: {
    label: 'Wetlands',
    color: '#3cc0a0',
    look: 'Open water turns dark. Flooded forest or reeds turn very bright in HH, because the signal bounces off the water and then the stems (a “double bounce”). As the flood spreads and retreats, these dark and bright patches move.',
    note: 'Radar sees flooding under a forest canopy, which optical satellites cannot. That makes L-band especially useful for wetlands.',
    links: [],
  },
  forest: {
    label: 'Forest loss',
    color: '#66bb44',
    look: 'Forest gives a strong HV echo from leaves and branches. Where it is cleared, HV drops sharply and stays low. L-band sees through the clouds that hide tropical forests for much of the year.',
    note: 'L-band reaches deeper into the canopy than shorter radar wavelengths, so it relates more closely to forest structure and biomass.',
    links: [['Global Forest Watch', 'https://www.globalforestwatch.org/']],
  },
  farming: {
    label: 'Farming seasons',
    color: '#e6d24a',
    look: 'Flooded paddies at planting turn dark, because calm water reflects the pulse away. As the rice grows, stems standing in water brighten HH through double bounce, and HV rises with the canopy. After harvest the fields fall dark again.',
    note: 'June to November covers the monsoon rice season in South and Southeast Asia, so NISAR’s first months show one whole crop cycle there.',
    links: [],
  },
};

export const PLACES = [
  // ---------- glaciers ----------
  {
    id: 'jakobshavn',
    kind: 'glacier',
    name: 'Sermeq Kujalleq (Jakobshavn)',
    region: 'Greenland',
    lat: 69.17,
    lon: -49.9,
    story: 'One of the fastest-flowing glaciers in the world and a major source of Greenland’s ice loss. Its icebergs fill the Ilulissat Icefjord.',
  },
  {
    id: 'helheim',
    kind: 'glacier',
    name: 'Helheim Glacier',
    region: 'Southeast Greenland',
    lat: 66.38,
    lon: -38.2,
    story: 'A large outlet glacier whose calving front moves back and forth through the seasons, on top of a longer-term retreat.',
  },
  {
    id: 'columbia',
    kind: 'glacier',
    name: 'Columbia Glacier',
    region: 'Alaska, USA',
    lat: 61.1,
    lon: -147.08,
    story: 'One of the fastest-retreating tidewater glaciers of recent decades, leaving a new fjord behind it.',
  },
  {
    id: 'athabasca',
    kind: 'glacier',
    name: 'Athabasca Glacier',
    region: 'Canadian Rockies',
    lat: 52.19,
    lon: -117.25,
    story: 'A popular, easily reached glacier that has retreated more than a kilometre since the late 1800s.',
  },
  {
    id: 'breidamerkurjokull',
    kind: 'glacier',
    name: 'Breiðamerkurjökull and Jökulsárlón',
    region: 'Iceland',
    lat: 64.06,
    lon: -16.28,
    story: 'The glacier’s retreat formed the Jökulsárlón lagoon, which keeps growing as the ice melts back.',
  },
  {
    id: 'aletsch',
    kind: 'glacier',
    name: 'Aletsch Glacier',
    region: 'Swiss Alps',
    lat: 46.47,
    lon: 8.03,
    story: 'The largest glacier in the Alps. It is thinning and shortening, and Alpine glaciers have lost a large share of their ice in recent decades.',
  },
  {
    id: 'gangotri',
    kind: 'glacier',
    name: 'Gangotri Glacier',
    region: 'Uttarakhand, India',
    lat: 30.93,
    lon: 79.08,
    story: 'The source of the Bhagirathi, a headwater of the Ganges. It has been retreating for decades.',
  },
  {
    id: 'imja',
    kind: 'glacier',
    name: 'Imja Tsho glacial lake',
    region: 'Khumbu, Nepal',
    lat: 27.9,
    lon: 86.92,
    story: 'One of the fastest-growing glacial lakes in the Himalaya. Lakes like this can burst and flood the valleys below, so they are watched closely.',
  },
  {
    id: 'khumbu',
    kind: 'glacier',
    name: 'Khumbu Glacier',
    region: 'Everest region, Nepal',
    lat: 27.97,
    lon: 86.83,
    story: 'A debris-covered glacier below Mount Everest. Its surface is lowering, and ponds form and drain on it.',
  },
  {
    id: 'perito-moreno',
    kind: 'glacier',
    name: 'Perito Moreno Glacier',
    region: 'Patagonia, Argentina',
    lat: -50.48,
    lon: -73.05,
    story: 'Long known as roughly stable while most Patagonian glaciers retreated. In June to September it is in southern winter, a useful contrast with the north.',
  },
  {
    id: 'tasman',
    kind: 'glacier',
    name: 'Tasman Glacier and lake',
    region: 'New Zealand',
    lat: -43.7,
    lon: 170.18,
    story: 'New Zealand’s longest glacier. Its retreat has formed a lake that has grown quickly in recent decades.',
  },
  {
    id: 'pine-island',
    kind: 'glacier',
    name: 'Pine Island Glacier',
    region: 'West Antarctica',
    lat: -75.0,
    lon: -101.0,
    story: 'One of the largest contributors to Antarctic ice loss. Its ice shelf calves large icebergs, and warm ocean water thins it from below.',
  },
  {
    id: 'thwaites',
    kind: 'glacier',
    name: 'Thwaites Glacier',
    region: 'West Antarctica',
    lat: -75.0,
    lon: -106.0,
    story: 'A very wide glacier whose retreat could raise sea level significantly over the coming centuries. Its floating ice tongue is breaking up.',
  },

  // ---------- sinking ground ----------
  {
    id: 'mexico-city',
    kind: 'subsidence',
    name: 'Mexico City',
    region: 'Mexico',
    lat: 19.43,
    lon: -99.13,
    story: 'Built on old lake clays. Some districts sink by tens of centimetres a year, cracking roads, pipes and buildings.',
  },
  {
    id: 'jakarta',
    kind: 'subsidence',
    name: 'North Jakarta',
    region: 'Indonesia',
    lat: -6.12,
    lon: 106.85,
    story: 'Parts of the coast are sinking below sea level, which worsens flooding. This is one reason Indonesia is building a new capital.',
  },
  {
    id: 'san-joaquin',
    kind: 'subsidence',
    name: 'San Joaquin Valley',
    region: 'California, USA',
    lat: 36.1,
    lon: -119.56,
    story: 'Decades of groundwater pumping for farming have lowered the ground by metres in places. It sinks faster during droughts.',
  },
  {
    id: 'tehran',
    kind: 'subsidence',
    name: 'Tehran plain',
    region: 'Iran',
    lat: 35.55,
    lon: 51.25,
    story: 'Among the fastest-sinking areas in the world, driven by groundwater use for the city and farms.',
  },

  // ---------- wetlands ----------
  {
    id: 'okavango',
    kind: 'wetland',
    name: 'Okavango Delta',
    region: 'Botswana',
    lat: -19.3,
    lon: 22.9,
    story: 'Rain in the Angolan highlands arrives months later as a flood pulse, which peaks in the middle of the year, in the dry season.',
  },
  {
    id: 'pantanal',
    kind: 'wetland',
    name: 'Pantanal',
    region: 'Brazil',
    lat: -17.5,
    lon: -57.0,
    story: 'The world’s largest tropical wetland. It floods and dries every year, and recent droughts and fires have hit it hard.',
  },
  {
    id: 'sundarbans',
    kind: 'wetland',
    name: 'Sundarbans',
    region: 'India and Bangladesh',
    lat: 21.9,
    lon: 89.2,
    story: 'The largest mangrove forest on Earth, shaped by tides, rivers and cyclones, and threatened by sea-level rise.',
  },
  {
    id: 'sudd',
    kind: 'wetland',
    name: 'The Sudd',
    region: 'South Sudan',
    lat: 7.0,
    lon: 30.5,
    story: 'A vast swamp on the White Nile. Its extent swells and shrinks with the rains, and recent years brought major floods.',
  },

  // ---------- forest loss ----------
  {
    id: 'rondonia',
    kind: 'forest',
    name: 'Rondônia',
    region: 'Brazilian Amazon',
    lat: -9.9,
    lon: -63.0,
    story: 'Known for its “fishbone” pattern of clearings spreading out from roads into the rainforest.',
  },
  {
    id: 'kalimantan',
    kind: 'forest',
    name: 'Central Kalimantan',
    region: 'Borneo, Indonesia',
    lat: -2.0,
    lon: 113.9,
    story: 'Rainforest and peat swamp forest cleared for plantations. Drained peat burns easily in dry years.',
  },

  // ---------- farming seasons ----------
  {
    id: 'west-bengal',
    kind: 'farming',
    name: 'Rice fields of Bardhaman',
    region: 'West Bengal, India',
    lat: 23.25,
    lon: 87.85,
    story: 'Known as the rice bowl of West Bengal. The main crop is planted with the monsoon rains and harvested in late autumn.',
  },
  {
    id: 'punjab',
    kind: 'farming',
    name: 'Punjab plains',
    region: 'India',
    lat: 30.9,
    lon: 75.85,
    story: 'Rice in the monsoon season, then wheat in winter. Heavy groundwater use for irrigation is lowering the water table.',
  },
  {
    id: 'mekong',
    kind: 'farming',
    name: 'Mekong Delta',
    region: 'Vietnam',
    lat: 10.2,
    lon: 105.6,
    story: 'One of the world’s great rice baskets, with up to three crops a year. It is also sinking and losing ground to the sea.',
  },
  {
    id: 'sacramento',
    kind: 'farming',
    name: 'Sacramento Valley rice',
    region: 'California, USA',
    lat: 39.2,
    lon: -122.0,
    story: 'Rice fields flooded in spring, harvested in autumn, and often flooded again in winter for migrating birds.',
  },
];

// Glaciers in the other hemisphere, to compare seasons side by side.
export function otherHemisphere(place) {
  return PLACES.filter((p) => p.kind === place.kind && p.id !== place.id && Math.sign(p.lat) !== Math.sign(place.lat));
}
