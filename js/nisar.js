// NISAR scene search through NASA's CMR catalogue. No login is needed for
// search, footprints or the preview images; only full HDF5 downloads need one.

import { CMR, NISAR_GCOV, NISAR_GUNW, NISAR_TILES } from './config.js';

const BROWSE_REL = 'http://esipfed.org/ns/fedsearch/1.1/browse#';
const DATA_REL = 'http://esipfed.org/ns/fedsearch/1.1/data#';

function stamp(s) {
  // 20261111T002344 -> ms
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)$/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

function parseEntry(entry) {
  const name = entry.title;
  const parts = name.split('_');
  const product = parts[3];
  const ring = [];
  const flat = (entry.polygons?.[0]?.[0] || '').split(' ').map(Number);
  for (let i = 0; i + 1 < flat.length; i += 2) ring.push({ lat: flat[i], lon: flat[i + 1] });
  if (ring.length < 3) return null;

  const hrefs = [...new Set((entry.links || []).filter((l) => l.rel === BROWSE_REL && l.href.startsWith('https')).map((l) => l.href))];
  const pick = (suffix) => hrefs.find((h) => h.endsWith(suffix)) || null;
  const scene = {
    id: entry.id,
    name,
    product,
    pipeline: parts[2] === 'UR' ? 'Urgent response' : 'Standard',
    cycle: parts[4],
    track: parts[5],
    direction: parts[6] === 'A' ? 'Ascending' : 'Descending',
    frame: parts[7],
    stack: `${parts[5]}-${parts[6]}-${parts[7]}`,
    time: Date.parse(entry.time_start),
    ring,
    sizeMb: Number(entry.granule_size) || null,
    image: pick('_LATLON.png'),
    thumb: pick('_LATLON_thumbnail.png'),
    kml: pick('_LATLON.png')?.replace(/\.png$/, '.kml') || null,
    polPreviews: hrefs
      .filter((h) => /_NATIVE_A_[HV]{4}\.png$/.test(h))
      .map((h) => ({ pol: h.slice(-8, -4).slice(0, 2), url: h })),
    download: (entry.links || []).find((l) => l.rel === DATA_REL && l.href.startsWith('https'))?.href || null,
  };
  if (product === 'GUNW') {
    scene.refTime = stamp(parts[11]);
    scene.secTime = stamp(parts[13]);
    scene.time = scene.secTime || scene.time;
  }
  return scene;
}

async function search(shortNames, pattern, extra, pageSize) {
  const q = new URLSearchParams();
  shortNames.forEach((s) => q.append('short_name[]', s));
  q.append('readable_granule_name[]', pattern);
  q.append('options[readable_granule_name][pattern]', 'true');
  q.append('page_size', String(pageSize));
  q.append('sort_key', '-start_date');
  for (const [k, v] of Object.entries(extra)) q.append(k, v);
  const res = await fetch(`${CMR}?${q}`);
  if (!res.ok) throw new Error(`NASA CMR answered ${res.status}`);
  const json = await res.json();
  return (json.feed?.entry || []).map(parseEntry).filter(Boolean);
}

// The same pass can be published twice (urgent, then standard). Keep one.
function dedupe(scenes) {
  const best = new Map();
  for (const s of scenes) {
    const key = `${s.product}:${s.stack}:${Math.round(s.time / 60000)}`;
    const held = best.get(key);
    if (!held || (held.pipeline !== 'Standard' && s.pipeline === 'Standard')) best.set(key, s);
  }
  return [...best.values()].sort((a, b) => b.time - a.time);
}

export async function latestScenes(count = 200) {
  return dedupe(await search(['NISAR_L2_GCOV_V1', 'NISAR_UR_L2'], '*_GCOV_*', {}, count));
}

export async function scenesAt(lat, lon, fromMs, toMs) {
  const temporal = `${new Date(fromMs).toISOString()},${new Date(toMs).toISOString()}`;
  const at = { point: `${lon},${lat}`, temporal };
  const [gcov, gunw] = await Promise.all([
    search(NISAR_GCOV, '*_GCOV_*', at, 100),
    search(NISAR_GUNW, '*_GUNW_*', at, 40).catch(() => []),
  ]);
  return { backscatter: dedupe(gcov), interferograms: dedupe(gunw) };
}

// Best before/after pair: same track and frame, closest to the event on each side.
export function bestPair(scenes, eventTime) {
  const byStack = new Map();
  for (const s of scenes) {
    if (!s.image) continue;
    if (!byStack.has(s.stack)) byStack.set(s.stack, []);
    byStack.get(s.stack).push(s);
  }
  let best = null;
  for (const list of byStack.values()) {
    const before = list.filter((s) => s.time < eventTime).sort((a, b) => b.time - a.time)[0];
    const after = list.filter((s) => s.time >= eventTime).sort((a, b) => a.time - b.time)[0];
    if (!before || !after) continue;
    const span = after.time - before.time;
    if (!best || span < best.span) best = { before, after, span };
  }
  return best;
}

// Corner coordinates of a preview image, read from its KML sidecar.
export async function imageBounds(scene) {
  const fallback = () => {
    const lats = scene.ring.map((p) => p.lat);
    const lons = scene.ring.map((p) => p.lon);
    return { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
  };
  if (!scene.kml) return fallback();
  try {
    const res = await fetch(scene.kml);
    if (!res.ok) return fallback();
    const text = await res.text();
    const m = /<coordinates>([^<]+)<\/coordinates>/.exec(text);
    if (!m) return fallback();
    const pts = m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number));
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    return { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
  } catch {
    return fallback();
  }
}

// Newest day for which the daily NISAR tile layer has been published.
export async function latestTileDate() {
  for (let back = 1; back <= 14; back++) {
    const date = new Date(Date.now() - back * 86400_000).toISOString().slice(0, 10);
    const url = NISAR_TILES.url.replace('{date}', date).replace('{z}', '0').replace('{y}', '0').replace('{x}', '0');
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return date;
    } catch {
      /* try the previous day */
    }
  }
  return new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
}
