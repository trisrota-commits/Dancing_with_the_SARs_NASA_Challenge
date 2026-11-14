// App wiring: polls the feeds, keeps the globe in sync and fills the panels.

import { CATEGORIES, FEEDS, BASEMAPS, OVERLAYS, RADAR_NOTES, RELATED_KM, RELATED_DAYS, NISAR_LATEST_EVERY_MS, NISAR_LOOKBACK_DAYS } from './config.js';
import { fetchFeed } from './feeds.js';
import { buildIncidents, tagNisarCoverage, pointInPolygon, distanceKm } from './incidents.js';
import { latestScenes, scenesAt, bestPair, imageBounds, latestTileDate } from './nisar.js';
import { Globe, loadPicture } from './globe.js';
import { Replay } from './replay/replay.js';
import { changeMap, CHANGE_THRESHOLD } from './change.js';
import { searchEvents, searchPlaces } from './search.js';

const DAY = 86400_000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? esc(u) : '#');

const state = {
  events: { usgs: [], eonet: [], gdacs: [] },
  loaded: {},
  feedStatus: {},
  seen: new Set(),
  incidents: [],
  scenes: [],
  hidden: new Set(),
  windowDays: 7,
  selected: null,
  lookup: 0,
  fresh: new Set(),
  playing: null,
};

const globe = new Globe('globe');
const replay = new Replay(globe, renderReplay);

// ---------- formatting ----------

