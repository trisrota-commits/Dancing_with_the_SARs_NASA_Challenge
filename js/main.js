// App wiring: polls the feeds, keeps the globe in sync and fills the panels.

import { CATEGORIES, FEEDS, BASEMAPS, OVERLAYS, RADAR_NOTES, CHANGE_EXPLANATIONS, RELATED_KM, RELATED_DAYS, NISAR_LATEST_EVERY_MS, NISAR_LOOKBACK_DAYS, NISAR_START } from './config.js';
import { fetchFeed, fetchArchive } from './feeds.js';
import { buildIncidents, tagNisarCoverage, pointInPolygon, distanceKm } from './incidents.js';
import { edgeMarginKm, latestScenes, scenesAt, bestPair, comparisonStatus, imageBounds, latestTileDate, historyAt, newestAt, nextPass, interferogramsAt, REPEAT_DAYS } from './nisar.js';
import { STORIES } from './stories.js';
import { PLACES, PLACE_KINDS, otherHemisphere } from './places.js';
import { loadFrames, spread, view, history, describeSeries, rankByCoverage } from './timelapse.js';
import { newsFor } from './news.js';
import { playPass } from './sound.js';
import { measuredById, measuredNear, measuredHtml, measuredChart, measuredLine, changeImageUrl } from './measured.js';
import { fetchElements, positionAt, groundTrack, swathEdges, elementsEpoch } from './orbit.js';
import { SPECIES, MONTHS, POIS, loadSightings } from './wildlife.js';
import { historyChart } from './chart.js';
import { narrate, nisarLine, timeline, SOURCE_NOTES } from './narrative.js';
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
  hiddenPlaces: new Set(),
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
const diamond = (kind) => `<i class="diamond" style="--c:${PLACE_KINDS[kind].color}"></i>`;
const placeById = (id) => PLACES.find((p) => p.id === id);

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
  const cutoff = state.archive ? NISAR_START : Date.now() - state.windowDays * DAY;
  const byId = new Map();
  for (const e of [...(state.archive || []), ...Object.values(state.events).flat()]) if (e.endTime >= cutoff) byId.set(e.id, e);
  const events = [...byId.values()];
  state.incidents = buildIncidents(events);
  tagNisarCoverage(state.incidents, state.scenes);
  // An incident counts as fresh when any of its reports just arrived.
  for (const inc of state.incidents) {
    if (!state.fresh.has(inc.id) && inc.reports.some((r) => state.fresh.has(r.id))) markFresh(inc.id);
  }

  if (state.selected?.kind === 'incident') {
    const ids = new Set(state.selected.incident.reports.map((r) => r.id));
    const again = state.incidents.find((i) => i.reports.some((r) => ids.has(r.id)));
    if (again) {
      // New reports about the open event: bring its timeline up to date,
      // without moving the camera, unless the reader is looking at the past.
      const sel = state.selected;
      const grew = again.endTime !== sel.incident.endTime || again.reports.length !== sel.incident.reports.length;
      sel.incident = again;
      if (grew && replay.timeline && replay.live) {
        replay.start(again, { keepView: true });
        if (sel.passes) replay.extend(sel.reach, sel.passes.map((x) => x.time));
      }
    }
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
  refreshTicker();
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
        return `<li tabindex="0" role="button" data-n="${n}" class="${state.fresh.has(i.id) ? 'fresh' : ''}">${dot(i.category)}<span class="name">${esc(i.title)}</span><span class="t">${ago(item.time)}</span></li>`;
      }
      const s = item.scene;
      return `<li tabindex="0" role="button" data-n="${n}" class="${state.fresh.has(s.id) ? 'fresh' : ''}"><i class="dot" style="--c:#39e6c4;border-radius:2px"></i><span class="name">NISAR pass, track ${esc(s.track)} frame ${esc(s.frame)}</span><span class="t">${ago(item.time)}</span></li>`;
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

// The left menu steps aside while something is selected, so the map and
// what was picked have the room, and comes back when it is closed. Someone
// who opens or shuts the menu by hand during a selection keeps it that way.
const menu = { folded: false, byHand: false };

function focusLayout(on) {
  const left = $('left');
  if (on) {
    if (!menu.byHand && !left.classList.contains('closed')) {
      left.classList.add('closed');
      menu.folded = true;
    }
  } else {
    if (menu.folded && !menu.byHand) left.classList.remove('closed');
    menu.folded = false;
    menu.byHand = false;
  }
  $('menu').setAttribute('aria-expanded', String(!left.classList.contains('closed')));
}

// Fills the details panel. An event opens quietly: the panel is filled but
// stays shut, and the small card shows until "Show details" is pressed.
function openPanel(html, quiet = false, fold = true) {
  $('detail').innerHTML = html;
  $('right').hidden = quiet;
  $('card').hidden = !quiet;
  // A story is picked from the menu, so the menu stays for the next one.
  if (fold) focusLayout(true);
  $('tip').hidden = true;
  $('right').scrollTop = 0;
}

function closePanel() {
  setLink('');
  state.selected = null;
  state.lookup++;
  $('right').hidden = true;
  $('card').hidden = true;
  $('tip').hidden = true;
  focusLayout(false);
  globe.select(null);
  replay.stop();
  endCompare();
}

// ---------- event card and plain-text account ----------

