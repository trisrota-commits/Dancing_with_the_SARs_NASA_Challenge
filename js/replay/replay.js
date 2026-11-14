// What happened at the selected event, drawn on the globe from data and
// driven by a timeline. It opens on the latest state and stands still; the
// reader drags the timeline to go back, or plays it once. Each kind of
// event has one template whose parameters (where, how big, how strong,
// when) are filled from the feeds.
//
// A plan also carries `key`: one short line per kind of mark it puts on
// the globe ({ mark: 'dot' | 'glow' | 'line' | 'outline' | 'bands' | 'fill', color,
// text }), shown as the key on the globe. Only marks that are really drawn
// for this event are listed.
//
// A template returns a plan: { from, to, timeOf(ms), draw(t, started, ms),
// caption(t), parts, frameKm, ... }. from and to are real times; timeOf
// turns a real time into the plan's own clock t, which draw understands.
// An optional intro (seconds of t) is played once when the event opens.
//
// Every element says where it comes from:
//   observed  – measured by an instrument or catalogued by an agency
//   analysis  – an area or zone an agency worked out and published
//   computed  – drawn here by a stated rule, to connect the data points

import { OVERLAYS, CATEGORIES, PALETTE } from '../config.js';
import { distanceKm } from '../incidents.js';
import { rgb, lonDelta } from '../engine/geo.js';
import { gdacsShapes, shakeContours, quakesNear, fireDetections, dateRange, useSignal } from './sources.js';

const DAY = 86400_000;
const HOLD = 2.5; // seconds the final picture stays before the loop restarts
const PLAY_SECONDS = 14; // how long "play" takes to run the whole timeline

// Shaking intensity is written in Roman numerals by convention.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const RAD = Math.PI / 180;

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const rgba = (hex, a) => `rgba(${rgb(hex).map((c) => Math.round(c * 255)).join(',')},${a})`;

// Points on a circle of the given ground radius around a centre.
function circle(c, km, n = 72) {
  const d = km / 6371;
  const lat1 = c.lat * RAD;
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = (i / n) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    const lon2 = c.lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    out.push({ lat: lat2 / RAD, lon: lon2 / RAD });
  }
  return out;
}

// Position along a dated track at a given time, blending between fixes.
function along(track, time) {
  if (time <= track[0].time) return { ...track[0], index: 0 };
  for (let i = 0; i + 1 < track.length; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (time > b.time) continue;
    const f = (time - a.time) / Math.max(1, b.time - a.time);
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + lonDelta(b.lon, a.lon) * f,
      value: a.value != null && b.value != null ? a.value + (b.value - a.value) * f : (a.value ?? b.value),
      time,
      index: i + 1,
    };
  }
  return { ...track[track.length - 1], index: track.length };
}

function reach(centre, points) {
  let km = 0;
  for (const p of points) km = Math.max(km, distanceKm(centre, p));
  return km;
}

// The USGS ShakeMap colour for a shaking intensity. USGS contours carry
// their own colour; this is for outlines that arrive without one.
function intensityColor(v) {
  return PALETTE.shaking[Math.max(0, Math.min(PALETTE.shaking.length - 1, Math.floor(v) - 3))];
}

const SHAKING_SWATCH = `linear-gradient(90deg,${PALETTE.shaking.join(',')})`;
const GDACS_SWATCH = `linear-gradient(90deg,${PALETTE.gdacs.green} 0 33%,${PALETTE.gdacs.orange} 33% 66%,${PALETTE.gdacs.red} 66%)`;

// Wind speed in knots to the familiar storm class.
function stormClass(kts) {
  if (kts == null) return null;
  if (kts < 34) return 'Tropical depression';
  if (kts < 64) return 'Tropical storm';
  const cat = kts < 83 ? 1 : kts < 96 ? 2 : kts < 113 ? 3 : kts < 137 ? 4 : 5;
  return `Category ${cat} cyclone`;
}

// The water product also paints "not water" white and masked areas grey;
// only its blue classes are water.
const isWater = (r, g, b) => b > 150 && b > r + 60 && b > g + 30;

// Published outlines belong to the event: they are off while the timeline
// stands before it. Returns a function to call from draw with `started`.
function outlines(globe, zones) {
  let shown = null;
  return (started) => {
    const show = started !== false;
    if (show === shown) return;
    shown = show;
    globe.setEffectZones(show ? zones : []);
  };
}

const GROUND = PALETTE.family.ground;

// ---------- templates ----------

