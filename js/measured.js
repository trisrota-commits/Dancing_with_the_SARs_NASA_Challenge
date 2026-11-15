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

// Measured sites; an empty list when none have been made yet.
export async function measuredIndex() {
  if (!index) {
    index = fetch(`${DIR}index.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return index;
}

// One line per tested site from tools/forecast.py: what stood out, and when.
let summary = null;
export function measuredSummary() {
  if (!summary) {
    summary = fetch(`${DIR}forecast.json`, { cache: 'no-store' })
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
      return `<tr${marked ? ' class="best"' : ''}><td>${esc(r.date)}${f.event?.firstPassAfter === r.date ? ' <span class="tag">after the event</span>' : ''}${r.newVersion ? ` <span class="tag" title="NASA's processing changed from ${esc(r.newVersion.from)} to ${esc(r.newVersion.to)} with this pass; that alone can shift the values">new processing</span>` : ''}</td><td>${num(r.seenMean, 1)}</td><td>${num(b.predMean, 1)}</td><td>${share(b.outside)}</td><td>${share(r.peers?.outside)}</td></tr>`;
    })
    .join('');
  // What the card is for: telling a change from the ordinary. The sentence
  // is put together from the numbers; "about 10 %" is the method's own
  // yardstick (the range nine cells in ten kept to before).
  const pct = (v) => `${(v * 100).toFixed(0)} %`;
  const after = f.event && f.byDate.find((r) => r.date === f.event.firstPassAfter);
  // A place's own usual range needs a longer history than a short series has.
  const own = f.short ? null : after?.[f.best]?.outside;
  const changed = after?.newVersion ? ` This pass is also the first made with a newer version of NASA's processing (${esc(after.newVersion.to)} after ${esc(after.newVersion.from)}), which by itself shifts the values: the figure cannot be put down to the event.` : '';
  const stood = after
    ? `On NISAR's first pass after the event of ${esc(f.event.date)} (${esc(after.date)})${after.peers?.outside != null ? `, ${pct(after.peers.outside)} of the cells did something other than their neighbours` : ''}${own != null ? `${after.peers?.outside != null ? ', and' : ','} ${pct(own)} fell outside their own usual range` : ''}. About 10 % is ordinary.${changed}`
    : f.peerSurprise
      ? `Set against their neighbours, the pass that stood out most was that of ${esc(f.peerSurprise.date)}: ${pct(f.peerSurprise.outside)} of the cells did something of their own. About 10 % is ordinary.`
      : '';
  return `<div class="card measured forecast">
    <div class="src">Computed from the measurements · detecting change, not forecasting it</div>
    ${stood ? `<p><strong>${stood}</strong></p>` : ''}
    <p class="hint">Each cell of ${f.cellM} m is compared with what was expected of it: from its own earlier passes, and from what the cells around it did in the same pass. Rain or a season moves every cell alike and drops out of the second comparison; what is left is ground that went its own way. It says that something changed and where, not what caused it.</p>
    <table class="forecast-table">
      <caption>Pass by pass: the mean over all cells, measured and as expected from the earlier passes; how many cells fell outside the range nine in ten had kept to before (about 10 % is ordinary), against their own past and against their neighbours</caption>
      <tr><th scope="col">Pass</th><th scope="col">Measured</th><th scope="col">Expected</th><th scope="col" title="Cells outside the range expected from their own earlier passes">Off own past</th><th scope="col" title="Cells that did something other than their neighbours in the same pass">Off neighbours</th></tr>
      ${dates}
    </table>
    <details class="fold inner"><summary>How good is the expectation? Baselines and error measures</summary>
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
    <p class="hint"><strong>Method.</strong> ${esc(f.method)}</p>
    </details>
    <p class="hint"><strong>Limits.</strong> ${esc(f.limits)} With few passes the usual range is rough. Made ${esc(f.generated.slice(0, 10))}.</p>
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
