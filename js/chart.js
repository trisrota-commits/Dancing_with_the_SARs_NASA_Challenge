// A small history chart: co- and cross-polarised preview brightness at one
// point across the passes of a time-lapse (one line for single-polarisation
// passes). One shared 0–255 axis, a crosshair tooltip that reads out every
// series, direct labels at the line ends, and a table view of the numbers.

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 176;
const BOX = { left: 30, right: 36, top: 10, bottom: 24 };
const SURFACE = '#0a101a';
// Colours validated for colour-blind separation on the dark panel surface.
const seriesFor = (pol) => [
  { key: 'co', short: pol.co, name: `${pol.co}, same polarisation`, color: '#d55181' },
  ...(pol.cross ? [{ key: 'cross', short: pol.cross, name: `${pol.cross}, cross polarisation`, color: '#0ca30c' }] : []),
];

const el = (name, attrs = {}, text) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
};
const html = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const month = (ms) => new Date(ms).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// points: [{ time, co, cross }] with null where a pass missed the point.
// pol: { co: 'HH', cross: 'HV' | null }. onPick(index) fires on a click.
export function historyChart(container, points, pol, onPick) {
  container.textContent = '';
  const SERIES = seriesFor(pol);
  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const x = (t) => BOX.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - BOX.left - BOX.right);
  const y = (v) => H - BOX.bottom - (v / 255) * (H - BOX.top - BOX.bottom);

  const root = html('div', 'chart');
  const legend = html('div', 'chart-legend');
  for (const s of SERIES) {
    const item = html('span');
    const key = html('i');
    key.style.background = s.color;
    item.append(key, s.name);
    legend.append(item);
  }
  // One line needs no legend: the heading already says what it is.
  if (SERIES.length > 1) root.append(legend);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${SERIES.map((x) => x.short).join(' and ')} brightness at this point for each NISAR pass` });
  for (const v of [0, 85, 170, 255]) {
    svg.append(el('line', { x1: BOX.left, x2: W - BOX.right, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: BOX.left - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'tick' }, v));
  }
  svg.append(el('text', { x: BOX.left, y: H - 6, class: 'tick' }, month(t0)));
  svg.append(el('text', { x: W - BOX.right, y: H - 6, 'text-anchor': 'end', class: 'tick' }, month(t1)));

  // The pass being shown on the globe.
  const active = el('line', { y1: BOX.top, y2: H - BOX.bottom, class: 'active' });
  svg.append(active);

  const ends = [];
  for (const s of SERIES) {
    let d = '';
    let pen = false;
    let last = null;
    for (const p of points) {
      if (p[s.key] == null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p[s.key]).toFixed(1)}`;
      pen = true;
      last = p;
    }
    svg.append(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (last) ends.push({ s, cx: x(last.time), cy: y(last[s.key]) });
  }
  // End markers with a surface ring, labelled directly; nudge labels apart.
  ends.sort((a, b) => a.cy - b.cy);
  if (ends.length === 2 && ends[1].cy - ends[0].cy < 12) {
    const mid = (ends[0].cy + ends[1].cy) / 2;
    ends[0].ly = mid - 6;
    ends[1].ly = mid + 6;
  }
  for (const e of ends) {
    svg.append(el('circle', { cx: e.cx, cy: e.cy, r: 4, fill: e.s.color, stroke: SURFACE, 'stroke-width': 2 }));
    svg.append(el('text', { x: e.cx + 9, y: (e.ly ?? e.cy) + 4, class: 'end' }, e.s.short));
  }

  const cross = el('line', { y1: BOX.top, y2: H - BOX.bottom, class: 'cross', visibility: 'hidden' });
  svg.append(cross);
  const hit = el('rect', { x: BOX.left - 6, y: 0, width: W - BOX.left - BOX.right + 12, height: H, fill: 'transparent' });
  svg.append(hit);
  root.append(svg);

  const tip = html('div', 'chart-tip');
  tip.hidden = true;
  root.append(tip);

  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.time) - px) < Math.abs(x(points[best].time) - px)) best = i;
    });
    return best;
  };
  hit.addEventListener('pointermove', (e) => {
    const i = nearest(e.clientX);
    const p = points[i];
    cross.setAttribute('x1', x(p.time));
    cross.setAttribute('x2', x(p.time));
    cross.setAttribute('visibility', 'visible');
    tip.textContent = '';
    tip.append(html('div', 'when', day(p.time)));
    for (const s of SERIES) {
      const row = html('div', 'row');
      const key = html('i');
      key.style.background = s.color;
      row.append(key, html('b', '', p[s.key] == null ? 'no data' : Math.round(p[s.key])), html('span', '', s.short));
      tip.append(row);
    }
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    const left = (x(p.time) / W) * box.width;
    tip.style.left = `${Math.min(box.width - 110, left + 10)}px`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  hit.addEventListener('click', (e) => onPick?.(nearest(e.clientX)));

  // The same numbers as a table, for anyone who cannot use the chart.
  const details = html('details', 'chart-table');
  details.append(html('summary', '', 'Show as table'));
  const table = html('table');
  const head = html('tr');
  head.append(html('th', '', 'Pass'), ...SERIES.map((x) => html('th', '', x.short)));
  table.append(head);
  for (const p of points) {
    const row = html('tr');
    row.append(html('td', '', day(p.time)), ...SERIES.map((x) => html('td', '', p[x.key] == null ? '–' : Math.round(p[x.key]))));
    table.append(row);
  }
  details.append(table);
  root.append(details);
  container.append(root);

  return {
    setActive(i) {
      const at = x(points[i].time);
      active.setAttribute('x1', at);
      active.setAttribute('x2', at);
    },
  };
}