// The popup for an event: what it is, the news about it, one line on what
// NISAR has seen, and the way into the details.
function renderCard() {
  const sel = state.selected;
  if (sel?.kind !== 'incident') return;
  const inc = sel.incident;
  const lasting = inc.endTime - inc.time > 6 * 3600_000;
  const when = lasting ? `${day(inc.time)} to ${day(inc.endTime)}` : `${utc(inc.time)} (${ago(inc.time)})`;
  const sized = size(inc.magnitude);
  let body;
  if (!sel.news) {
    body = '<p class="spinner">Looking for news about this event…</p>';
  } else if (sel.news.articles.length) {
    body =
      sel.news.articles
        .slice(0, 3)
        .map((a) => `<a class="headline" href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}<small>${esc(a.source || '')}${Number.isFinite(a.time) ? ` · ${ago(a.time)}` : ''}</small></a>`)
        .join('') + `<p class="hint">${sel.news.via === 'gdacs' ? 'Linked to this event by GDACS, by topic and country' : 'Found by a news search'}; some may be about something else. Press coverage, not data.</p>`;
  } else {
    // No press: say what the feeds themselves report.
    const lines = [...new Set(inc.reports.flatMap((r) => r.detail.map((d) => `${d} (${FEEDS[r.source].label})`)))].slice(0, 4);
    body = `<p class="note">No press coverage found${lines.length ? '. The feeds report:' : '.'}</p>${lines.length ? `<ul class="plain">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}`;
  }
  const scene = sel.passes?.length;
  $('card').innerHTML = `<button id="card-close" aria-label="Close">✕</button>
    <span class="tag">${dot(inc.category)}${esc(CATEGORIES[inc.category].label)}</span>
    <h3>${esc(inc.title)}</h3>
    <p class="when">${esc(when)}${sized ? ` · ${esc(sized)}` : ''}</p>
    <h4>In the news</h4>
    ${body}
    <p class="nisar-line">${esc(nisarLine(inc, sel.found))}</p>
    ${sel.measured ? `<p class="nisar-line measured-line">${esc(measuredLine(sel.measured, inc.time))}</p>` : ''}
    <div class="actions">
      <button class="primary" id="card-details">Show details</button>
      ${sel.found && bestPair(sel.found.backscatter, inc.time, true, inc) ? `<button id="card-change" aria-pressed="${stage.owner === 'change'}">${stage.owner === 'change' ? 'Back to the radar picture' : 'Show what changed'}</button>` : ''}
      ${scene ? `<button id="card-nisar" aria-pressed="${stage.owner === 'timeline' && !sel.nisarOff}">${stage.owner === 'timeline' && !sel.nisarOff ? 'Hide the radar picture' : 'Show the radar picture'}</button>` : ''}
    </div>`;
}

// The account of the event in the details panel, and its timeline. Both
// are redrawn as the news, the NISAR search and the history arrive.
function renderNarrative() {
  const sel = state.selected;
  if (sel?.kind !== 'incident' || !$('story-text')) return;
  $('story-text').innerHTML = narrate(sel.incident, { found: sel.found, news: sel.news, history: sel.history, measured: sel.measured, sizeText: size(sel.incident.magnitude) });
  $('timeline').innerHTML = timeline(sel.incident, sel.found);
}

// Opens the details panel for the selected event. The pass-by-pass history
// downloads several radar previews, so it only starts here.
function showDetails() {
  const sel = state.selected;
  if (sel?.kind !== 'incident') return;
  $('right').hidden = false;
  $('card').hidden = true;
  // Keyboard and screen-reader users land in the panel they just opened.
  $('close').focus({ preventScroll: true });
  if (!sel.historyStarted) {
    sel.historyStarted = true;
    startIncidentHistory(sel.incident, sel);
  }
}

// The radar picture under the event, off or on again, from the card.
function toggleCardImage() {
  const sel = state.selected;
  if (sel?.kind !== 'incident') return;
  // Anything else on the globe counts as "hidden": the button brings the
  // timeline's picture back; pressed again, it hides it.
  if (stage.owner === 'timeline') sel.nisarOff = !sel.nisarOff;
  else sel.nisarOff = false;
  sel.passIndex = undefined;
  backToTimeline();
}

// The hover box for a source named in the text. For NISAR it shows the
// newest pass itself.
function sourceTip(link) {
  const sel = state.selected;
  const key = link.dataset.src;
  const scene = key === 'nisar' ? sel?.found?.backscatter[0] : null;
  const tip = $('tip');
  tip.innerHTML = `${scene?.thumb ? `<img src="${safeUrl(scene.thumb)}" alt="" />` : ''}<span>${esc(SOURCE_NOTES[key] || '')}${scene ? ` Newest pass here: ${day(scene.time)}, ${esc(scene.direction.toLowerCase())} track ${esc(scene.track)}.` : ''} <b>Click to see it.</b></span>`;
  tip.hidden = false;
  // Beside the panel, level with the link, so it never covers the text.
  const box = link.getBoundingClientRect();
  const panel = $('right').getBoundingClientRect();
  const beside = panel.left - tip.offsetWidth - 10;
  tip.style.left = `${beside > 8 ? beside : Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, box.left))}px`;
  tip.style.top = `${beside > 8 ? Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, box.top - 8)) : box.bottom + 6}px`;
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
  bar.hidden = false;
  bar.classList.toggle('timeline', !!u.timeline);
  if (u.timeline || u.state === 'loading') bar.classList.remove('back');
  if (u.state === 'loading') {
    bar.classList.add('timeline');
    $('replay-caption').textContent = 'Gathering what is known about this event…';
    $('replay-fill').style.width = '0';
    $('replay-knob').style.left = '100%';
    $('replay-span').style.width = '0';
    $('replay-marks').textContent = '';
    if (list) list.innerHTML = '<p class="spinner">Loading the event history…</p>';
    return;
  }
  $('replay-toggle').textContent = u.state === 'playing' ? '❚❚' : '▶';
  const percent = (f) => `${(f * 100).toFixed(2)}%`;
  $('replay-fill').style.width = percent(u.progress);
  $('replay-bar').setAttribute('aria-valuenow', Math.round(u.progress * 100));
  if (u.timeline) {
    // The event's own stretch of the line, NISAR's passes as ticks, and
    // the handle. The radar picture follows the handle.
    $('replay-knob').style.left = percent(u.progress);
    $('replay-span').style.left = percent(u.span[0]);
    $('replay-span').style.width = percent(Math.max(0.006, u.span[1] - u.span[0]));
    const marks = u.marks.map(percent).join(',');
    if ($('replay-marks').dataset.at !== marks) {
      $('replay-marks').dataset.at = marks;
      $('replay-marks').innerHTML = u.marks.map((f) => `<i style="left:${percent(f)}"></i>`).join('');
    }
    const event = state.selected?.incident;
    if (event) $('replay-span').style.background = CATEGORIES[event.category].color;
    $('replay-from').textContent = day(u.range.from);
    document.querySelector('.key-event').style.background = event ? CATEGORIES[event.category].color : '';
    $('replay-bar').setAttribute('aria-label', 'Timeline: drag to go back in time');
    $('replay-bar').setAttribute('aria-valuetext', u.live ? 'Latest' : day(u.ms));
    $('replay-live').classList.toggle('on', u.live);
    $('replay-live').textContent = u.live ? '● Latest' : 'Go to latest';
    const pass = syncNisar(u.ms);
    // The opening plays in seconds, not on a date.
    $('replay-caption').textContent = `${u.intro ? '' : `${u.live ? 'Latest' : day(u.ms)} · `}${u.caption}${pass ? ` · NISAR pass of ${day(pass.time)} underneath` : ''}`;
  } else {
    // The time-lapse is a looping player, and says so. Inside an event it
    // offers the way back to that event's timeline.
    $('replay-caption').textContent = `Time-lapse (loops) · ${u.caption}`;
    $('replay-bar').setAttribute('aria-label', 'Time-lapse position');
    $('replay-bar').setAttribute('aria-valuetext', u.caption);
    const inEvent = state.selected?.kind === 'incident';
    bar.classList.toggle('back', inEvent);
    $('replay-live').classList.remove('on');
    $('replay-live').textContent = 'Back to the event';
  }
  if (list && u.parts && list.partsRef !== u.parts) {
    list.partsRef = u.parts;
    list.innerHTML = `<ul class="parts">${u.parts
      .map((p) => `<li><span class="badge ${p.kind}">${BADGE[p.kind]}</span><span>${esc(p.text)}${p.source ? ` <small>· ${esc(p.source)}</small>` : ''}</span></li>`)
      .join('')}</ul>
      <p class="hint">Observed = measured or catalogued. Analysis = worked out and published by an agency. Computed = drawn here by the stated rule.</p>`;
  }
}

// ---------- NISAR passes on the event timeline ----------

// The passes of one repeat track over the event, oldest first: the track of
// the best before/after pair, or else the one that holds the place best.
function timelinePasses(inc, found) {
  const key = (x) => `${x.stack}-${x.pol?.code}`;
  const usable = found.backscatter.filter((x) => x.image && x.pol?.co);
  const pair = bestPair(usable, inc.time, true, inc);
  const best = pair ? pair.after : [...usable].sort((a, b) => edgeMarginKm(b.ring, inc.lat, inc.lon) - edgeMarginKm(a.ring, inc.lat, inc.lon))[0];
  return best ? usable.filter((x) => key(x) === key(best)).sort((a, b) => a.time - b.time) : [];
}

// Puts the radar picture of the newest pass up to `ms` on the globe, and
// returns that pass. Does nothing while the reader has switched it off.
function syncNisar(ms) {
  const sel = state.selected;
  if (sel?.kind !== 'incident' || !sel.passes?.length) return null;
  // Only while the timeline owns the globe: a pass picked by hand, the
  // change picture or the divider is left alone.
  if (stage.owner !== 'timeline') return null;
  let i = -1;
  if (!sel.nisarOff) sel.passes.forEach((x, k) => x.time <= ms && (i = k));
  const pass = i >= 0 ? sel.passes[i] : null;
  // The caption names a pass only once its picture is really up.
  if (i === sel.passIndex) return sel.passLoaded === i ? pass : null;
  sel.passIndex = i;
  if (!pass) {
    globe.clearScenes();
    setLegend(null);
    return null;
  }
  // The first picture is uncovered by the sweep; later ones cross-fade.
  const first = !sel.passShown;
  sel.passShown = true;
  const token = stage.token;
  Promise.all([imageBounds(pass), loadPicture(pass.image)])
    .then(([bounds, picture]) => {
      if (state.selected !== sel || sel.passIndex !== i || token !== stage.token) return;
      if (first) globe.sweepTo(picture, bounds, pass.direction !== 'Descending');
      else globe.fadeTo(picture, bounds, 0.45);
      setLegend('radar', { pol: pass.pol, time: pass.time });
      sel.passLoaded = i;
      if (replay.timeline) replay.report();
    })
    .catch(() => {
      /* a preview that will not load leaves the last picture up */
    });
  return null;
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
        .map((l, n) => `<li tabindex="0" role="button" data-rel="${n}">${dot(l.incident.category)}<span>${esc(l.incident.title)}</span><span class="km">${Math.round(l.km)} km</span></li>`)
        .join('')}</ul>${inc.related.length > 12 ? `<p class="hint">and ${inc.related.length - 12} more</p>` : ''}`
    : `<p class="note">Nothing else within ${RELATED_KM} km and ${RELATED_DAYS} days.</p>`;

  // One plain text first, then the timeline; everything else is folded
  // away under headings the text links to. NISAR comes first and is open.
  return `<span class="tag">${dot(inc.category)}${esc(cat.label)}</span>
    <h3>${esc(inc.title)}</h3>
    <div id="story-text" class="prose"></div>
    <div id="timeline"></div>
    <details class="fold" id="sec-nisar" open>
      <summary>NISAR radar at this place</summary>
      <div id="measured-slot"></div>
      <h4>Radar brightness here, pass by pass</h4>
      <div id="incident-history" aria-live="polite"><p class="spinner">Searching NISAR repeat passes…</p></div>
      <h4>Passes, changes and ground movement</h4>
      <div id="radar">${radar}</div>
      ${lapseBox(inc.lat, inc.lon)}
    </details>
    <details class="fold" id="sec-replay"><summary>How the drawing on the globe is built</summary><div id="replay-parts"></div></details>
    <details class="fold" id="sec-news"><summary>In the news</summary><div id="news"><p class="spinner">Looking for press coverage…</p></div></details>
    <details class="fold" id="sec-linked"><summary>Linked events (${inc.related.length})</summary>${related}</details>
    <details class="fold" id="sec-reports"><summary>Source reports and facts</summary>
      <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${reports}
    </details>
    <details class="fold" id="sec-about"><summary>What radar can show for this kind of event</summary><p class="note">${esc(RADAR_NOTES[inc.category])}</p></details>`;
}

// "Next NISAR overpass" card with a live countdown. The time is an estimate
// worked out from archived passes, and says so.
function nextPassHtml(scenes) {
  const est = nextPass(scenes);
  if (!est) return '';
  const local = new Date(est.time).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const weak = est.missed
    ? ` ${est.missed} expected ${est.missed === 1 ? 'pass' : 'passes'} since then ${est.missed === 1 ? 'is' : 'are'} not in the archive, so this estimate is weak.`
    : '';
  return `<div class="card" id="next-pass">
    <div class="src">Next NISAR overpass <span class="badge computed">Computed</span></div>
    <p><b class="countdown" data-until="${est.time}">…</b></p>
    <p>${utc(est.time)} · ${esc(local)} your time</p>
    <details class="fold inner"><summary>How this is worked out</summary>
    <p>Newest archived pass on ${esc(est.last.direction.toLowerCase())} track ${esc(est.last.track)}, frame ${esc(est.last.frame)} (${utc(est.last.time)}), plus NISAR's ${REPEAT_DAYS}-day repeat cycle.${weak} An overpass is not a guaranteed acquisition, and images reach the archive hours to days later. NASA's own observation plan needs a login, so it is not used here.</p></details>
  </div>`;
}

// Ticks every countdown on the page once a second; touches the DOM only.
function tickCountdowns() {
  for (const el of document.querySelectorAll('.countdown')) {
    let left = Math.floor((+el.dataset.until - Date.now()) / 1000);
    if (left <= 0) {
      // Past due: recompute from the same passes rather than run negative.
      const scenes = state.selected?.found?.newest?.length ? state.selected.found.newest : (state.lapse?.stacks || []).flatMap((st) => st.scenes);
      const card = $('next-pass');
      if (card && scenes.length) card.outerHTML = nextPassHtml(scenes);
      else el.textContent = 'Due about now';
      continue;
    }
    const d = Math.floor(left / 86400);
    left -= d * 86400;
    const h = String(Math.floor(left / 3600)).padStart(2, '0');
    const m = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
    const sec = String(left % 60).padStart(2, '0');
    el.textContent = `in ${d} d ${h}:${m}:${sec}`;
  }
}

const SENTINEL_OFFER = `<p class="note">Meanwhile, Sentinel-1 flies a shorter radar wavelength (C-band, about 5.6 cm, against NISAR's 24 cm L-band) and may already have imaged the area. <button id="s1-now">Show Sentinel-1 radar here</button></p>`;

