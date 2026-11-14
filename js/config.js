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

// NISAR's calibrated science data starts here; the archive window reaches
// back to it so that older events have radar scenes on both sides.
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
export const OVERLAYS = {
  water: {
    label: 'Surface water from radar (OPERA, Sentinel-1)',
    url: gibs('OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1', 'png', 12),
    maxLevel: 12,
  },
  s1: {
    label: 'C-band backscatter (OPERA, Sentinel-1)',
    url: gibs('OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1', 'png', 12),
    maxLevel: 12,
  },
  disturbance: {
    label: 'Vegetation disturbance alerts (OPERA)',
    url: gibs('OPERA_L3_DIST-ALERT-HLS_Color_Index', 'png', 12),
    maxLevel: 12,
  },
  soil: {
    label: 'Surface soil moisture (SMAP)',
    url: gibs('SMAP_L4_Analyzed_Surface_Soil_Moisture', 'png', 6),
    maxLevel: 6,
  },
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
