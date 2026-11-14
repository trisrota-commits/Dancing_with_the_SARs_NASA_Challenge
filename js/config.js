// Static configuration: event categories, data endpoints and map layers.

// Every colour that carries meaning, in one place. docs/VISUAL_RULES.md
// gives the rule behind each and where it comes from. A colour that means
// something must come from here, never be typed in where it is used.
export const PALETTE = {
  // Everything NISAR: footprints, the frame of a pass, pass ticks, the
  // orbit, the ring on an event NISAR has imaged.
  nisar: '#39e6c4',
  // The two radar channels, as in NASA's preview pictures: the
  // same-polarisation echo (HH or VV) is in red and blue, so it reads
  // magenta; the cross-polarisation echo (HV or VH) is in green.
  co: '#d85bd8',
  cross: '#4be04b',
  // Change between two passes: a diverging pair around "no change", which
  // is not drawn. Only ever a filled patch on the ground.
  weaker: '#40aaff',
  stronger: '#ffaa3c',
  // The reader's own focus: selection, divider, handle, "today".
  focus: '#ffffff',
  // Context that is not the subject: earlier quakes, links, missing data.
  context: '#9ea8b8',
  // Kinds of event and place, grouped into families by what physically
  // happens. NASA's guidance allows about twelve categories "practically
  // speaking, probably fewer"; seven can be told apart, thirteen cannot.
  family: {
    ground: '#ff5a4f', // the ground moves: earthquakes, volcanoes, landslides
    fire: '#ffa62b', // something burns
    water: '#2f8fff', // water where it was not
    weather: '#d596ff', // the air: storms, dust, heat and cold, drought
    ice: '#e4f4ff', // ice and snow
    life: '#c5e84a', // vegetation: forests and fields
    human: '#7f8ba0', // human-made, and anything else
  },
  // GDACS alert levels, the agency's own three colours.
  gdacs: { green: '#4ade80', orange: '#ffa62b', red: '#ff5a4f' },
  // USGS ShakeMap intensity, used only when a contour arrives without the
  // colour USGS normally gives it. From intensity III to IX and above.
  shaking: ['#a0e6ff', '#80ffff', '#7aff93', '#ffff00', '#ffc800', '#ff9100', '#ff0000'],
};

const F = PALETTE.family;

// Listed family by family, so the filter chips sit together by colour.
export const CATEGORIES = {
  earthquake: { label: 'Earthquake', family: 'ground', color: F.ground, mergeKm: 100, mergeHours: 0.25 },
  volcano: { label: 'Volcano', family: 'ground', color: F.ground, mergeKm: 30, mergeHours: 24 * 14 },
  landslide: { label: 'Landslide', family: 'ground', color: F.ground, mergeKm: 30, mergeHours: 24 * 7 },
  wildfire: { label: 'Wildfire', family: 'fire', color: F.fire, mergeKm: 25, mergeHours: 24 * 7 },
  flood: { label: 'Flood', family: 'water', color: F.water, mergeKm: 100, mergeHours: 24 * 7 },
  storm: { label: 'Storm', family: 'weather', color: F.weather, mergeKm: 300, mergeHours: 24 * 3 },
  drought: { label: 'Drought', family: 'weather', color: F.weather, mergeKm: 300, mergeHours: 24 * 30 },
  dust: { label: 'Dust & haze', family: 'weather', color: F.weather, mergeKm: 300, mergeHours: 24 * 3 },
  heat: { label: 'Extreme heat or cold', family: 'weather', color: F.weather, mergeKm: 300, mergeHours: 24 * 3 },
  ice: { label: 'Sea & lake ice', family: 'ice', color: F.ice, mergeKm: 50, mergeHours: 24 * 14 },
  snow: { label: 'Snow', family: 'ice', color: F.ice, mergeKm: 300, mergeHours: 24 * 3 },
  manmade: { label: 'Human-made', family: 'human', color: F.human, mergeKm: 30, mergeHours: 24 * 3 },
  other: { label: 'Other', family: 'human', color: F.human, mergeKm: 50, mergeHours: 24 * 7 },
};