function radarHtml(inc, found) {
  const { backscatter, interferograms } = found;
  if (!backscatter.length && !interferograms.length) {
    return `<p class="note">No NISAR scene covers this point between ${day(inc.time - NISAR_LOOKBACK_DAYS * DAY)} and today. NISAR revisits every 12 days, and oceans are mostly not imaged.</p>`;
  }
  const { pair, reason } = comparisonStatus(backscatter, inc.time, inc);
  const before = backscatter.filter((s) => s.time < inc.time).length;
  let html = `<p class="note">${backscatter.length} radar images (${before} before the event, ${backscatter.length - before} after) and ${interferograms.length} interferograms, which compare two passes to show ground movement.</p>`;
  html += nextPassHtml(found.newest?.length ? found.newest : backscatter);
  if (pair) {
    const explanation = Object.hasOwn(CHANGE_EXPLANATIONS, inc.category) ? CHANGE_EXPLANATIONS[inc.category] : CHANGE_EXPLANATIONS.other;
    html += `<div class="card pair"><div class="src">What NISAR saw change</div>
      <p>Two passes on the same track and frame: ${day(pair.before.time)} and ${day(pair.after.time)}, ${Math.round(pair.span / DAY)} days apart.</p>
      <details><summary>Why might this have changed?</summary>
        <p>${esc(explanation)}</p>
        <p class="hint">Possible explanations, not a diagnosis. These comparisons use preview brightness, not calibrated radar measurements. Image scaling and alignment can also affect the apparent change. The event category selects this guidance; it is not a classification of the images or proof that the event caused a change.</p>
      </details>
      <div class="actions">
        <button class="primary" id="changes">Show what changed</button>
        <button id="compare">Compare the source images</button>
      </div>
      <div id="change-out"></div></div>`;
  } else {
    // The reason comes from the catalogue metadata; Sentinel-1 is offered
    // as context while NISAR has no usable pair.
    html += `<p class="note">Before/after comparison unavailable: ${esc(reason)}</p>${backscatter.length ? SENTINEL_OFFER : ''}`;
  }
  // An interferogram whose two passes sit either side of the event shows
  // how far the ground itself moved.
  const spanning = interferograms.filter((g) => g.refTime < inc.time && g.secTime > inc.time).sort((a, b) => a.secTime - a.refTime - (b.secTime - b.refTime));
  if (spanning.length) {
    const g = spanning[0];
    html += `<div class="card pair"><div class="src">Ground movement</div>
      <p>An interferogram compares the passes of ${day(g.refTime)} and ${day(g.secTime)}, either side of this event${spanning.length > 1 ? `, and ${spanning.length - 1} more ${spanning.length > 2 ? 'do' : 'does'} too` : ''}.</p>
      <div class="actions"><button class="primary" id="igram-go" data-show="${esc(g.id)}">Show ground movement</button></div>
      <p class="hint">Each full run through the colours means the distance to the satellite changed by about 12 cm, half of NISAR's 24 cm wavelength. Tight bands that crowd around one place are ground movement. Broad bands across the whole picture are mostly the atmosphere, and speckle means the two passes did not match, as over water.</p></div>`;
  } else if (inc.category === 'earthquake' && !interferograms.length) {
    html += `<p class="note">No interferogram yet. NISAR publishes interferograms later than backscatter images, so recent earthquakes may not have one for a while.</p>`;
  }
  // The single passes are for those who want them.
  html += `<details class="fold inner"><summary>Every pass found (${backscatter.length + interferograms.length})</summary>`;
  html += backscatter.slice(0, 8).map((s) => sceneCard(s, inc.time)).join('');
  if (backscatter.length > 8) html += `<p class="hint">${backscatter.length - 8} older scenes not listed.</p>`;
  if (interferograms.length) {
    html += `<h4>Interferograms (ground movement)</h4>` + interferograms.slice(0, 5).map((s) => sceneCard(s, inc.time)).join('');
  }
  return `${html}</details>`;
}

async function selectIncident(inc, fly, intro = '') {
  take('timeline');
  const token = ++state.lookup;
  // A story, or someone already reading details, goes straight to the
  // panel; otherwise the event opens as the small card.
  const detailed = !!intro || (!$('right').hidden && state.selected?.kind === 'incident');
  // The linked events as listed in the panel: a feed refresh re-sorts them.
  state.selected = { kind: 'incident', incident: inc, historyStarted: detailed, related: inc.related, story: !!intro };
  openPanel(intro + incidentHtml(inc, '<p class="spinner">Searching the NISAR archive…</p>'), !detailed, !intro);
  renderCard();
  renderNarrative();
  const opened = state.selected;
  showMeasured(() => state.selected === opened, measuredNear(inc.lat, inc.lon, inc.time));
  globe.select(inc);
  if (fly) globe.flyTo(inc.lat, inc.lon);
  replay.start(inc);
  // Independent of the replay and the shorter before/after catalogue search.
  if (detailed) startIncidentHistory(inc, state.selected);
  loadNews(inc, state.selected);
  setLink(`event=${encodeURIComponent(inc.id)}`);

  let found;
  try {
    // Scenes around the event, plus the newest ones for the next-pass estimate.
    const [around, newest] = await Promise.all([
      scenesAt(inc.lat, inc.lon, inc.time - NISAR_LOOKBACK_DAYS * DAY, Math.min(Date.now(), inc.endTime + 75 * DAY)),
      newestAt(inc.lat, inc.lon).catch(() => []),
    ]);
    found = { ...around, newest };
  } catch (err) {
    if (token !== state.lookup) return;
    // Say so where the reader is looking, not only in the folded section.
    $('radar').innerHTML = `<p class="note">NISAR search failed: ${esc(err.message)}</p>`;
    state.selected.found = { backscatter: [], interferograms: [], newest: [], failed: true };
    renderCard();
    renderNarrative();
    return;
  }
  if (token !== state.lookup) return;
  const sel = state.selected;
  sel.found = found;
  $('radar').innerHTML = radarHtml(inc, found);
  // NISAR's passes go onto the event's timeline, which reaches back far
  // enough to hold the last two before the event, and the picture of the
  // pass the timeline stands at is shown.
  sel.passes = timelinePasses(inc, found);
  const earlier = sel.passes.filter((x) => x.time < inc.time);
  sel.reach = earlier.length ? earlier[Math.max(0, earlier.length - 2)].time - DAY : null;
  replay.extend(sel.reach, sel.passes.map((x) => x.time));
  renderCard();
  renderNarrative();
  globe.select(inc, sel.passes.slice(-1));
}

