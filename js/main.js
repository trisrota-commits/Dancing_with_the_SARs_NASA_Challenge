// App wiring: polls the feeds, keeps the globe in sync and fills the panels.

import { CATEGORIES, FEEDS, BASEMAPS, OVERLAYS, RADAR_NOTES, RELATED_KM, RELATED_DAYS, NISAR_LATEST_EVERY_MS, NISAR_LOOKBACK_DAYS } from './config.js';
import { fetchFeed } from './feeds.js';
import { buildIncidents, tagNisarCoverage, pointInPolygon } from './incidents.js';
import { latestScenes, scenesAt, bestPair, imageBounds, latestTileDate } from './nisar.js';
import { Globe } from './globe.js';

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
  endCompare();
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
    html += `<div class="card pair"><div class="src">Before / after pair</div>
      <p>${day(pair.before.time)} → ${day(pair.after.time)}, same track and frame, ${Math.round(pair.span / DAY)} days apart.</p>
      <button class="primary" id="compare">Compare on globe</button></div>`;
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
    button.textContent = 'Comparing – drag the white bar';
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
  $('close').onclick = closePanel;
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
    const li = t.closest('li');
    if (!li) return;
    if (li.dataset.rel) return selectIncident(sel.incident.related[+li.dataset.rel].incident, true);
    if (li.dataset.in) return selectIncident(sel.inside[+li.dataset.in], true);
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
window.app = { state, globe };

start();