// What each family colour stands for, for the key.
export const FAMILIES = {
  ground: 'The ground moves: earthquakes, volcanoes, landslides',
  fire: 'Fire',
  water: 'Water: floods and wetlands',
  weather: 'Weather: storms, dust, heat or cold, drought',
  ice: 'Ice and snow',
  life: 'Vegetation: forests and fields',
  human: 'Human-made, and other',
};

// An event first reported within this time counts as recent: the reports
// bar lists it, and its dot sends out a soft ring every few seconds.
export const RECENT_MS = 24 * 3600_000;

// Events of different kinds this close in space and time are shown as related.
export const RELATED_KM = 250;
export const RELATED_DAYS = 14;

export const FEEDS = {
  usgs: {
    label: 'USGS',
    urls: [
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
    ],
    everyMs: 60_000,
  },
  eonet: {
    label: 'NASA EONET',
    urls: ['https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=14'],
    everyMs: 5 * 60_000,
  },
  gdacs: {
    label: 'GDACS',
    urls: [
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ,TC,FL,VO,WF,DR&alertlevel=Green;Orange;Red',
    ],
    everyMs: 5 * 60_000,
  },
};

// Start of the archive time window. Our team's notes give 17 June 2026 as
// the start of calibrated NISAR data, and most scenes with map-ready
// previews in the archive date from about then. Reaching back this far
// gives older events radar scenes on both sides.
export const NISAR_START = Date.UTC(2026, 5, 17);
const since = new Date(NISAR_START).toISOString().slice(0, 10);

// Larger events only, to keep five months of history readable on the globe.
export const ARCHIVE = {
  usgs: [`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&minmagnitude=6&orderby=time`],
  eonet: [`https://eonet.gsfc.nasa.gov/api/v3/events?start=${since}&status=all&category=floods,severeStorms,volcanoes,seaLakeIce,drought,landslides`],
  gdacs: [`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ,TC,FL,VO,WF,DR&fromDate=${since}&alertlevel=Orange;Red`],
};

export const CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json';
export const NISAR_GCOV = ['NISAR_L2_GCOV_V1', 'NISAR_L2_GCOV_PROVISIONAL_V1', 'NISAR_UR_L2'];
export const NISAR_GUNW = ['NISAR_L2_GUNW_V1', 'NISAR_L2_GUNW_PROVISIONAL_V1'];
export const NISAR_LATEST_EVERY_MS = 5 * 60_000;
// How far before an event to look for a "before" radar scene.
export const NISAR_LOOKBACK_DAYS = 45;