async function quake(inc, globe) {
  const centre = { lat: inc.lat, lon: inc.lon };
  const mag = inc.magnitude?.value ?? 5;
  const radius = mag >= 7 ? 500 : mag >= 6 ? 300 : 150;
  const [contours, shapes, nearby] = await Promise.all([
    shakeContours(inc).catch(() => []),
    gdacsShapes(inc).catch(() => ({ polygons: [], lines: [] })),
    quakesNear(inc.lat, inc.lon, radius, inc.time - 30 * DAY).catch(() => []),
  ]);

  // Prefer the USGS contours; fall back to the GDACS intensity zones.
  let zones = contours.map((c) => ({ km: reach(centre, c.points), paint: { ring: c.points, color: c.color || intensityColor(c.value), width: 2.2, open: true }, value: c.value }));
  let zoneSource = 'USGS ShakeMap';
  if (!zones.length) {
    zones = shapes.polygons
      .filter((p) => p.kind.startsWith('Poly_SMPInt') && p.intensity)
      .map((p) => ({ km: reach(centre, p.ring), paint: { ring: p.ring, color: rgba(intensityColor(p.intensity), 0.9), fill: rgba(intensityColor(p.intensity), 0.1), width: 1.6 }, value: p.intensity }));
    zoneSource = 'GDACS';
  }
  zones.sort((a, b) => a.km - b.km);

  const before = nearby.filter((q) => q.time < inc.time - 60_000);
  const after = nearby.filter((q) => q.time > inc.time + 60_000);
  const span = Math.max(3600_000, Date.now() - inc.time);
  const rmax = Math.max(120, zones.length ? zones[zones.length - 1].km : 0);
  const WAVE = 5.5;
  const AFTER = after.length ? 8 : 0;
  const speedup = Math.round(rmax / 3.5 / WAVE);
  const dot = (q, color, pop) => ({ lat: q.lat, lon: q.lon, color, size: 4 + Math.max(0, q.mag - 2.5) * 3.2, pop });
  // When each later quake first showed, so it can pop in once.
  const popped = [];
  // Labels: the shaking level on one outline of each whole level, and the
  // magnitude of the strongest later quakes (those only from closer in).
  const levelLabels = [];
  for (const z of zones) {
    if (Number.isInteger(z.value) && ROMAN[z.value] && !levelLabels.some((l) => l.value === z.value)) {
      const top = z.paint.ring.reduce((a, b) => (b.lat > a.lat ? b : a));
      levelLabels.push({ value: z.value, km: z.km, lat: top.lat, lon: top.lon, text: `Shaking ${ROMAN[z.value]}`, color: intensityColor(z.value) });
    }
  }
  const named = new Set([...after].sort((a, b) => b.mag - a.mag).slice(0, 4).filter((q) => q.mag >= 4));
  const closer = (rmax * 1.3 * 3.4) / 6371 * 0.8;
  let shownLabels = '';
  let shownZones = -1;
  let shownAfter = -1;
  let shownEarly = -1;

  return {
    from: inc.time,
    to: Date.now(),
    // What the caption reads; draw keeps them up to date.
    now: inc.time,
    count: 0,
    // The wave fronts cross in seconds, far too fast for a timeline of
    // days, so they play once when the event opens.
    intro: WAVE + 0.5,
    key: [
      ...(zones.length ? [{ mark: 'bands', color: SHAKING_SWATCH, text: `Outlines: how strong the shaking was, from weak (blue) to violent (red), in the colours of ${zoneSource === 'GDACS' ? 'the USGS scale (outlines from GDACS)' : 'USGS'}` }] : []),
      ...(after.length ? [{ mark: 'dot', color: GROUND, text: 'Red dots: later quakes nearby, bigger for stronger' }] : []),
      ...(before.length ? [{ mark: 'dot', color: PALETTE.context, text: 'Grey dots: quakes in the 30 days before' }] : []),
      { mark: 'line', color: GROUND, text: 'Red and white rings at the start: the two earthquake waves spreading, sped up' },
    ],
    timeOf: (ms) => WAVE + 0.5 + (AFTER ? Math.max(0, Math.min(1, (ms - inc.time) / span)) * AFTER : 0),
    frameKm: rmax * 1.3,
    parts: [
      { kind: 'observed', text: `Epicentre, magnitude ${mag.toFixed(1)} and time`, source: 'USGS' },
      zones.length
        ? { kind: 'analysis', text: `Shaking intensity outlines, levels ${Math.min(...zones.map((z) => z.value))} to ${Math.max(...zones.map((z) => z.value))}`, source: zoneSource }
        : { kind: 'note', text: 'No shaking map has been published for this earthquake.' },
      { kind: 'computed', text: `Wave fronts at typical crust speeds (P 6 km/s, S 3.5 km/s), played ${speedup}× faster than real time. The glow and ripple on the ground mark where the fronts are; their brightness and height are not to scale.` },
      { kind: 'observed', text: `${after.length} later and ${before.length} earlier quakes of M2.5+ within ${radius} km, from 30 days before the quake until now${nearby.length >= 600 ? ' (the catalogue query stops at 600, so the newest may be missing)' : ''}`, source: 'USGS catalogue' },
    ],
    draw(t, started, ms) {
      if (started === false) {
        // Before the earthquake: only the quakes that had happened by then.
        // Dragging the handle asks for this many times a second, so the
        // globe is only touched when the set of quakes changes.
        const earlier = before.filter((q) => ms == null || q.time <= ms);
        if (earlier.length === shownEarly) return;
        shownEarly = earlier.length;
        globe.setShockwave(null);
        globe.setEffectLines([]);
        globe.setEffectZones([]);
        globe.setEffectGlow([]);
        globe.setEffectDots(earlier.map((q) => dot(q, rgb(PALETTE.context))));
        globe.setLabels([]);
        shownZones = shownAfter = -1;
        shownLabels = '';
        popped.length = 0;
        this.hadLines = this.hadFlash = false;
        return;
      }
      shownEarly = -1;
      const s = Math.min(1, t / WAVE) * rmax;
      const lines = [];
      if (t < WAVE + 0.5) {
        const fade = 1 - Math.max(0, t - WAVE) * 2;
        lines.push({ points: circle(centre, Math.max(1, s)), color: [1, 0.32, 0.28, 0.95 * fade], closed: true });
        lines.push({ points: circle(centre, Math.max(1, Math.min(s * (6 / 3.5), rmax * 1.72))), color: [1, 1, 1, 0.5 * fade], closed: true });
      }
      if (lines.length || this.hadLines) globe.setEffectLines(lines);
      this.hadLines = lines.length > 0;
      // The same two fronts, drawn into the terrain itself.
      const fade = Math.max(0, Math.min(1, 1 - (t - WAVE) * 2));
      globe.setShockwave(
        fade > 0
          ? { ...centre, sKm: Math.max(1, s), pKm: Math.max(1, Math.min(s * (6 / 3.5), rmax * 1.72)), widthKm: rmax * 0.03, strength: fade, rippleKm: rmax * 0.1, heightM: rmax * 8 }
          : null,
      );
      // A flash at the epicentre as the rupture starts.
      const flash = Math.max(0, 1 - t / 1.4);
      if (flash > 0 || this.hadFlash) globe.setEffectGlow(flash > 0 ? [{ ...centre, color: [flash, 0.55 * flash, 0.3 * flash], size: 10 + mag * 4 }] : []);
      this.hadFlash = flash > 0;

      const nZones = t >= WAVE ? zones.length : zones.filter((z) => z.km <= s).length;
      if (nZones !== shownZones) {
        shownZones = nZones;
        globe.setEffectZones(zones.slice(0, nZones).map((z) => z.paint));
      }
      const now = AFTER ? inc.time + (Math.max(0, t - WAVE - 0.5) / AFTER) * span : inc.time;
      const nAfter = after.filter((q) => q.time <= now).length;
      if (nAfter !== shownAfter) {
        // Jumping back in time forgets the entrances from there on.
        if (nAfter < shownAfter) popped.length = nAfter;
        for (let i = popped.length; i < nAfter; i++) popped[i] = globe.clock;
        shownAfter = nAfter;
        globe.setEffectDots([...before.map((q) => dot(q, rgb(PALETTE.context))), ...after.slice(0, nAfter).map((q, i) => dot(q, rgb(GROUND), popped[i]))]);
      }
      this.now = now;
      this.count = nAfter;
      const labels = [
        ...levelLabels.filter((l) => t >= WAVE || l.km <= s),
        ...after.slice(0, nAfter).filter((q) => named.has(q)).map((q) => ({ lat: q.lat, lon: q.lon, text: `M ${q.mag.toFixed(1)}`, color: GROUND, within: closer })),
      ];
      const key = labels.map((l) => l.text + l.lat).join('|');
      if (key !== shownLabels) {
        shownLabels = key;
        globe.setLabels(labels);
      }
    },
    caption(t) {
      if (t < WAVE) return `Seismic waves spreading from the epicentre · ${Math.round((Math.min(1, t / WAVE) * rmax) / 3.5)} s after the quake`;
      if (!AFTER) return 'No later quakes catalogued nearby so far';
      return `${day(this.now)} · ${this.count} of ${after.length} later quakes nearby`;
    },
  };
}

