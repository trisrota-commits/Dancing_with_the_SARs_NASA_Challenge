// Calibrated NISAR measurements made offline by tools/measure.py from the
// full-resolution GCOV products (not the preview images). The app only
// shows them: data/measured/index.json lists the measured sites, and each
// site has its own JSON file and change map.

import { distanceKm } from './incidents.js';

const DIR = 'data/measured/';
const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 190;
const BOX = { left: 34, right: 28, top: 12, bottom: 24 };
const LINES = [
  { key: 'hh', label: 'HH', color: '#d55181' },
  { key: 'hv', label: 'HV', color: '#0ca30c' },
];
const COMPARE_COLOR = '#9fb4d0';

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
      <li><i style="--c: rgb(64, 170, 255)"></i>Blue: echo got weaker from ${day(c.before)} to ${day(c.after)} (${esc(c.pol)})</li>
      <li><i style="--c: rgb(255, 170, 60)"></i>Orange: echo got stronger. Full colour means 3 dB or more.</li>
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