function ago(ms) {
  const s = Math.max(0, Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 2 * 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const utc = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function size(mag) {
  if (!mag || !Number.isFinite(mag.value)) return null;
  if (mag.unit === 'M') return `Magnitude ${mag.value.toFixed(1)}`;
  const value = mag.value >= 100 ? Math.round(mag.value).toLocaleString('en') : mag.value.toFixed(1);
  if (mag.unit === 'acres') return `${value} acres (${Math.round(mag.value * 0.4047).toLocaleString('en')} ha)`;
  if (mag.unit === 'kts') return `${value} knots (${Math.round(mag.value * 1.852)} km/h)`;
  return `${value} ${mag.unit}`.trim();
}

const where = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const dot = (category) => `<i class="dot" style="--c:${CATEGORIES[category].color}"></i>`;

// ---------- data ----------

// Newly arrived items pulse on the globe and flash in the feed for a while.
function markFresh(id) {
  state.fresh.add(id);
  setTimeout(() => state.fresh.delete(id), 90_000);
}

function visibleIncidents() {
  return state.incidents.filter((i) => !state.hidden.has(i.category));
}

function rebuild() {
  const cutoff = Date.now() - state.windowDays * DAY;
  const events = Object.values(state.events)
    .flat()
    .filter((e) => e.endTime >= cutoff);
  state.incidents = buildIncidents(events);
  tagNisarCoverage(state.incidents, state.scenes);
  // An incident counts as fresh when any of its reports just arrived.
  for (const inc of state.incidents) {
    if (!state.fresh.has(inc.id) && inc.reports.some((r) => state.fresh.has(r.id))) markFresh(inc.id);
  }

  if (state.selected?.kind === 'incident') {
    const ids = new Set(state.selected.incident.reports.map((r) => r.id));
    const again = state.incidents.find((i) => i.reports.some((r) => ids.has(r.id)));
    if (again) state.selected.incident = again;
  }
  draw();
}

function draw() {
  const shown = visibleIncidents();
  globe.renderIncidents(shown, state.fresh);
  globe.renderFootprints(state.scenes, $('footprints').checked);
  renderChips();
  renderFeed();
  $('event-count').textContent = shown.length;
  $('scene-count').textContent = state.scenes.length ? `(${state.scenes.length})` : '';
}

async function refreshFeed(name) {
  try {
    const events = await fetchFeed(name);
    if (state.loaded[name]) {
      for (const e of events) if (!state.seen.has(e.id)) markFresh(e.id);
    }
    events.forEach((e) => state.seen.add(e.id));
    state.events[name] = events;
    state.loaded[name] = true;
    state.feedStatus[name] = { ok: true, at: Date.now(), count: events.length };
  } catch (err) {
    state.feedStatus[name] = { ok: false, at: Date.now(), error: err.message };
  }
  rebuild();
  renderStatus();
}

async function refreshNisar() {
  try {
    const scenes = await latestScenes();
    const known = new Set(state.scenes.map((s) => s.id));
    if (state.scenes.length) scenes.forEach((s) => !known.has(s.id) && markFresh(s.id));
    state.scenes = scenes;
    state.feedStatus.nisar = { ok: true, at: Date.now(), count: scenes.length };
  } catch (err) {
    state.feedStatus.nisar = { ok: false, at: Date.now(), error: err.message };
  }
  rebuild();
  renderStatus();
}

// ---------- left panel ----------

function renderStatus() {
  const labels = { usgs: 'USGS', eonet: 'NASA EONET', gdacs: 'GDACS', nisar: 'NISAR' };
  $('status').innerHTML = Object.entries(labels)
    .map(([key, label]) => {
      const s = state.feedStatus[key];
      if (!s) return `<span class="pill"><i></i>${label}</span>`;
      const title = s.ok ? `${s.count} items, checked ${utc(s.at)}` : `Failed: ${s.error}`;
      return `<span class="pill ${s.ok ? 'ok' : 'err'}" title="${esc(title)}"><i></i>${label}${s.ok ? '' : ' offline'}</span>`;
    })
    .join('');
}

function renderChips() {
  const counts = {};
  state.incidents.forEach((i) => (counts[i.category] = (counts[i.category] || 0) + 1));
  $('chips').innerHTML = Object.entries(CATEGORIES)
    .filter(([key]) => counts[key])
    .map(
      ([key, c]) =>
        `<button class="chip ${state.hidden.has(key) ? 'off' : ''}" data-cat="${key}" aria-pressed="${!state.hidden.has(key)}" style="--c:${c.color}"><i></i>${c.label} ${counts[key]}</button>`,
    )
    .join('');
}

function renderFeed() {
  const items = [
    ...visibleIncidents().map((i) => ({ time: i.endTime, incident: i })),
    ...state.scenes.map((s) => ({ time: s.time, scene: s })),
  ]
    .sort((a, b) => b.time - a.time)
    .slice(0, 60);
  $('feed').innerHTML = items
    .map((item, n) => {
      if (item.incident) {
        const i = item.incident;
        return `<li data-n="${n}" class="${state.fresh.has(i.id) ? 'fresh' : ''}">${dot(i.category)}<span class="name">${esc(i.title)}</span><span class="t">${ago(item.time)}</span></li>`;
      }
      const s = item.scene;
      return `<li data-n="${n}" class="${state.fresh.has(s.id) ? 'fresh' : ''}"><i class="dot" style="--c:#39e6c4;border-radius:2px"></i><span class="name">NISAR pass, track ${esc(s.track)} frame ${esc(s.frame)}</span><span class="t">${ago(item.time)}</span></li>`;
    })
    .join('');
  $('feed').onclick = (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const item = items[+li.dataset.n];
    if (item.incident) selectIncident(item.incident, true);
    else selectScene(item.scene, true);
  };
}

// ---------- detail panel ----------

function openPanel(html) {
  $('detail').innerHTML = html;
  $('right').hidden = false;
  $('right').scrollTop = 0;
}

function closePanel() {
  state.selected = null;
  state.lookup++;
  $('right').hidden = true;
  globe.select(null);
  replay.stop();
  endCompare();
}

// ---------- replay ----------

const BADGE = { observed: 'Observed', analysis: 'Analysis', computed: 'Computed', note: 'Note' };

// Keeps the replay bar and the "what this is made of" list in step with
// the player.
function renderReplay(u) {
  const bar = $('replay');
  const list = $('replay-parts');
  if (u.state === 'off') {
    bar.hidden = true;
    return;
  }
  if (u.state === 'loading') {
    bar.hidden = false;
    $('replay-caption').textContent = 'Gathering what is known about this event…';
    $('replay-fill').style.width = '0';
    if (list) list.innerHTML = '<p class="spinner">Loading the event history…</p>';
    return;
  }
  if (u.state === 'none') {
    bar.hidden = true;
    if (list) list.innerHTML = '<p class="note">The feeds carry no history for this event beyond its location, so there is nothing to replay.</p>';
    return;
  }
  bar.hidden = false;
  $('replay-toggle').textContent = u.state === 'playing' ? '❚❚' : '▶';
  $('replay-caption').textContent = u.caption;
  $('replay-fill').style.width = `${(u.progress * 100).toFixed(1)}%`;
  if (list && list.partsRef !== u.parts) {
    list.partsRef = u.parts;
    list.innerHTML = `<ul class="parts">${u.parts
      .map((p) => `<li><span class="badge ${p.kind}">${BADGE[p.kind]}</span><span>${esc(p.text)}${p.source ? ` <small>· ${esc(p.source)}</small>` : ''}</span></li>`)
      .join('')}</ul>
      <p class="hint">Observed = measured or catalogued. Analysis = worked out and published by an agency. Computed = drawn here by the stated rule.</p>`;
  }
}

function sceneCard(scene, eventTime) {
  let rel = '';
  if (eventTime != null) {
    const days = (scene.time - eventTime) / DAY;
    const n = Math.abs(days) < 1 ? `${Math.abs(days * 24).toFixed(0)} h` : `${Math.abs(days).toFixed(0)} d`;
    rel = `<span class="rel ${days < 0 ? 'before' : 'after'}">${n} ${days < 0 ? 'before' : 'after'}</span>`;
  }
  const when =
    scene.product === 'GUNW' ? `${day(scene.refTime)} → ${day(scene.secTime)}` : utc(scene.time);
  const spans = scene.product === 'GUNW' && eventTime != null && scene.refTime < eventTime && scene.secTime > eventTime;
  return `<div class="card scene ${spans ? 'pair' : ''}">
    ${scene.thumb ? `<img src="${safeUrl(scene.thumb)}" alt="Radar preview" loading="lazy" />` : '<div></div>'}
    <div>
      <div class="when">${esc(when)} ${spans ? '<span class="rel after">spans the event</span>' : rel}</div>
      <div class="meta">${esc(scene.direction)} track ${esc(scene.track)}, frame ${esc(scene.frame)} · ${esc(scene.pipeline)}</div>
      <div class="actions">
        ${scene.image ? `<button data-show="${esc(scene.id)}">Show on globe</button>` : ''}
        ${scene.polPreviews.map((p) => `<a href="${safeUrl(p.url)}" target="_blank" rel="noopener">${esc(p.pol)}</a>`).join('')}
        ${scene.download ? `<a href="${safeUrl(scene.download)}" target="_blank" rel="noopener" title="Needs a free NASA Earthdata login">HDF5</a>` : ''}
      </div>
    </div>
  </div>`;
}

function incidentHtml(inc, radar) {
  const cat = CATEGORIES[inc.category];
  const facts = [
    ['When', inc.endTime - inc.time > 3600_000 ? `${utc(inc.time)} → ${utc(inc.endTime)}` : `${utc(inc.time)} (${ago(inc.time)})`],
    ['Where', where(inc.lat, inc.lon)],
    ['Size', size(inc.magnitude)],
    ['Reported by', `${inc.reports.length} ${inc.reports.length > 1 ? 'feeds, merged into one event' : 'feed'}`],
  ].filter(([, v]) => v);

  const reports = inc.reports
    .map(
      (r) => `<div class="card">
        <div class="src">${esc(FEEDS[r.source].label)}</div>
        <p>${esc(r.title)}</p>
        ${r.detail.map((d) => `<p>${esc(d)}</p>`).join('')}
        ${r.url ? `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">Open source report</a>` : ''}
      </div>`,
    )
    .join('');

  const related = inc.related.length
    ? `<ul class="links">${inc.related
        .slice(0, 12)
        .map((l, n) => `<li data-rel="${n}">${dot(l.incident.category)}<span>${esc(l.incident.title)}</span><span class="km">${Math.round(l.km)} km</span></li>`)
        .join('')}</ul>${inc.related.length > 12 ? `<p class="hint">and ${inc.related.length - 12} more</p>` : ''}`
    : `<p class="note">Nothing else within ${RELATED_KM} km and ${RELATED_DAYS} days.</p>`;

  return `<span class="tag">${dot(inc.category)}${esc(cat.label)}</span>
    <h3>${esc(inc.title)}</h3>
    <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <h4>What happened here</h4>
    <div id="replay-parts"></div>
    <h4>NISAR radar over this spot</h4>
    <div id="radar">${radar}</div>
    <h4>What radar can show here</h4>
    <p class="note">${esc(RADAR_NOTES[inc.category])}</p>
    <h4>Linked events (${inc.related.length})</h4>
    ${related}
    <h4>Source reports</h4>
    ${reports}`;
}

function radarHtml(inc, found) {
  const { backscatter, interferograms } = found;
  if (!backscatter.length && !interferograms.length) {
    return `<p class="note">No NISAR scene covers this point between ${day(inc.time - NISAR_LOOKBACK_DAYS * DAY)} and today. NISAR revisits every 12 days, and oceans are mostly not imaged.</p>`;
  }
  const pair = bestPair(backscatter, inc.time);
  const before = backscatter.filter((s) => s.time < inc.time).length;
  let html = `<p class="note">${backscatter.length} backscatter scenes (${before} before, ${backscatter.length - before} after) and ${interferograms.length} interferograms.</p>`;
  if (pair) {
    html += `<div class="card pair"><div class="src">What NISAR saw change</div>
      <p>Two passes on the same track and frame: ${day(pair.before.time)} and ${day(pair.after.time)}, ${Math.round(pair.span / DAY)} days apart.</p>
      <div class="actions">
        <button class="primary" id="changes">Show what changed</button>
        <button id="compare">Compare the source images</button>
      </div>
      <div id="change-out"></div></div>`;
  } else if (backscatter.length) {
    html += `<p class="note">No repeat pass after the event yet, so there is no before/after pair. The next pass on the same track comes 12 days after the last one.</p>`;
  }
  html += backscatter.slice(0, 8).map((s) => sceneCard(s, inc.time)).join('');
  if (backscatter.length > 8) html += `<p class="hint">${backscatter.length - 8} older scenes not listed.</p>`;
  if (interferograms.length) {
    html += `<h4>Interferograms (ground movement)</h4>` + interferograms.slice(0, 5).map((s) => sceneCard(s, inc.time)).join('');
  }
  return html;
}

async function selectIncident(inc, fly) {
  endCompare();
  const token = ++state.lookup;
  state.selected = { kind: 'incident', incident: inc };
  openPanel(incidentHtml(inc, '<p class="spinner">Searching the NISAR archive…</p>'));
  globe.select(inc);
  if (fly) globe.flyTo(inc.lat, inc.lon);
  replay.start(inc);

  let found;
  try {
    found = await scenesAt(inc.lat, inc.lon, inc.time - NISAR_LOOKBACK_DAYS * DAY, Date.now());
  } catch (err) {
    if (token === state.lookup) $('radar').innerHTML = `<p class="note">NISAR search failed: ${esc(err.message)}</p>`;
    return;
  }
  if (token !== state.lookup) return;
  state.selected.found = found;
  $('radar').innerHTML = radarHtml(inc, found);
  globe.select(inc, found.backscatter.slice(0, 1));
}

function selectScene(scene, fly) {
  endCompare();
  replay.stop();
  state.lookup++;
  state.selected = { kind: 'scene', scene, found: { backscatter: [scene], interferograms: [] } };
  const inside = visibleIncidents().filter((i) => pointInPolygon(i.lat, i.lon, scene.ring));
  openPanel(`<span class="tag"><i class="dot" style="--c:#39e6c4;border-radius:2px"></i>NISAR radar pass</span>
    <h3>Track ${esc(scene.track)}, frame ${esc(scene.frame)}</h3>
    <dl>
      <dt>Acquired</dt><dd>${utc(scene.time)} (${ago(scene.time)})</dd>
      <dt>Orbit</dt><dd>${esc(scene.direction)}, cycle ${esc(scene.cycle)}</dd>
      <dt>Product</dt><dd>L-band backscatter (GCOV), ${esc(scene.pipeline.toLowerCase())}</dd>
      ${scene.sizeMb ? `<dt>Full file</dt><dd>${(scene.sizeMb / 1024).toFixed(1)} GB</dd>` : ''}
    </dl>
    <h4>Preview</h4>
    ${sceneCard(scene, null)}
    <h4>Events inside this pass (${inside.length})</h4>
    ${
      inside.length
        ? `<ul class="links">${inside.map((i, n) => `<li data-in="${n}">${dot(i.category)}<span>${esc(i.title)}</span></li>`).join('')}</ul>`
        : '<p class="note">No tracked event falls inside this footprint.</p>'
    }
    <p class="hint">${esc(scene.name)}</p>`);
  state.selected.inside = inside;
  globe.select(null, [scene]);
  if (fly) globe.flyTo(scene.ring[0].lat, scene.ring[0].lon, 2_500_000);
}

function choose(found) {
  replay.stop();
  state.selected = { kind: 'choice', found };
  state.lookup++;
  openPanel(`<h3>${found.length} things overlap here</h3>
    <ul class="links">${found
      .map((f, n) =>
        f.kind === 'incident'
          ? `<li data-pick="${n}">${dot(f.incident.category)}<span>${esc(f.incident.title)}</span><span class="km">${ago(f.incident.endTime)}</span></li>`
          : `<li data-pick="${n}"><i class="dot" style="--c:#39e6c4;border-radius:2px"></i><span>NISAR pass, track ${esc(f.scene.track)} frame ${esc(f.scene.frame)}</span><span class="km">${ago(f.scene.time)}</span></li>`,
      )
      .join('')}</ul>`);
}

// ---------- radar imagery on the globe ----------

function allScenes() {
  const f = state.selected?.found;
  return f && f.backscatter ? [...f.backscatter, ...f.interferograms] : [];
}

async function showScene(id, button) {
  const scene = allScenes().find((s) => s.id === id);
  if (!scene) return;
  endCompare();
  button.textContent = 'Loading…';
  try {
    const bounds = await imageBounds(scene);
    await globe.addScene(scene, bounds);
    globe.flyToBounds(bounds);
    button.textContent = 'Shown';
  } catch {
    button.textContent = 'Preview failed';
  }
}

async function compare(button) {
  const inc = state.selected.incident;
  const pair = bestPair(state.selected.found.backscatter, inc.time);
  if (!pair) return;
  endCompare();
  replay.stop();
  button.textContent = 'Loading…';
  try {
    const [b1, b2] = await Promise.all([imageBounds(pair.before), imageBounds(pair.after)]);
    await Promise.all([globe.addScene(pair.before, b1, 'left'), globe.addScene(pair.after, b2, 'right')]);
    globe.flyToBounds(b2);
    globe.select(inc, [pair.after]);
    $('split-before').textContent = `Before · ${day(pair.before.time)}`;
    $('split-after').textContent = `After · ${day(pair.after.time)}`;
    $('split').hidden = false;
    setSplit(0.5);
    button.textContent = 'Comparing: drag the white bar';
  } catch {
    button.textContent = 'Preview failed';
  }
}

function setSplit(fraction) {
  const f = Math.max(0.02, Math.min(0.98, fraction));
  $('split-handle').style.left = `${f * 100}%`;
  globe.setSplit(f);
}

function endCompare() {
  $('split').hidden = true;
  globe.clearScenes();
  state.change = null;
  const out = $('change-out');
  if (out) out.innerHTML = '';
}

// The friendly view: colours only where the radar echo changed between the
// two passes, with the source image available underneath as proof.
async function showChanges(button) {
  const inc = state.selected.incident;
  const pair = bestPair(state.selected.found.backscatter, inc.time);
  if (!pair) return;
  endCompare();
  replay.stop();
  button.textContent = 'Comparing the two passes…';
  try {
    const [b1, b2, before, after] = await Promise.all([imageBounds(pair.before), imageBounds(pair.after), loadPicture(pair.before.image), loadPicture(pair.after.image)]);
    const result = changeMap(before, b1, after, b2);
    if (!result) throw new Error('The two passes do not overlap');
    state.change = { result, after, afterBounds: b2, pair };
    drapeChanges(false);
    globe.flyToBounds(result.bounds);
    globe.select(inc, [pair.after]);
    const km = (v) => (v >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(1));
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    $('change-out').innerHTML = `
      <ul class="legend">
        <li><i style="--c:#40aaff"></i><span><b>Echo got weaker</b> on ${km(result.weakerKm2)} km² (${pct(result.weakerShare)}). Typical causes: new open water, burnt or cleared vegetation, smoother ground.</span></li>
        <li><i style="--c:#ffaa3c"></i><span><b>Echo got stronger</b> on ${km(result.strongerKm2)} km² (${pct(result.strongerShare)}). Typical causes: flooded vegetation, wetter or rougher ground, new structures.</span></li>
      </ul>
      <label class="check"><input type="checkbox" id="under" /> Show the radar image underneath</label>
      <p class="hint">Computed in your browser from NASA's preview images of both passes over ${km(result.comparedKm2)} km². A pixel is coloured where the combined HH + HV brightness moved by more than ${Math.round((CHANGE_THRESHOLD / 255) * 100)}% of full scale. Differences that a shift of up to two pixels between the images would explain are ignored. Previews are 8-bit and reduced in resolution, so treat this as where to look, not a measurement. Open sea changes with the wind between passes. The causes listed are the usual ones, not a diagnosis.</p>`;
    button.textContent = 'Changes shown';
  } catch (err) {
    button.textContent = 'Could not compare';
    $('change-out').innerHTML = `<p class="note">${esc(err.message)}</p>`;
  }
}

function drapeChanges(withSource) {
  const c = state.change;
  if (!c) return;
  globe.clearScenes();
  if (withSource) globe.addPicture(c.after, c.afterBounds);
  globe.addPicture(c.result.canvas, c.result.bounds, undefined, 0.9);
}

// ---------- search ----------

let searchRun = 0;
let searchHits = [];
let searchAt = -1;

function renderSearch(events, places, pending) {
  searchHits = [...events.map((incident) => ({ incident })), ...places.map((place) => ({ place }))];
  searchAt = searchHits.length ? 0 : -1;
  const box = $('search-results');
  let n = 0;
  let html = '';
  if (events.length) {
    html += '<h5>Events on the map</h5>' + events.map((i) => `<div class="hit" data-n="${n++}">${dot(i.category)}<span>${esc(i.title)}</span><small>${ago(i.endTime)}</small></div>`).join('');
  }
  if (places.length) {
    html += '<h5>Places</h5>' + places.map((p) => `<div class="hit" data-n="${n++}"><span>${esc(p.label)}</span><small>${esc(p.kind)}</small></div>`).join('');
  }
  if (!html) html = `<p>${pending ? 'Searching…' : 'Nothing found. Try a place name or an event type.'}</p>`;
  box.innerHTML = html;
  box.hidden = false;
  markHit();
}

function markHit() {
  $('search-results')
    .querySelectorAll('.hit')
    .forEach((el) => el.classList.toggle('on', +el.dataset.n === searchAt));
}

function runSearch() {
  const query = $('search-box').value.trim();
  const run = ++searchRun;
  if (query.length < 2) {
    $('search-results').hidden = true;
    return;
  }
  const events = searchEvents(query, state.incidents);
  renderSearch(events, [], true);
  // Place names come from the network, so wait for a pause in typing.
  setTimeout(async () => {
    if (run !== searchRun) return;
    const places = await searchPlaces(query).catch(() => []);
    if (run === searchRun) renderSearch(events, places, false);
  }, 280);
}

function pickHit(n) {
  const hit = searchHits[n];
  if (!hit) return;
  $('search-results').hidden = true;
  $('search-box').blur();
  if (hit.incident) {
    state.hidden.delete(hit.incident.category);
    draw();
    return selectIncident(hit.incident, true);
  }
  goToPlace(hit.place);
}

// Lands on a place and lists the events around it.
function goToPlace(place) {
  endCompare();
  replay.stop();
  state.lookup++;
  const b = place.bounds;
  const reach = Math.max(250, b ? distanceKm({ lat: b.north, lon: b.west }, { lat: b.south, lon: b.east }) / 2 : 0);
  if (b && b.east > b.west) globe.flyToBounds(b);
  else globe.flyTo(place.lat, place.lon, 400_000);
  const near = visibleIncidents()
    .map((incident) => ({ incident, km: distanceKm(place, incident) }))
    .filter((x) => x.km <= reach)
    .sort((a, c) => a.km - c.km)
    .slice(0, 30);
  state.selected = { kind: 'place', near };
  globe.select(null);
  openPanel(`<span class="tag">Place</span>
    <h3>${esc(place.label)}</h3>
    <dl><dt>Where</dt><dd>${where(place.lat, place.lon)}</dd></dl>
    <h4>Events within ${Math.round(reach)} km (${near.length})</h4>
    ${
      near.length
        ? `<ul class="links">${near.map((x, n) => `<li data-near="${n}">${dot(x.incident.category)}<span>${esc(x.incident.title)}</span><span class="km">${Math.round(x.km)} km</span></li>`).join('')}</ul>`
        : '<p class="note">No tracked event near this place in the current time window.</p>'
    }
    <p class="hint">Turn on "NISAR radar picture on the globe" in the menu to see what the radar recorded here.</p>`);
}

// ---------- layer controls ----------

function applyLayers() {
  const date = $('date').value;
  globe.setNisarTiles($('nisar-tiles').checked, date, +$('stack').value);
  for (const key of Object.keys(OVERLAYS)) {
    globe.setOverlay(key, $(`ov-${key}`).checked, date);
  }
}

function shiftDate(days) {
  const next = day(Date.parse($('date').value) + days * DAY);
  if (next > $('date').max || next < $('date').min) return false;
  $('date').value = next;
  applyLayers();
  return true;
}

function togglePlay() {
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    $('date-play').textContent = 'Play';
    return;
  }
  $('nisar-tiles').checked = true;
  if ($('date').value >= $('date').max) $('date').value = day(Date.parse($('date').max) - 24 * DAY);
  applyLayers();
  $('date-play').textContent = 'Stop';
  state.playing = setInterval(() => {
    if (!shiftDate(1)) togglePlay();
  }, 2500);
}

// ---------- start ----------

async function start() {
  $('basemap').innerHTML = Object.entries(BASEMAPS)
    .map(([k, b]) => `<option value="${k}">${b.label}</option>`)
    .join('');
  $('overlays').innerHTML = Object.entries(OVERLAYS)
    .map(([k, o]) => `<label class="check"><input type="checkbox" id="ov-${k}" /> ${o.label}</label>`)
    .join('');
  globe.setBasemap('esri');
  renderStatus();

  $('basemap').onchange = (e) => globe.setBasemap(e.target.value);
  $('lighting').onchange = (e) => globe.setLighting(e.target.checked);
  $('footprints').onchange = draw;
  $('window').onchange = (e) => {
    state.windowDays = +e.target.value;
    rebuild();
  };
  $('chips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const cat = chip.dataset.cat;
    state.hidden.has(cat) ? state.hidden.delete(cat) : state.hidden.add(cat);
    draw();
  };
  ['nisar-tiles', 'stack', 'date'].forEach((id) => ($(id).onchange = applyLayers));
  $('overlays').onchange = applyLayers;
  $('date-prev').onclick = () => shiftDate(-1);
  $('date-next').onclick = () => shiftDate(1);
  $('date-play').onclick = togglePlay;
  $('terrain').onchange = (e) => globe.setTerrain(e.target.checked);
  $('stretch').oninput = (e) => {
    $('stretch-value').textContent = `×${e.target.value}`;
    globe.setExaggeration(+e.target.value);
  };
  $('nav-in').onclick = () => globe.zoom(0.5);
  $('nav-out').onclick = () => globe.zoom(2);
  $('nav-north').onclick = () => globe.faceNorth();
  $('nav-tilt').onclick = () => globe.toggleTilt();
  globe.onView = (view) => {
    $('needle').style.transform = `rotate(${-view.heading}deg)`;
    $('nav-tilt').classList.toggle('on', view.pitch > 5);
    $('nav-tilt').textContent = view.pitch > 5 ? '2D' : '3D';
  };
  $('close').onclick = closePanel;
  $('chips-all').onclick = () => {
    state.hidden.clear();
    draw();
  };
  $('chips-none').onclick = () => {
    Object.keys(CATEGORIES).forEach((c) => state.hidden.add(c));
    draw();
  };

  $('replay-toggle').onclick = () => replay.toggle();
  $('replay-bar').onclick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    replay.seek((e.clientX - box.left) / box.width);
  };

  $('search-box').oninput = runSearch;
  $('search-box').onfocus = runSearch;
  $('search-box').onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchHits.length) searchAt = (searchAt + (e.key === 'ArrowDown' ? 1 : -1) + searchHits.length) % searchHits.length;
      markHit();
    } else if (e.key === 'Enter') pickHit(searchAt);
    else if (e.key === 'Escape') $('search-results').hidden = true;
  };
  $('search-results').onclick = (e) => {
    const hit = e.target.closest('.hit');
    if (hit) pickHit(+hit.dataset.n);
  };
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#search')) $('search-results').hidden = true;
  });

  // One-time hint for first-time visitors.
  let seen = false;
  try {
    seen = localStorage.getItem('sars-welcome') === '1';
  } catch {
    /* storage unavailable: just show the hint */
  }
  $('welcome').hidden = seen;
  $('welcome-close').onclick = () => {
    $('welcome').hidden = true;
    try {
      localStorage.setItem('sars-welcome', '1');
    } catch {
      /* nothing to remember it with */
    }
  };
  $('menu').onclick = () => {
    const closed = $('left').classList.toggle('closed');
    $('menu').setAttribute('aria-expanded', String(!closed));
  };
  if (window.innerWidth <= 760) $('menu').click();

  $('detail').onclick = (e) => {
    const t = e.target;
    const sel = state.selected;
    if (!sel) return;
    if (t.dataset.show) return showScene(t.dataset.show, t);
    if (t.id === 'compare') return compare(t);
    if (t.id === 'changes') return showChanges(t);
    if (t.id === 'under') return drapeChanges(t.checked);
    const li = t.closest('li');
    if (!li) return;
    if (li.dataset.rel) return selectIncident(sel.incident.related[+li.dataset.rel].incident, true);
    if (li.dataset.in) return selectIncident(sel.inside[+li.dataset.in], true);
    if (li.dataset.near) return selectIncident(sel.near[+li.dataset.near].incident, true);
    if (li.dataset.pick) {
      const f = sel.found[+li.dataset.pick];
      return f.kind === 'incident' ? selectIncident(f.incident, false) : selectScene(f.scene, false);
    }
  };

  globe.onPick((found) => {
    if (!found.length) return;
    // Dots win over the footprints they sit on, unless several dots overlap.
    const incidents = found.filter((f) => f.kind === 'incident');
    if (incidents.length === 1) return selectIncident(incidents[0].incident, false);
    if (incidents.length > 1) return choose(incidents);
    if (found.length === 1) return selectScene(found[0].scene, false);
    choose(found);
  });

  const handle = $('split-handle');
  handle.onpointerdown = (e) => {
    handle.setPointerCapture(e.pointerId);
    handle.onpointermove = (m) => setSplit(m.clientX / window.innerWidth);
  };
  handle.onpointerup = () => (handle.onpointermove = null);

  setInterval(() => ($('clock').textContent = utc(Date.now()).replace(' UTC', ':') + new Date().toISOString().slice(17, 19) + ' UTC'), 1000);
  setInterval(renderFeed, 60_000);

  for (const name of Object.keys(FEEDS)) {
    refreshFeed(name);
    setInterval(() => refreshFeed(name), FEEDS[name].everyMs);
  }
  refreshNisar();
  setInterval(refreshNisar, NISAR_LATEST_EVERY_MS);

  const latest = await latestTileDate();
  $('date').max = latest;
  $('date').min = '2026-04-01';
  $('date').value = latest;
}

// Handy in the browser console while developing.
window.app = { state, globe, replay };

start();