async function storm(inc, globe) {
  const shapes = await gdacsShapes(inc).catch(() => ({ polygons: [], lines: [] }));
  let track = inc.track ? inc.track.map((p) => ({ ...p })) : null;
  let timing = 'observed';
  if (!track && shapes.lines.length) {
    // GDACS gives the path without times: spread it evenly over the event.
    const pts = shapes.lines.flatMap((l) => l.points);
    track = pts.map((p, i) => ({ ...p, time: inc.time + ((inc.endTime - inc.time) * i) / Math.max(1, pts.length - 1), value: null }));
    timing = 'computed';
  }
  if (!track || track.length < 2) return null;
  // A track without any spread in time cannot be put on a timeline.
  if (!(track[track.length - 1].time > track[0].time)) return null;
  // A path is drawn in the colour of the kind of event it belongs to.
  const hex = (Object.hasOwn(CATEGORIES, inc.category) ? CATEGORIES[inc.category] : CATEGORIES.storm).color;
  const color = rgb(hex);
  const zoneStyle = { Poly_Green: PALETTE.gdacs.green, Poly_Orange: PALETTE.gdacs.orange, Poly_Red: PALETTE.gdacs.red };
  const zones = shapes.polygons.filter((p) => zoneStyle[p.kind]).map((p) => ({ ring: p.ring, color: rgba(zoneStyle[p.kind], 0.8), fill: rgba(zoneStyle[p.kind], 0.1), width: 1.4 }));
  const t0 = track[0].time;
  const t1 = track[track.length - 1].time;
  const centre = track[Math.floor(track.length / 2)];
  const peak = Math.max(...track.map((p) => p.value || 0));
  const showZones = outlines(globe, zones);
  // The storm counts as over a day and a half after its last fix and after
  // the feeds last updated it, whichever is later.
  const over = Math.max(t1, inc.endTime) + 1.5 * DAY;

  return {
    from: t0,
    to: t1,
    // The plan's clock is the fraction of the track covered.
    timeOf: (ms) => Math.max(0, Math.min(1, (ms - t0) / (t1 - t0))),
    frameKm: Math.max(300, reach(centre, track) * 1.2),
    focus: centre,
    key: [
      { mark: 'line', color: hex, text: `Line: the storm's path${timing === 'observed' ? '' : ' (GDACS)'}, bold up to the moment shown` },
      { mark: 'glow', color: hex, text: 'Cloud spiral: where the storm was. Its size follows the wind speed by a rule; it is animation, not a picture of the clouds.' },
      ...(zones.length ? [{ mark: 'bands', color: GDACS_SWATCH, text: 'Green, orange, red areas: wind-speed zones, weakest to strongest, in the alert colours of GDACS' }] : []),
    ],
    parts: [
      { kind: timing, text: timing === 'observed' ? `${track.length} dated position fixes${peak ? ` with wind speed (peak ${Math.round(peak)} kt)` : ''}` : 'Track line, with timing spread evenly along it', source: timing === 'observed' ? 'NASA EONET' : 'GDACS' },
      { kind: 'computed', text: 'Position between fixes is a straight blend' },
      { kind: 'computed', text: 'Cloud spiral: its radius (120 to 500 km) and spin follow the wind speed by a fixed rule. It is not a satellite image or the storm\'s measured extent.' },
      ...(zones.length ? [{ kind: 'analysis', text: 'Wind-speed zones (green, orange, red)', source: 'GDACS' }] : []),
    ],
    draw(t, started, ms) {
      showZones(started);
      // Before the first fix, or well after the last one, there is no storm
      // to draw: only its path, faint before and whole afterwards.
      this.over = ms != null && ms > over;
      this.early = started === false;
      if (this.early || this.over) {
        this.at = this.over ? track[track.length - 1] : track[0];
        globe.setEffectLines([{ points: track, color: [...color, this.over ? 0.9 : 0.28] }]);
        globe.setVortex(null);
        globe.setLabels([]);
        return;
      }
      const at = along(track, t0 + Math.min(t, 1) * (t1 - t0));
      this.at = at;
      const done = track.slice(0, at.index);
      globe.setEffectLines([
        { points: track, color: [...color, 0.28] },
        { points: [...done, at], color: [...color, 1] },
      ]);
      // Bigger and brighter with stronger wind.
      const strength = at.value ? Math.min(1, at.value / 140) : 0.4;
      const radiusKm = 120 + strength * 380;
      globe.setVortex({ lat: at.lat, lon: at.lon, radiusKm, color, power: strength });
      // The wind speed travels with the storm, at the rim of the spiral.
      globe.setLabels(at.value ? [{ lat: Math.min(89, at.lat + radiusKm / 111), lon: at.lon, text: `${Math.round(at.value * 1.852)} km/h · ${stormClass(at.value)}`, color: hex }] : []);
    },
    caption() {
      const a = this.at;
      if (this.over) return `The track ended on ${day(t1)}`;
      const wind = a?.value ? ` · ${Math.round(a.value)} kt (${Math.round(a.value * 1.852)} km/h) · ${stormClass(a.value)}` : '';
      // Times spread evenly along a GDACS track are not real clock times.
      return `${timing === 'computed' ? day(a?.time ?? t0) : stamp(a?.time ?? t0)}${wind}`;
    },
  };
}