function selectScene(scene, fly) {
  setLink('');
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
        ? `<ul class="links">${inside.map((i, n) => `<li tabindex="0" role="button" data-in="${n}">${dot(i.category)}<span>${esc(i.title)}</span></li>`).join('')}</ul>`
        : '<p class="note">No tracked event falls inside this footprint.</p>'
    }
    <p class="hint">${esc(scene.name)}</p>`);
  state.selected.inside = inside;
  globe.select(null, [scene]);
  if (fly) globe.flyTo(scene.ring[0].lat, scene.ring[0].lon, 2_500_000);
}

function choose(found) {
  endCompare();
  globe.select(null);
  setLink('');
  replay.stop();
  state.selected = { kind: 'choice', found };
  state.lookup++;
  openPanel(`<h3>${found.length} things overlap here</h3>
    <ul class="links">${found
      .map((f, n) =>
        f.kind === 'incident'
          ? `<li tabindex="0" role="button" data-pick="${n}">${dot(f.incident.category)}<span>${esc(f.incident.title)}</span><span class="km">${ago(f.incident.endTime)}</span></li>`
          : f.kind === 'place'
            ? `<li tabindex="0" role="button" data-pick="${n}">${diamond(f.place.kind)}<span>${esc(f.place.name)}</span><span class="km">${esc(PLACE_KINDS[f.place.kind].label)}</span></li>`
            : f.kind === 'satellite'
              ? `<li tabindex="0" role="button" data-pick="${n}"><i class="dot" style="--c:#39e6c4"></i><span>NISAR, live position</span><span class="km">satellite</span></li>`
              : f.kind === 'animal'
                ? `<li tabindex="0" role="button" data-pick="${n}"><i class="dot" style="--c:${speciesOf(f.animal).color}"></i><span>${esc(f.animal.common)}</span><span class="km">${esc(f.animal.date || '')}</span></li>`
                : f.kind === 'poi'
                  ? `<li tabindex="0" role="button" data-pick="${n}"><i class="dot" style="--c:#f4e3b2"></i><span>${esc(f.poi.name)}</span><span class="km">landmark</span></li>`
                  : `<li tabindex="0" role="button" data-pick="${n}"><i class="dot" style="--c:#39e6c4;border-radius:2px"></i><span>NISAR pass, track ${esc(f.scene.track)} frame ${esc(f.scene.frame)}</span><span class="km">${ago(f.scene.time)}</span></li>`,
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
  const token = take('manual');
  button.textContent = 'Loading…';
  try {
    const [bounds, picture] = await Promise.all([imageBounds(scene), loadPicture(scene.image)]);
    if (token !== stage.token) return;
    globe.sweepTo(picture, bounds, scene.direction !== 'Descending');
    globe.flyToBounds(bounds);
    if (scene.product === 'GUNW') setLegend('interferogram', { from: scene.refTime, to: scene.secTime });
    else setLegend('radar', { pol: scene.pol, time: scene.time });
    button.textContent = 'Shown';
    renderCard();
  } catch {
    if (token !== stage.token) return;
    button.textContent = 'Preview failed';
    backToTimeline();
  }
}

async function compare(button) {
  const sel = state.selected;
  const inc = sel.incident;
  const pair = bestPair(sel.found.backscatter, inc.time, true, inc);
  if (!pair) return;
  const token = take('compare');
  button.textContent = 'Loading…';
  try {
    const [b1, b2, before, after] = await Promise.all([imageBounds(pair.before), imageBounds(pair.after), loadPicture(pair.before.image), loadPicture(pair.after.image)]);
    if (token !== stage.token) return;
    globe.addPicture(before, b1, 'left');
    globe.addPicture(after, b2, 'right');
    globe.flyToBounds(b2);
    globe.select(inc, [pair.after]);
    $('split-before').textContent = `Before · ${day(pair.before.time)}`;
    $('split-after').textContent = `After · ${day(pair.after.time)}`;
    $('split').hidden = false;
    setSplit(0.5);
    setLegend('radar', { pol: pair.after.pol });
    button.textContent = 'Comparing: drag the white bar';
    renderCard();
  } catch {
    if (token !== stage.token) return;
    button.textContent = 'Preview failed';
    backToTimeline();
  }
}

function setSplit(fraction) {
  const f = Math.max(0.02, Math.min(0.98, fraction));
  $('split-handle').style.left = `${f * 100}%`;
  globe.setSplit(f);
}

// ---------- the key to what is on the globe ----------

// Says what the picture on the globe is and what its colours mean, in the
// corner of the map, whenever a radar picture or a change picture is up.
// kind: 'radar' | 'interferogram' | 'change' | null to hide.
function setLegend(kind, info = {}) {
  const box = $('legend');
  if (!kind) return (box.hidden = true);
  const row = (color, text) => `<li><i style="--c:${color}"></i><span>${text}</span></li>`;
  let html;
  if (kind === 'radar') {
    const pol = info.pol?.co ? info.pol : { co: 'HH', cross: 'HV' };
    const single = !pol.cross || info.channel;
    const channel = info.channel === 'cross' ? pol.cross : pol.co;
    html = `<b>NISAR radar picture${info.time ? ` · ${day(info.time)}` : ''}</b>
      <p>Not a photo: it shows how strongly the ground sends the radar pulse back.</p>
      <ul>${
        single
          ? row('#f2f2f2', 'Bright: rough ground, buildings, plants standing in water') + row('#10141c;border:1px solid #556', 'Dark: calm water, smooth or wet ground')
          : row('#4be04b', 'Green: forest and other vegetation') + row('#d85bd8', 'Magenta: bare ground and buildings') + row('#f2f2f2', 'White: both echoes strong') + row('#10141c;border:1px solid #556', 'Dark: calm water, smooth ground')
      }</ul>
      <small>${single ? `One radar channel (${esc(channel)}).` : `Two radar channels: magenta is ${esc(pol.co)}, green is ${esc(pol.cross)}.`}</small>`;
  } else if (kind === 'interferogram') {
    html = `<b>NISAR interferogram${info.from ? ` · ${day(info.from)} to ${day(info.to)}` : ''}</b>
      <p>Two passes compared: the colours show how the distance to the satellite changed.</p>
      <ul>${row('linear-gradient(90deg,#f33,#ff3,#3f3,#3ff,#33f,#f3f)', 'One run through the colours: about 12 cm')}</ul>
      <small>Tight bands around one place are ground movement. Broad bands are mostly the atmosphere. Speckle means the passes did not match, as over water.</small>`;
  } else {
    const km = (v) => (v >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(1));
    html = `<b>What changed · ${day(info.from)} to ${day(info.to)}</b>
      <p>Where the radar echo differs between two NISAR passes.</p>
      <ul>${row('#40aaff', `Echo got weaker: ${km(info.result.weakerKm2)} km²`) + row('#ffaa3c', `Echo got stronger: ${km(info.result.strongerKm2)} km²`)}</ul>
      <small>Worked out from preview pictures: a guide to where to look, not a measurement, and not a statement of cause.</small>`;
  }
  // On a phone the key is one line until tapped, to leave the map visible.
  const title = html.slice(0, html.indexOf('</b>') + 4);
  box.innerHTML = `<details ${window.innerWidth > 760 ? 'open' : ''}><summary>${title}</summary>${html.slice(title.length)}</details>`;
  box.hidden = false;
}

// One thing at a time owns the picture on the globe, with its key and
// divider: the event timeline, a pass picked by hand, the change picture,
// the before/after divider, a chart date, the time-lapse, or nothing.
// Taking the globe clears what was there and hands back a token; work that
// waits for pictures checks the token before drawing, so a slow download
// can never land on top of what the reader asked for next.
const stage = { owner: 'none', token: 0 };

function take(owner) {
  stage.token++;
  stage.owner = owner;
  // A running time-lapse yields to whatever takes the globe from it.
  if (owner !== 'lapse' && replay.plan && !replay.timeline) replay.stop();
  setLegend(null);
  globe.clearScenes();
  // The divider stays up while the two radar wavelengths are being compared.
  if (state.bands) showBandSplit();
  else $('split').hidden = true;
  state.change = null;
  const out = $('change-out');
  if (out) out.innerHTML = '';
  // Buttons that had put a picture up go back to offering it.
  if ($('compare')) $('compare').textContent = 'Compare the source images';
  if ($('changes')) $('changes').textContent = 'Show what changed';
  document.querySelectorAll('#detail [data-show]').forEach((b) => (b.textContent = b.id === 'igram-go' ? 'Show ground movement' : 'Show on globe'));
  // The timeline draws its pass afresh when it next owns the globe.
  if (state.selected) state.selected.passIndex = state.selected.passLoaded = undefined;
  return stage.token;
}

function endCompare() {
  take('none');
}

// Hands the globe back to the event's timeline and shows its pass again.
function backToTimeline() {
  if (stage.owner !== 'timeline') take('timeline');
  if (replay.timeline) replay.report();
  else syncNisar(Date.now());
  renderCard();
}

// The friendly view: colours only where the radar echo changed between the
// two passes, with the source image available underneath as proof.
// "Show what changed", from the card or from the details panel: the change
// between the two passes either side of the event, over the newer radar
// picture. The timeline stays; pressing again goes back to its picture.
async function showChanges(button) {
  const sel = state.selected;
  if (sel?.kind !== 'incident' || !sel.found) return;
  if (stage.owner === 'change') return backToTimeline();
  const inc = sel.incident;
  const pair = bestPair(sel.found.backscatter, inc.time, true, inc);
  if (!pair) return;
  const token = take('change');
  button.textContent = 'Comparing the two passes…';
  try {
    const [b1, b2, before, after] = await Promise.all([imageBounds(pair.before), imageBounds(pair.after), loadPicture(pair.before.image), loadPicture(pair.after.image)]);
    if (token !== stage.token) return;
    const result = changeMap(before, b1, after, b2);
    const pol = pair.after.pol?.co ? pair.after.pol : { co: 'radar', cross: null };
    const channels = pol.cross ? `combined ${pol.co} + ${pol.cross}` : pol.co;
    if (!result) throw new Error('The two passes do not overlap');
    state.change = { result, after, afterBounds: b2, pair };
    drapeChanges(true);
    setLegend('change', { result, from: pair.before.time, to: pair.after.time });
    globe.select(inc, [pair.after]);
    const km = (v) => (v >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(1));
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    if ($('change-out')) {
      $('change-out').innerHTML = `
      <ul class="legend">
        <li><i style="--c:#40aaff"></i><span><b>Echo got weaker</b> on ${km(result.weakerKm2)} km² (${pct(result.weakerShare)}). Typical causes: new open water, burnt or cleared vegetation, smoother ground.</span></li>
        <li><i style="--c:#ffaa3c"></i><span><b>Echo got stronger</b> on ${km(result.strongerKm2)} km² (${pct(result.strongerShare)}). Typical causes: flooded vegetation, wetter or rougher ground, new structures.</span></li>
      </ul>
      <label class="check"><input type="checkbox" id="under" checked /> Show the radar image underneath</label>
      <details class="fold inner"><summary>How this is worked out</summary>
      <p class="hint">Computed in your browser from NASA's preview images of both passes over ${km(result.comparedKm2)} km². A pixel is coloured where the ${esc(channels)} brightness moved by more than ${Math.round((CHANGE_THRESHOLD / 255) * 100)}% of full scale. Differences that a shift of up to two pixels between the images would explain are ignored. Previews are 8-bit and reduced in resolution, so treat this as where to look, not a measurement. Open sea changes with the wind between passes. The causes listed are the usual ones, not a diagnosis.</p></details>`;
    }
    if ($('changes')) $('changes').textContent = 'Back to the radar picture';
    renderCard();
  } catch (err) {
    if (token !== stage.token) return;
    backToTimeline();
    if ($('changes')) $('changes').textContent = 'Could not compare';
    if ($('change-out')) $('change-out').innerHTML = `<p class="note">${esc(err.message)}</p>`;
  }
}

function drapeChanges(withSource) {
  const c = state.change;
  if (!c) return;
  globe.fadeToAll([...(withSource ? [{ image: c.after, bounds: c.afterBounds, alpha: 1 }] : []), { image: c.result.canvas, bounds: c.result.bounds, alpha: 0.9 }], 0.9);
}

// ---------- press coverage ----------

async function loadNews(inc, selection) {
  const { articles, via } = await newsFor(inc).catch(() => ({ articles: [], via: 'gdelt' }));
  const box = $('news');
  if (state.selected !== selection || !box) return;
  selection.news = { articles, via };
  renderCard();
  renderNarrative();
  if (!articles.length) {
    box.innerHTML = '<p class="note">No press coverage found for this event. Small or remote events often go unreported.</p>';
    return;
  }
  const how =
    via === 'gdacs'
      ? 'Articles GDACS has linked to this event by topic and country; some may be about something else.'
      : 'Found by searching the GDELT news index for the place and event type; only headlines naming the place are kept, but some may still be about something else.';
  box.innerHTML = `${articles
    .map(
      (a) => `<a class="article" href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer">
        ${a.image ? `<img src="${safeUrl(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
        <span><b>${esc(a.title)}</b><small>${esc(a.source || '')}${Number.isFinite(a.time) ? ` · ${ago(a.time)}` : ''}</small></span>
      </a>`,
    )
    .join('')}
    <p class="hint">Press coverage, not data: written by news outlets and not checked by this app. ${how}</p>`;
}

// ---------- share links ----------

// The address bar always points at what is open, so it can be copied.
function setLink(hash) {
  // window.history, because this file also imports a function called history.
  window.history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

// Opens whatever a shared link points at. Events may need a moment, or the
// archive, before they are loaded.
async function openLink() {
  // Whatever the reader picks while this is still looking wins.
  const look = state.lookup;
  const [key, raw] = location.hash.slice(1).split('=');
  const value = decodeURIComponent(raw || '');
  if (!key || !value) return;
  if (key === 'story') return openStory(value);
  if (key === 'place' && placeById(value)) return selectPlace(placeById(value), true);
  if (key === 'spot') {
    const [lat, lon] = value.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      globe.flyTo(lat, lon, 400_000);
      return selectSpot({ lat, lon });
    }
    return;
  }
  if (key !== 'event') return;
  const find = () => state.incidents.find((i) => i.reports.some((r) => r.id === value));
  for (let tries = 0; tries < 20 && !find(); tries++) await new Promise((r) => setTimeout(r, 700));
  if (!find() && !state.archive) {
    $('window').value = 'nisar';
    await $('window').onchange({ target: $('window') });
  }
  const incident = find();
  if (incident && look === state.lookup) {
    state.hidden.delete(incident.category);
    draw();
    selectIncident(incident, true);
  }
}

// ---------- stories ----------

// `data` is what the story shows (a time-lapse box, an interferogram): it
// goes right after "What to look at", before the explanations.
function storyHtml(story, data = '') {
  const n = STORIES.indexOf(story);
  const next = STORIES[(n + 1) % STORIES.length];
  const part = (heading, text, hypothesis) => `<h4>${heading}${hypothesis ? ' <span class="badge computed">Hypothesis</span>' : ''}</h4><p class="note">${esc(text)}</p>`;
  return `<div class="story" data-story="${story.id}">
    <span class="tag">Story ${n + 1} of ${STORIES.length} · ${esc(story.kind)}</span>
    <h3>${esc(story.title)}</h3>
    <p class="note">${esc(story.place)} · ${where(story.lat, story.lon)}</p>
    ${part('What to look at', story.look)}
    ${data}
    ${part('Why it happens', story.why, true)}
    ${part('Which polarisation shows it', story.pol, true)}
    ${part('What a camera would miss', story.beyond)}
    ${part('Who could use this, and for what', story.next)}
    <p class="hint">The place and the explanations are our choice. Every number here is computed from the NISAR passes and feeds loaded right now.</p>
    <button id="story-next" data-next="${next.id}">Next story: ${esc(next.title)} ▸</button>
  </div>`;
}

async function openStory(id) {
  const story = STORIES.find((x) => x.id === id);
  if (!story) return;
  endCompare();
  replay.stop();
  state.lookup++;
  state.selected = { kind: 'story', story };
  globe.select(null);
  setLink(`story=${story.id}`);

  if (story.action === 'lapse') {
    openPanel(storyHtml(story, `<h4>NISAR time-lapse at this point</h4>${lapseBox(story.lat, story.lon)}`), false, false);
    return startLapse();
  }
  if (story.action === 'interferogram') {
    openPanel(storyHtml(story, `<h4>The interferogram</h4><div id="igram"><p class="spinner">Searching the NISAR archive…</p></div>`), false, false);
    globe.flyTo(story.lat, story.lon, 600_000);
    const token = state.lookup;
    try {
      const list = await interferogramsAt(story.lat, story.lon);
      if (token !== state.lookup) return;
      if (!list.length) throw new Error('No interferogram with a preview covers this point.');
      // The longest gap between passes gives slow movement the most time to show.
      const pick = [...list].sort((a, b) => b.secTime - b.refTime - (a.secTime - a.refTime))[0];
      state.selected.found = { backscatter: [], interferograms: list };
      const [bounds, picture] = await Promise.all([imageBounds(pick), loadPicture(pick.image)]);
      if (token !== state.lookup) return;
      take('manual');
      globe.sweepTo(picture, bounds, pick.direction !== 'Descending');
      setLegend('interferogram', { from: pick.refTime, to: pick.secTime });
      globe.flyToBounds(bounds);
      $('igram').innerHTML = `<p class="note">Shown on the globe: ${day(pick.refTime)} compared with ${day(pick.secTime)}, ${Math.round((pick.secTime - pick.refTime) / DAY)} days apart, ${esc(pick.direction.toLowerCase())} track ${esc(pick.track)}. ${list.length} pairs cover this point in all.</p>
        ${list.slice(0, 4).map((x) => sceneCard(x, null)).join('')}`;
    } catch (err) {
      if (token === state.lookup) $('igram').innerHTML = `<p class="note">${esc(err.message)}</p>`;
    }
    return;
  }
  // An event story: find the event in the archive and open it under the story.
  openPanel(`${storyHtml(story)}<p class="spinner">Loading events since NISAR's data began…</p>`, false, false);
  globe.flyTo(story.lat, story.lon, 900_000);
  const token = state.lookup;
  if (!state.archive) {
    $('window').value = 'nisar';
    await $('window').onchange({ target: $('window') });
  }
  if (token !== state.lookup) return;
  // The strongest event of the story's kind near its point, from the feeds.
  const incident = state.incidents
    .filter((i) => i.category === story.category && distanceKm(i, story) <= story.withinKm)
    .sort((a, b) => b.severity - a.severity)[0];
  if (!incident) {
    $('detail').querySelector('.spinner').outerHTML = '<p class="note">This event is not in the feeds\' archives right now.</p>';
    return;
  }
  state.hidden.delete(incident.category);
  draw();
  await selectIncident(incident, false, storyHtml(story));
  if (token + 1 !== state.lookup) return;
  setLink(`story=${story.id}`);
  // The story is about the ground movement, so show it straight away.
  $('igram-go')?.click();
}

