// Static configuration: event categories, data endpoints and map layers.

export const CATEGORIES = {
  earthquake: { label: 'Earthquake', color: '#ff5a4f', mergeKm: 100, mergeHours: 0.25 },
  wildfire: { label: 'Wildfire', color: '#ffa62b', mergeKm: 25, mergeHours: 24 * 7 },
  flood: { label: 'Flood', color: '#3fa7ff', mergeKm: 100, mergeHours: 24 * 7 },
  storm: { label: 'Storm', color: '#b48cff', mergeKm: 300, mergeHours: 24 * 3 },
  volcano: { label: 'Volcano', color: '#ff4fa3', mergeKm: 30, mergeHours: 24 * 14 },
  ice: { label: 'Sea & lake ice', color: '#7fe7f2', mergeKm: 50, mergeHours: 24 * 14 },
  drought: { label: 'Drought', color: '#d9b26a', mergeKm: 300, mergeHours: 24 * 30 },
  other: { label: 'Other', color: '#c2c9d6', mergeKm: 50, mergeHours: 24 * 7 },
};

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

export const NISAR_TILES = {
  id: 'NISAR_L2_Geocoded_Polarimetric_Covariance',
  url: gibs('NISAR_L2_Geocoded_Polarimetric_Covariance', 'png', 13),
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
// Context layers, all tiles from NASA GIBS. Most follow the imagery date;
// those with a `date` are yearly or one-off maps published under that date.
export const OVERLAYS = {
  water: {
    group: 'Radar and water',
    label: 'Surface water from radar (OPERA, Sentinel-1)',
    url: gibs('OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1', 'png', 12),
    maxLevel: 12,
  },
  s1: {
    group: 'Radar and water',
    label: 'C-band backscatter (OPERA, Sentinel-1)',
    url: gibs('OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1', 'png', 12),
    maxLevel: 12,
  },
  soil: {
    group: 'Radar and water',
    label: 'Surface soil moisture (SMAP)',
    url: gibs('SMAP_L4_Analyzed_Surface_Soil_Moisture', 'png', 6),
    maxLevel: 6,
  },
  rain: {
    group: 'Weather and ice',
    label: 'Rainfall rate that day (IMERG)',
    url: gibs('IMERG_Precipitation_Rate', 'png', 6),
    maxLevel: 6,
  },
  seaice: {
    group: 'Weather and ice',
    label: 'Sea ice concentration (GHRSST MUR)',
    url: gibs('GHRSST_L4_MUR25_Sea_Ice_Concentration', 'png', 6),
    maxLevel: 6,
  },
  snow: {
    group: 'Weather and ice',
    label: 'Snow cover (MODIS Terra)',
    url: gibs('MODIS_Terra_L3_NDSI_Snow_Cover_Daily', 'png', 8),
    maxLevel: 8,
  },
  disturbance: {
    group: 'Land and people',
    label: 'Vegetation disturbance alerts (OPERA)',
    url: gibs('OPERA_L3_DIST-ALERT-HLS_Color_Index', 'png', 12),
    maxLevel: 12,
  },
  landcover: {
    group: 'Land and people',
    label: 'Land cover type (MODIS, 2024)',
    url: gibs('MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', 'png', 8),
    maxLevel: 8,
    date: '2024-01-01',
  },
  crops: {
    group: 'Land and people',
    label: 'Croplands (2000)',
    url: gibs('Agricultural_Lands_Croplands_2000', 'png', 7),
    maxLevel: 7,
    date: '2000-01-01',
  },
  population: {
    group: 'Land and people',
    label: 'Population density (GPW, 2020)',
    url: gibs('GPW_Population_Density_2020', 'png', 7),
    maxLevel: 7,
    date: '2020-01-01',
  },
  built: {
    group: 'Land and people',
    label: 'Built-up areas (Landsat)',
    url: gibs('Landsat_Human_Built-up_And_Settlement_Extent', 'png', 12),
    maxLevel: 12,
    date: '2010-01-01',
  },
  lights: {
    group: 'Land and people',
    label: 'City lights at night (Black Marble, 2016)',
    url: gibs('VIIRS_Black_Marble', 'png', 8),
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
  other: 'Changes in water, vegetation, soil moisture or surface roughness can alter radar brightness. Weather, season and differences between acquisitions can produce similar patterns. Compare independent observations before attributing a change to a particular event.',
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
  other: 'Compare a scene from before the event with one after it and look for brightness changes in HH and HV.',
};
