// Fetches the extra, per-event data a replay is built from. Every function
// returns plain observed or agency-published data; nothing is invented here.

import { tilePoints } from './mvt.js';
import { distanceKm } from '../incidents.js';

const DAY = 86400_000;

// The signal of the event being loaded: its requests end when it is closed.
// Every request also gives up after a while, so a server that never
// answers cannot leave an event "loading" for good.
let current = null;
export function useSignal(signal) {
  current = signal;
}

const PATIENCE_MS = 15_000;
function patient(signal) {
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(PATIENCE_MS) : null;
  if (signal && timeout) return AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;
  return signal || timeout || undefined;
}

async function json(url) {
  const res = await fetch(url, { signal: patient(current) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

// Keeps big outlines light: at most `max` corners per ring.
function thin(ring, max = 360) {
  if (ring.length <= max) return ring;
  const step = ring.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(ring[Math.floor(i * step)]);
  return out;
}

const toRing = (coords) => thin(coords.map(([lon, lat]) => ({ lat, lon })));

// Shapes GDACS publishes for an event: affected areas, shaking-intensity
// zones, storm wind zones and track lines.
export async function gdacsShapes(incident) {
  const report = incident.reports.find((r) => r.source === 'gdacs' && r.geometryUrl);
  if (!report) return { polygons: [], lines: [] };
  const data = await json(report.geometryUrl);
  const polygons = [];
  const lines = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!g) continue;
    const outer = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((poly) => poly[0]) : [];
    for (const ring of outer) {
      if (ring.length >= 3) polygons.push({ kind: p.Class || '', label: p.polygonlabel || '', intensity: parseFloat(p.intensity) || null, ring: toRing(ring) });
    }
    const paths = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const path of paths) if (path.length >= 2) lines.push({ kind: p.Class || '', points: toRing(path) });
  }
  return { polygons, lines };
}

// USGS ShakeMap intensity contours, published for larger earthquakes.
export async function shakeContours(incident) {
  const report = incident.reports.find((r) => r.source === 'usgs' && r.detailUrl);
  if (!report) return [];
  const detail = await json(report.detailUrl);
  const url = detail.properties?.products?.shakemap?.[0]?.contents?.['download/cont_mmi.json']?.url;
  if (!url) return [];
  const data = await json(url);
  const out = [];
  for (const f of data.features || []) {
    const lines = f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : [];
    for (const line of lines) if (line.length >= 2) out.push({ value: f.properties.value, color: f.properties.color, points: toRing(line) });
  }
  return out;
}

// Every earthquake USGS has catalogued near a point since a given time.
export async function quakesNear(lat, lon, radiusKm, fromMs) {
  const q = new URLSearchParams({
    format: 'geojson',
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    maxradiuskm: String(radiusKm),
    starttime: new Date(fromMs).toISOString(),
    minmagnitude: '2.5',
    orderby: 'time-asc',
    limit: '600',
  });
  const data = await json(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`);
  return (data.features || []).map((f) => ({
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    time: f.properties.time,
    mag: f.properties.mag,
    title: f.properties.title,
  }));
}

// Active-fire detections from the VIIRS instrument on NOAA-20, one list per
// day, read from NASA GIBS vector tiles (9° tiles in plain lat/lon).
const FIRE_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_NOAA20_Thermal_Anomalies_375m_All/default/{date}/500m/5/{row}/{col}.mvt';
const FIRE_SPAN = 288 / 2 ** 5;

async function fireTile(date, row, col) {
  const res = await fetch(FIRE_URL.replace('{date}', date).replace('{row}', row).replace('{col}', col), { signal: patient(current) });
  if (!res.ok) return [];
  return tilePoints(await res.arrayBuffer()).map((p) => ({ lat: 90 - (row + p.y) * FIRE_SPAN, lon: -180 + (col + p.x) * FIRE_SPAN }));
}

export async function fireDetections(lat, lon, radiusKm, dates) {
  const reach = radiusKm / 111;
  const reachLon = reach / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const tiles = new Set();
  for (const dLat of [-reach, reach]) {
    for (const dLon of [-reachLon, reachLon]) {
      const col = Math.floor((lon + dLon + 180) / FIRE_SPAN);
      const row = Math.floor((90 - (lat + dLat)) / FIRE_SPAN);
      tiles.add(`${row}/${col}`);
    }
  }
  const days = [];
  const signal = current;
  // A few days at a time, so a long fire does not flood the network.
  for (let i = 0; i < dates.length; i += 4) {
    if (signal?.aborted) throw new DOMException('The event was closed', 'AbortError');
    const batch = await Promise.all(
      dates.slice(i, i + 4).map(async (date) => {
        const parts = await Promise.all([...tiles].map((t) => fireTile(date, ...t.split('/').map(Number)).catch(() => [])));
        const seen = new Set();
        const points = [];
        for (const p of parts.flat()) {
          const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
          if (seen.has(key) || distanceKm({ lat, lon }, p) > radiusKm) continue;
          seen.add(key);
          points.push(p);
        }
        return { date, points };
      }),
    );
    days.push(...batch);
  }
  return days;
}

// ISO dates from the day of `fromMs` up to today, at most `max` of them.
export function dateRange(fromMs, toMs, max) {
  const out = [];
  const end = Math.floor(toMs / DAY) * DAY;
  for (let t = Math.floor(fromMs / DAY) * DAY; t <= end; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out.slice(-max);
}