async function fire(inc, globe) {
  const centre = { lat: inc.lat, lon: inc.lon };
  const shapes = await gdacsShapes(inc).catch(() => ({ polygons: [], lines: [] }));
  const burnt = shapes.polygons.filter((p) => p.kind === 'Poly_area');
  const radius = Math.min(150, Math.max(60, burnt.length ? reach(centre, burnt.flatMap((b) => b.ring)) + 25 : 60));
  // The days of the event itself: up to fifteen, ending a day after its
  // last report, or yesterday while it is still going on.
  const last = Math.min(Date.now() - DAY, inc.endTime + DAY);
  const dates = dateRange(Math.max(inc.time - DAY, last - 14 * DAY), last, 15);
  if (!dates.length) return null;
  const days = await fireDetections(inc.lat, inc.lon, radius, dates);
  const total = days.reduce((n, d) => n + d.points.length, 0);
  const STEP = 1.1;

  const first = Date.parse(dates[0]);
  const showZones = outlines(globe, burnt.map((b) => ({ ring: b.ring, color: rgba(PALETTE.family.fire, 0.95), fill: rgba(PALETTE.family.fire, 0.07), width: 2 })));
  return {
    from: first,
    to: first + days.length * DAY,
    timeOf: (ms) => Math.max(0, Math.min(days.length, (ms - first) / DAY)) * STEP,
    frameKm: radius * 1.1,
    key: [
      ...(total ? [{ mark: 'glow', color: 'radial-gradient(#ffc257,#ff660f 55%,#eb1708)', text: 'Glowing spots: fires a satellite saw that day (VIIRS). Hot is bright; they cool to dark red over three days.' }] : []),
      ...(total ? [{ mark: 'glow', color: '#8a8a8a', text: 'Thin smoke and shimmer: animation, not data' }] : []),
      ...(burnt.length ? [{ mark: 'outline', color: PALETTE.family.fire, text: 'Orange outline: the burnt area as published by GDACS' }] : []),
    ],
    parts: [
      total
        ? { kind: 'observed', text: `${total} active-fire detections over ${days.length} days within ${Math.round(radius)} km`, source: 'VIIRS on NOAA-20, NASA GIBS' }
        : { kind: 'note', text: `No satellite fire detections within ${Math.round(radius)} km from ${dates[0]} to ${dates[dates.length - 1]}.` },
      ...(burnt.length ? [{ kind: 'analysis', text: 'Burnt-area outline', source: 'GDACS / GWIS' }] : []),
      { kind: 'computed', text: 'Each detection glows at the sensor\'s 375 m pixel size, fades in during its day (the satellite gives the day, not the hour) and cools to dark red over about three days. Nothing is drawn between detections.' },
      { kind: 'computed', text: 'Closer in, each spot sits on the exact position of its detection at true size, reddest at its centre. The shape of the glow, its shimmer and the thin smoke are animation, not measurements; the smoke rises straight up because the feeds carry no wind.' },
    ],
    setup() {
      // Every detection is handed over once, with the moment it ignites on
      // the timeline's clock: spread through the first part of its day, in an
      // order fixed by its position.
      const items = [];
      days.forEach((d, i) => {
        for (const p of d.points) {
          const h = Math.sin(p.lat * 269.5 + p.lon * 183.3) * 43758.5453;
          items.push({ lat: p.lat, lon: p.lon, born: (i + (h - Math.floor(h)) * 0.55) * STEP });
        }
      });
      globe.setFire(items, centre);
    },
    draw(t, started) {
      showZones(started);
      this.index = Math.min(days.length - 1, Math.floor(t / STEP));
      globe.setFireTime(t, STEP);
    },
    caption() {
      const d = days[this.index ?? 0];
      const sofar = days.slice(0, (this.index ?? 0) + 1).reduce((n, x) => n + x.points.length, 0);
      return d ? `${d.date} · ${d.points.length} fire detections that day · ${sofar} so far` : '';
    },
  };
}