// ---------- alerts ticker ----------

// Freshness rule: "New" means first reported in the last 6 hours. Reports
// from the last 24 hours follow as "Earlier today". Long-running events that
// a feed updated in the last 6 hours are "Ongoing", at most three of them.
const NEW_MS = 6 * 3600_000;
const RECENT_MS = 24 * 3600_000;
const ticker = { items: [], at: 0, paused: false, dismissed: false };

function tickerItems() {
  const now = Date.now();
  const list = visibleIncidents();
  const fresh = list.filter((i) => now - i.time < RECENT_MS).sort((a, b) => b.time - a.time);
  const ongoing = list
    .filter((i) => now - i.time >= RECENT_MS && now - i.endTime < NEW_MS)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3);
  return [
    ...fresh.map((incident) => ({ incident, label: now - incident.time < NEW_MS ? 'New' : 'Earlier today' })),
    ...ongoing.map((incident) => ({ incident, label: 'Ongoing' })),
  ].slice(0, 15);
}

function renderTicker() {
  const bar = $('ticker');
  if (ticker.dismissed) return (bar.hidden = true);
  bar.hidden = false;
  const statuses = Object.entries(state.feedStatus).filter(([k]) => k !== 'nisar');
  const checked = Math.max(0, ...statuses.filter(([, s]) => s.ok).map(([, s]) => s.at));
  const down = statuses.filter(([, s]) => !s.ok).map(([k]) => FEEDS[k].label);
  let feeds = checked ? `Feeds checked ${new Date(checked).toISOString().slice(11, 16)} UTC` : 'Loading the feeds…';
  if (checked && Date.now() - checked > 15 * 60_000) feeds += ' (stale)';
  if (down.length) feeds += ` · ${down.join(', ')} offline`;
  $('ticker-feeds').textContent = feeds;

  if (!ticker.items.length) {
    $('ticker-label').textContent = '';
    $('ticker-label').className = 'badge';
    $('ticker-label').hidden = true;
    $('ticker-text').textContent = checked ? 'No new reports from the feeds in the last 24 hours. That does not mean nothing is happening.' : '';
    $('ticker-text').disabled = true;
    $('ticker-count').textContent = '';
    return;
  }
  ticker.at = (ticker.at + ticker.items.length) % ticker.items.length;
  const { incident, label } = ticker.items[ticker.at];
  const sources = [...new Set(incident.reports.map((r) => FEEDS[r.source].label))].join(' + ');
  $('ticker-label').hidden = false;
  $('ticker-label').textContent = label;
  $('ticker-label').className = `badge ${label === 'New' ? 'observed' : ''}`;
  $('ticker-text').disabled = false;
  $('ticker-text').textContent = [`${CATEGORIES[incident.category].label}: ${incident.title}`, size(incident.magnitude), incident.nisarScenes.length ? 'NISAR passed here in the last days' : null, sources, `${utc(label === 'Ongoing' ? incident.endTime : incident.time)} (${ago(label === 'Ongoing' ? incident.endTime : incident.time)})`]
    .filter(Boolean)
    .join(' · ');
  $('ticker-count').textContent = `${ticker.at + 1}/${ticker.items.length}`;
}

function refreshTicker() {
  const shown = ticker.items[ticker.at]?.incident.id;
  ticker.items = tickerItems();
  // Stay on the same report across a feed refresh when it is still listed.
  const again = ticker.items.findIndex((x) => x.incident.id === shown);
  ticker.at = again >= 0 ? again : 0;
  renderTicker();
}

function startTicker() {
  const step = (by) => {
    ticker.at += by;
    renderTicker();
  };
  $('ticker-prev').onclick = () => step(-1);
  $('ticker-next').onclick = () => step(1);
  $('ticker-pause').onclick = () => {
    ticker.paused = !ticker.paused;
    $('ticker-pause').textContent = ticker.paused ? '▶' : '❚❚';
    $('ticker-pause').setAttribute('aria-label', ticker.paused ? 'Resume cycling through reports' : 'Pause cycling through reports');
  };
  $('ticker-close').onclick = () => {
    ticker.dismissed = true;
    renderTicker();
  };
  $('ticker-text').onclick = () => {
    const item = ticker.items[ticker.at];
    if (item) selectIncident(item.incident, true);
  };
  // People who ask for less motion step through by hand instead.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) $('ticker-pause').click();
  const bar = $('ticker');
  setInterval(() => {
    if (!ticker.paused && !ticker.dismissed && !bar.matches(':hover') && !bar.contains(document.activeElement)) step(1);
  }, 7000);
  renderTicker();
}

// ---------- NISAR time-lapse ----------

const LAPSE_STEP = 0.9; // seconds each pass stays on screen
const LAPSE_DEFAULT = 14; // passes loaded unless "all" is ticked
const PIN_HISTORY = 8; // passes sampled automatically when an event is opened

// Loads a bounded history alongside incident details, without taking ownership
// of the replay or incrementing lookup (the radar search shares that token).
async function startIncidentHistory(inc, selection) {
  const box = $('incident-history');
  const current = () => state.selected === selection && $('incident-history') === box;
  if (!box || !current()) return;
  try {
    const stacks = await rankByCoverage(await historyAt(inc.lat, inc.lon), inc.lat, inc.lon);
    if (!current()) return;
    const stack = stacks[0]; // tracks that cover the pin first, then by number of passes
    if (!stack) {
      box.innerHTML = '<p class="note">No repeat history available: the archive has fewer than two placeable previews on the same track, frame and orbit direction here.</p>';
      return;
    }
    // Each pass is about a megabyte, and this loads on every click on an
    // event, so it samples fewer passes than the full time-lapse does.
    const wanted = spread(stack.scenes, PIN_HISTORY);
    const pol = stack.pol?.co ? stack.pol : { co: 'Radar', cross: null };
    const channels = pol.cross ? `${pol.co} and ${pol.cross}` : pol.co;
    const frames = [];
    // Do not start more image requests after switching or closing the pin.
    for (let i = 0; i < wanted.length; i += 3) {
      box.innerHTML = `<p class="spinner">Loading preview history: ${i} of ${wanted.length} passes…</p>`;
      frames.push(...await loadFrames(wanted.slice(i, i + 3)));
      if (!current()) return;
    }
    const samples = history(frames, inc.lat, inc.lon);
    const byId = new Map(frames.map((frame, i) => [frame.scene.id, { frame, point: samples[i] }]));
    // Keep failed images in their original time slots so lines show gaps.
    const points = wanted.map((scene) => byId.get(scene.id)?.point || { time: scene.time, co: null, cross: null });
    const usable = points.filter((p) => p.co != null).length;
    // The samples also feed the plain-text account.
    const sampled = points.filter((p) => p.co != null);
    if (sampled.length >= 2) {
      selection.history = { pol: pol.co, pols: pol, points: sampled };
      renderNarrative();
    }
    box.innerHTML = `
      <p class="note">${usable} usable samples from ${wanted.length} requested previews of ${stack.scenes.length} available passes. Same ${esc(stack.direction)} track ${esc(stack.track)}, frame ${esc(stack.frame)}; ${day(wanted[0].time)} to ${day(wanted[wanted.length - 1].time)}.${stack.unplaced ? ` ${stack.unplaced} other passes lack placeable previews and are omitted.` : ''}</p>
      <div id="incident-history-chart"></div>
      <p id="incident-history-status" class="note" role="status">${usable < 2 ? 'Insufficient data for a trend: fewer than two previews have samples at this pin. ' : ''}${wanted.length - usable} requested passes have no sample (failed image or no coverage); these are gaps, not zero brightness.</p>
      <p class="hint">${esc(channels)} ${pol.cross ? 'are' : 'is'} NASA preview brightness (0–255), not calibrated backscatter or a measurement of forest loss, area lost or ice melt. Samples average up to 5×5 preview pixels; the ground footprint varies with image resolution and coverage, not a fixed area. Click a chart date to show that pass on the globe.</p>`;
    if (!usable) {
      $('incident-history-chart').innerHTML = '<p class="note">No brightness history could be sampled from these previews.</p>';
      return;
    }
    const chart = historyChart($('incident-history-chart'), points, pol, (i) => {
      if (!current()) return;
      const frame = byId.get(wanted[i].id)?.frame;
      const status = $('incident-history-status');
      if (!frame) {
        status.textContent = `${day(wanted[i].time)}: preview unavailable; no image to show.`;
        return;
      }
      // A date picked by hand takes the globe; the timeline keeps running
      // underneath and takes it back when it is next touched.
      take('chart');
      globe.addPicture(view(frame, 'colour'), frame.bounds);
      setLegend('radar', { pol, time: frame.time });
      renderCard();
      globe.flyToBounds(frame.bounds);
      chart.setActive(i);
      status.textContent = `${day(frame.time)}: preview shown on globe.${points[i].co == null ? ' No sample at the exact pin.' : ''}`;
    });
  } catch (err) {
    if (current()) box.innerHTML = `<p class="note">Preview history unavailable: ${esc(err.message)}</p>`;
  }
}

function lapseBox(lat, lon) {
  return `<div id="lapse" data-lat="${lat}" data-lon="${lon}"><button id="lapse-go">▶ Play a year of NISAR passes here</button></div>`;
}

