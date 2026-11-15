// App wiring: polls the feeds, keeps the globe in sync and fills the panels.

// Which version of the app this is. `tools/pack.sh` sets it; it shows at the
// end of the credits line, so nobody has to wonder whether the browser is
// still showing an older copy.
const BUILD = '2026-11-15 20:30 UTC';

import { CATEGORIES, FAMILIES, PALETTE, FEEDS, BASEMAPS, OVERLAYS, RADAR_NOTES, CHANGE_EXPLANATIONS, RELATED_KM, RELATED_DAYS, NISAR_LATEST_EVERY_MS, NISAR_LOOKBACK_DAYS, NISAR_START, RECENT_MS, OVERLAY_REACH_DAYS, NISAR_MOSAIC, NISAR_CHANGE, PREVIEW_STRETCH } from './config.js';
import { fetchFeed, fetchArchive } from './feeds.js';
import { buildIncidents, tagNisarCoverage, pointInPolygon, distanceKm } from './incidents.js';
import { edgeMarginKm, latestScenes, scenesAt, passesAt, bestPair, comparisonStatus, imageBounds, latestTileDate, likelyTileDate, historyAt, newestAt, nextPass, interferogramsAt, REPEAT_DAYS } from './nisar.js';
import { STORIES } from './stories.js';
import { PLACES, PLACE_KINDS, otherHemisphere } from './places.js';
import { loadFrames, spread, view, history, describeSeries, rankByCoverage, sampleAt, channelView } from './timelapse.js';
import { measuredIndex, measuredSummary, measuredById, measuredNear, measuredHtml, measuredChart, measuredLine, changeImageUrl, forecastFor, forecastHtml, detectFor, detectHtml, sensitivity, stoodImageUrl, stoodLine, share, stoodOut } from './measured.js';
import { fetchElements, positionAt, groundTrack, swathEdges, elementsEpoch } from './orbit.js';
import { SPECIES, MONTHS, POIS, loadSightings } from './wildlife.js';
import { figurineIcon } from './engine/figurines.js';
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

// Newly arrived items pulse on the globe for a while.
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
      if (grew && replay.timeline && !replay.plan?.lapse && replay.live) {
        replay.start(again, { keepView: true });
        if (sel.passes) replay.extend(sel.reach, sel.passes.map((x) => x.time));
      }
    }
  }
  draw();
}