const gibs = (layer, ext, level) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/{date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;

// NASA's map service draws any part of a layer on request, where the tile
// service above hands out ready-made tiles. It is slower, so the tile
// engine uses it for two things only (see `sparse` there): one picture of
// the whole world per layer and day, and any single tile the tile service
// sends damaged. `{bbox}` is the area in Web Mercator metres, `{px}` the
// picture's size.
const gibsMap = (layer) =>
  `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&BBOX={bbox}&WIDTH={px}&HEIGHT={px}&TIME={date}`;

// The whole world, 1,024 pixels square: the same as the sixteen level-2
// tiles put together.
const gibsSheet = (layer) => gibsMap(layer).replace('{bbox}', '-20037508.34,-20037508.34,20037508.34,20037508.34').replaceAll('{px}', '1024');

export const NISAR_TILES = {
  id: 'NISAR_L2_Geocoded_Polarimetric_Covariance',
  url: gibs('NISAR_L2_Geocoded_Polarimetric_Covariance', 'png', 13),
  sheet: gibsSheet('NISAR_L2_Geocoded_Polarimetric_Covariance'),
  map: gibsMap('NISAR_L2_Geocoded_Polarimetric_Covariance'),
  maxLevel: 13,
  firstDate: '2026-04-01',
};

export const BASEMAPS = {
  esri: {
    label: 'Satellite (Esri)',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxLevel: 18,
    credit: 'Esri, Maxar, Earthstar Geographics',
  },
  bluemarble: {
    label: 'NASA Blue Marble',
    url: gibs('BlueMarble_ShadedRelief_Bathymetry', 'jpeg', 8).replace('{date}', '2004-08-01'),
    maxLevel: 8,
    credit: 'NASA GIBS',
  },
  viirs: {
    label: 'Yesterday in true colour (VIIRS)',
    url: gibs('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'jpeg', 9),
    maxLevel: 9,
    dated: true,
    credit: 'NASA GIBS',
  },
};

// Optional context overlays, all dated daily tiles from NASA GIBS.
// NASA publishes a legend picture for most of its map layers. The app shows
// that picture and does not describe NASA's colours in its own words. The
// names come from the GIBS catalogue (WMTS GetCapabilities, LegendURL).
const legend = (name) => `https://gibs.earthdata.nasa.gov/legends/${name}_H.svg`;

// Layers that are pictures, not colour-coded values, have no legend there;
// they carry one plain line on how to read them instead.
// Context layers, all tiles from NASA GIBS. Most follow the imagery date;
// those with a `date` are yearly or one-off maps published under that date
// ('default' for a map NASA publishes without one).
//
// `fills` marks a layer that paints the whole land surface (measured: 77 to
// 100 % of a tile over land is drawn). Such a layer hides everything under
// it, so only one of them is shown at a time; the others (strips, alerts,
// rain, ice) lie on top and can be combined.
// How many days back the app looks for the newest day NASA has published
// for a daily layer. Some run days behind (soil moisture two, the
// vegetation alerts about a week).
export const OVERLAY_REACH_DAYS = 12;
export const OVERLAYS = {
  water: {
    group: 'Radar and water',
    label: 'Surface water from radar (OPERA, Sentinel-1)',
    url: gibs('OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1', 'png', 12),
    legend: legend('OPERA_Dynamic_Surface_Water_Extent_S1'),
    maxLevel: 12,
  },
  s1: {
    group: 'Radar and water',
    label: 'C-band backscatter (OPERA, Sentinel-1)',
    url: gibs('OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1', 'png', 12),
    sparse: true,
    sheet: gibsSheet('OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1'),
    map: gibsMap('OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1'),
    note: 'A radar picture from Sentinel-1 (C-band). Bright: rough ground, buildings, vegetation. Dark: calm water and smooth ground.',
    maxLevel: 12,
  },
  soil: {
    group: 'Radar and water',
    fills: true,
    label: 'Surface soil moisture (SMAP)',
    url: gibs('SMAP_L4_Analyzed_Surface_Soil_Moisture', 'png', 6),
    legend: legend('SMAP_Analyzed_Soil_Moisture'),
    maxLevel: 6,
  },
  rain: {
    group: 'Weather and ice',
    label: 'Rainfall rate that day (IMERG)',
    url: gibs('IMERG_Precipitation_Rate', 'png', 6),
    legend: legend('GPM_Precipitation_Rate'),
    maxLevel: 6,
  },
  seaice: {
    group: 'Weather and ice',
    label: 'Sea ice concentration (GHRSST MUR)',
    url: gibs('GHRSST_L4_MUR25_Sea_Ice_Concentration', 'png', 6),
    legend: legend('GHRSST_Sea_Ice_Concentration'),
    maxLevel: 6,
  },
  snow: {
    group: 'Weather and ice',
    label: 'Snow cover (MODIS Terra)',
    url: gibs('MODIS_Terra_L3_NDSI_Snow_Cover_Daily', 'png', 8),
    legend: legend('MODIS_NDSI_Snow_Cover'),
    maxLevel: 8,
  },
  disturbance: {
    group: 'Land and people',
    label: 'Vegetation disturbance alerts (OPERA)',
    url: gibs('OPERA_L3_DIST-ALERT-HLS_Color_Index', 'png', 12),
    legend: legend('OPERA_Vegetation_Disturbance_Status'),
    maxLevel: 12,
  },
  landcover: {
    group: 'Land and people',
    fills: true,
    label: 'Land cover type (MODIS, 2024)',
    url: gibs('MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', 'png', 8),
    legend: legend('MODIS_IGBP_Land_Cover_Type'),
    maxLevel: 8,
    date: '2024-01-01',
  },
  crops: {
    group: 'Land and people',
    fills: true,
    label: 'Croplands (2000)',
    url: gibs('Agricultural_Lands_Croplands_2000', 'png', 7),
    legend: legend('Agricultural_Lands_Croplands_2000'),
    maxLevel: 7,
    date: '2000-01-01',
  },
  population: {
    group: 'Land and people',
    fills: true,
    label: 'Population density (GPW, 2020)',
    url: gibs('GPW_Population_Density_2020', 'png', 7),
    legend: legend('GPW_Population_Density_2020'),
    maxLevel: 7,
    // Published without a date: asking for one is refused.
    date: 'default',
  },
  built: {
    group: 'Land and people',
    fills: true,
    label: 'Built-up areas (Landsat)',
    url: gibs('Landsat_Human_Built-up_And_Settlement_Extent', 'png', 12),
    legend: legend('Landsat_Human_Built-up_And_Settlement_Extent'),
    maxLevel: 12,
    date: '2010-01-01',
  },
  lights: {
    group: 'Land and people',
    fills: true,
    label: 'City lights at night (Black Marble, 2016)',
    url: gibs('VIIRS_Black_Marble', 'png', 8),
    note: 'A night-time picture: the brighter, the more light a place gave off.',
    maxLevel: 8,
    date: '2016-01-01',
  },
};

// Possible mechanisms, not conclusions inferred from the preview comparison.
export const CHANGE_EXPLANATIONS = {
  earthquake: 'Shaking can trigger landslides or alter buildings and surface roughness, which may change radar brightness. Rainfall and soil moisture can also change the return. Brightness alone cannot measure ground displacement or confirm earthquake damage; that needs other evidence, such as validated interferometric analysis.',
  wildfire: 'Fire can alter vegetation structure and moisture, changing the radar return in either direction. Rainfall, soil moisture and seasonal vegetation changes can also affect brightness. This comparison alone cannot confirm a burn scar or measure fire severity.',
  flood: 'Calm open water often returns less radar energy and may appear darker, while water around trees or buildings can produce a stronger return. Wind, surface roughness and soil moisture can also change brightness. Neither dark nor bright pixels alone confirm flooding or measure flood depth.',
  storm: 'Storms can change surface water, soil moisture and vegetation structure. Calm new water may look darker, while wind-roughened water can look brighter. Seasonal changes and differences between acquisitions can look similar; this comparison alone cannot confirm storm damage.',
  volcano: 'Fresh lava or ash can change surface roughness and radar brightness. Rainfall, vegetation changes and viewing geometry can also affect the image. Brightness alone cannot confirm an eruption or measure volcanic deformation; deformation requires separate analysis.',
  ice: 'Changes in ice roughness, snow wetness or open water can alter radar brightness. Temperature, season and viewing geometry also matter. A brightness change alone cannot establish ice loss, melt volume or ice motion.',
  drought: 'Drying soil and changing vegetation moisture or structure can alter the radar return. Rainfall, harvesting and seasonal growth can produce similar changes. Brightness alone cannot confirm drought or quantify crop loss.',
  landslide: 'A slope failure can strip vegetation and change surface roughness, which may change radar brightness in either direction. Rainfall, soil moisture and seasonal vegetation changes can also affect the return. Brightness alone cannot confirm a landslide or measure how far the ground moved; that needs interferometric or pixel-offset analysis.',
  snow: 'New, wet or melting snow can change the radar return: wet snow often looks darker, while dry snow is nearly transparent at L-band. Temperature and the time of day of each pass also matter. Brightness alone cannot measure snow depth or water content.',
  dust: 'Radar sees through dust and haze, so any change comes from the ground, such as drying soil or vegetation. Rainfall and seasonal changes can produce similar patterns. This comparison cannot detect the dust itself.',
  heat: 'Heat can dry soil and vegetation or melt snow and ice, which may change radar brightness. Rainfall, irrigation and seasonal growth can produce similar changes. Brightness alone cannot measure temperature or confirm heat damage.',
  manmade: 'Construction, accidents or spills can change surface roughness or water cover, which may change radar brightness. Weather and seasonal changes can look similar. Compare independent observations before attributing a change to a particular event.',
  other: 'Changes in water, vegetation, soil moisture or surface roughness can alter radar brightness. Weather, season and differences between acquisitions can produce similar patterns. Compare independent observations before attributing a change to a particular event.',
};

// Who could act on NISAR's view of each kind of event, and how. Written by
// us and shown as our view, one sentence each, claiming only what the
// radar can deliver.
export const WHO_USES = {
  earthquake: 'Emergency planners and geologists: an interferogram from the passes either side of a quake shows which fault moved and where the ground shifted most, before field surveys can.',
  wildfire: 'Forest and fire agencies: radar maps burnt ground through smoke and cloud, and later passes show whether the vegetation is coming back.',
  flood: 'Flood managers and relief teams: radar shows where water stands, under cloud and at night, which tells them which roads and villages are cut off.',
  storm: 'Coastal and disaster agencies: after landfall, radar shows flooded and battered land while cloud still hides it from cameras.',
  volcano: 'Volcano observatories: ground that swells or sinks by centimetres between passes can be a sign of magma moving below.',
  ice: 'Ship routing, coastal communities and climate scientists: radar follows sea ice and glacier fronts through the polar night.',
  drought: 'Water managers and advisers to farmers: a falling radar echo over fields follows drying soil and thinning crops across whole regions.',
  landslide: 'Planners of roads and towns in the mountains: radar shows slopes that creep before they fail, and the scar afterwards.',
  snow: 'Water managers: the echo drops when snow turns wet, which marks the start of the melt that feeds rivers.',
  dust: 'Few people directly: radar looks straight through dust and haze. It can show the dry ground the dust came from.',
  heat: 'Advisers to farmers and water managers: radar follows soil and crops drying out through a heat wave.',
  manmade: 'Regulators and insurers: radar shows where a surface changed after an accident, whatever the weather.',
  other: 'Anyone who needs to know whether the ground changed: compare the pass before with the pass after.',
};

// What L-band radar is expected to show for each kind of event.
export const RADAR_NOTES = {
  earthquake:
    'Ground shifts of a few centimetres show up as coloured fringes in an interferogram made from a scene before and a scene after the quake. Backscatter images change only where buildings collapse or slopes fail.',
  wildfire:
    'Burning removes leaves and branches, so the cross-polarised return (HV) drops over the scar while HH changes less. L-band sees through smoke and cloud, day or night.',
  flood:
    'Calm open water reflects the radar pulse away and turns dark. Flooded forest or crops do the opposite and brighten in HH, because the signal bounces off the water and then the stems.',
  storm:
    'Radar images through the cloud deck. Look for dark new water along coasts and rivers after landfall, and rougher, brighter sea surface under strong wind.',
  volcano:
    'Inflation or deflation of the edifice appears as fringes in interferograms. Fresh lava and ash change surface roughness, which shifts backscatter between scenes.',
  ice: 'Sea ice roughness and age separate clearly at L-band. Pixel-offset products track how far the ice or a glacier moved between two passes.',
  drought:
    'Backscatter falls as soil dries, because dry soil has a lower dielectric constant. Crop canopies thinning out also lower the HV return.',
  landslide:
    'A landslide strips the vegetation and roughens the slope, so backscatter changes sharply along the scar, often most in HV. Interferograms and pixel offsets also show slopes that creep slowly before or after a failure.',
  snow: 'Dry snow is almost transparent at L-band, so the radar sees the ground beneath it. Wet snow absorbs the signal and turns dark, which marks melting.',
  dust: 'Radar sees straight through dust and haze. Look for change on the ground instead: drying soil lowers the backscatter.',
  heat: 'Heat waves dry out soil and vegetation, which lowers the backscatter. Where heat melts snow or ice, the wet surface turns dark.',
  manmade:
    'Human-made events, such as industrial accidents, can change surfaces sharply. Oil calms the sea surface and turns it dark, but NISAR images most open ocean only rarely.',
  other: 'Compare a scene from before the event with one after it and look for brightness changes in HH and HV.',
};