// Finds every pass over the point, loads one repeat track of them and
// plays them in order, with a history chart for the point itself.
async function startLapse(stackIndex = 0, all = false) {
  const box = $('lapse');
  if (!box) return;
  const lat = +box.dataset.lat;
  const lon = +box.dataset.lon;
  // Its own counter: bumping the selection's would cancel the event's
  // NISAR search, which may still be running.
  const run = (state.lapseRun = (state.lapseRun || 0) + 1);
  const look = state.lookup;
  const stale = () => run !== state.lapseRun || look !== state.lookup || !$('lapse');
  take('lapse');
  replay.stop();
  box.innerHTML = '<p class="spinner">Searching a year of NISAR passes…</p>';
  let stacks = state.lapse?.lat === lat && state.lapse?.lon === lon ? state.lapse.stacks : null;
  try {
    // Tracks whose picture really covers the point go first.
    stacks = stacks || (await rankByCoverage(await historyAt(lat, lon), lat, lon));
  } catch (err) {
    box.innerHTML = `<p class="note">NISAR search failed: ${esc(err.message)}</p>`;
    return;
  }
  if (stale()) return;
  if (!stacks.length) {
    box.innerHTML = '<p class="note">NISAR has not imaged this spot at least twice on the same track yet. Open ocean is mostly not imaged.</p>';
    return;
  }
  const stack = stacks[stackIndex];
  const wanted = all ? stack.scenes : spread(stack.scenes, LAPSE_DEFAULT);
  const frames = await loadFrames(wanted, (done, total) => {
    if (!stale()) box.innerHTML = `<p class="spinner">Loading pass ${done} of ${total}…</p>`;
  });
  if (stale()) return;
  if (frames.length < 2) {
    box.innerHTML = '<p class="note">The preview images for these passes could not be loaded.</p>';
    return;
  }

  const lapse = { lat, lon, stacks, stackIndex, all, frames, mode: 'colour', chart: null };
  state.lapse = lapse;
  const pol = stack.pol?.co ? stack.pol : { co: 'Radar', cross: null };
  const names = { colour: pol.cross ? `both radar channels in colour (${pol.co} + ${pol.cross})` : `one radar channel (${pol.co})`, co: `${pol.co} channel only`, cross: `${pol.cross} channel only` };
  const plan = {
    duration: frames.length * LAPSE_STEP,
    parts: null,
    index: -1,
    draw(t) {
      const i = Math.max(0, Math.min(frames.length - 1, Math.floor(t / LAPSE_STEP)));
      if (stage.owner !== 'lapse' || (i === this.index && this.mode === lapse.mode)) return;
      this.index = i;
      this.mode = lapse.mode;
      globe.fadeTo(view(frames[i], lapse.mode), frames[i].bounds, 0.45);
      lapse.chart?.setActive(i);
      if (lapse.sound && replay.playing) playPass(lapse.series?.[i]);
    },
    caption() {
      const i = Math.max(0, this.index);
      return `${day(frames[i].time)} · pass ${i + 1} of ${frames.length} · ${names[lapse.mode]}`;
    },
    teardown() {
      globe.clearScenes();
      // The passes are large: let them go, keep the track list for a restart.
      lapse.frames = null;
      // Its controls would be dead now, so the box offers to play again.
      const here = $('lapse');
      if (here && state.lapse === lapse) here.innerHTML = '<button id="lapse-go">▶ Play a year of NISAR passes here</button>';
    },
  };
  lapse.plan = plan;

  // The picture controls and the chart come first; the fine print follows.
  box.innerHTML = `
    <div class="actions seg" role="group" aria-label="Which radar channel to show">
      <button data-mode="colour" class="on">${pol.cross ? 'Colour' : 'As published'}</button>
      ${pol.cross ? `<button data-mode="co">${esc(pol.co)} only</button><button data-mode="cross">${esc(pol.cross)} only</button>` : ''}
    </div>
    <h4>Brightness at ${where(lat, lon)}</h4>
    <div id="lapse-chart"></div>
    ${stacks.length > 1 ? `<label class="row"><span>Track</span><select id="lapse-stack">${stacks.map((st, n) => `<option value="${n}" ${n === stackIndex ? 'selected' : ''}>${esc(st.direction)} ${esc(st.track)} (${st.scenes.length} passes)</option>`).join('')}</select></label>` : ''}
    ${stack.scenes.length > frames.length || all ? `<label class="check"><input type="checkbox" id="lapse-all" ${all ? 'checked' : ''} /> Load all ${stack.scenes.length} passes (about ${stack.scenes.length} MB)</label>` : ''}
    <label class="check"><input type="checkbox" id="lapse-sound" /> ♪ Play it as sound: pitch follows the brightness at this point</label>
    <p class="note">${frames.length} of ${stack.scenes.length} passes on ${esc(stack.direction.toLowerCase())} track ${esc(stack.track)}, frame ${esc(stack.frame)}, ${day(frames[0].time)} to ${day(frames[frames.length - 1].time)}.${stack.unplaced ? ` ${stack.unplaced} earlier passes are left out: their previews were published without public corner coordinates, so they cannot be placed on the map accurately.` : ''}${stack.otherModes ? ` ${stack.otherModes} passes recorded in a different polarisation mode are left out too, because their previews are not comparable with these.` : ''}</p>
    ${state.selected?.kind === 'incident' ? '' : nextPassHtml(stacks.flatMap((st) => st.scenes))}
    <p class="hint">Each pass is NASA's preview of a NISAR backscatter scene, recorded here in ${pol.cross ? `dual polarisation. ${esc(pol.co)} is the echo that comes back in the polarisation that was sent; ${esc(pol.cross)} is the part that came back twisted, which mostly happens inside vegetation` : `single polarisation (${esc(pol.co)}), so there is no cross-polarised channel`}. Values are the 0–255 preview brightness averaged over 5×5 pixels, not calibrated radar units. Click the chart to jump to a pass.</p>`;
  const series = history(frames, lat, lon);
  lapse.series = series;
  if (series.some((p) => p.co != null)) {
    lapse.chart = historyChart($('lapse-chart'), series, pol, (i) => replay.seek((i + 0.01) / frames.length));
    // What the numbers say, worked out from the series by fixed rules.
    const lines = describeSeries(series, pol);
    if (lines.length) $('lapse-chart').insertAdjacentHTML('beforeend', `<ul class="parts facts">${lines.map((l) => `<li><span class="badge computed">Computed</span><span>${esc(l)}</span></li>`).join('')}</ul>`);
  }
  else $('lapse-chart').innerHTML = '<p class="note">These passes do not cover the exact point, so there is no history to chart.</p>';

  replay.run(plan);
  lapse.pol = pol;
  setLegend('radar', { pol });
  globe.select(state.selected?.incident || null, [stack.scenes[stack.scenes.length - 1]]);
  globe.flyToBounds(frames[frames.length - 1].bounds);
}

function setLapseMode(mode) {
  const lapse = state.lapse;
  if (!lapse?.plan || replay.plan !== lapse.plan) return;
  lapse.mode = mode;
  $('lapse')
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  setLegend('radar', { pol: lapse.pol, channel: mode === 'colour' ? null : mode });
  replay.seek(Math.min(0.999, replay.time / lapse.plan.duration));
}

// A click on bare ground offers a time-lapse there.
function offerHere(at, screen) {
  const here = $('here');
  here.hidden = false;
  here.style.left = `${screen.x}px`;
  here.style.top = `${screen.y}px`;
  here.onclick = () => {
    here.hidden = true;
    selectSpot(at);
  };
}