async function flood(inc, globe) {
  const centre = { lat: inc.lat, lon: inc.lon };
  const shapes = await gdacsShapes(inc).catch(() => ({ polygons: [], lines: [] }));
  const area = shapes.polygons.filter((p) => p.kind === 'Poly_Affected');
  // Every second day keeps the download small; each step still adds to the last.
  // The days of the event itself, ending two days after its last report, or
  // yesterday while it is still going on (today's water map is rarely out).
  const last = Math.min(Date.now() - DAY, inc.endTime + 2 * DAY);
  const dates = dateRange(Math.max(inc.time - 4 * DAY, last - 21 * DAY), last, 22).filter((_, i, all) => (all.length - 1 - i) % 2 === 0);
  if (!dates.length) return null;
  const water = OVERLAYS.water;
  const STEP = 1.1;
  // Only fetch water tiles around the event, not for the whole view.
  const pts = area.length ? area.flatMap((a) => a.ring) : [centre];
  const pad = area.length ? 0.3 : 1.5;
  const bounds = {
    west: Math.min(...pts.map((p) => p.lon)) - pad,
    east: Math.max(...pts.map((p) => p.lon)) + pad,
    south: Math.min(...pts.map((p) => p.lat)) - pad,
    north: Math.max(...pts.map((p) => p.lat)) + pad,
  };

  const first = Date.parse(dates[0]);
  const showZones = outlines(globe, area.map((a) => ({ ring: a.ring, color: rgba(PALETTE.family.water, 0.95), fill: rgba(PALETTE.family.water, 0.06), width: 2 })));
  return {
    from: first,
    to: Date.parse(dates[dates.length - 1]) + DAY,
    // The passes used are two days apart; each has fully arrived a day later.
    timeOf: (ms) => Math.max(0, Math.min(dates.length, (ms - first) / (2 * DAY) + 0.5)) * STEP,
    frameKm: Math.min(600, Math.max(120, area.length ? reach(centre, area.flatMap((a) => a.ring)) * 1.2 : 150)),
    key: [
      { mark: 'fill', color: 'linear-gradient(90deg,#3d99d6,#0d4580)', text: 'Blue water: water a radar satellite saw on land (Sentinel-1). Rivers and lakes show too. Its ripples are animation.' },
      ...(area.length ? [{ mark: 'outline', color: PALETTE.family.water, text: 'Blue outline: the affected area as published by GDACS' }] : []),
    ],
    parts: [
      { kind: 'observed', text: `Water the radar saw on land (blue), building up pass by pass from ${dates[0]}. Rivers and lakes that are always there show too.`, source: 'OPERA DSWx, Sentinel-1' },
      ...(area.length ? [{ kind: 'analysis', text: 'Affected-area outline', source: 'GDACS' }] : []),
      { kind: 'note', text: 'Radar passes come every few days, so water appears in strips as each pass arrives.' },
      { kind: 'computed', text: 'Each patch of water fades in at the first pass that saw it. The ripples and the waves along its edge are animation: the radar gives where water was on each pass, not how it moved.' },
    ],
    setup() {
      // Every pass is handed over once, marked with its step; the terrain
      // shader then lets the water arrive as the timeline passes it.
      globe.setWater(-1, dates.length);
      globe.setEffectLayers(dates.map((date, i) => ({ url: water.url.replace('{date}', date), maxLevel: water.maxLevel, bounds, keep: isWater, tint: [255, Math.round((255 * i) / dates.length), 0], mask: i })));
    },
    draw(t, started) {
      showZones(started);
      this.index = Math.min(dates.length - 1, Math.floor(t / STEP));
      // Before the first pass used here there is no water to show at all.
      globe.setWater(started === false ? -1 : t / STEP, dates.length);
    },
    caption() {
      return `Water seen by radar up to ${dates[this.index ?? 0]}`;
    },
  };
}

