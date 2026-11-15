// Calibrated NISAR measurements made offline by tools/measure.py from the
// full-resolution GCOV products (not the preview images). The app only
// shows them: data/measured/index.json lists the measured sites, and each
// site has its own JSON file and change map.

import { distanceKm } from './incidents.js';
import { PALETTE } from './config.js';

const DIR = 'data/measured/';
const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 190;
const BOX = { left: 34, right: 28, top: 12, bottom: 24 };
const LINES = [
  { key: 'hh', label: 'HH', color: PALETTE.co },
  { key: 'hv', label: 'HV', color: PALETTE.cross },
];
const COMPARE_COLOR = PALETTE.context;

let index = null;
const cache = new Map();

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The calibrated change between the two passes of the change map, as a
// plain statement: { co, db, before, after, acrossEvent }. `eventTime`, when
// given, tells whether those two passes lie on either side of that event.
export function measuredStep(d, eventTime) {
  const at = (t) => d.series.find((s) => s.time === t);
  const a = at(d.change.before);
  const b = at(d.change.after);
  if (!a || !b || a.hh == null || b.hh == null) return null;
  return {
    co: d.pols?.[0] || 'HH',
    cross: d.pols?.[1] || null,
    db: b.hh - a.hh,
    crossDb: a.hv != null && b.hv != null ? b.hv - a.hv : null,
    before: a.time,
    after: b.time,
    acrossEvent: eventTime != null && a.time < eventTime && b.time >= eventTime,
  };
}

// One line for the event card.
export function measuredLine(d, eventTime) {
  const m = measuredStep(d, eventTime);
  if (!m) return '';
  const moved = Math.abs(m.db) < 0.5 ? 'stayed within half a decibel' : `${m.db < 0 ? 'fell' : 'rose'} by ${Math.abs(m.db).toFixed(1)} dB`;
  return `Measured (calibrated): the ${m.co} echo ${moved} between ${day(m.before)} and ${day(m.after)}${m.acrossEvent ? ', the passes on either side of the event' : ''}.`;
}

// A share of the cells as the app writes it: one decimal under 10 %.
export const share = (v) => (v == null ? '–' : v < 0.095 ? `${(v * 100).toFixed(1)} %` : `${Math.round(v * 100)} %`);

// When the app says "stood out" in words: at least 2 % of the cells. With
// nothing happening the detector flags under 1 % (measured, see the test
// with changes put in), so 2 % is at least twice that.
export const stoodOut = (stood) => stood != null && stood >= 0.02;

// One more line for the event card: how much of the ground stood out on
// the first pass after the event (tools/detect.py).
export function stoodLine(f) {
  const e = f?.event;
  if (!e || e.stood == null) return '';
  const rough = e.grade === 'pair' ? ' (a rough reading: one pass before the event)' : e.grade === 'two' ? ' (two passes before the event)' : '';
  return `On NISAR's first pass afterwards (${e.firstPassAfter}), ${share(e.stood)} of the ground stood out from what it had read before${rough}.${stoodOut(e.stood) ? '' : ' That is no more than is flagged when nothing has happened.'}`;
}