async function selectSpot(at) {
  endCompare();
  replay.stop();
  state.lookup++;
  state.selected = { kind: 'spot' };
  const spot = state.selected;
  globe.select(null);
  setLink(`spot=${at.lat.toFixed(4)},${at.lon.toFixed(4)}`);
  openPanel(`<span class="tag">Place</span>
    <h3 id="spot-name">${where(at.lat, at.lon)}</h3>
    <dl><dt>Where</dt><dd>${where(at.lat, at.lon)}</dd></dl>
    <h4>NISAR radar over this spot</h4>
    ${lapseBox(at.lat, at.lon)}`);
  startLapse();
  // A name for the spot, if the geocoder knows one.
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${at.lat}&lon=${at.lon}&lang=en`);
    const p = (await res.json()).features?.[0]?.properties;
    const name = p && [p.name || p.city || p.county, p.state, p.country].filter(Boolean).join(', ');
    if (name && $('spot-name') && state.selected === spot) $('spot-name').textContent = name;
  } catch {
    /* coordinates are a fine title */
  }
}

// ---------- live sky, NISAR and wildlife ----------

const live = {
  elements: null,
  track: null,
  swath: null,
  trackAt: 0,
  sightings: null,
  month: new Date().getUTCMonth(),
  playing: true,
  timer: null,
  hiddenSpecies: new Set(),
};

function openFound(f) {
  if (f.kind === 'incident') return selectIncident(f.incident, false);
  if (f.kind === 'place') return selectPlace(f.place, false);
  if (f.kind === 'satellite') return selectSatellite();
  if (f.kind === 'animal') return selectAnimal(f.animal);
  if (f.kind === 'poi') return selectPoi(f.poi);
  return selectScene(f.scene, false);
}

const speciesOf = (a) => SPECIES.find((sp) => sp.id === a.species);

async function startNisarLive() {
  $('nisar-live-status').textContent = 'loading…';
  live.elements = await fetchElements();
  if (!live.elements) {
    $('nisar-live-status').textContent = 'orbit data unavailable';
    return;
  }
  $('nisar-live-status').textContent = '';
  tickNisar();
  setInterval(tickNisar, 1000);
}

// Moves the satellite once a second; the ground track is recomputed every 30 s.
function tickNisar() {
  const e = live.elements;
  if (!e || !$('live-nisar').checked) {
    // Once is enough: clearing it again every second would redraw the globe.
    if (live.satelliteShown !== false) globe.setSatellite(null);
    live.satelliteShown = false;
    return;
  }
  live.satelliteShown = true;
  const now = new Date();
  if (!live.track || now - live.trackAt > 30_000) {
    live.track = groundTrack(e.satrec, now, 50, 50, 1);
    live.swath = swathEdges(live.track);
    live.trackAt = now;
  }
  const pos = positionAt(e.satrec, now);
  if (!pos) return;
  const shift = (now - live.trackAt) / 60_000;
  globe.setSatellite({ now: pos, track: live.track.map((p) => ({ ...p, minutes: p.minutes - shift })), swath: live.swath });
  live.pos = pos;
  if (state.selected?.kind === 'satellite' && $('sat-facts')) satFacts(pos);
}

function satFacts(pos) {
  $('sat-facts').innerHTML = `<dt>Over</dt><dd>${where(pos.lat, pos.lon)}</dd>
    <dt>Height</dt><dd>${Math.round(pos.altKm)} km</dd>
    <dt>Speed</dt><dd>${pos.speedKms.toFixed(2)} km/s (${Math.round(pos.speedKms * 3600).toLocaleString('en')} km/h)</dd>`;
}

function selectSatellite() {
  setLink('');
  const e = live.elements;
  if (!e) return;
  endCompare();
  replay.stop();
  state.lookup++;
  state.selected = { kind: 'satellite' };
  globe.select(null);
  openPanel(`<span class="tag"><i class="dot" style="--c:#39e6c4"></i>Live</span>
    <h3>NISAR, right now</h3>
    <dl id="sat-facts"></dl>
    <div class="actions"><button id="sat-follow">Fly to NISAR</button></div>
    <h4>Its orbit</h4>
    <p class="note">NISAR circles the Earth about every 100 minutes, 747 km up, passing near both poles. Its orbit keeps it over the line between day and night (a dawn–dusk orbit), and it repeats the same path every 12 days.</p>
    <h4>Where the radar looks</h4>
    <p class="note">The radar looks to the left of the flight direction. The two lines on the ground mark the edges of its 242 km swath over the last 25 minutes, and the two beams show where it points now. NISAR does not image all the time, so this shows where it can look, not proof that it did.</p>
    <h4>Where this comes from</h4>
    <p class="hint">Position worked out in your browser with the standard SGP4 orbit model, from public orbit elements (${esc(e.source)}, ${esc(e.name)}, epoch ${utc(elementsEpoch(e.satrec).getTime())}). Accurate to a few kilometres. The swath edges are approximate.</p>`);
  satFacts(live.pos || positionAt(e.satrec, new Date()));
}

function selectAnimal(a) {
  setLink('');
  const sp = speciesOf(a);
  endCompare();
  replay.stop();
  state.lookup++;
  state.selected = { kind: 'animal' };
  globe.select({ lat: a.lat, lon: a.lon, related: [] });
  const basis = { HUMAN_OBSERVATION: 'Seen by a person', MACHINE_OBSERVATION: 'Recorded by an instrument or tag', PRESERVED_SPECIMEN: 'Museum specimen', OCCURRENCE: 'Occurrence record' }[a.basis] || 'Occurrence record';
  openPanel(`<span class="tag"><i class="dot" style="--c:${sp.color}"></i>Wildlife sighting</span>
    <h3>${esc(sp.common)}</h3>
    <p class="hint"><em>${esc(sp.sci)}</em></p>
    <dl>
      <dt>Seen</dt><dd>${esc(a.date || 'date not given')}</dd>
      <dt>Where</dt><dd>${where(a.lat, a.lon)}${a.country ? ` · ${esc(a.country)}` : ''}</dd>
      <dt>Record</dt><dd>${esc(basis)}</dd>
    </dl>
    <p class="note">${esc(sp.note)}</p>
    <p class="hint">From ${esc(a.dataset || 'a dataset')} via GBIF, the Global Biodiversity Information Facility. <a href="${safeUrl(a.url)}" target="_blank" rel="noopener">Open the record</a></p>
    <h4>NISAR radar over this spot</h4>
    ${lapseBox(a.lat, a.lon)}`);
}

function selectPoi(poi) {
  setLink('');
  endCompare();
  replay.stop();
  state.lookup++;
  state.selected = { kind: 'poi' };
  globe.select({ lat: poi.lat, lon: poi.lon, related: [] });
  openPanel(`<span class="tag"><i class="dot" style="--c:#f4e3b2"></i>Landmark · not NISAR data</span>
    <h3>${esc(poi.name)}</h3>
    <dl><dt>Where</dt><dd>${where(poi.lat, poi.lon)}</dd></dl>
    <p class="note">${esc(poi.text)}</p>
    <p class="hint">NISAR images land and ice, and only rarely the open ocean, so there is usually no NISAR data here.</p>`);
}

function renderSpeciesChips() {
  const counts = {};
  (live.sightings || []).forEach((s) => (counts[s.species] = (counts[s.species] || 0) + 1));
  $('species-chips').innerHTML = SPECIES.map(
    (sp) =>
      `<button class="chip ${live.hiddenSpecies.has(sp.id) ? 'off' : ''}" data-species="${sp.id}" aria-pressed="${!live.hiddenSpecies.has(sp.id)}" style="--c:${sp.color}"><i></i>${esc(sp.common)} ${counts[sp.id] || 0}</button>`,
  ).join('');
}

function showMonth(splash) {
  if (!live.sightings) return;
  $('wildlife-month').textContent = MONTHS[live.month];
  const m = live.month + 1;
  const decor = $('decor').checked;
  globe.setAnimals(
    live.sightings
      .filter((a) => a.month === m && !live.hiddenSpecies.has(a.species))
      .map((a) => {
        const sp = speciesOf(a);
        return { animal: a, lat: a.lat, lon: a.lon, color: sp.color, size: 6, splash: splash && decor && sp.splash };
      }),
  );
}

function playMonths(on) {
  live.playing = on;
  clearInterval(live.timer);
  live.timer = null;
  $('wildlife-play').textContent = on ? 'Pause' : 'Play';
  if (on && $('wildlife').checked) {
    live.timer = setInterval(() => {
      live.month = (live.month + 1) % 12;
      showMonth(true);
    }, 1800);
  }
}

async function setWildlife(on) {
  $('wildlife-controls').hidden = !on;
  if (!on) {
    playMonths(false);
    live.playing = true;
    $('wildlife-play').textContent = 'Pause';
    globe.setAnimals([]);
    return;
  }
  if (!live.sightings) {
    $('wildlife-status').textContent = 'loading…';
    try {
      live.sightings = await loadSightings((done, total) => ($('wildlife-status').textContent = `loading ${Math.round((done / total) * 100)}%`));
    } catch {
      $('wildlife-status').textContent = 'GBIF unavailable';
      return;
    }
    $('wildlife-status').textContent = `${live.sightings.length.toLocaleString('en')} records`;
  }
  if (!$('wildlife').checked) return;
  renderSpeciesChips();
  showMonth(true);
  playMonths(live.playing);
}

function setDecor(on) {
  globe.setShootingStars(on);
  globe.setPois(on ? POIS.map((poi) => ({ poi, lat: poi.lat, lon: poi.lon })) : []);
}

// ---------- calibrated measurements ----------

// Fills #measured-slot when tools/measure.py has measured this spot.
// stillHere() guards against the panel having moved on meanwhile.
async function showMeasured(stillHere, pending, findCompare) {
  const d = await pending;
  if (!d || !stillHere() || !$('measured-slot')) return;
  const compare = findCompare ? await findCompare() : null;
  if (!stillHere() || !$('measured-slot')) return;
  state.selected.measured = d;
  $('measured-slot').innerHTML = `<h4>Measured with NISAR</h4>${measuredHtml(d, compare)}`;
  measuredChart($('measured-chart'), d, compare);
  // An event's card and text lead with the calibrated value once it is here.
  renderCard();
  renderNarrative();
}

async function showMeasuredMap(button) {
  const d = state.selected?.measured;
  if (!d) return;
  const token = take('manual');
  button.textContent = 'Loading…';
  try {
    const picture = await loadPicture(changeImageUrl(d));
    if (token !== stage.token) return;
    globe.addPicture(picture, d.change.bounds, undefined, 0.95);
    globe.flyToBounds(d.change.bounds);
    button.textContent = 'Change map shown';
  } catch {
    if (token === stage.token) button.textContent = 'Change map failed to load';
  }
}

// ---------- changing places ----------

// Kinds of place where the change is ground movement, which shows in
// interferograms and not in the backscatter time-lapse.
const MOVING_GROUND = new Set(['subsidence', 'volcano', 'landslide']);

function visiblePlaces() {
  return PLACES.filter((p) => !state.hiddenPlaces.has(p.kind));
}

function drawPlaces() {
  const shown = visiblePlaces();
  globe.renderPlaces(shown.map((place) => ({ place, color: PLACE_KINDS[place.kind].color })));
  const counts = {};
  PLACES.forEach((p) => (counts[p.kind] = (counts[p.kind] || 0) + 1));
  $('place-chips').innerHTML = Object.entries(PLACE_KINDS)
    .map(
      ([key, k]) =>
        `<button class="chip ${state.hiddenPlaces.has(key) ? 'off' : ''}" data-kind="${key}" aria-pressed="${!state.hiddenPlaces.has(key)}" style="--c:${k.color}"><i></i>${k.label} ${counts[key] || 0}</button>`,
    )
    .join('');
  $('place-list').innerHTML = shown
    .map((p) => `<li tabindex="0" role="button" data-site="${esc(p.id)}">${diamond(p.kind)}<span>${esc(p.name)}</span><span class="km">${esc(p.region)}</span></li>`)
    .join('');
  $('place-count').textContent = shown.length;
}

async function selectPlace(place, fly) {
  endCompare();
  replay.stop();
  const kind = PLACE_KINDS[place.kind];
  state.selected = { kind: 'site', place, incident: { lat: place.lat, lon: place.lon, related: [] } };
  setLink(`place=${place.id}`);
  globe.select(state.selected.incident);
  if (fly) globe.flyTo(place.lat, place.lon, 300_000);

  const others = place.kind === 'glacier' ? otherHemisphere(place) : [];
  const links = kind.links.length
    ? `<h4>Read more (context, not NISAR)</h4><ul class="plain">${kind.links
        .map(([label, url]) => `<li><a href="${safeUrl(url)}" target="_blank" rel="noopener">${esc(label)}</a></li>`)
        .join('')}</ul>`
    : '';
  openPanel(`<span class="tag">${diamond(place.kind)}Changing place · ${esc(kind.label)}</span>
    <h3>${esc(place.name)}</h3>
    <dl><dt>Where</dt><dd>${esc(place.region)} · ${where(place.lat, place.lon)}</dd></dl>
    <h4>Why this place</h4>
    <div class="context"><p class="note">${esc(place.story)}</p>
    <p class="hint">Background from published research, not measured by this app.</p></div>
    <h4>What NISAR can show here</h4>
    <p class="note">${esc(kind.look)}</p>
    <p class="note">${esc(kind.note)}</p>
    ${place.animals ? `<h4>Animals and the water</h4><p class="note">${esc(place.animals)} NISAR maps the flooding and drying that they follow. Turn on wildlife sightings under “Live sky and wildlife” to see migrating species.</p>` : ''}
    <div id="measured-slot"></div>
    <h4>NISAR passes over this spot</h4>
    ${lapseBox(place.lat, place.lon)}
    ${MOVING_GROUND.has(place.kind) ? '<h4>Interferograms (ground movement)</h4><div id="place-ifg"><p class="spinner">Searching for interferograms…</p></div>' : ''}
    ${
      others.length
        ? `<h4>Same months, other hemisphere</h4><p class="hint">Play one of these next to see the opposite season.</p><ul class="links">${others
            .map((p) => `<li tabindex="0" role="button" data-site="${esc(p.id)}">${diamond(p.kind)}<span>${esc(p.name)}</span><span class="km">${esc(p.region)}</span></li>`)
            .join('')}</ul>`
        : ''
    }
    ${links}`);
  startLapse();
  showMeasured(() => state.selected?.place === place, measuredById(place.id), async () => {
    for (const other of others) {
      const d = await measuredById(other.id);
      if (d) return d;
    }
    return null;
  });

  if (!MOVING_GROUND.has(place.kind)) return;
  let found;
  try {
    found = await scenesAt(place.lat, place.lon, NISAR_START, Date.now());
  } catch (err) {
    if (state.selected?.place === place && $('place-ifg')) $('place-ifg').innerHTML = `<p class="note">NISAR search failed: ${esc(err.message)}</p>`;
    return;
  }
  if (state.selected?.place !== place || !$('place-ifg')) return;
  state.selected.found = { backscatter: [], interferograms: found.interferograms };
  $('place-ifg').innerHTML = found.interferograms.length
    ? found.interferograms.slice(0, 6).map((s) => sceneCard(s, null)).join('')
    : `<p class="note">No NISAR interferogram over this spot since ${day(NISAR_START)} yet. They are published later than backscatter images.</p>`;
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
  setLink('');
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
        ? `<ul class="links">${near.map((x, n) => `<li tabindex="0" role="button" data-near="${n}">${dot(x.incident.category)}<span>${esc(x.incident.title)}</span><span class="km">${Math.round(x.km)} km</span></li>`).join('')}</ul>`
        : '<p class="note">No tracked event near this place in the current time window.</p>'
    }
    <h4>NISAR radar over this place</h4>
    ${lapseBox(place.lat, place.lon)}`);
}

