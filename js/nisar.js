// NISAR scene search through NASA's CMR catalogue. No login is needed for
// search, footprints or the preview images; only full HDF5 downloads need one.

import { CMR, NISAR_GCOV, NISAR_GUNW, NISAR_TILES } from './config.js';
import { lonNear } from './incidents.js';

const BROWSE_REL = 'http://esipfed.org/ns/fedsearch/1.1/browse#';
const DATA_REL = 'http://esipfed.org/ns/fedsearch/1.1/data#';

function stamp(s) {
  // 20261111T002344 -> ms
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)$/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

// NISAR records in several polarisation modes, and the preview colours mean
// different things in each. The mode is the tenth field of the scene name:
// two letters per frequency band, e.g. DHDH (both bands dual: HH and HV),
// SHNA (band A single HH, no band B) or NASV (band B only, single VV).
// In dual-mode previews red and blue carry the co-polarised echo and green
// the cross-polarised one; single-mode previews are that one channel in grey.
const POL_MODES = {
  DH: { code: 'DH', co: 'HH', cross: 'HV' },
  DV: { code: 'DV', co: 'VV', cross: 'VH' },
  SH: { code: 'SH', co: 'HH', cross: null },
  SV: { code: 'SV', co: 'VV', cross: null },
};

export function polMode(field) {
  const band = field && field.slice(0, 2) !== 'NA' ? field.slice(0, 2) : (field || '').slice(2, 4);
  // Anything else (quad-pol, for instance) has an unverified colour layout.
  return POL_MODES[band] || { code: band || '??', co: null, cross: null };
}

// A scene's outline from the catalogue's polygons ("lat lon lat lon …").
//
// A scene that crosses the date line comes as two polygons, cut along
// 180°, one on each side. Read alone, the first is half the scene. They
// are joined here into one outline whose longitudes run on past 180°
// (178° to 181°, say): the corners of both, without the points on the
// cut, in order around their middle. The preview's corner file uses the
// same convention.
export function sceneOutline(polygons) {
  const rings = (polygons || [])
    .map((p) => {
      const flat = String(p?.[0] || '').split(' ').map(Number);
      const ring = [];
      for (let i = 0; i + 1 < flat.length; i += 2) ring.push({ lat: flat[i], lon: flat[i + 1] });
      return ring;
    })
    .filter((ring) => ring.length >= 3);
  const onCut = (p) => Math.abs(Math.abs(p.lon) - 180) < 1e-6;
  if (rings.length < 2 || !rings.every((ring) => ring.some(onCut))) return rings[0] || [];
  const corners = rings.flat().filter((p) => !onCut(p)).map((p) => ({ lat: p.lat, lon: p.lon < 0 ? p.lon + 360 : p.lon }));
  if (corners.length < 3) return rings[0];
  // A scene is a four-cornered strip: its corners in order of their
  // direction from the middle make its outline.
  const mid = { lat: corners.reduce((n, p) => n + p.lat, 0) / corners.length, lon: corners.reduce((n, p) => n + p.lon, 0) / corners.length };
  corners.sort((a, b) => Math.atan2(a.lat - mid.lat, a.lon - mid.lon) - Math.atan2(b.lat - mid.lat, b.lon - mid.lon));
  return [...corners, corners[0]];
}