// Anything else: follow its track if it has one, and show published areas.
async function generic(inc, globe) {
  const shapes = await gdacsShapes(inc).catch(() => ({ polygons: [], lines: [] }));
  const zones = shapes.polygons.filter((p) => p.kind !== 'Poly_Circle').map((p) => ({ ring: p.ring, color: 'rgba(232,237,245,0.9)', fill: 'rgba(232,237,245,0.06)', width: 1.6 }));
  const showZones = outlines(globe, zones);
  // A moving thing that is not a storm (an iceberg, a plume): the storm
  // template's path, without its cloud, wind wording or wind zones.
  const plan = inc.track && inc.track.length > 1 ? await storm({ ...inc, reports: [] }, globe) : null; // drawn in this event's own colour
  if (plan) {
    plan.parts[0] = { kind: 'observed', text: `${inc.track.length} dated positions`, source: 'NASA EONET' };
    plan.parts.length = 2;
    if (zones.length) plan.parts.push({ kind: 'analysis', text: 'Affected-area outline', source: 'GDACS' });
    plan.key = [
      { mark: 'line', color: CATEGORIES[inc.category]?.color || PALETTE.context, text: 'Line: the path it took (NASA EONET), bold up to the moment shown' },
      { mark: 'dot', color: PALETTE.focus, text: 'White dot: where it was at the moment shown' },
      ...(zones.length ? [{ mark: 'outline', color: '#e8edf5', text: 'Outline: the affected area as published by GDACS' }] : []),
    ];
    const draw = plan.draw.bind(plan);
    plan.draw = (t, started, ms) => {
      draw(t, started, ms);
      showZones(started);
      globe.setVortex(null);
      globe.setLabels([]);
      globe.setEffectDots(plan.early ? [] : [{ lat: plan.at.lat, lon: plan.at.lon, color: [1, 1, 1], size: 9 }]);
    };
    plan.caption = () => (plan.over ? `Last position reported on ${day(inc.track[inc.track.length - 1].time)}` : stamp(plan.at?.time ?? inc.time));
    return plan;
  }
  if (!zones.length) return still(inc);
  return {
    from: inc.time,
    to: inc.endTime,
    timeOf: () => 0,
    frameKm: Math.max(100, reach({ lat: inc.lat, lon: inc.lon }, shapes.polygons.flatMap((p) => p.ring)) * 1.2),
    key: [{ mark: 'outline', color: '#e8edf5', text: 'Outline: the affected area as published by GDACS' }],
    parts: [{ kind: 'analysis', text: 'Affected-area outline', source: 'GDACS' }],
    draw(t, started) {
      showZones(started);
    },
    caption() {
      return 'Published affected area';
    },
  };
}