// Measured sites; an empty list when none have been made yet.
export async function measuredIndex() {
  if (!index) {
    index = fetch(`${DIR}index.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return index;
}

// One line per judged site from tools/detect.py: what stood out, and when.
let summary = null;
export function measuredSummary() {
  if (!summary) {
    summary = fetch(`${DIR}detect.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return summary;
}

export async function measuredById(id) {
  const entry = (await measuredIndex()).find((e) => e.id === id);
  return entry ? load(entry) : null;
}

// The measured site for a point, if one lies within its match radius. A
// measurement made for an event at about `eventTime` comes before one that
// merely lies nearer.
export async function measuredNear(lat, lon, eventTime) {
  const made = (e) => (eventTime != null && e.event != null && Math.abs(e.event - eventTime) < 30 * 86400_000 ? 0 : 1);
  const near = (await measuredIndex())
    .map((e) => ({ e, km: distanceKm({ lat, lon }, e) }))
    .filter((x) => x.km <= x.e.radiusKm)
    .sort((a, b) => made(a.e) - made(b.e) || a.km - b.km)[0];
  return near ? load(near.e) : null;
}

function load(entry) {
  if (!cache.has(entry.file)) {
    cache.set(
      entry.file,
      fetch(DIR + entry.file)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cache.get(entry.file);
}

export const changeImageUrl = (d) => DIR + d.change.image;
// The picture of one pass's flagged cells (a row of the detector's result).
export const stoodImageUrl = (row) => DIR + row.image;

// ---- how well the next pass can be predicted (tools/forecast.py) ----

const forecasts = new Map();

// The prediction check for a measured site, or null if none was made.
export function forecastFor(d) {
  if (!forecasts.has(d.id)) {
    forecasts.set(
      d.id,
      fetch(`${DIR}${d.id}_forecast.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return forecasts.get(d.id);
}

const num = (v, digits = 2) => (v == null ? '–' : Number(v).toFixed(digits));

// The card for the prediction check: what was tried, how far off each way
// was, and the yes/no question. Every number is computed by
// tools/forecast.py from the calibrated cells; nothing is written by hand.
export function forecastHtml(f) {
  // A baseline is a simple rule the model has to beat; the model is set apart from them.
  const name = (w) => `<th scope="row" title="${esc(w.how)}">${esc(w.name)}${w.needsNewPass ? ' <span class="tag">needs the new pass</span>' : w.baseline ? '' : ' <span class="tag">model</span>'}</th>`;
  const mark = (w) => (w.key === f.best ? ' class="best"' : '');
  const row = (w) => {
    const s = f.overall[w.key];
    if (!s) return '';
    return `<tr${mark(w)}>${name(w)}<td>${num(s.mae)}</td><td>${num(s.rmse)}</td><td>±${num(s.within90)}</td><td>${num(s.r2)}</td><td>${num(s.spearman)}</td></tr>`;
  };
  const way = (w) => {
    const d = f.overall[w.key]?.direction;
    if (!d) return '';
    return `<tr${mark(w)}>${name(w)}<td>${num(d.accuracy)}</td><td>${num(d.precision)}</td><td>${num(d.recall)}</td><td>${num(d.f1)}</td></tr>`;
  };
  const strong = (w) => {
    const c = f.overall[w.key]?.strong;
    if (!c) return '';
    return `<tr${mark(w)}>${name(w)}<td>${num(c.accuracy)}</td><td>${num(c.precision)}</td><td>${num(c.recall)}</td><td>${num(c.f1)}</td></tr>`;
  };
  const shares = f.overall.last?.direction;
  const happened = f.overall.last?.strong?.happened;
  const dates = f.byDate
    .map((r) => {
      const b = r[f.best] || {};
      const share = (v) => (v == null ? '–' : `${(v * 100).toFixed(0)} %`);
      const marked = f.event ? f.event.firstPassAfter === r.date : f.peerSurprise?.time === r.time;
      return `<tr${marked ? ' class="best"' : ''}><td>${esc(r.date)}${f.event?.firstPassAfter === r.date ? ' <span class="tag">after the event</span>' : ''}${r.newVersion ? ` <span class="tag" title="NASA's processing changed from ${esc(r.newVersion.from)} to ${esc(r.newVersion.to)} with this pass; that alone can shift the values">new processing</span>` : ''}</td><td>${num(r.seenMean, 1)}</td><td>${num(b.predMean, 1)}</td>${f.short ? '' : `<td>${share(b.outside)}</td>`}<td>${share(r.peers?.outside)}</td></tr>`;
    })
    .join('');
  return `<div class="card measured forecast">
    <div class="src">Computed from the measurements · a test of predictability, not a forecast</div>
    <p>${esc(f.summary)}</p>
    <table class="forecast-table">
      <caption>Predicting the next pass in ${f.cells.toLocaleString('en')} cells of ${f.cellM} m, in dB. ${f.short ? 'Too few passes here for more than the simplest ways' : 'The first four are baselines: simple rules a model has to beat'}</caption>
      <tr><th scope="col">Way of predicting</th><th scope="col" title="Mean absolute error">MAE</th><th scope="col" title="Root mean square error">RMSE</th><th scope="col" title="Nine cells in ten are within this">9 in 10</th><th scope="col" title="Share of the differences between cells that the prediction explains">R²</th><th scope="col" title="Rank agreement between prediction and measurement">Spearman</th></tr>
      ${f.ways.map(row).join('')}
    </table>
    ${
      shares
        ? `<table class="forecast-table">
      <caption>“Will the echo go down, stay or go up by the next pass?” (${f.directionDb} dB or more is a move.) Always naming the commonest answer would be right ${(shares.commonest * 100).toFixed(0)} % of the time</caption>
      <tr><th scope="col">Way of predicting</th><th scope="col">Accuracy</th><th scope="col" title="Averaged over the three answers">Precision</th><th scope="col" title="Averaged over the three answers">Recall</th><th scope="col" title="Averaged over the three answers">F1</th></tr>
      ${f.ways.map(way).join('')}
    </table>`
        : ''
    }
    <table class="forecast-table">
      <caption>“Will this cell change by ${f.strongDb} dB or more by the next pass?” It did in ${happened == null ? '–' : (happened * 100).toFixed(1)} % of readings</caption>
      <tr><th scope="col">Way of predicting</th><th scope="col">Accuracy</th><th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">F1</th></tr>
      ${f.ways.map(strong).join('')}
    </table>
    <table class="forecast-table passes">
      <caption>Pass by pass: the mean over all cells in dB, measured and as expected from the earlier passes, and the share of cells further off than nine in ten had been before (about 10 % is ordinary)</caption>
      <tr><th scope="col">Pass</th><th scope="col">Measured</th><th scope="col">Expected</th>${f.short ? '' : '<th scope="col" title="Cells outside the range expected from their own earlier passes">Off own past</th>'}<th scope="col" title="Cells whose step differed from their neighbours' step in the same pass">Off neigh&shy;bours</th></tr>
      ${dates}
    </table>
    <p class="hint"><strong>Method.</strong> ${esc(f.method)}</p>
    <p class="hint"><strong>Limits.</strong> ${esc(f.limits)} With few passes the usual range is rough. Made ${esc(f.generated.slice(0, 10))}.</p>
  </div>`;
}

// ---- what stood out (tools/detect.py) ----

const detections = new Map();

// The detector's result for a measured site, or null if it could not be judged.
export function detectFor(d) {
  if (!detections.has(d.id)) {
    detections.set(
      d.id,
      fetch(`${DIR}${d.id}_detect.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return detections.get(d.id);
}

// The test of the detector with changes put in (tools/detect.py --sensitivity).
let tested = null;
export function sensitivity() {
  if (!tested) {
    tested = fetch('data/detection/sensitivity.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return tested;
}

// The card: how much of the ground read differently from its own past,
// pass by pass, where, and how far the detector can be trusted. Every
// number is computed by tools/detect.py; the sentences are templates.
export function detectHtml(f, sens) {
  const e = f.event;
  const at = e ? f.byDate.find((r) => r.date === e.firstPassAfter) : f.byDate.find((r) => r.time === f.most.time);
  // What the detector flags when nothing has happened, from the test.
  const idle = sens?.groups?.all?.flaggedWithNothingPutIn?.new;
  let head = '';
  if (e && !at) head = `No pass after the event of ${esc(e.date)} can be judged yet.`;
  else if (at) {
    const lead = e ? `On NISAR's first pass after the event of ${esc(e.date)} (${esc(at.date)})` : `On the pass that stood out most (${esc(at.date)})`;
    head =
      `${lead}, ${share(at.stood)} of the ground stood out` +
      (at.grade === 'both' ? ': it had left both what the place read on its two latest passes and its own usual reading.' : at.baseline === 1 ? ' against the pass before it.' : ' against the two passes before it.') +
      (stoodOut(at.stood) ? '' : ` That is no more than these rules flag when nothing has happened${idle != null ? ` (${share(idle)} in our test)` : ''}: nothing stood out.`) +
      (f.rough?.[at.grade] ? ` ${esc(f.rough[at.grade])}` : '') +
      (at.stillNext != null && at.stood > 0 ? ` A pass later, ${share(at.stillNext)} of those cells still stood out.` : '') +
      (at.newVersion ? ` This pass is also the first made with a newer version of NASA's processing (${esc(at.newVersion.to)} after ${esc(at.newVersion.from)}): a step that is the same everywhere drops out of this comparison, an uneven one would not.` : '');
  }
  // What kind of change: the flagged cells by how the two channels moved.
  const kinds = at?.kinds
    ? Object.entries(at.kinds)
        .filter(([k, v]) => v >= 0.05 && f.kindsOfChange?.[k])
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<li><b>${share(v)}</b> ${esc(f.kindsOfChange[k])}</li>`)
        .join('')
    : '';
  const rows = f.byDate
    .map(
      (r, i) =>
        `<tr data-pass="${i}" tabindex="0" role="button" title="Show this pass on the globe"${r === at ? ' class="best"' : ''}><td>${esc(r.date)}${e?.firstPassAfter === r.date ? ' <span class="tag">after the event</span>' : ''}${r.newVersion ? ` <span class="tag" title="NASA's processing changed from ${esc(r.newVersion.from)} to ${esc(r.newVersion.to)} with this pass">new processing</span>` : ''}${r.grade !== 'both' ? ` <span class="tag" title="${esc(f.rough?.[r.grade] || '')}">${r.grade === 'pair' ? 'one pass before' : 'two passes before'}</span>` : ''}</td><td>${share(r.stood)}</td><td>${share(r.recent)}</td><td>${share(r.long)}</td></tr>`,
    )
    .join('');
  const p = f.picture;
  // How far it can be trusted: the test with changes put in, for the group
  // of places this one belongs to.
  let trust = '';
  const mine = sens?.sites?.find((x) => x.id === f.id);
  const group = sens?.groups?.[mine?.group || 'quiet'];
  if (group?.rows?.length) {
    const wide = Math.max(...group.rows.map((r) => r.cells));
    const other = sens.groups[mine?.group === 'changing' ? 'quiet' : 'changing'];
    const three = (g) => g?.rows?.find((r) => r.cells === wide && r.db === -3);
    const line = (r) => `<tr><th scope="row">${r.db > 0 ? '+' : '−'}${Math.abs(r.db)} dB</th><td>${num(r.new.recall)}</td><td>${num(r.new.precision)}</td><td>${num(r.new.f1)}</td><td>${num(r.long.f1)}</td><td>${num(r.old.f1)}</td></tr>`;
    trust = `<details class="fold inner"><summary>How far can this be trusted? A test with changes put in</summary>
    <p class="hint">Not a measurement: a patch of ${wide} by ${wide} cells in a real pass before any event was raised or lowered by a set amount, ${sens.trialsEach} times a pass, and the detector run on it. ${mine ? `This place counts as ${mine.group === 'quiet' ? 'quiet' : 'changing by itself'}.` : ''}</p>
    <table class="forecast-table">
      <caption>${esc(group.what)}: ${group.places.length} places, ${group.passes} passes. Recall: how much of the patch was found. Precision: how much of what was flagged lay in the patch</caption>
      <tr><th scope="col">Change put in</th><th scope="col">Recall</th><th scope="col">Precision</th><th scope="col">F1</th><th scope="col" title="${esc(sens.names.long)}">F1, one key</th><th scope="col" title="${esc(sens.names.old)}">F1, first rule</th></tr>
      ${group.rows.filter((r) => r.cells === wide).map(line).join('')}
    </table>
    <p class="hint">With nothing put in, the detector flags ${share(group.flaggedWithNothingPutIn.new)} of the cells in this group; the long key alone ${share(group.flaggedWithNothingPutIn.long)}, the rule we used first ${share(group.flaggedWithNothingPutIn.old)}.${three(other) ? ` In the other group (${esc(other.what.toLowerCase())}) a drop of 3 dB is found with recall ${num(three(other).new.recall)} at precision ${num(three(other).new.precision)}.` : ''} With few passes before an event it is rougher: for a drop of 3 dB in this group, recall ${num(three(group).recent.recall)} at precision ${num(three(group).recent.precision)} with two passes before, ${num(three(group).pair.recall)} at ${num(three(group).pair.precision)} with one. ${esc(sens.limits)}</p>
    </details>`;
  }
  return `<div class="card measured forecast">
    <div class="src">Computed from the measurements · detecting change</div>
    ${head ? `<p><strong>${head}</strong></p>` : ''}
    ${
      p
        ? `<div class="actions"><button class="primary" id="stood-map">Show where it stood out</button>${f.byDate.length > 1 ? ' <button id="stood-play">Play the passes</button>' : ''}</div>
    <ul class="legend">
      <li><i style="--c: ${PALETTE.stronger}"></i>Orange: the echo rose against what was usual</li>
      <li><i style="--c: ${PALETTE.weaker}"></i>Blue: it fell</li>
    </ul>`
        : ''
    }
    ${kinds ? `<p class="hint"><strong>What kind of change?</strong> <span class="badge computed">Hypothesis</span> Of the cells that stood out, by how the two radar channels moved:</p><ul class="plain kinds">${kinds}</ul>` : ''}
    <table class="forecast-table passes">
      <caption>Pass by pass: the share of cells that stood out (both keys), and each key alone: against the two latest passes, and against the cell's own history. Click a pass to see it on the globe</caption>
      <tr><th scope="col">Pass</th><th scope="col">Stood out</th><th scope="col" title="Cells that left what the place read on its two latest passes">Latest two</th><th scope="col" title="Cells that left their own usual reading over the longer history">Own history</th></tr>
      ${rows}
    </table>
    ${trust}
    <p class="hint"><strong>Method.</strong> ${esc(f.method)} “Stood out” is said in words from 2 % of the cells on.</p>
    <p class="hint"><strong>Limits.</strong> ${esc(f.limits)} Made ${esc(f.generated.slice(0, 10))}.</p>
  </div>`;
}

// The card's HTML. The chart is drawn into #measured-chart afterwards.
export function measuredHtml(d, compare) {
  const c = d.change;
  return `<div class="card measured">
    <div class="src">Measured with NISAR · calibrated data</div>
    <p>${esc(d.summary)}</p>
    <div id="measured-chart"></div>
    ${compare ? `<p class="hint">Dashed line: ${esc(compare.pols?.[0] || 'HH')} at ${esc(compare.name)}, same months, other hemisphere.</p>` : ''}
    <div class="actions">
      <button class="primary" id="measured-map">Show the measured change map</button>
    </div>
    <ul class="legend">
      <li><i style="--c: ${PALETTE.weaker}"></i>Blue: echo got weaker from ${day(c.before)} to ${day(c.after)} (${esc(c.pol)})</li>
      <li><i style="--c: ${PALETTE.stronger}"></i>Orange: echo got stronger. Full colour means 3 dB or more.</li>
    </ul>
    <p class="hint"><strong>Method.</strong> ${esc(d.method)} Made ${esc(d.generated.slice(0, 10))}.</p>
  </div>`;
}

const el = (name, attrs = {}, text) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
};

// HH and HV in dB over time, with the two map dates marked and, when
// given, another site's HH as a dashed line for comparison.
export function measuredChart(container, d, compare) {
  container.textContent = '';
  const all = [...d.series, ...(compare?.series || [])];
  const values = all.flatMap((s) => [s.hh, s.hv]).filter((v) => v != null);
  if (!values.length) return;
  const t0 = Math.min(...all.map((s) => s.time));
  const t1 = Math.max(...all.map((s) => s.time));
  const lo = Math.floor(Math.min(...values) / 2) * 2 - 1;
  const hi = Math.ceil(Math.max(...values) / 2) * 2 + 1;
  const x = (t) => BOX.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - BOX.left - BOX.right);
  const y = (v) => BOX.top + ((hi - v) / (hi - lo)) * (H - BOX.top - BOX.bottom);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'measured-svg', role: 'img', 'aria-label': `Backscatter in decibels at ${d.name}` });
  const step = hi - lo > 16 ? 4 : 2;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    svg.append(el('line', { x1: BOX.left, x2: W - BOX.right, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: BOX.left - 5, y: y(v) + 3.5, 'text-anchor': 'end', class: 'tick' }, `${v}`));
  }
  svg.append(el('text', { x: 4, y: BOX.top - 2, class: 'tick' }, 'dB'));
  for (const t of [t0, (t0 + t1) / 2, t1]) {
    svg.append(el('text', { x: x(t), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, new Date(t).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })));
  }
  for (const [t, label] of [
    [d.change.before, 'before'],
    [d.change.after, 'after'],
  ]) {
    svg.append(el('line', { x1: x(t), x2: x(t), y1: BOX.top, y2: H - BOX.bottom, class: 'mark' }));
    svg.append(el('text', { x: x(t) + 3, y: H - BOX.bottom - 4, class: 'tick' }, label));
  }
  if (compare) {
    const pts = compare.series.filter((s) => s.hh != null).map((s) => `${x(s.time)},${y(s.hh)}`);
    if (pts.length > 1) svg.append(el('polyline', { points: pts.join(' '), fill: 'none', stroke: COMPARE_COLOR, 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }));
  }
  // The series keys are hh/hv, but a pass may have recorded VV/VH instead.
  const lines = LINES.map((line, i) => ({ ...line, label: d.pols?.[i] || line.label }));
  for (const line of lines) {
    const pts = d.series.filter((s) => s[line.key] != null);
    if (pts.length < 2) continue;
    svg.append(el('polyline', { points: pts.map((s) => `${x(s.time)},${y(s[line.key])}`).join(' '), fill: 'none', stroke: line.color, 'stroke-width': 2 }));
    for (const s of pts) {
      const dotEl = el('circle', { cx: x(s.time), cy: y(s[line.key]), r: 2.6, fill: line.color });
      dotEl.append(el('title', {}, `${line.label} ${s[line.key].toFixed(1)} dB on ${day(s.time)}`));
      svg.append(dotEl);
    }
    const last = pts[pts.length - 1];
    svg.append(el('text', { x: x(last.time) + 4, y: y(last[line.key]) - 5, class: 'end' }, line.label));
  }
  container.append(svg);
}