function parseEntry(entry) {
  const name = entry.title;
  const parts = name.split('_');
  const product = parts[3];
  const ring = sceneOutline(entry.polygons);
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
    pol: polMode(parts[9]),
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

// One search of NASA's catalogue for one kind of product ('GCOV' or 'GUNW').
//
// The catalogue can filter by a pattern in the file name, but that one
// option makes it take seven to eight seconds where the same search without
// it takes a third of a second. So the kind of product is sorted out here
// instead, from the file names that come back. Only the urgent-response
// collection holds more than one kind (about half of it is another
// product), so twice as many entries are asked for when it is searched.
//
// The same question is not put twice within five minutes: an event that
// was pointed at, or opened before, opens at once.
const MIXED = 'NISAR_UR_L2';
const ASKED = new Map();
const ASK_AGAIN_MS = 5 * 60_000;

function search(shortNames, product, extra, pageSize) {
  const q = new URLSearchParams();
  shortNames.forEach((s) => q.append('short_name[]', s));
  q.append('page_size', String(Math.min(2000, shortNames.includes(MIXED) ? pageSize * 2 + 20 : pageSize)));
  q.append('sort_key', '-start_date');
  for (const [k, v] of Object.entries(extra)) q.append(k, v);
  const key = `${product}?${q}`;
  const held = ASKED.get(key);
  if (held && Date.now() - held.at < ASK_AGAIN_MS) return held.answer;
  const answer = fetch(`${CMR}?${q}`)
    .then((res) => {
      if (!res.ok) throw new Error(`NASA CMR answered ${res.status}`);
      return res.json();
    })
    .then((json) =>
      (json.feed?.entry || [])
        .map(parseEntry)
        .filter((scene) => scene && scene.product === product)
        .slice(0, pageSize),
    );
  ASKED.set(key, { at: Date.now(), answer });
  // A search that failed is asked again next time.
  answer.catch(() => ASKED.delete(key));
  if (ASKED.size > 60) ASKED.delete(ASKED.keys().next().value);
  return answer;
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

// The newest passes, newest first.
//
// The catalogue's answer for these is 10 MB and is not compressed, so it
// is fetched whole only once. After that, give back what an earlier call
// returned (`held`) and when it was asked (`since`, in ms): then only what
// the catalogue has added or changed since is fetched, and merged in. NASA
// adds about 170 passes an hour, so that is one or two megabytes.
export async function latestScenes(count = 200, held = null, since = null) {
  const names = ['NISAR_L2_GCOV_V1', 'NISAR_UR_L2'];
  if (held?.length && since) {
    const added = await search(names, 'GCOV', { updated_since: new Date(since).toISOString().slice(0, 19) + 'Z' }, count);
    return dedupe([...added, ...held]).slice(0, count);
  }
  return dedupe(await search(names, 'GCOV', {}, count));
}

// How far inside a frame outline a point lies, in kilometres (0 or less
// means outside). The picture does not reach the outline: a strip along
// the edges is empty, so a point close to the edge is often not imaged.
export function edgeMarginKm(ring, lat, lon) {
  if (ring.length) lon = lonNear(lon, ring[0].lon);
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  let nearest = Infinity;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[i].lon - lon) * kx;
    const ay = (ring[i].lat - lat) * ky;
    const bx = (ring[j].lon - lon) * kx;
    const by = (ring[j].lat - lat) * ky;
    if (ay > 0 !== by > 0 && 0 < ((bx - ax) * (0 - ay)) / (by - ay) + ax) inside = !inside;
    const t = Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    nearest = Math.min(nearest, Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)));
  }
  return inside ? nearest : -nearest;
}

// A point this far inside the outline is reliably in the picture.
export const SAFE_MARGIN_KM = 12;

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
  const [gcov, gunw] = await Promise.all([search(NISAR_GCOV, 'GCOV', at, 100), search(NISAR_GUNW, 'GUNW', at, 40).catch(() => [])]);
  return { backscatter: dedupe(gcov), interferograms: dedupe(gunw) };
}

// The radar passes alone, which is all an event's picture needs: the same
// search scenesAt makes, so asking for both costs one request.
export async function passesAt(lat, lon, fromMs, toMs) {
  const temporal = `${new Date(fromMs).toISOString()},${new Date(toMs).toISOString()}`;
  return dedupe(await search(NISAR_GCOV, 'GCOV', { point: `${lon},${lat}`, temporal }, 100));
}

// Every backscatter pass over a point since NISAR began science operations,
// grouped by repeat track ("stack"). Passes on one stack line up exactly, so
// they can be played as a time-lapse. Stacks that hold the point well inside
// their frame come first, the one with the most passes leading; stacks
// that only graze it follow, because their pictures often miss it.
const ALL_GCOV = ['NISAR_L2_GCOV_V1', 'NISAR_L2_GCOV_PROVISIONAL_V1', 'NISAR_L2_GCOV_BETA_V1', 'NISAR_UR_L2'];