// An event the feeds give nothing more about than where and when. It still
// gets a timeline, because NISAR's passes over it are shown on one.
function still(inc) {
  return {
    from: inc.time,
    to: inc.endTime,
    timeOf: () => 0,
    frameKm: 180,
    parts: [{ kind: 'note', text: 'The feeds carry no history for this event beyond where and when it was reported.' }],
    draw() {},
    caption() {
      return 'Reported here';
    },
  };
}

const TEMPLATES = { earthquake: quake, storm, wildfire: fire, flood };

// ---------- player ----------

export class Replay {
  // onUpdate receives { state: 'loading' | 'playing' | 'paused' | 'off',
  // caption, progress, parts } and, for an event timeline, also
  // { timeline: true, ms, range, span, marks, live }.
  constructor(globe, onUpdate) {
    this.globe = globe;
    this.onUpdate = onUpdate;
    this.plan = null;
    this.token = 0;
    this.playing = false;
    this.time = 0;
    this.last = 0;
    this.loop = 0;
    this.loops = 0;
    // Event timeline: the real time shown, the range the bar covers, and
    // extra marks on it (NISAR passes).
    this.timeline = false;
    this.ms = 0;
    this.range = null;
    this.marks = [];
    this.pending = null;
    this.intro = false;
    this.abort = null;
  }

