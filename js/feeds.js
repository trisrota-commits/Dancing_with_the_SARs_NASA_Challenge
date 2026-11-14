// Fetches the live event feeds and normalises them to one shape:
// { id, source, category, title, lat, lon, time, endTime, magnitude, severity, url, detail, track }

import { FEEDS, ARCHIVE } from './config.js';

const EONET_CATEGORY = {
  wildfires: 'wildfire',
  severeStorms: 'storm',
  seaLakeIce: 'ice',
  volcanoes: 'volcano',
  floods: 'flood',
  earthquakes: 'earthquake',
  drought: 'drought',
};

const GDACS_CATEGORY = { EQ: 'earthquake', TC: 'storm', FL: 'flood', VO: 'volcano', WF: 'wildfire', DR: 'drought' };
const GDACS_ALERT = { Green: 0.3, Orange: 0.65, Red: 1 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

function fromUsgs(json) {
  return json.features
    .filter((f) => f.geometry && f.properties.type === 'earthquake')
    .map((f) => {
      const p = f.properties;
      const [lon, lat, depth] = f.geometry.coordinates;
      return {
        id: `usgs:${f.id}`,
        source: 'usgs',
        category: 'earthquake',
        title: p.title || `M ${p.mag} earthquake`,
        lat,
        lon,
        time: p.time,
        endTime: p.time,
        magnitude: { value: p.mag, unit: 'M' },
        severity: clamp01((p.mag - 4) / 4),
        url: p.url,
        detailUrl: p.detail,
        detail: [
          depth != null ? `Depth ${depth.toFixed(0)} km` : null,
          p.alert ? `PAGER alert ${p.alert}` : null,
          p.tsunami ? 'Tsunami message issued' : null,
          p.felt ? `${p.felt} felt reports` : null,
        ].filter(Boolean),
      };
    });
}

function fromEonet(json) {
  const out = [];
  for (const ev of json.events || []) {
    const points = (ev.geometry || []).filter((g) => g.type === 'Point');
    if (!points.length) continue;
    const last = points[points.length - 1];
    const categoryId = ev.categories?.[0]?.id;
    const category = EONET_CATEGORY[categoryId] || 'other';
    const mag = last.magnitudeValue;
    let severity = 0.35;
    if (category === 'wildfire' && mag) severity = clamp01(Math.log10(mag) / 5.5);
    if (category === 'storm' && mag) severity = clamp01(mag / 140);
    out.push({
      id: `eonet:${ev.id}`,
      source: 'eonet',
      category,
      title: ev.title,
      lat: last.coordinates[1],
      lon: last.coordinates[0],
      time: Date.parse(points[0].date),
      endTime: Date.parse(last.date),
      magnitude: mag ? { value: mag, unit: last.magnitudeUnit || '' } : null,
      severity,
      url: ev.sources?.[0]?.url || ev.link,
      detail: [ev.description, ev.categories?.[0]?.title].filter(Boolean),
      track:
        points.length > 1
          ? points.map((g) => ({ lon: g.coordinates[0], lat: g.coordinates[1], time: Date.parse(g.date), value: g.magnitudeValue ?? null, unit: g.magnitudeUnit || '' }))
          : null,
    });
  }
  return out;
}

function fromGdacs(json) {
  return (json.features || [])
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => {
      const p = f.properties;
      const sev = p.severitydata || {};
      const utc = (s) => Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
      return {
        id: `gdacs:${p.eventtype}${p.eventid}`,
        source: 'gdacs',
        category: GDACS_CATEGORY[p.eventtype] || 'other',
        title: p.name || p.description,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        time: utc(p.fromdate),
        endTime: utc(p.todate),
        magnitude: sev.severity ? { value: sev.severity, unit: sev.severityunit || '' } : null,
        severity: GDACS_ALERT[p.alertlevel] ?? 0.3,
        url: p.url?.report,
        geometryUrl: p.url?.geometry,
        gdacsKey: { type: p.eventtype, id: p.eventid },
        detail: [sev.severitytext, p.country ? `Country: ${p.country}` : null, `GDACS alert level: ${p.alertlevel}`].filter(Boolean),
      };
    });
}

const PARSERS = { usgs: fromUsgs, eonet: fromEonet, gdacs: fromGdacs };

export async function fetchFeed(name, urls = FEEDS[name].urls) {
  const batches = await Promise.all(urls.map(getJson));
  const seen = new Map();
  for (const json of batches) {
    for (const ev of PARSERS[name](json)) {
      if (Number.isFinite(ev.lat) && Number.isFinite(ev.lon) && Number.isFinite(ev.time)) seen.set(ev.id, ev);
    }
  }
  return [...seen.values()];
}

// Larger events since NISAR's data began, from the feeds' archives. A feed
// that fails is skipped; the others still load.
export async function fetchArchive() {
  const parts = await Promise.all(Object.keys(ARCHIVE).map((name) => fetchFeed(name, ARCHIVE[name]).catch(() => [])));
  return parts.flat();
}