export async function historyAt(lat, lon) {
  const temporal = `2025-10-01T00:00:00Z,${new Date().toISOString()}`;
  const scenes = dedupe(await search(ALL_GCOV, 'GCOV', { point: `${lon},${lat}`, temporal }, 500));
  const stacks = new Map();
  for (const s of scenes) {
    if (!stacks.has(s.stack)) stacks.set(s.stack, { stack: s.stack, track: s.track, frame: s.frame, direction: s.direction, scenes: [], unplaced: 0 });
    // Early passes were published without public corner coordinates for
    // their preview, so they cannot be laid on the map accurately.
    if (s.image) stacks.get(s.stack).scenes.push(s);
    else stacks.get(s.stack).unplaced++;
  }
  const list = [...stacks.values()];
  for (const st of list) {
    // Keep the polarisation mode most passes share; the rest cannot be
    // compared with them and are counted, not shown.
    const modes = new Map();
    for (const s of st.scenes) modes.set(s.pol.code, (modes.get(s.pol.code) || 0) + (s.pol.co ? 1 : 0.001));
    const main = [...modes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    st.otherModes = st.scenes.filter((s) => s.pol.code !== main).length;
    st.scenes = st.scenes.filter((s) => s.pol.code === main).sort((a, b) => a.time - b.time);
    st.pol = st.scenes[0]?.pol;
    st.marginKm = st.scenes.length ? Math.min(...st.scenes.map((s) => edgeMarginKm(s.ring, lat, lon))) : -1;
  }
  const safe = (st) => st.marginKm >= SAFE_MARGIN_KM;
  return list.filter((st) => st.scenes.length >= 2).sort((a, b) => safe(b) - safe(a) || (safe(a) ? b.scenes.length - a.scenes.length : b.marginKm - a.marginKm));
}

// Interferograms over a point, newest first. Each compares two passes.
export async function interferogramsAt(lat, lon) {
  return dedupe(await search(NISAR_GUNW, 'GUNW', { point: `${lon},${lat}` }, 80)).filter((s) => s.image && s.refTime && s.secTime);
}

// The newest passes over a point, whatever their date: what the next-pass
// estimate has to start from.
export async function newestAt(lat, lon) {
  return dedupe(await search(ALL_GCOV, 'GCOV', { point: `${lon},${lat}` }, 30));
}

// Best before/after pair: same track and frame, closest to the event on each
// side. Given the place (`at`), pairs that hold it well inside their frame
// win over pairs that only graze it.
export function bestPair(scenes, eventTime, requirePreview = true, at = null) {
  const byStack = new Map();
  for (const s of scenes) {
    if (s.product !== 'GCOV' || !s.track || !s.frame ||
        !['Ascending', 'Descending'].includes(s.direction) || !Number.isFinite(s.time)) continue;
    if (requirePreview && !s.image) continue;
    // Passes in different polarisation modes are not comparable.
    const stack = `${s.track}-${s.direction}-${s.frame}-${s.pol?.code ?? ''}`;
    if (!byStack.has(stack)) byStack.set(stack, []);
    byStack.get(stack).push(s);
  }
  let best = null;
  for (const list of byStack.values()) {
    const before = list.filter((s) => s.time < eventTime).sort((a, b) => b.time - a.time)[0];
    const after = list.filter((s) => s.time >= eventTime).sort((a, b) => a.time - b.time)[0];
    if (!before || !after) continue;
    const span = after.time - before.time;
    const placed = at && Number.isFinite(at.lat) && Number.isFinite(at.lon) && before.ring && after.ring;
    const grazing = placed ? Math.min(edgeMarginKm(before.ring, at.lat, at.lon), edgeMarginKm(after.ring, at.lat, at.lon)) < SAFE_MARGIN_KM : false;
    if (!best || grazing < best.grazing || (grazing === best.grazing && span < best.span)) best = { before, after, span, grazing };
  }
  if (best) delete best.grazing;
  return best;
}

// Metadata-only feasibility check; no preview downloads are needed.
export function comparisonStatus(scenes, eventTime, at = null) {
  const pair = bestPair(scenes, eventTime, true, at);
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
const BOUNDS = new Map();
export function imageBounds(scene) {
  if (!BOUNDS.has(scene.id)) {
    BOUNDS.set(scene.id, readBounds(scene));
    if (BOUNDS.size > 400) BOUNDS.delete(BOUNDS.keys().next().value);
  }
  return BOUNDS.get(scene.id);
}

async function readBounds(scene) {
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
// The newest day for which NASA's NISAR map layer shows anything. The
// server answers every date, with a tiny see-through tile when it has
// nothing, so the whole-world tile's size says whether a day has data.
// NASA publishes with a delay of days, so yesterday is usually still empty.
// The last two weeks are asked at once, not one after the other.
export async function latestTileDate() {
  const days = [...Array(14)].map((_, i) => new Date(Date.now() - (i + 1) * 86400_000).toISOString().slice(0, 10));
  const sizes = await Promise.all(
    days.map((date) =>
      fetch(NISAR_TILES.url.replace('{date}', date).replace('{z}', '0').replace('{y}', '0').replace('{x}', '0'))
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => blob?.size || 0)
        .catch(() => 0),
    ),
  );
  const at = sizes.findIndex((size) => size > 300);
  return at >= 0 ? days[at] : likelyTileDate();
}

// Where to start before the answer above is in: two days back.
export function likelyTileDate() {
  return new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
}