  // Opens an event on its latest state. With keepView the event is already
  // open and has new reports: its plan is rebuilt behind the one on screen
  // and swapped in, without touching the camera or showing "loading".
  async start(incident, { keepView = false } = {}) {
    const refresh = keepView && this.plan && this.timeline;
    const held = refresh ? { from: this.range.from, marks: this.marks } : null;
    if (!refresh) {
      this.stop();
      this.pending = null;
      this.onUpdate({ state: 'loading' });
    }
    const token = ++this.token;
    // Requests for an event that was closed in the meantime are dropped.
    if (!refresh) this.abort?.abort();
    this.abort = new AbortController();
    useSignal(this.abort.signal);
    let plan = null;
    try {
      plan = await (TEMPLATES[incident.category] || generic)(incident, this.globe);
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('Event history failed to load', err);
    }
    if (token !== this.token) return;
    if (!plan || !Number.isFinite(plan.from) || !Number.isFinite(plan.to)) plan = still(incident);
    if (refresh && this.plan) {
      this.plan.teardown?.();
      this.globe.clearEffects();
    }
    this.plan = plan;
    this.timeline = true;
    const now = Date.now();
    // The bar always runs to now, so passes after the event have a place.
    // It also reaches back at least two weeks, so a fresh event is not a
    // bar with nothing on it.
    this.range = { from: Math.min(plan.from - DAY, now - 14 * DAY), to: now };
    this.marks = [];
    this.ms = now;
    this.intro = !!plan.intro && !refresh;
    this.time = 0;
    this.playing = this.intro;
    plan.setup?.();
    this.loop = ++this.loops;
    const focus = plan.focus || incident;
    if (!refresh) this.globe.flyTo(focus.lat, focus.lon, Math.min(9_000_000, plan.frameKm * 1000 * 3.4), { pitch: plan.frameKm < 400 ? 40 : 15 });
    this.globe.setFocus({ lat: focus.lat, lon: focus.lon, radiusKm: plan.frameKm * 1.15 });
    if (!this.intro) this.show();
    // The reach and marks asked for while this was loading, or the ones the
    // plan being replaced had. Only now is everything they need in place.
    const wanted = this.pending || held;
    this.pending = null;
    if (wanted) {
      if (wanted.from != null) this.range.from = Math.min(this.range.from, wanted.from);
      this.marks = wanted.marks || [];
    }
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t, this.loop));
    this.report();
  }

  // Plays a plan built elsewhere, in a loop (the NISAR time-lapse).
  run(plan) {
    this.stop();
    this.plan = plan;
    this.timeline = false;
    this.time = 0;
    this.playing = true;
    plan.setup?.();
    this.loop = ++this.loops;
    this.last = performance.now();
    requestAnimationFrame((now) => this.tick(now, this.loop));
  }

  // Makes the timeline reach back to `from` and puts marks on it. Works
  // before the event's own history has loaded, too.
  extend(from, marks) {
    if (!this.plan || !this.timeline) {
      this.pending = { from, marks };
      return;
    }
    if (from != null) this.range.from = Math.min(this.range.from, from);
    this.marks = marks || [];
    this.report();
  }

  get live() {
    return this.timeline && !this.intro && this.ms >= this.range.to - 60_000;
  }

  // Draws the event as it stood at this.ms.
  show() {
    const plan = this.plan;
    plan.draw(plan.timeOf(this.ms), this.ms >= plan.from, this.ms);
    this.globe.dirty = true;
  }

  toggle() {
    if (!this.plan) return;
    if (this.timeline && this.intro) {
      // Pressed during the opening: skip it and stand on the latest state.
      this.intro = false;
      this.playing = false;
      this.show();
      return this.report();
    }
    if (this.timeline) {
      // Play runs once, from wherever the handle is; from the end it
      // starts over at the beginning.
      if (!this.playing && this.live) this.ms = this.range.from;
      this.playing = !this.playing;
    } else {
      this.playing = !this.playing;
    }
    this.last = performance.now();
    this.report();
  }

  // Jumps to a fraction (0..1) of the timeline or of the looping plan.
  seek(fraction) {
    if (!this.plan) return;
    const f = Math.max(0, Math.min(1, fraction));
    if (this.timeline) {
      this.intro = false;
      this.playing = false;
      this.ms = this.range.from + f * (this.range.to - this.range.from);
      this.show();
    } else {
      this.time = f * this.plan.duration;
      this.plan.draw(this.time);
    }
    this.report();
  }

  stop() {
    this.token++;
    this.abort?.abort();
    if (this.plan) {
      this.plan.teardown?.();
      this.globe.clearEffects();
    }
    this.plan = null;
    this.playing = false;
    this.timeline = false;
    this.intro = false;
    this.onUpdate({ state: 'off' });
  }

  tick(now, loop) {
    const plan = this.plan;
    // A newer plan has its own loop; this one ends.
    if (!plan || loop !== this.loop) return;
    requestAnimationFrame((next) => this.tick(next, loop));
    // The first frame's clock can read slightly before the start time.
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    if (!this.playing) return;
    if (!this.timeline) {
      this.time += dt;
      if (this.time > plan.duration + HOLD) this.time = 0;
      plan.draw(Math.min(this.time, plan.duration));
    } else if (this.intro) {
      // The opening moment, once; then the latest state.
      this.time += dt;
      plan.draw(Math.min(this.time, plan.intro), true, plan.from);
      if (this.time >= plan.intro + 1) {
        this.intro = false;
        this.playing = false;
        this.show();
      }
    } else {
      this.ms += (dt / PLAY_SECONDS) * (this.range.to - this.range.from);
      if (this.ms >= this.range.to) {
        this.ms = this.range.to;
        this.playing = false;
      }
      this.show();
    }
    this.globe.dirty = true;
    this.report();
  }

  report() {
    const plan = this.plan;
    if (!plan) return;
    if (!this.timeline) {
      const t = Math.min(this.time, plan.duration);
      return this.onUpdate({ state: this.playing ? 'playing' : 'paused', caption: plan.caption(t), progress: t / plan.duration, parts: plan.parts, plan });
    }
    const { from, to } = this.range;
    const at = (ms) => Math.max(0, Math.min(1, (ms - from) / (to - from)));
    const caption = this.intro ? plan.caption(Math.min(this.time, plan.intro)) : this.ms < plan.from ? 'Before the event' : plan.caption(plan.timeOf(this.ms));
    this.onUpdate({
      state: this.playing ? 'playing' : 'paused',
      timeline: true,
      caption,
      ms: this.intro ? plan.from : this.ms,
      progress: at(this.intro ? plan.from : this.ms),
      span: [at(plan.from), at(Math.max(plan.to, plan.from))],
      marks: this.marks.map(at),
      range: this.range,
      live: this.live,
      intro: this.intro,
      parts: plan.parts,
      plan,
    });
  }
}