// ---------- layer controls ----------

function applyLayers() {
  const date = $('date').value;
  globe.setNisarTiles($('nisar-tiles').checked, date, +$('stack').value);
  for (const key of Object.keys(OVERLAYS)) {
    globe.setOverlay(key, $(`ov-${key}`).checked, date);
  }
  // Two wavelengths side by side, for the same days.
  state.bands = $('bands').checked;
  globe.setBandCompare(state.bands, date, Math.min(3, +$('stack').value));
  if (state.bands) showBandSplit();
  else if (!globe.pictures.some((p) => p.side)) $('split').hidden = true;
}

function showBandSplit() {
  $('split-before').textContent = 'NISAR · L-band, 24 cm';
  $('split-after').textContent = 'Sentinel-1 · C-band, 5.6 cm';
  $('split').hidden = false;
  setSplit(0.5);
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
  const groups = [...new Set(Object.values(OVERLAYS).map((o) => o.group))];
  $('overlays').innerHTML = groups
    .map(
      (group) =>
        `<h5>${group}</h5>` +
        Object.entries(OVERLAYS)
          .filter(([, o]) => o.group === group)
          .map(([k, o]) => `<label class="check"><input type="checkbox" id="ov-${k}" /> ${o.label}</label>`)
          .join(''),
    )
    .join('');
  globe.setBasemap('esri');
  renderStatus();

  $('basemap').onchange = (e) => globe.setBasemap(e.target.value);
  $('lighting').onchange = (e) => globe.setLighting(e.target.checked);
  globe.setLighting($('lighting').checked);
  $('live-nisar').onchange = tickNisar;
  $('wildlife').onchange = (e) => setWildlife(e.target.checked);
  $('wildlife-play').onclick = () => playMonths(!live.playing);
  $('species-chips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const id = chip.dataset.species;
    live.hiddenSpecies.has(id) ? live.hiddenSpecies.delete(id) : live.hiddenSpecies.add(id);
    renderSpeciesChips();
    showMonth(false);
  };
  $('decor').onchange = (e) => setDecor(e.target.checked);
  setDecor($('decor').checked);
  startNisarLive();
  $('footprints').onchange = draw;
  $('window').onchange = async (e) => {
    const run = (state.windowRun = (state.windowRun || 0) + 1);
    if (e.target.value !== 'nisar') {
      state.archive = null;
      state.windowDays = +e.target.value;
      $('window-note').hidden = true;
      return rebuild();
    }
    $('window-note').hidden = false;
    $('window-note').textContent = `Loading larger events since ${day(NISAR_START)}…`;
    const archive = await fetchArchive();
    // A shorter window chosen while the archive loaded stays chosen.
    if (run !== state.windowRun) return;
    state.archive = archive;
    $('window-note').textContent = `Events since ${day(NISAR_START)}: earthquakes of magnitude 6 and up, orange and red GDACS alerts, and NASA-tracked floods, storms, volcanoes and ice. Smaller events are shown for the last 14 days only.`;
    rebuild();
  };
  $('chips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const cat = chip.dataset.cat;
    state.hidden.has(cat) ? state.hidden.delete(cat) : state.hidden.add(cat);
    draw();
  };
  ['nisar-tiles', 'stack', 'date', 'bands'].forEach((id) => ($(id).onchange = applyLayers));
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
  // Called on every drawn frame, so it only touches the page on a change.
  const shown = { heading: null, tilted: null };
  globe.onView = (camera) => {
    const heading = Math.round(camera.heading);
    const tilted = camera.pitch > 5;
    if (heading !== shown.heading) $('needle').style.transform = `rotate(${-heading}deg)`;
    if (tilted !== shown.tilted) {
      $('nav-tilt').classList.toggle('on', tilted);
      $('nav-tilt').textContent = tilted ? '2D' : '3D';
    }
    shown.heading = heading;
    shown.tilted = tilted;
  };
  // ✕ on the details of an event steps back to its card and timeline; the
  // card's own ✕, or ✕ on anything else, lets go of the selection.
  const stepBack = () => {
    const sel = state.selected;
    if (sel?.kind === 'incident' && !sel.story && !$('right').hidden) {
      $('right').hidden = true;
      $('card').hidden = false;
      $('tip').hidden = true;
      renderCard();
    } else closePanel();
  };
  $('close').onclick = stepBack;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected && !e.target.closest('#search')) stepBack();
    // Rows that act as buttons answer to the keyboard too.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('li[role="button"]')) {
      e.preventDefault();
      e.target.click();
    }
  });
  $('share').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('share').textContent = 'Link copied';
    } catch {
      $('share').textContent = 'Copy the address bar';
    }
    setTimeout(() => ($('share').textContent = 'Copy link'), 2000);
  };
  $('stories').innerHTML = STORIES.map((x) => `<button data-story="${x.id}"><small>${esc(x.kind)}</small>${esc(x.title)}</button>`).join('');
  $('stories').onclick = (e) => {
    const b = e.target.closest('[data-story]');
    if (b) openStory(b.dataset.story);
  };
  $('chips-all').onclick = () => {
    state.hidden.clear();
    draw();
  };
  $('place-chips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const kind = chip.dataset.kind;
    state.hiddenPlaces.has(kind) ? state.hiddenPlaces.delete(kind) : state.hiddenPlaces.add(kind);
    drawPlaces();
  };
  $('place-list').onclick = (e) => {
    const li = e.target.closest('li');
    if (li) selectPlace(placeById(li.dataset.site), true);
  };
  drawPlaces();
  $('chips-none').onclick = () => {
    Object.keys(CATEGORIES).forEach((c) => state.hidden.add(c));
    draw();
  };

  $('replay-toggle').onclick = () => {
    if (replay.timeline && stage.owner !== 'timeline') {
      take('timeline');
      renderCard();
    }
    replay.toggle();
  };
  // The timeline is dragged like a slider.
  const line = $('replay-bar');
  const retake = () => {
    if (replay.timeline && stage.owner !== 'timeline') {
      take('timeline');
      renderCard();
    }
  };
  const seekTo = (e) => {
    const box = line.getBoundingClientRect();
    retake();
    replay.seek((e.clientX - box.left) / box.width);
  };
  line.onpointerdown = (e) => {
    line.setPointerCapture(e.pointerId);
    seekTo(e);
    line.onpointermove = seekTo;
  };
  line.onpointerup = line.onpointercancel = () => (line.onpointermove = null);
  line.onkeydown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    retake();
    replay.seek(+line.getAttribute('aria-valuenow') / 100 + (e.key === 'ArrowLeft' ? -0.02 : 0.02));
  };
  $('replay-live').onclick = () => {
    const sel = state.selected;
    if (replay.timeline) {
      retake();
      return replay.seek(1);
    }
    // From a time-lapse inside an event: back to that event's timeline.
    if (sel?.kind !== 'incident') return;
    take('timeline');
    replay.start(sel.incident, { keepView: true });
    if (sel.passes) replay.extend(sel.reach, sel.passes.map((x) => x.time));
    renderCard();
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
  $('welcome-story').onclick = () => {
    $('welcome-close').click();
    openStory(STORIES[0].id);
  };
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
    // A choice made by hand during a selection is kept.
    if (state.selected) menu.byHand = true;
  };
  if (window.innerWidth <= 760) $('menu').click();

  $('card').onclick = (e) => {
    const t = e.target;
    if (t.id === 'card-close') return closePanel();
    if (t.id === 'card-details') return showDetails();
    if (t.id === 'card-nisar') return toggleCardImage();
    if (t.id === 'card-change') return showChanges(t);
  };
  // Sources named in the text: hovering explains one, clicking opens the
  // part of the panel that holds what came from it.
  $('detail').addEventListener('mouseover', (e) => {
    const link = e.target.closest('.src');
    if (link) sourceTip(link);
  });
  $('detail').addEventListener('mouseout', (e) => {
    if (e.target.closest('.src')) $('tip').hidden = true;
  });
  $('detail').onclick = (e) => {
    const t = e.target;
    const sel = state.selected;
    if (!sel) return;
    const source = t.closest('.src');
    if (source) {
      e.preventDefault();
      const section = $(source.dataset.open);
      if (section) {
        section.open = true;
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (t.dataset.show) return showScene(t.dataset.show, t);
    if (t.id === 'compare') return compare(t);
    if (t.id === 'changes') return showChanges(t);
    if (t.id === 'story-next') return openStory(t.dataset.next);
    if (t.id === 'lapse-go') return startLapse();
    if (t.id === 's1-now') {
      $('ov-s1').checked = true;
      $('ov-s1').closest('details').open = true;
      applyLayers();
      t.textContent = `Sentinel-1 shown for ${$('date').value}`;
      return;
    }
    if (t.dataset.mode) return setLapseMode(t.dataset.mode);
    if (t.id === 'under') return drapeChanges(t.checked);
    if (t.id === 'measured-map') return showMeasuredMap(t);
    if (t.id === 'sat-follow' && live.pos) return globe.flyTo(live.pos.lat, live.pos.lon, 6_000_000);
    const li = t.closest('li');
    if (!li) return;
    if (li.dataset.site) return selectPlace(placeById(li.dataset.site), true);
    if (li.dataset.rel) return selectIncident((sel.related || sel.incident.related)[+li.dataset.rel].incident, true);
    if (li.dataset.in) return selectIncident(sel.inside[+li.dataset.in], true);
    if (li.dataset.near) return selectIncident(sel.near[+li.dataset.near].incident, true);
    if (li.dataset.pick) {
      return openFound(sel.found[+li.dataset.pick]);
    }
  };

  $('detail').onchange = (e) => {
    if (e.target.id === 'lapse-sound' && state.lapse) state.lapse.sound = e.target.checked;
    if (e.target.id === 'lapse-stack') startLapse(+e.target.value, false);
    if (e.target.id === 'lapse-all') startLapse(state.lapse?.stackIndex || 0, e.target.checked);
  };

  globe.onPick((found, at, screen) => {
    $('here').hidden = true;
    if (!found.length) {
      if (at) offerHere(at, screen);
      return;
    }
    // Dots win over the footprints they sit on, unless several dots overlap.
    const marks = found.filter((f) => f.kind !== 'scene');
    if (marks.length > 1) return choose(marks);
    if (marks.length === 1) return openFound(marks[0]);
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
  setInterval(tickCountdowns, 1000);
  startTicker();

  for (const name of Object.keys(FEEDS)) {
    refreshFeed(name);
    setInterval(() => refreshFeed(name), FEEDS[name].everyMs);
  }
  refreshNisar();
  setInterval(refreshNisar, NISAR_LATEST_EVERY_MS);

  openLink();
  const latest = await latestTileDate();
  $('date').max = latest;
  $('date').min = '2026-04-01';
  $('date').value = latest;
}

// Handy in the browser console while developing.
window.app = { state, globe, replay };

start();
