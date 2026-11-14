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

// NISAR flies an exact repeat orbit: the same track comes round every 12 days.
export const REPEAT_DAYS = 12;

// Estimates the next overpass from archived passes: for each repeat track,
// the newest pass plus whole 12-day cycles until the result is in the future.
// It is an estimate only: an overpass is not a guaranteed acquisition.
export function nextPass(scenes, now = Date.now()) {
  const newest = new Map();
  for (const s of scenes) {
    if (!Number.isFinite(s.time)) continue;
    if (!newest.has(s.stack) || newest.get(s.stack).time < s.time) newest.set(s.stack, s);
  }
  let best = null;
  for (const last of newest.values()) {
    const cycle = REPEAT_DAYS * 86400_000;
    const cycles = Math.max(1, Math.ceil((now - last.time) / cycle));
    const time = last.time + cycles * cycle;
    // Cycles beyond the first are expected passes that never reached the archive.
    if (!best || time < best.time) best = { time, last, missed: cycles - 1 };
  }
  return best;
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

// Every backscatter pass over a point since NISAR began science operations,
// grouped by repeat track ("stack"). Passes on one stack line up exactly, so
// they can be played as a time-lapse. Stacks with the most passes come first.
const ALL_GCOV = ['NISAR_L2_GCOV_V1', 'NISAR_L2_GCOV_PROVISIONAL_V1', 'NISAR_L2_GCOV_BETA_V1', 'NISAR_UR_L2'];

export async function historyAt(lat, lon) {
  const temporal = `2025-10-01T00:00:00Z,${new Date().toISOString()}`;
  const scenes = dedupe(await search(ALL_GCOV, '*_GCOV_*', { point: `${lon},${lat}`, temporal }, 500));
  const stacks = new Map();
  for (const s of scenes) {
    if (!stacks.has(s.stack)) stacks.set(s.stack, { stack: s.stack, track: s.track, frame: s.frame, direction: s.direction, scenes: [], unplaced: 0 });
    // Early passes were published without public corner coordinates for
    // their preview, so they cannot be laid on the map accurately.
    if (s.image) stacks.get(s.stack).scenes.push(s);
    else stacks.get(s.stack).unplaced++;
  }
  const list = [...stacks.values()];
  for (const st of list) st.scenes.sort((a, b) => a.time - b.time);
  return list.filter((st) => st.scenes.length >= 2).sort((a, b) => b.scenes.length - a.scenes.length);
}

// The newest passes over a point, whatever their date: what the next-pass
// estimate has to start from.
export async function newestAt(lat, lon) {
  return dedupe(await search(ALL_GCOV, '*_GCOV_*', { point: `${lon},${lat}` }, 30));
}

// Best before/after pair: same track and frame, closest to the event on each side.
export function bestPair(scenes, eventTime, requirePreview = true) {
  const byStack = new Map();
  for (const s of scenes) {
    if (s.product !== 'GCOV' || !s.track || !s.frame ||
        !['Ascending', 'Descending'].includes(s.direction) || !Number.isFinite(s.time)) continue;
    if (requirePreview && !s.image) continue;
    const stack = `${s.track}-${s.direction}-${s.frame}`;
    if (!byStack.has(stack)) byStack.set(stack, []);
    byStack.get(stack).push(s);
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

// Metadata-only feasibility check; no preview downloads are needed.
export function comparisonStatus(scenes, eventTime) {
  const pair = bestPair(scenes, eventTime);
  if (pair) return { pair, reason: '' };
  const coverage = scenes.filter((s) => s.product === 'GCOV' && Number.isFinite(s.time));
  let reason;
  if (!coverage.length) reason = 'No backscatter scenes were found in the searched archive window.';
  else if (!coverage.some((s) => s.time < eventTime)) reason = 'No earlier pass was found before the event in the searched archive window.';
  else if (!coverage.some((s) => s.time >= eventTime)) reason = 'No pass at or after the event was found in the searched archive window.';
  else if (bestPair(coverage, eventTime, false)) reason = 'Matching passes exist, but a source image preview is unavailable.';
  else reason = 'No before/after passes with verified matching metadata on the same track, direction and frame were found in the searched archive window.';
  return { pair: null, reason };
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