function draw() {
  const shown = visibleIncidents();
  // Reports of the last day keep signalling on the globe (see RECENT_MS).
  const now = Date.now();
  globe.renderIncidents(shown, state.fresh, new Set(shown.filter((i) => now - i.time < RECENT_MS).map((i) => i.id)));
  globe.renderFootprints(state.scenes, $('footprints').checked);
  renderChips();
  $('event-count').textContent = shown.length;
  refreshTicker();
  renderSpotlight();
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
    // The whole list once (10 MB); after that only what the catalogue has
    // added since the last look, with two minutes of overlap. After six
    // hours without a look, the whole list again.
    const asked = Date.now();
    const recent = state.scenesAsked && asked - state.scenesAsked < 6 * 3600_000;
    const scenes = await latestScenes(200, recent ? state.scenes : null, recent ? state.scenesAsked - 2 * 60_000 : null);
    state.scenesAsked = asked;
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

// ---------- detail panel ----------

// The menu has the lowest claim on the screen. It opens only when its
// button is pressed (or "Explore the globe" on the opening card), and it
// folds away as soon as anything outside it is pressed or anything is
// opened, from the menu or from the globe. It never comes back by itself,
// and it is never open beside the details panel. Before 15 November 2026
// it folded for a selection and came back after it, unless it had been
// opened by hand meanwhile, and stayed for stories: three people saw three
// different behaviours and none could say why.
const menuOpen = () => !$('left').classList.contains('closed');

function setMenu(open) {
  $('left').classList.toggle('closed', !open);
  $('menu').setAttribute('aria-expanded', String(open));
}

// The opening card is where a visit starts and where it comes back to:
// closing whatever was opened shows the card again, until the visitor
// chooses "Explore the globe". The title at the top left shows it at any
// time.
const home = { exploring: false };

function showWelcome() {
  if (state.selected) closePanel();
  setMenu(false);
  $('welcome').hidden = false;
}

// Letting go of a selection by hand (✕ or Escape).
function letGo() {
  closePanel();
  if (!home.exploring) showWelcome();
}

// Fills the details panel. An event opens quietly: the panel is filled but
// stays shut, and the small card shows until "Show details" is pressed.
// The opening card steps aside once the visitor has opened anything, by its
// own buttons or by a dot, a report, a search hit or a link.
function closeWelcome() {
  $('welcome').hidden = true;
}

function openPanel(html, quiet = false) {
  closeWelcome();
  $('detail').innerHTML = html;
  $('right').hidden = quiet;
  $('card').hidden = !quiet;
  setMenu(false);
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
  globe.select(null);
  replay.stop();
  endCompare();
}

// ---------- event card and plain-text account ----------

// The popup for an event: what it is, what the agencies report about it
// (press only as an extra), one line on what
// NISAR has seen, and the way into the details.
function renderCard() {
  const sel = state.selected;
  if (sel?.kind !== 'incident') return;
  const inc = sel.incident;
  const lasting = inc.endTime - inc.time > 6 * 3600_000;
  const when = lasting ? `${day(inc.time)} to ${day(inc.endTime)}` : `${utc(inc.time)} (${ago(inc.time)})`;
  const sized = size(inc.magnitude);
  // What the agencies themselves report: data, there at once, and about
  // this event. (Press headlines were tried and removed: they were noise,
  // and they are not part of what the app is for.)
  const lines = [...new Set(inc.reports.flatMap((r) => r.detail.map((d) => `${d} (${FEEDS[r.source].label})`)))].slice(0, 4);
  const pages = inc.reports.filter((r) => /^https?:\/\//.test(r.url || ''));
  let body = lines.length ? `<ul class="plain">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="note">The feeds give where and when, and nothing more.</p>';
  if (pages.length) body += `<p class="hint">Official page: ${[...new Map(pages.map((r) => [r.source, r])).values()].map((r) => `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">${esc(FEEDS[r.source].label)}</a>`).join(', ')}</p>`;
  const scene = sel.passes?.length;
  $('card').innerHTML = `<button id="card-close" aria-label="Close">✕</button>
    <span class="tag">${dot(inc.category)}${esc(CATEGORIES[inc.category].label)}</span>
    <h3>${esc(inc.title)}</h3>
    <p class="when">${esc(when)}${sized ? ` · ${esc(sized)}` : ''}</p>
    <h4>What the agencies report</h4>
    ${body}
    <p class="nisar-line">${esc(nisarLine(inc, sel.found))}</p>
    ${sel.measured ? `<p class="nisar-line measured-line">${esc(measuredLine(sel.measured, inc.time))}${sel.check && stoodLine(sel.check) ? ` ${esc(stoodLine(sel.check))}` : ''}</p>` : ''}
    <div class="actions">
      <button class="primary" id="card-details">Show details</button>
      ${sel.found && bestPair(sel.found.backscatter, inc.time, true, inc) ? `<button id="card-change" aria-pressed="${stage.owner === 'change'}">${stage.owner === 'change' ? 'Back to the radar picture' : 'Show what changed'}</button>` : ''}
      ${scene ? `<button id="card-nisar" aria-pressed="${stage.owner === 'timeline' && !sel.nisarOff}">${stage.owner === 'timeline' && !sel.nisarOff ? 'Hide the radar picture' : 'Show the radar picture'}</button>` : ''}
    </div>`;
}

// The account of the event in the details panel, and its timeline. Both
// are redrawn as the NISAR search and the history arrive.
function renderNarrative() {
  const sel = state.selected;
  if (sel?.kind !== 'incident' || !$('story-text')) return;
  $('story-text').innerHTML = narrate(sel.incident, { found: sel.found, history: sel.history, measured: sel.measured, sizeText: size(sel.incident.magnitude) });
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
  // The key says what this event's marks are, plus the lines to its neighbours.
  const lapsing = !!u.plan?.lapse;
  const event = u.timeline && !lapsing ? state.selected?.incident : null;
  const changeUp = stage.owner === 'change' || stage.owner === 'measured';
  setEventKey(
    event
      ? [
          ...(u.plan.key || []).filter((row) => !(changeUp && row.mark === 'fill')),
          // NASA's map layer shows around the event's own picture, in other colours.
          ...($('nisar-tiles').checked ? [{ mark: 'bands', color: 'linear-gradient(90deg,#4fbf2f,#d8a030,#1c3f7a)', text: "Green, orange and blue strips: NASA's NISAR map layer of the last days, in its own colours (NISAR radar in the menu explains them)" }] : []), ...(event.related.length ? [{ mark: 'dash', color: PALETTE.context, text: 'Dashed lines: other events nearby in place and time' }] : [])]
      : null,
  );
  if (u.state === 'off') {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.classList.add('timeline');
  if (u.state === 'loading') {
    bar.classList.remove('back');
    $('replay-caption').textContent = 'Gathering what is known about this event…';
    $('replay-fill').style.width = '0';
    $('replay-knob').style.left = '100%';
    $('replay-span').style.width = '0';
    $('replay-marks').textContent = '';
    delete $('replay-marks').dataset.at;
    if (list) list.innerHTML = '<p class="spinner">Loading the event history…</p>';
    return;
  }
  $('replay-toggle').textContent = u.state === 'playing' ? '❚❚' : '▶';
  const percent = (f) => `${(f * 100).toFixed(2)}%`;
  $('replay-fill').style.width = percent(u.progress);
  $('replay-bar').setAttribute('aria-valuenow', Math.round(u.progress * 100));
  // The event's own stretch of the line (a place has none), NISAR's passes
  // as ticks, and the handle. The radar picture follows the handle.
  $('replay-knob').style.left = percent(u.progress);
  $('replay-span').style.display = u.span ? '' : 'none';
  if (u.span) {
    $('replay-span').style.left = percent(u.span[0]);
    $('replay-span').style.width = percent(Math.max(0.006, u.span[1] - u.span[0]));
  }
  const marks = u.marks.map(percent).join(',');
  if ($('replay-marks').dataset.at !== marks) {
    $('replay-marks').dataset.at = marks;
    $('replay-marks').innerHTML = u.marks.map((f) => `<i style="left:${percent(f)}"></i>`).join('');
  }
  if (event) $('replay-span').style.background = CATEGORIES[event.category].color;
  $('replay-from').textContent = day(u.range.from);
  document.querySelector('.key-event').style.background = event ? CATEGORIES[event.category].color : '';
  $('replay-key-event').hidden = lapsing;
  $('replay-bar').setAttribute('aria-label', 'Timeline: drag to go back in time');
  $('replay-bar').setAttribute('aria-valuetext', u.live ? 'Latest' : day(u.ms));
  $('replay-live').classList.toggle('on', u.live);
  $('replay-live').textContent = u.live ? '● Latest' : 'Go to latest';
  // The passes of a place opened from inside an event: the way back to it.
  bar.classList.toggle('back', lapsing && state.selected?.kind === 'incident');
  if (lapsing) {
    $('replay-caption').textContent = `${u.live ? 'Latest' : day(u.ms)} · ${u.caption}`;
  } else {
    const pass = syncNisar(u.ms);
    // The opening plays in seconds, not on a date.
    $('replay-caption').textContent = `${u.intro ? '' : `${u.live ? 'Latest' : day(u.ms)} · `}${u.caption}${pass ? ` · NISAR pass of ${day(pass.time)} underneath` : ''}`;
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
  const current = () => state.selected === sel && sel.passIndex === i && token === stage.token;
  // The pass has a 15 KB thumbnail and a 5 MB picture of the same area. The
  // thumbnail goes up the moment it is here; the picture replaces it when
  // it has arrived, and is all that shows if it wins the race.
  let up = null; // 'quick' or 'sharp'
  const put = (picture, bounds, sharp) => {
    if (!current() || up === 'sharp' || (up && !sharp)) return;
    if (up) globe.fadeTo(picture, bounds, 0.3);
    else if (first) globe.sweepTo(picture, bounds, pass.direction !== 'Descending');
    else globe.fadeTo(picture, bounds, 0.45);
    up = sharp ? 'sharp' : 'quick';
    setLegend('radar', { pol: pass.pol, time: pass.time });
    sel.passLoaded = i;
    if (replay.timeline) replay.report();
  };
  const bounds = imageBounds(pass);
  // A preview that will not load leaves the last picture up.
  if (pass.thumb) Promise.all([bounds, loadPicture(pass.thumb)]).then(([b, picture]) => put(picture, b, false), () => {});
  Promise.all([bounds, loadPicture(pass.image)]).then(([b, picture]) => put(picture, b, true), () => {});
  return null;
}

// Until when an event's passes are searched: 75 days after it ended, or
// now. "Now" is the end of the current hour, so that the search made when
// an event is pointed at and the one made when it is opened are the same
// question and the second finds the first one's answer.
const searchUntil = (inc) => Math.min(Math.ceil(Date.now() / 3600_000) * 3600_000, inc.endTime + 75 * DAY);

// Gets an event ready before it is opened: the search for its passes, and
// the small picture of the pass that would show. Called for the event the
// pointer rests on and for the one the opening card offers, so that a click
// finds the answers already here. `fully` also fetches the large picture.
function warmIncident(inc, fully = false) {
  passesAt(inc.lat, inc.lon, inc.time - NISAR_LOOKBACK_DAYS * DAY, searchUntil(inc))
    .then((backscatter) => {
      const pass = timelinePasses(inc, { backscatter }).pop();
      if (!pass) return;
      imageBounds(pass);
      if (pass.thumb) loadPicture(pass.thumb).catch(() => {});
      // The large picture is 5 MB: it waits until the map on screen has
      // finished loading, so it never slows that down.
      if (fully) whenSettled(() => loadPicture(pass.image).catch(() => {}));
    })
    .catch(() => {});
}

// Runs something once the tiles on screen have all arrived (or after ten
// seconds, whichever comes first).
function whenSettled(run, since = performance.now()) {
  if (globe.tiles.awaited === 0 || performance.now() - since > 10_000) return run();
  setTimeout(() => whenSettled(run, since), 400);
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
    // Feeds, not reports: one feed can list an event twice.
    ['Reported by', new Set(inc.reports.map((r) => r.source)).size > 1 ? `${new Set(inc.reports.map((r) => r.source)).size} feeds, merged into one event` : `1 feed${inc.reports.length > 1 ? `, in ${inc.reports.length} reports` : ''}`],
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
    <div id="measured-slot"></div>
    <div id="story-text" class="prose"></div>
    <div id="timeline"></div>
    <details class="fold" id="sec-nisar" open>
      <summary>NISAR radar at this place</summary>
      <h4>Preview brightness here, pass by pass (relative)</h4>
      <div id="incident-history" aria-live="polite"><p class="spinner">Searching NISAR repeat passes…</p></div>
      <h4>Passes, changes and ground movement</h4>
      <div id="radar">${radar}</div>
      ${lapseBox(inc.lat, inc.lon)}
    </details>
    <details class="fold" id="sec-replay"><summary>How the drawing on the globe is built</summary><div id="replay-parts"></div></details>
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
        <p class="hint">Possible explanations, not a diagnosis. These comparisons use preview brightness, not calibrated radar measurements. ${esc(PREVIEW_STRETCH)} A change across the whole scene can vanish, and slight misalignment can add false change. The event category selects this guidance; it is not a classification of the images or proof that the event caused a change.</p>
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
  openPanel(intro + incidentHtml(inc, '<p class="spinner">Searching the NISAR archive…</p>'), !detailed);
  renderCard();
  renderNarrative();
  const opened = state.selected;
  showMeasured(() => state.selected === opened, measuredNear(inc.lat, inc.lon, inc.time));
  globe.select(inc);
  if (fly) globe.flyTo(inc.lat, inc.lon);
  replay.start(inc);
  // Independent of the replay and the shorter before/after catalogue search.
  if (detailed) startIncidentHistory(inc, state.selected);
  setLink(`event=${encodeURIComponent(inc.id)}`);

  // The passes come first and alone: they are all the radar picture and the
  // timeline need, so those appear without waiting for the rest.
  const from = inc.time - NISAR_LOOKBACK_DAYS * DAY;
  const to = searchUntil(inc);
  const rest = Promise.all([scenesAt(inc.lat, inc.lon, from, to), newestAt(inc.lat, inc.lon).catch(() => [])]);
  rest.catch(() => {});
  passesAt(inc.lat, inc.lon, from, to)
    .then((backscatter) => {
      if (token !== state.lookup || opened.found) return;
      opened.found = { backscatter, interferograms: [], newest: [], partial: true };
      placePasses(inc, opened);
    })
    .catch(() => {});

  let found;
  try {
    // Then everything: interferograms, and the newest passes for the
    // next-pass estimate. The passes above are not asked for twice.
    const [around, newest] = await rest;
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
  const placed = !!sel.passes;
  sel.found = found;
  $('radar').innerHTML = radarHtml(inc, found);
  if (placed) {
    renderCard();
    renderNarrative();
  } else placePasses(inc, sel);
}

// NISAR's passes go onto the event's timeline, which reaches back far
// enough to hold the last two before the event, and the picture of the
// pass the timeline stands at is shown.
function placePasses(inc, sel) {
  sel.passes = timelinePasses(inc, sel.found);
  const earlier = sel.passes.filter((x) => x.time < inc.time);
  sel.reach = earlier.length ? earlier[Math.max(0, earlier.length - 2)].time - DAY : null;
  // (Not while the bar shows the passes of a place opened inside the event.)
  if (!replay.plan?.lapse) replay.extend(sel.reach, sel.passes.map((x) => x.time));
  // The newest pass goes up now, without waiting for the event's own history
  // (fire detections, water maps) to arrive: the timeline will find it
  // already there. An earthquake opens on its wave and on the pass before
  // it, so there the timeline decides.
  if (!replay.timeline && inc.category !== 'earthquake') syncNisar(Date.now());
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
  openPanel(`<span class="tag"><i class="dot" style="--c:${PALETTE.nisar};border-radius:2px"></i>NISAR radar pass</span>
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

// "Show more" on the reports bar: everything the bar draws from, as a list.
// The bar itself shows only what was first reported in the last day and up
// to three of the strongest ongoing events.
function openFeed() {
  const all = [
    ...visibleIncidents().map((incident) => ({ kind: 'incident', incident, time: incident.endTime })),
    ...state.scenes.map((scene) => ({ kind: 'scene', scene, time: scene.time })),
  ].sort((a, b) => b.time - a.time);
  const found = all.slice(0, FEED_ROWS);
  choose(
    found,
    'Latest reports and NISAR passes',
    `<p class="hint">Newest first: ${found.length === all.length ? `all ${all.length}` : `the newest ${found.length} of ${all.length}`} events on the map and NISAR passes. The events are the kinds and the period chosen in the menu under "Events on the map"; the time is when each was last reported. The bar at the top shows only events first reported in the last 24 hours, and up to three of the strongest that are still going on. Click a line to go there.</p>`,
    true,
    '<span class="tag">Live feeds</span>',
  );
}

function choose(found, heading = `${found.length} things overlap here`, note = '', fly = false, tag = '') {
  endCompare();
  globe.select(null);
  setLink('');
  replay.stop();
  state.selected = { kind: 'choice', found, fly };
  state.lookup++;
  openPanel(`${tag}<h3>${esc(heading)}</h3>${note}
    <ul class="links">${found
      .map((f, n) =>
        f.kind === 'incident'
          ? `<li tabindex="0" role="button" data-pick="${n}">${dot(f.incident.category)}<span>${esc(f.incident.title)}</span><span class="km">${ago(f.incident.endTime)}</span></li>`
          : f.kind === 'place'
            ? `<li tabindex="0" role="button" data-pick="${n}">${diamond(f.place.kind)}<span>${esc(f.place.name)}</span><span class="km">${esc(PLACE_KINDS[f.place.kind].label)}</span></li>`
            : f.kind === 'satellite'
              ? `<li tabindex="0" role="button" data-pick="${n}"><i class="dot" style="--c:${PALETTE.nisar}"></i><span>NISAR, live position</span><span class="km">satellite</span></li>`
              : f.kind === 'animal'
                ? `<li tabindex="0" role="button" data-pick="${n}"><img class="figure" src="${figurineIcon(f.animal.species, speciesOf(f.animal).color, 22)}" alt=""><span>${esc(f.animal.common)}</span><span class="km">${esc(f.animal.date || '')}</span></li>`
                : f.kind === 'poi'
                  ? `<li tabindex="0" role="button" data-pick="${n}"><i class="dot" style="--c:#f4e3b2"></i><span>${esc(f.poi.name)}</span><span class="km">landmark</span></li>`
                  : `<li tabindex="0" role="button" data-pick="${n}"><i class="dot" style="--c:${PALETTE.nisar};border-radius:2px"></i><span>NISAR pass, track ${esc(f.scene.track)} frame ${esc(f.scene.frame)}</span><span class="km">${ago(f.scene.time)}</span></li>`,
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

// The key on the globe has two parts: what the radar picture shows, and
// what the marks of the open event are. Either can be missing.
const legend = { picture: null, marks: '' };

// Says what the picture on the globe is and what its colours mean, in the
// corner of the map, whenever a radar picture or a change picture is up.
// kind: 'radar' | 'interferogram' | 'change' | null to hide.
function setLegend(kind, info = {}) {
  if (!kind) {
    legend.picture = null;
    return drawLegend();
  }
  const row = (color, text) => `<li><i style="--c:${color}"></i><span>${text}</span></li>`;
  // The teal frame around a radar picture is the edge of what that pass saw.
  const frame = `<li><i class="outline" style="--c:${PALETTE.nisar}"></i><span>Teal frame: the area this pass covered</span></li>`;
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
          : row(PALETTE.cross, 'Green: forest and other vegetation') + row(PALETTE.co, 'Magenta: bare ground and buildings') + row('#f2f2f2', 'White: both echoes strong') + row('#10141c;border:1px solid #556', 'Dark: calm water, smooth ground')
      }${frame}</ul>
      <small>${single ? `One radar channel (${esc(channel)}).` : `Two radar channels: magenta is ${esc(pol.co)}, green is ${esc(pol.cross)}.`}</small>`;
  } else if (kind === 'interferogram') {
    html = `<b>NISAR interferogram${info.from ? ` · ${day(info.from)} to ${day(info.to)}` : ''}</b>
      <p>Two passes compared: the colours show how the distance to the satellite changed.</p>
      <ul>${row('linear-gradient(90deg,#f33,#ff3,#3f3,#3ff,#33f,#f3f)', 'One run through the colours: about 12 cm')}</ul>
      <small>Tight bands around one place are ground movement. Broad bands are mostly the atmosphere. Speckle means the passes did not match, as over water.</small>`;
  } else if (kind === 'stood') {
    const { f, row: r } = info;
    const how = r.grade === 'both' ? `read differently both from the two passes just before and from their own history over ${r.history} passes` : r.baseline === 1 ? 'stood out against the pass before (a rough reading)' : 'stood out against the two passes before';
    html = `<b>What stood out · ${esc(r.date)}</b>
      <p>${share(r.stood)} of the cells of ${f.cellM} m ${how}. From NISAR's calibrated data.</p>
      <ul>${row(PALETTE.stronger, 'Orange: the echo rose against what was usual') + row(PALETTE.weaker, 'Blue: it fell')}</ul>
      <small>What moved the whole area alike (rain, a season) is taken away first, and a cell counts only with flagged neighbours. It shows where something changed, not what caused it. Each square is one cell of the measurement, placed to within about half a cell; the satellite map underneath (Esri) is there to show what ground it is, and is not from the same day.</small>`;
  } else if (kind === 'measured') {
    const c = info.d.change;
    html = `<b>Measured change · ${day(c.before)} to ${day(c.after)}</b>
      <p>How much the ${esc(c.pol)} radar echo changed here between two NISAR passes, from NISAR's calibrated data.</p>
      <ul>${row(PALETTE.weaker, 'Blue: the echo got weaker') + row(PALETTE.stronger, 'Orange: the echo got stronger')}</ul>
      <small>Full colour means 3 dB or more, which is half or double the echo's power. Changes under 1.5 dB are not drawn. A measurement, not a statement of cause.</small>`;
  } else {
    const km = (v) => (v >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(1));
    html = `<b>What changed · ${day(info.from)} to ${day(info.to)}</b>
      <p>Where the radar echo differs between two NISAR passes.</p>
      <ul>${row(PALETTE.weaker, `Blue: the echo got weaker, ${km(info.result.weakerKm2)} km²`) + row(PALETTE.stronger, `Orange: the echo got stronger, ${km(info.result.strongerKm2)} km²`)}</ul>
      <small>Worked out from preview pictures, each contrast-stretched on its own: a guide to where to look, not a measurement, and not a statement of cause.</small>`;
  }
  legend.picture = html;
  drawLegend();
}

// The marks an open event puts on the globe: [{ mark, color, text }].
function setEventKey(rows) {
  const html = (rows || []).map((r) => `<li><i class="${esc(r.mark)}" style="--c:${r.color}"></i><span>${esc(r.text)}</span></li>`).join('');
  if (html === legend.marks) return;
  legend.marks = html;
  drawLegend();
}

function drawLegend() {
  const box = $('legend');
  if (!legend.picture && !legend.marks) return (box.hidden = true);
  const marks = legend.marks ? `<ul>${legend.marks}</ul>` : '';
  let title = '<b>On the globe</b>';
  let body = marks;
  if (legend.picture) {
    title = legend.picture.slice(0, legend.picture.indexOf('</b>') + 4);
    body = legend.picture.slice(title.length) + (marks ? `<b class="also">Also on the globe</b>${marks}` : '');
  }
  // On a phone the key is one line until tapped, to leave the map visible.
  // Once the reader has folded or opened it, it stays that way.
  const was = box.hidden ? null : box.querySelector('details');
  const open = was ? was.open : window.innerWidth > 760;
  box.innerHTML = `<details ${open ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
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
  // The passes of a place yield to whatever takes the globe from them.
  if (owner !== 'lapse' && replay.plan?.lapse) {
    replay.stop();
    // Inside an event that leaves the bar empty: the event's own timeline
    // comes back, where the camera is. ("Back to the event" starts it itself.)
    const sel = state.selected;
    // (Not for 'none': that is the selection itself being left.)
    if (sel?.kind === 'incident' && owner !== 'timeline' && owner !== 'none') {
      replay.start(sel.incident, { still: true });
      if (sel.passes) replay.extend(sel.reach, sel.passes.map((x) => x.time));
    }
  }
  // A change map is a blue and orange fill; the event's own blue water
  // makes way for it and comes back with anything else.
  globe.setEffectFillsShown(owner !== 'change' && owner !== 'measured');
  if (replay.timeline) replay.report();
  setLegend(null);
  globe.clearScenes();
  globe.showGround(false);
  // The divider stays up, where it is, while the two radar wavelengths
  // are being compared.
  if (state.bands) showBandSplit(false);
  else $('split').hidden = true;
  state.change = null;
  const out = $('change-out');
  if (out) out.innerHTML = '';
  // Buttons that had put a picture up go back to offering it.
  if ($('compare')) $('compare').textContent = 'Compare the source images';
  if ($('changes')) $('changes').textContent = 'Show what changed';
  if ($('measured-map')) $('measured-map').textContent = 'Show the measured change map';
  if ($('stood-map')) $('stood-map').textContent = 'Show where it stood out';
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
        <li><i style="--c:${PALETTE.weaker}"></i><span><b>Echo got weaker</b> on ${km(result.weakerKm2)} km² (${pct(result.weakerShare)}). Typical causes: new open water, burnt or cleared vegetation, smoother ground.</span></li>
        <li><i style="--c:${PALETTE.stronger}"></i><span><b>Echo got stronger</b> on ${km(result.strongerKm2)} km² (${pct(result.strongerShare)}). Typical causes: flooded vegetation, wetter or rougher ground, new structures.</span></li>
      </ul>
      <label class="check"><input type="checkbox" id="under" checked /> Show the radar image underneath</label>
      <details class="fold inner"><summary>How this is worked out</summary>
      <p class="hint">Computed in your browser from NASA's preview images of both passes over ${km(result.comparedKm2)} km². A pixel is coloured where the ${esc(channels)} brightness moved by more than ${Math.round((CHANGE_THRESHOLD / 255) * 100)}% of each preview's own scale. ${esc(PREVIEW_STRETCH)} So the colours show where change stands out within the scene, not how much the radar echo changed, and a change across the whole scene may not show at all. Differences that a shift of up to two pixels between the images would explain are ignored. Previews are 8-bit and reduced in resolution, so treat this as where to look, not a measurement. Open sea changes with the wind between passes. The causes listed are the usual ones, not a diagnosis.</p></details>`;
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

// ---------- share links ----------

// The address bar always points at what is open, so it can be copied.
function setLink(hash) {
  // window.history, because this file also imports a function called history.
  window.history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

// Opens whatever a shared link points at. Events may need a moment, or the
// archive, before they are loaded.
async function openLink(detailed = false) {
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
  // Until the feeds have all answered (or failed), at most 14 seconds.
  const answered = () => Object.keys(FEEDS).every((k) => state.feedStatus[k]);
  for (let tries = 0; tries < 20 && !find() && !answered(); tries++) await new Promise((r) => setTimeout(r, 700));
  if (!find() && !state.archive) {
    $('window').value = 'nisar';
    await $('window').onchange({ target: $('window') });
  }
  const incident = find();
  if (incident && look === state.lookup) {
    state.hidden.delete(incident.category);
    draw();
    await selectIncident(incident, true);
    // The lead case is about the measurement: open on it, not on the small card.
    if (detailed && state.selected?.incident === incident) $('card-details')?.click();
  } else if (!incident && look === state.lookup && !state.selected) {
    // A link must not fail without a word.
    notice('The event this link points to is no longer in the feeds, so it cannot be opened. Recent events stay for a week; after that only the larger ones are kept.');
  }
}

// A short message at the top of the globe that goes away by itself.
let noticeTimer = 0;
function notice(text) {
  const box = $('notice');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (box.hidden = true), 12_000);
  box.onclick = () => (box.hidden = true);
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
    openPanel(storyHtml(story, `<h4>NISAR's passes over this point</h4>${lapseBox(story.lat, story.lon)}`));
    return startLapse();
  }
  if (story.action === 'interferogram') {
    openPanel(storyHtml(story, `<h4>The interferogram</h4><div id="igram"><p class="spinner">Searching the NISAR archive…</p></div>`));
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
  openPanel(`${storyHtml(story)}<p class="spinner">Loading events since NISAR's data began…</p>`);
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
const ticker = { items: [], at: 0, paused: false, dismissed: false };

// The strongest recent event that NISAR has flown over since it began: the
// agencies' report is the signal that something happened, the pass is the
// reason to go and look. Null when no reported event has a later pass yet.
function spotlight() {
  const seen = visibleIncidents()
    .map((incident) => ({ incident, pass: incident.nisarScenes.filter((s) => s.time > incident.time).sort((a, b) => a.time - b.time)[0] }))
    .filter((x) => x.pass);
  return seen.sort((a, b) => b.incident.severity - a.incident.severity || b.incident.time - a.incident.time)[0] || null;
}

function renderSpotlight() {
  const box = $('spotlight');
  const pick = spotlight();
  state.spotlight = pick;
  box.hidden = !pick;
  if (!pick) return;
  const { incident } = pick;
  // Most first visits start here: have it ready before the button is pressed.
  if (state.warmed !== incident.id) {
    state.warmed = incident.id;
    warmIncident(incident, true);
  }
  $('spotlight-title').innerHTML = `${dot(incident.category)}${esc(CATEGORIES[incident.category].label)}: ${esc(incident.title)}`;
  // No day count here: this only knows NISAR's newest passes, and the
  // event's own card searches the whole archive and may find an earlier one.
  $('spotlight-text').textContent = `It began ${ago(incident.time)}. NISAR has flown over it since.`;
}

// The two lead cases on the opening card. Both are measured sites; the
// sentence is put together from their files (tools/measure.py and
// tools/detect.py), so it says nothing the data does not.
const PROOF = { flood: 'event-gdacs-fl1104220', floodReport: 'gdacs:FL1104220', crop: 'west-bengal' };

async function renderProof() {
  const [flood, crop] = await Promise.all([measuredById(PROOF.flood), measuredById(PROOF.crop)]);
  const check = flood ? await detectFor(flood) : null;
  const parts = [];
  const e = check?.event;
  const found = e && stoodOut(e.stood) ? e.stood : null;
  if (found != null) {
    const before = check.byDate.filter((r) => !r.afterEvent).pop();
    parts.push(`At a flood in Italy, ${share(e.stood)} of the ground stood out from what it had read before on NISAR's first pass afterwards (${e.firstPassAfter})${before ? `; on the pass before the flood, ${share(before.stood)}` : ''}.`);
  }
  if (crop?.series?.length > 2 && placeById(PROOF.crop)) {
    const hh = crop.series.filter((p) => p.hh != null);
    const low = hh.reduce((a, b) => (b.hh < a.hh ? b : a));
    const high = hh.reduce((a, b) => (b.hh > a.hh ? b : a));
    parts.push(`Over the rice fields of Bardhaman the echo ran from ${low.hh.toFixed(1)} to ${high.hh.toFixed(1)} dB through one crop.`);
  }
  $('proof-flood').hidden = found == null;
  $('proof-crop').hidden = parts.length === (found == null ? 0 : 1);
  $('proof-crop').classList.toggle('primary', found == null);
  $('proof-text').textContent = parts.join(' ');
  $('proof').hidden = !parts.length;
  // Without the measured cases the story is the way in.
  $('welcome-story').classList.toggle('primary', !parts.length);
}

// The measured places and events, as a list in the menu: the ones where
// most of the ground stood out come first. Every figure is from
// tools/detect.py; a place it could not judge is listed without one.
async function renderMeasuredList() {
  const [index, checks] = await Promise.all([measuredIndex(), measuredSummary()]);
  const byId = new Map(checks.map((c) => [c.id, c]));
  const rows = index
    .filter((e) => e.event != null || placeById(e.id))
    .map((e) => {
      const c = byId.get(e.id);
      const at = e.event != null ? c?.event : c?.most;
      return { e, stood: at?.stood ?? null, rough: e.event != null && c?.event?.grade === 'pair', sea: !!c?.event?.openWater, when: e.event != null ? c?.event?.firstPassAfter : c?.most?.date };
    })
    .sort((a, b) => (b.stood ?? -1) - (a.stood ?? -1));
  if (!rows.length) return;
  state.measuredList = rows;
  $('measured-list').innerHTML = rows
    .map(({ e, stood, rough, sea, when }, i) => {
      const label = sea ? 'open water' : stood == null ? 'measured' : `${share(stood)} stood out`;
      const title = sea ? 'The reported point lies in open water, where the echo follows the wind: not judged' : stood == null ? 'No pass can be judged yet' : `${e.event != null ? 'First pass after the event' : 'The pass that stood out most'}: ${when}${rough ? '. A rough reading: one pass before the event' : ''}`;
      return `<li tabindex="0" role="button" data-n="${i}" class="${stoodOut(stood) && !rough ? 'out' : ''}" title="${esc(title)}"><span>${esc(e.name)}</span><span class="km">${label}</span></li>`;
    })
    .join('');
  $('measured-count').textContent = rows.length;
  $('measured-menu').hidden = false;
}

// Opens a measured place, or the reported event a measurement was made for.
async function openMeasured(entry) {
  if (entry.event == null) return selectPlace(placeById(entry.id), true);
  const look = ++state.lookup;
  const find = () => state.incidents.find((i) => Math.abs(i.time - entry.event) < 3 * DAY && distanceKm(i, entry) < 30);
  if (!find() && !state.archive) {
    $('window').value = 'nisar';
    await $('window').onchange({ target: $('window') });
  }
  const incident = find();
  if (look !== state.lookup) return;
  if (!incident) return notice('This event is no longer in the feeds, so its card cannot be opened. Its measurement stays in data/measured/.');
  state.hidden.delete(incident.category);
  draw();
  await selectIncident(incident, true);
  if (state.selected?.incident === incident) $('card-details')?.click();
}

const FEED_ROWS = 60; // lines in the list behind "Show more"

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
  // Nothing has answered yet: still loading, unless every feed has failed.
  const none = statuses.length > 0 && down.length === statuses.length;
  let feeds = checked ? `Feeds checked ${new Date(checked).toISOString().slice(11, 16)} UTC` : none ? 'No event feed can be reached; trying again shortly' : 'Loading the feeds…';
  if (checked && Date.now() - checked > 15 * 60_000) feeds += ' (stale)';
  if (down.length && !(none && !checked)) feeds += ` · ${down.join(', ')} offline`;
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
  $('ticker-more').onclick = openFeed;
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

const LAPSE_DEFAULT = 14; // passes read for the chart unless "all" is ticked
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
      <p class="hint">${esc(channels)} ${pol.cross ? 'are' : 'is'} NASA preview brightness (0–255), not calibrated backscatter or a measurement of forest loss, area lost or ice melt. ${esc(PREVIEW_STRETCH)} Rises and falls in this line can come from the stretch rather than the ground; where a “Measured with NISAR” card appears above, use its dB values for amounts. Samples average up to 5×5 preview pixels; the ground footprint varies with image resolution and coverage, not a fixed area. Click a chart date to show that pass on the globe.</p>`;
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

const LAPSE_OFFER = "▶ NISAR's passes here, on a timeline";

function lapseBox(lat, lon) {
  return `<div id="lapse" data-lat="${lat}" data-lon="${lon}"><button id="lapse-go">${LAPSE_OFFER}</button></div>`;
}

// The repeat tracks over a point, the one that covers it best first. Asked
// for as soon as a spot is offered, so the answer is usually here by the
// time it is opened.
const stacksAsked = new Map();
function stacksAt(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (!stacksAsked.has(key)) {
    const asked = historyAt(lat, lon).then((stacks) => rankByCoverage(stacks, lat, lon));
    stacksAsked.set(key, asked);
    asked.catch(() => stacksAsked.delete(key));
    if (stacksAsked.size > 6) stacksAsked.delete(stacksAsked.keys().next().value);
  }
  return stacksAsked.get(key);
}

// NISAR's passes over a place, on the same timeline as an event: it opens
// on the newest pass and stands still, every pass is a mark on the line,
// dragging goes back, and play runs through them once.
//
// Nothing waits for the whole year. The newest pass goes up at once (its
// small picture first, then the sharp one); the others are read in the
// background, oldest first, for the brightness chart, and any pass the
// handle stands on is fetched then and there.
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
  box.innerHTML = "<p class=\"spinner\">Looking up NISAR's passes over this spot…</p>";
  let stacks;
  try {
    stacks = await stacksAt(lat, lon);
  } catch (err) {
    if (!stale()) box.innerHTML = `<p class="note">NISAR search failed: ${esc(err.message)}</p>`;
    return;
  }
  if (stale()) return;
  if (!stacks.length) {
    box.innerHTML = '<p class="note">NISAR has not imaged this spot at least twice on the same track yet. Open ocean is mostly not imaged.</p>';
    return;
  }
  // Only now is the globe taken: had the search found nothing, an event's
  // own timeline would have been closed for no reason.
  take('lapse');
  replay.stop();
  const stack = stacks[stackIndex];
  const passes = stack.scenes; // every placeable pass of the track, oldest first
  const pol = stack.pol?.co ? stack.pol : { co: 'Radar', cross: null };
  const names = { co: `${pol.co} channel only`, cross: `${pol.cross} channel only` };
  const lapse = {
    lat, lon, stacks, stackIndex, all, passes, pol,
    mode: 'colour',
    index: -2, // the pass the handle stands on; -1 before the first
    drawn: null, // the channel that pass was last asked for in
    sharp: -1, // the pass whose full picture is up
    series: passes.map((p) => ({ time: p.time, co: null, cross: null })),
    read: new Set(), // passes whose picture has been read for the chart
    missed: 0,
    views: new Map(),
    chart: null,
  };
  state.lapse = lapse;
  const first = passes[0].time;
  const plan = {
    lapse: true,
    // A little room before the first pass, so its mark is not on the edge.
    from: first - Math.max(DAY, (Date.now() - first) * 0.04),
    to: Date.now(),
    timeOf: (ms) => ms,
    parts: null,
    draw(t, started, ms) {
      showLapsePass(lapse, ms);
    },
    caption() {
      const i = lapse.index;
      if (i < 0) return "Before NISAR's first pass here";
      // Kept short: the bar is narrow. The colour view is the usual one and
      // goes unnamed.
      return `NISAR pass of ${day(passes[i].time)} · ${i + 1} of ${passes.length}${lapse.mode === 'colour' ? '' : ` · ${names[lapse.mode]}`}${lapse.sharp === i ? '' : ' · loading…'}`;
    },
    teardown() {
      lapse.over = true;
      globe.clearScenes();
      // Its controls would be dead now, so the box offers to open it again.
      const here = $('lapse');
      if (here && state.lapse === lapse) here.innerHTML = `<button id="lapse-go">${LAPSE_OFFER}</button>`;
    },
  };
  lapse.plan = plan;

  // The picture controls and the chart come first; the fine print follows.
  const wanted = all ? passes.length : Math.min(passes.length, LAPSE_DEFAULT);
  box.innerHTML = `
    <p class="hint">Drag the timeline at the bottom, or click the chart, to go to a pass. ▶ plays them once.</p>
    <div class="actions seg" role="group" aria-label="Which radar channel to show">
      <button data-mode="colour" class="on">${pol.cross ? 'Colour' : 'As published'}</button>
      ${pol.cross ? `<button data-mode="co">${esc(pol.co)} only</button><button data-mode="cross">${esc(pol.cross)} only</button>` : ''}
    </div>
    <h4>Brightness at ${where(lat, lon)}</h4>
    <div id="lapse-chart"></div>
    <p id="lapse-status" class="note" role="status"></p>
    ${stacks.length > 1 ? `<label class="row"><span>Track</span><select id="lapse-stack">${stacks.map((st, n) => `<option value="${n}" ${n === stackIndex ? 'selected' : ''}>${esc(st.direction)} ${esc(st.track)} (${st.scenes.length} passes)</option>`).join('')}</select></label>` : ''}
    ${passes.length > wanted || all ? `<label class="check"><input type="checkbox" id="lapse-all" ${all ? 'checked' : ''} /> Read all ${passes.length} passes for the chart (a few megabytes each)</label>` : ''}
    <p class="note">${passes.length} passes on ${esc(stack.direction.toLowerCase())} track ${esc(stack.track)}, frame ${esc(stack.frame)}, ${day(first)} to ${day(passes[passes.length - 1].time)}.${stack.unplaced ? ` ${stack.unplaced} earlier passes are left out: their previews were published without public corner coordinates, so they cannot be placed on the map accurately.` : ''}${stack.otherModes ? ` ${stack.otherModes} passes recorded in a different polarisation mode are left out too, because their previews are not comparable with these.` : ''}</p>
    ${state.selected?.kind === 'incident' ? '' : nextPassHtml(stacks.flatMap((st) => st.scenes))}
    <p class="hint">Each pass is NASA's preview of a NISAR backscatter scene, recorded here in ${pol.cross ? `dual polarisation. ${esc(pol.co)} is the echo that comes back in the polarisation that was sent; ${esc(pol.cross)} is the part that came back twisted, which mostly happens inside vegetation` : `single polarisation (${esc(pol.co)}), so there is no cross-polarised channel`}. Values are the 0–255 preview brightness averaged over 5×5 pixels, not calibrated radar units. ${esc(PREVIEW_STRETCH)} Use this to see when something changed, not by how much; where a “Measured with NISAR” card appears, its dB values are the measurement.</p>`;
  drawLapseChart(lapse);
  setLegend('radar', { pol });
  const newest = passes[passes.length - 1];
  globe.select(state.selected?.incident || null, [newest]);
  imageBounds(newest).then((b) => !stale() && state.lapse === lapse && !lapse.over && globe.flyToBounds(b), () => {});
  replay.open(plan, passes.map((p) => p.time));
  readLapse(lapse);
}

// Puts the newest pass up to `ms` on the globe: its small picture the
// moment it is here, the full one when it has arrived.
function showLapsePass(lapse, ms) {
  if (stage.owner !== 'lapse' || state.lapse !== lapse || lapse.over) return;
  const { passes } = lapse;
  let i = -1;
  passes.forEach((p, k) => p.time <= ms && (i = k));
  if (i === lapse.index && lapse.mode === lapse.drawn) return;
  const moved = i !== lapse.index;
  lapse.index = i;
  lapse.drawn = lapse.mode;
  markLapseChart(lapse);
  if (i < 0) {
    lapse.sharp = -1;
    globe.clearScenes();
    setLegend(null);
    return;
  }
  const pass = passes[i];
  const mode = lapse.mode;
  const token = stage.token;
  const current = () => state.lapse === lapse && !lapse.over && lapse.index === i && lapse.mode === mode && token === stage.token;
  let up = null; // 'quick' or 'sharp'
  const put = (picture, bounds, sharp) => {
    if (!current() || up === 'sharp' || (up && !sharp)) return;
    // The first picture is uncovered by the sweep; later ones cross-fade.
    if (up) globe.fadeTo(picture, bounds, 0.3);
    else if (!lapse.shown) globe.sweepTo(picture, bounds, pass.direction !== 'Descending');
    else globe.fadeTo(picture, bounds, 0.45);
    lapse.shown = true;
    up = sharp ? 'sharp' : 'quick';
    if (sharp) lapse.sharp = i;
    setLegend('radar', { pol: lapse.pol, time: pass.time, channel: mode === 'colour' ? null : mode });
    replay.report();
  };
  const bounds = imageBounds(pass);
  // The small picture is in colour, so it only stands in for the colour view.
  if (mode === 'colour' && pass.thumb) Promise.all([bounds, loadPicture(pass.thumb)]).then(([b, picture]) => put(picture, b, false), () => {});
  Promise.all([bounds, lapsePicture(lapse, i)]).then(([b, picture]) => put(mode === 'colour' ? picture : lapseChannel(lapse, i, picture, mode), b, true), () => {});
}

// The full picture of one pass. The first time it arrives, the brightness
// at the point is read from it for the chart.
function lapsePicture(lapse, i) {
  const pass = lapse.passes[i];
  return Promise.all([loadPicture(pass.image), imageBounds(pass)]).then(([picture, bounds]) => {
    if (!lapse.read.has(i)) {
      lapse.read.add(i);
      lapse.series[i] = sampleAt(picture, bounds, lapse.lat, lapse.lon, !!pass.pol?.cross, pass.time);
      lapseChartSoon(lapse);
    }
    return picture;
  });
}

// One channel of a pass as greys; the last few are kept.
function lapseChannel(lapse, i, picture, mode) {
  const key = `${i}-${mode}`;
  if (!lapse.views.has(key)) {
    lapse.views.set(key, channelView(picture, mode));
    if (lapse.views.size > 12) lapse.views.delete(lapse.views.keys().next().value);
  }
  return lapse.views.get(key);
}

// Reads the passes for the chart in the background, two at a time: the
// oldest first, so the most recent ones are the ones still in memory when
// the reader starts dragging back from the latest. Unless all are asked
// for, a spread of them is read; the rest join when the handle visits them.
async function readLapse(lapse) {
  const { passes } = lapse;
  const alive = () => state.lapse === lapse && !lapse.over;
  // Where each pass lies, and its small picture: a few kilobytes each.
  for (const pass of passes) {
    imageBounds(pass).catch(() => {});
    if (pass.thumb) loadPicture(pass.thumb).catch(() => {});
  }
  const every = passes.map((_, k) => k);
  const wanted = lapse.all ? every : spread(every, LAPSE_DEFAULT);
  lapse.wanted = wanted.length;
  let next = 0;
  const reader = async () => {
    while (next < wanted.length && alive()) {
      const i = wanted[next++];
      await lapsePicture(lapse, i).catch(() => lapse.missed++);
      lapseChartSoon(lapse);
    }
  };
  await Promise.all([reader(), reader()]);
  if (!alive()) return;
  lapse.done = true;
  drawLapseChart(lapse);
}

function lapseChartSoon(lapse) {
  if (lapse.chartTimer) return;
  lapse.chartTimer = setTimeout(() => {
    lapse.chartTimer = 0;
    drawLapseChart(lapse);
  }, 400);
}

// The brightness chart, from the passes read so far.
function drawLapseChart(lapse) {
  const box = $('lapse-chart');
  if (!box || state.lapse !== lapse || lapse.over) return;
  const { passes, series, pol } = lapse;
  // Only passes that were read: one not read yet is not a gap in the data.
  const shown = [...lapse.read].sort((a, b) => a - b);
  const usable = shown.filter((i) => series[i].co != null).length;
  const status = $('lapse-status');
  if (status) {
    status.textContent = lapse.done
      ? `Read from ${shown.length} of ${passes.length} passes${lapse.missed ? `; ${lapse.missed} pictures could not be loaded` : ''}.${shown.length < passes.length ? ' A pass you go to on the timeline is added.' : ''}`
      : `Reading the passes: ${shown.length} of ${lapse.wanted || Math.min(passes.length, LAPSE_DEFAULT)} so far…`;
  }
  if (usable < 2) {
    lapse.chart = null;
    lapse.chartOf = null;
    box.innerHTML = lapse.done ? '<p class="note">These passes do not cover the exact point, so there is no history to chart.</p>' : '<p class="spinner">Reading the brightness at this point, pass by pass…</p>';
    return;
  }
  lapse.chartOf = shown;
  lapse.chart = historyChart(box, shown.map((i) => series[i]), pol, (k) => replay.seekTo(passes[shown[k]].time + 1000));
  markLapseChart(lapse);
  // What the numbers say, worked out from the series by fixed rules.
  const lines = describeSeries(shown.map((i) => series[i]), pol);
  if (lines.length) box.insertAdjacentHTML('beforeend', `<ul class="parts facts">${lines.map((l) => `<li><span class="badge computed">Computed</span><span>${esc(l)}</span></li>`).join('')}</ul>`);
}

// Marks the pass on the globe in the chart, if the chart holds it.
function markLapseChart(lapse) {
  const k = lapse.chartOf ? lapse.chartOf.indexOf(lapse.index) : -1;
  if (k >= 0) lapse.chart?.setActive(k);
}

function setLapseMode(mode) {
  const lapse = state.lapse;
  if (!lapse?.plan || replay.plan !== lapse.plan) return;
  lapse.mode = mode;
  $('lapse')
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  replay.show();
  replay.report();
}

// A click on bare ground offers a time-lapse there.
// A click on bare ground offers a year of radar there. Only on land (NISAR
// images almost no open sea), and it goes away again by itself: after a few
// seconds, on its ✕, on Escape, or as soon as the globe is touched.
let hereTimer = 0;
function hideHere() {
  clearTimeout(hereTimer);
  $('here').hidden = true;
}

function offerHere(at, screen) {
  if (globe.tiles.landAt(at.lat, at.lon) === false) return hideHere();
  const here = $('here');
  // The search starts now, so the answer is here if the offer is taken.
  stacksAt(at.lat, at.lon).catch(() => {});
  here.hidden = false;
  here.style.left = `${screen.x}px`;
  here.style.top = `${screen.y}px`;
  $('here-go').onclick = () => {
    hideHere();
    selectSpot(at);
  };
  clearTimeout(hereTimer);
  hereTimer = setTimeout(hideHere, 7000);
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

// `fly` moves the view there: wanted from a list of the whole planet, not
// for things that overlap where the visitor already is.
function openFound(f, fly = false) {
  if (f.kind === 'incident') return selectIncident(f.incident, fly);
  if (f.kind === 'place') return selectPlace(f.place, fly);
  if (f.kind === 'satellite') return selectSatellite();
  if (f.kind === 'animal') return selectAnimal(f.animal);
  if (f.kind === 'poi') return selectPoi(f.poi);
  return selectScene(f.scene, fly);
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
  openPanel(`<span class="tag"><i class="dot" style="--c:${PALETTE.nisar}"></i>Live</span>
    <h3>NISAR, right now</h3>
    <dl id="sat-facts"></dl>
    <div class="actions"><button id="sat-follow">Fly to NISAR</button></div>
    <h4>Its orbit</h4>
    <p class="note">NISAR circles the Earth about every 100 minutes, 747 km up, passing near both poles. Its orbit keeps it over the line between day and night (a dawn–dusk orbit), and it repeats the same path every 12 days.</p>
    <h4>Where the radar looks</h4>
    <p class="note">The radar looks to the left of the flight direction. The two lines on the ground mark the edges of its 242 km swath over the last 25 minutes, and the two beams show where it points now. The solid line is the orbit it has just flown, the dashed line the orbit ahead; everything of NISAR's is drawn in teal. NISAR does not image all the time, so this shows where it can look, not proof that it did.</p>
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
    <h3><img class="figure big" src="${figurineIcon(sp.id, sp.color, 44)}" alt="">${esc(sp.common)}</h3>
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
      `<button class="chip ${live.hiddenSpecies.has(sp.id) ? 'off' : ''}" data-species="${sp.id}" aria-pressed="${!live.hiddenSpecies.has(sp.id)}" style="--c:${sp.color}"><img class="figure" src="${figurineIcon(sp.id, sp.color, 22)}" alt="">${esc(sp.common)} ${counts[sp.id] || 0}</button>`,
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
        // Each month's figures drop onto the globe as it turns over.
        return { animal: a, lat: a.lat, lon: a.lon, color: sp.color, drop: splash && decor };
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
  // (A list with requests left unanswered is asked for again.)
  if (!live.sightings || live.sightings.missed) {
    $('wildlife-status').textContent = 'loading…';
    try {
      live.sightings = await loadSightings((done, total) => ($('wildlife-status').textContent = `loading ${Math.round((done / total) * 100)}%`));
    } catch {
      $('wildlife-status').textContent = 'GBIF unavailable';
      return;
    }
    const { missed, asked, fetched } = live.sightings;
    $('wildlife-status').textContent =
      `${live.sightings.length.toLocaleString('en')} records` +
      (fetched ? `, fetched from GBIF on ${fetched}` : '') +
      (missed ? ` (incomplete: GBIF left ${missed} of ${asked} requests unanswered)` : '');
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
  // What stood out comes first (filled in below), then the series it rests
  // on, then how well the next pass could have been predicted.
  $('measured-slot').innerHTML = `<div id="detect-slot"></div><h4>Measured with NISAR</h4>${measuredHtml(d, compare)}<div id="forecast-slot"></div>
    <p class="note">These are calibrated values from the full NISAR data, comparable between dates. Any preview charts below are relative: each preview is contrast-stretched on its own, so use them for <em>where</em> and <em>when</em>, and these dB values for <em>how much</em>.</p>`;
  measuredChart($('measured-chart'), d, compare);
  const here = () => stillHere() && state.selected?.measured === d;
  Promise.all([detectFor(d), sensitivity()]).then(([found, sens]) => {
    if (!found || !here() || !$('detect-slot')) return;
    state.selected.check = found;
    if (state.selected.kind === 'incident') renderCard();
    $('detect-slot').innerHTML = `<h4>What stood out here?</h4>${detectHtml(found, sens)}`;
  });
  forecastFor(d).then((f) => {
    if (!f || !here() || !$('forecast-slot')) return;
    $('forecast-slot').innerHTML = `<details class="fold"><summary>Can the next pass be predicted? Baselines and error measures</summary>${forecastHtml(f)}</details>`;
  });
  // An event's card and text lead with the calibrated value once it is here.
  renderCard();
  renderNarrative();
}

async function showMeasuredMap(button) {
  const d = state.selected?.measured;
  if (!d) return;
  const token = take('measured');
  button.textContent = 'Loading…';
  try {
    const picture = await loadPicture(changeImageUrl(d));
    if (token !== stage.token) return;
    // On the satellite map, as for the cells that stood out: NASA's own
    // radar colours under an orange and blue picture cannot be told from it.
    globe.showGround(true);
    globe.addPicture(picture, d.change.bounds, undefined, 0.95);
    globe.flyToBounds(d.change.bounds);
    setLegend('measured', { d });
    button.textContent = 'Change map shown';
  } catch {
    if (token === stage.token) button.textContent = 'Change map failed to load';
  }
}

// The cells that did something other than their neighbours, on the globe.
async function showStoodMap(button, index) {
  const f = state.selected?.check;
  if (!f?.picture) return null;
  // The pass asked for, or the one the card is about.
  const row = index != null ? f.byDate[index] : f.byDate.find((r) => r.time === f.picture.time);
  if (!row) return null;
  // The first pass shown takes the globe; the next ones only change places
  // with it, so that the key and the buttons do not flicker between passes.
  const held = stage.owner === 'measured' && stood.token === stage.token;
  const token = held ? stage.token : take('measured');
  stood.token = token;
  if (button) button.textContent = 'Loading…';
  try {
    // A pass on which nothing stood out has no picture: the map alone says so.
    const picture = row.image ? await loadPicture(stoodImageUrl(row)) : null;
    if (token !== stage.token) return null;
    if (held) globe.clearScenes();
    // On the satellite map, so that it shows what ground the cells lie on.
    globe.showGround(true);
    if (picture) globe.addPicture(picture, f.bounds, undefined, 1);
    if (!stood.playing) globe.flyToBounds(f.bounds);
    setLegend('stood', { f, row });
    document.querySelectorAll('#detect-slot tr[data-pass]').forEach((tr) => tr.classList.toggle('on', +tr.dataset.pass === f.byDate.indexOf(row)));
    if ($('stood-map')) $('stood-map').textContent = `Shown: ${row.date}`;
  } catch {
    if (token === stage.token && button) button.textContent = 'The picture failed to load';
  }
  return token;
}

// Plays the passes of the place one after another on the globe: the
// detection as a time series, ending on the pass the card is about. It
// stops when the reader picks something else.
const stood = { playing: false, token: null, run: 0 };
async function playStood(button) {
  const f = state.selected?.check;
  if (!f?.picture || stood.playing) return;
  const run = ++stood.run;
  const about = f.byDate.findIndex((r) => r.time === f.picture.time);
  const order = [...f.byDate.keys(), ...(about >= 0 && about !== f.byDate.length - 1 ? [about] : [])];
  stood.playing = true;
  button.textContent = 'Playing…';
  try {
    await showStoodMap(null, order[0]);
    globe.flyToBounds(f.bounds);
    for (const [n, i] of order.entries()) {
      if (n && !(await showStoodMap(null, i))) return;
      await new Promise((r) => setTimeout(r, n ? 1600 : 2600));
      // Something else took the globe, or the reader moved on.
      if (run !== stood.run || state.selected?.check !== f || stage.owner !== 'measured' || stood.token !== stage.token) return;
    }
  } finally {
    stood.playing = false;
    if (button.isConnected) button.textContent = 'Play the passes';
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
  state.lookup++;
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
    <div id="measured-slot"></div>
    <h4>Why this place</h4>
    <div class="context"><p class="note">${esc(place.story)}</p>
    <p class="hint">Background from published research, not measured by this app.</p></div>
    <h4>What NISAR can show here</h4>
    <p class="note">${esc(kind.look)}</p>
    <p class="note">${esc(kind.note)}</p>
    ${place.animals ? `<h4>Animals and the water</h4><p class="note">${esc(place.animals)} NISAR maps the flooding and drying that they follow. Turn on wildlife sightings under “Live sky and wildlife” to see migrating species.</p>` : ''}
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

// The mosaic is a picture with a date on it: the far and the continent
// view as they stood when it was built. It does not have to be current to
// be right, because everything else comes live from NASA and only for
// what is on screen: every day flown after the mosaic's last is drawn on
// top of it, and close up it is always NASA's own tiles. Where the newest
// pass is not in it yet, it shows the one before.
//
// A page left open for days looks now and then whether a newer mosaic has
// been put online, and takes it. (The build's time is part of each tile's
// address, so the new tiles are fetched and the old ones are let go.)
async function refreshMosaic() {
  const about = await fetch(NISAR_MOSAIC.about, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (!about?.built || about.built === state.mosaic?.built) return;
  state.mosaic = about;
  // It arrived after the app had given up waiting for it (see `start`):
  // the opening view goes back to the whole planet, unless the reader has
  // chosen for themselves by now.
  if (!state.stackChosen) $('stack').value = '24';
  globe.setMosaic(about);
  applyLayers();
}

// The planet-wide change picture, if this copy of the app has one: its
// switch appears in the menu, with what was compared and how.
async function loadChange() {
  const about = await fetch(NISAR_CHANGE.about, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (!about?.tiles) return;
  globe.setChange(about);
  $('change-row').hidden = false;
  const pct = (v) => `${Math.round(v * 100)} %`;
  $('change-note').textContent =
    `Each pass from ${about.after.from} to ${about.after.to} against the same pass ${about.gapDays} days earlier (${about.before.from} to ${about.before.to}); NISAR flies the same tracks every 12 days. ` +
    `${about.notCalibrated} Changes under ${about.deadBand} are not drawn; full colour is ${about.full} or more. ` +
    `A pair of passes is only used where it compares like with like: ${pct(about.numbers.accepted)} of the overlap was, and ${pct(about.numbers.covered)} of the map is covered. ` +
    `${about.limits} ${about.checked || ''} While this is on, the radar picture itself is hidden. Built ${about.built} by tools/change.py.`;
}

// The day a context layer is shown for: the chosen day, or the newest day
// before it that NASA has published. Several layers run days behind, and
// asking for a day they do not have returns an error for every tile. One
// tiny tile (the whole world) answers whether a day exists.
const overlayDays = new Map();
function overlayDay(key, date) {
  const o = OVERLAYS[key];
  if (o.date) return Promise.resolve(o.date);
  const id = `${key} ${date}`;
  if (!overlayDays.has(id)) {
    const has = (d) =>
      fetch(o.url.replace('{date}', d).replace('{z}/{y}/{x}', '0/0/0')).then(
        (res) => (res.ok ? true : res.status === 404 || res.status === 400 ? false : null),
        () => null,
      );
    const found = (async () => {
      const first = await has(date);
      // Published, or the question could not be answered: the chosen day.
      if (first !== false) return date;
      const days = Array.from({ length: OVERLAY_REACH_DAYS }, (_, k) => day(Date.parse(date) - (k + 1) * DAY));
      const answers = await Promise.all(days.map(has));
      return days[answers.indexOf(true)] || null;
    })();
    overlayDays.set(id, found);
  }
  return overlayDays.get(id);
}

function applyLayers() {
  // A date field that was emptied goes back to the newest day.
  if (!$('date').value) $('date').value = $('date').max;
  const date = $('date').value;
  globe.setNisarTiles($('nisar-tiles').checked, date, +$('stack').value);
  for (const key of Object.keys(OVERLAYS)) {
    const on = $(`ov-${key}`).checked;
    $(`key-${key}`).hidden = !on;
    const note = $(`day-${key}`);
    note.hidden = true;
    if (!on) {
      globe.setOverlay(key, false, date);
      continue;
    }
    overlayDay(key, date).then((used) => {
      // The switch or the date may have changed while the answer was out.
      if (!$(`ov-${key}`).checked || $('date').value !== date) return;
      globe.setOverlay(key, !!used, used);
      if (used === date || OVERLAYS[key].date) return;
      note.hidden = false;
      note.textContent = used
        ? `NASA's newest day for this layer is ${used}; that is what is shown.`
        : `NASA has published nothing for this layer in the ${OVERLAY_REACH_DAYS} days before ${date}.`;
    });
  }
  const changing = $('change48').checked && !$('bands').checked;
  globe.showChange(changing);
  $('change-key').hidden = !changing;
  $('nisar-tiles-key').hidden = !$('nisar-tiles').checked || changing;
  const planet = $('nisar-tiles').checked && +$('stack').value > 12 && !changing;
  $('stack-note').hidden = !planet;
  if (planet) {
    // Says which of the two ways the whole planet is being shown.
    const m = globe.mosaicFor({ date, days: +$('stack').value });
    $('stack-note').textContent = m
      ? `Every place NISAR images, land and ice. From far away this is one picture that this app put together ahead of time from NASA's daily layer for ${m.from} to ${m.to}, the newest pass on top (built ${state.mosaic.built}). Close up, and for every day flown since, NASA's own tiles are loaded live; what you have looked at stays sharp until the page is closed (held in memory, up to about ${Math.round(globe.tiles.keptLimit / 1048576)} MB). Where the ordinary map shows through on land, NISAR has no picture from those days.`
      : "Every place NISAR images, land and ice, from its passes of the last 24 days; the newest pass over each place lies on top. NASA publishes passes up to two weeks late, so the newest days are thin and the last complete round is 12 to 24 days old. It takes longer to load.";
  }
  // Two wavelengths side by side, for the same days.
  const compared = state.bands;
  state.bands = $('bands').checked;
  globe.setBandCompare(state.bands, date, Math.min(3, +$('stack').value));
  // Switched on: the divider appears in the middle. A new date or another
  // layer leaves it where the reader put it.
  if (state.bands) showBandSplit(!compared);
  else if (!globe.pictures.some((p) => p.side)) $('split').hidden = true;
}

function showBandSplit(centre = true) {
  $('split-before').textContent = 'NISAR · L-band, 24 cm';
  $('split-after').textContent = 'Sentinel-1 · C-band, 5.6 cm';
  $('split').hidden = false;
  if (centre) setSplit(0.5);
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
          .map(
            ([k, o]) =>
              `<label class="check"><input type="checkbox" id="ov-${k}" ${o.fills ? 'data-fills' : ''} /> ${o.label}${o.fills ? ' <span class="fills" title="This layer covers the whole map, so it replaces any other that does">▣</span>' : ''}</label>` +
              `<small class="layer-day" id="day-${k}" hidden></small>` +
              // What the layer's colours mean, shown while it is on: NASA's
              // own legend picture where there is one, a plain line if not.
              `<div class="layer-key" id="key-${k}" hidden>${
                o.legend ? `<img src="${o.legend}" alt="NASA's legend for this layer" loading="lazy" /><small>Legend: NASA GIBS</small>` : `<small>${esc(o.note || '')}</small>`
              }</div>`,
          )
          .join(''),
    )
    .join('');
  globe.setBasemap('esri');
  renderStatus();
  // The ready-made whole-planet picture, if this copy of the app has one.
  const mosaicAsked = refreshMosaic();
  loadChange();
  setInterval(() => !document.hidden && refreshMosaic(), 10 * 60_000);

  $('basemap').onchange = (e) => {
    $('basemap-note').hidden = true;
    globe.setBasemap(e.target.value);
  };
  // The satellite basemap comes from one company's server. If that cannot
  // be reached, NASA's own picture of the Earth takes its place, and the
  // menu says so, so the globe is never left black.
  globe.onBasemapFailed = (key) => {
    if (key !== 'esri') return;
    $('basemap').value = 'bluemarble';
    globe.setBasemap('bluemarble');
    $('basemap-note').hidden = false;
  };
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
  ['nisar-tiles', 'stack', 'date', 'bands', 'change48'].forEach((id) => ($(id).onchange = applyLayers));
  $('stack').addEventListener('change', () => (state.stackChosen = true));
  $('overlays').onchange = (e) => {
    // A layer that covers the whole map hides whatever lies under it, so
    // switching one on switches the other ones of that sort off.
    if (e.target.dataset?.fills != null && e.target.checked) {
      for (const other of document.querySelectorAll('#overlays input[data-fills]')) if (other !== e.target) other.checked = false;
    }
    applyLayers();
  };
  $('date-prev').onclick = () => shiftDate(-1);
  $('date-next').onclick = () => shiftDate(1);
  $('date-play').onclick = togglePlay;
  $('terrain').onchange = (e) => globe.setTerrain(e.target.checked);
  $('nav-in').onclick = () => globe.zoom(0.5);
  $('nav-out').onclick = () => globe.zoom(2);
  $('nav-north').onclick = () => globe.faceNorth();
  $('nav-tilt').onclick = () => globe.toggleTilt();
  // Called on every drawn frame, so it only touches the page on a change.
  const shown = { heading: null, tilted: null };
  globe.onView = (camera) => {
    const heading = Math.round(camera.heading);
    const tilted = camera.pitch > 5;
    if (heading !== shown.heading) {
      $('needle').style.transform = `rotate(${-heading}deg)`;
      // North is no longer turned back by itself: the button shows when it is off.
      $('nav-north').classList.toggle('turned', Math.abs(heading) > 2);
    }
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
    } else letGo();
  };
  $('close').onclick = stepBack;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideHere();
    // Escape closes the opening card first, then steps back from a selection.
    if (e.key === 'Escape' && !$('welcome').hidden) return $('welcome-close').click();
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
    retake();
    replay.toggle();
  };
  // The timeline is dragged like a slider.
  const line = $('replay-bar');
  // An event's timeline takes the globe back from a picture put up by
  // hand. (The passes of a place always hold it while they are open.)
  const retake = () => {
    if (replay.timeline && !replay.plan.lapse && stage.owner !== 'timeline') {
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
    if (!replay.timeline) return;
    retake();
    replay.seek(1);
  };
  // From the passes of a place inside an event: back to that event's timeline.
  $('replay-back').onclick = () => {
    const sel = state.selected;
    if (sel?.kind !== 'incident') return;
    take('timeline');
    replay.start(sel.incident);
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

  // Every visit starts the same: the globe and the opening card, with the
  // menu folded behind its button.
  $('welcome').hidden = false;
  setMenu(false);
  $('home').onclick = (e) => {
    e.preventDefault();
    showWelcome();
  };
  $('welcome-story').onclick = () => {
    closeWelcome();
    openStory(STORIES[0].id);
  };
  renderProof();
  renderMeasuredList();
  $('measured-list').onclick = (e) => {
    const li = e.target.closest('li');
    if (li) openMeasured(state.measuredList[+li.dataset.n].e);
  };
  $('proof-flood').onclick = () => {
    closeWelcome();
    setLink(`event=${encodeURIComponent(PROOF.floodReport)}`);
    openLink(true);
  };
  $('proof-crop').onclick = () => {
    closeWelcome();
    selectPlace(placeById(PROOF.crop), true);
  };
  $('spotlight-go').onclick = () => {
    const pick = state.spotlight;
    closeWelcome();
    if (pick) selectIncident(pick.incident, true);
  };
  // Exploring needs the stories, the filters and the key to the dots, so
  // the menu slides in. On a phone it would cover the globe; it stays shut.
  $('welcome-close').onclick = () => {
    closeWelcome();
    home.exploring = true;
    if (window.innerWidth > 760 && !state.selected) setMenu(true);
  };
  $('menu').onclick = () => {
    const open = !menuOpen();
    // The menu and the details panel are never open side by side: the
    // panel steps back (an event to its small card) when the menu opens.
    if (open && !$('right').hidden) {
      const sel = state.selected;
      if (sel?.kind === 'incident' && !sel.story) {
        $('right').hidden = true;
        $('card').hidden = false;
        $('tip').hidden = true;
        renderCard();
      } else closePanel();
    }
    if (open) closeWelcome();
    setMenu(open);
  };
  // Anything pressed outside the menu folds it away.
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen() && !e.target.closest('#left, #menu, #welcome-close')) setMenu(false);
  });

  $('card').onclick = (e) => {
    const t = e.target;
    if (t.id === 'card-close') return letGo();
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
    if (t.id === 'stood-map') return showStoodMap(t);
    if (t.id === 'stood-play') return playStood(t);
    const pass = t.closest('tr[data-pass]');
    if (pass) return showStoodMap(null, +pass.dataset.pass);
    if (t.id === 'sat-follow' && live.pos) return globe.flyTo(live.pos.lat, live.pos.lon, 6_000_000);
    const li = t.closest('li');
    if (!li) return;
    if (li.dataset.site) return selectPlace(placeById(li.dataset.site), true);
    if (li.dataset.rel) return selectIncident((sel.related || sel.incident.related)[+li.dataset.rel].incident, true);
    if (li.dataset.in) return selectIncident(sel.inside[+li.dataset.in], true);
    if (li.dataset.near) return selectIncident(sel.near[+li.dataset.near].incident, true);
    if (li.dataset.pick) {
      return openFound(sel.found[+li.dataset.pick], sel.fly);
    }
  };

  $('detail').onchange = (e) => {
    if (e.target.id === 'lapse-stack') startLapse(+e.target.value, false);
    if (e.target.id === 'lapse-all') startLapse(state.lapse?.stackIndex || 0, e.target.checked);
  };

  // An event the pointer rests on for a moment is got ready for a click.
  let restTimer = 0;
  globe.onRest = (incident) => {
    clearTimeout(restTimer);
    if (incident) restTimer = setTimeout(() => warmIncident(incident), 140);
  };
  $('here-x').onclick = hideHere;
  globe.el.addEventListener('pointerdown', hideHere);
  globe.el.addEventListener('wheel', hideHere, { passive: true });
  globe.onPick((found, at, screen) => {
    hideHere();
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
  setInterval(tickCountdowns, 1000);
  startTicker();

  // Nothing is asked of anyone while the page sits in a tab nobody is
  // looking at: every regular check waits until it is seen again, and
  // then all of them run once (at most once a minute, however often the
  // tab is flipped to).
  const whileSeen = (check) => () => !document.hidden && check();
  for (const name of Object.keys(FEEDS)) {
    refreshFeed(name);
    setInterval(whileSeen(() => refreshFeed(name)), FEEDS[name].everyMs);
  }
  refreshNisar();
  setInterval(whileSeen(refreshNisar), NISAR_LATEST_EVERY_MS);
  let caughtUp = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || Date.now() - caughtUp < 60_000) return;
    caughtUp = Date.now();
    for (const name of Object.keys(FEEDS)) refreshFeed(name);
    refreshNisar();
    refreshMosaic();
    state.refreshDate?.();
  });

  openLink();
  // NISAR's map layer is on from the start, as the whole planet: every
  // place NISAR images, the newest pass on top. That view opens from the
  // ready-made mosaic (a third of a megabyte for the opening view), so the
  // app waits a moment for the mosaic's list of tiles before it sets the
  // layers; asking NASA for 24 daily layers first would be wasted. A copy
  // of the app without the mosaic, or one that cannot reach it, opens on
  // one 12-day cycle instead: 24 days stacked live take too long to be the
  // first thing a visitor sees.
  // The newest day NASA has published has to be asked for, so the layer
  // starts on the likely one and moves if the answer differs.
  await Promise.race([mosaicAsked, new Promise((done) => setTimeout(done, 2500))]);
  if (!state.mosaic && !state.stackChosen) $('stack').value = '12';
  $('date').min = '2026-04-01';
  $('date').max = $('date').value = likelyTileDate();
  applyLayers();
  const refreshDate = async () => {
    const latest = await latestTileDate();
    if (latest === $('date').max) return;
    // Someone looking at the newest day keeps looking at the newest day.
    const follow = $('date').value === $('date').max;
    $('date').max = latest;
    if (follow || $('date').value > latest) {
      $('date').value = latest;
      applyLayers();
    }
  };
  refreshDate();
  state.refreshDate = refreshDate;
  // NASA adds days and fills in recent ones; look again now and then.
  setInterval(() => !document.hidden && refreshDate(), 10 * 60_000);
}

// Handy in the browser console while developing.
window.app = { state, globe, replay, stage, build: BUILD };
$('credits').append(` · Version ${BUILD}`);

start();
