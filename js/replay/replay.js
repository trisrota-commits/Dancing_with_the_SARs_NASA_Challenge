// Event replays: a short looping animation of what happened at the selected
// event, built only from data. Each kind of event has one template whose
// parameters (where, how big, how strong, when) are filled from the feeds.
//
// Every element says where it comes from:
//   observed  – measured by an instrument or catalogued by an agency
//   analysis  – an area or zone an agency worked out and published
//   computed  – drawn here by a stated rule, to connect the data points

import { OVERLAYS } from '../config.js';
import { distanceKm } from '../incidents.js';
import { rgb, lonDelta } from '../engine/geo.js';
import { gdacsShapes, shakeContours, quakesNear, fireDetections, dateRange } from './sources.js';

const DAY = 86400_000;
const HOLD = 2.5; // seconds the final picture stays before the loop restarts
const ORBIT = 2.5; // degrees per second the camera circles a replay
const PUSH_IN = 0.6; // how much closer the camera drifts while a replay plays

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

// The colour scale seismologists use for shaking intensity.
function intensityColor(v) {
  const stops = [
    [3, '#a0e6ff'],
    [4, '#80ffff'],
    [5, '#7aff93'],
    [6, '#ffff00'],
    [7, '#ffc800'],
    [8, '#ff9100'],
    [9, '#ff0000'],
  ];
  let hex = stops[0][1];
  for (const [at, c] of stops) if (v >= at) hex = c;
  return hex;
}

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

  return {
    duration: WAVE + AFTER + 0.5,
    frameKm: rmax * 1.3,
    parts: [
      { kind: 'observed', text: `Epicentre, magnitude ${mag.toFixed(1)} and time`, source: 'USGS' },
      zones.length
        ? { kind: 'analysis', text: `Shaking intensity outlines, levels ${Math.min(...zones.map((z) => z.value))} to ${Math.max(...zones.map((z) => z.value))}`, source: zoneSource }
        : { kind: 'note', text: 'No shaking map has been published for this earthquake.' },
      { kind: 'computed', text: `Wave fronts at typical crust speeds (P 6 km/s, S 3.5 km/s), played ${speedup}× faster than real time. The glow and ripple on the ground mark where the fronts are; their brightness and height are not to scale.` },
      { kind: 'observed', text: `${after.length} later and ${before.length} earlier quakes of M2.5+ within ${radius} km (30 days back)`, source: 'USGS catalogue' },
    ],
    draw(t) {
      const s = Math.min(1, t / WAVE) * rmax;
      const lines = [];
      if (t < WAVE + 1) {
        const fade = 1 - Math.max(0, t - WAVE);
        lines.push({ points: circle(centre, Math.max(1, s)), color: [1, 0.32, 0.28, 0.95 * fade], closed: true });
        lines.push({ points: circle(centre, Math.max(1, Math.min(s * (6 / 3.5), rmax * 1.72))), color: [1, 1, 1, 0.5 * fade], closed: true });
      }
      if (lines.length || this.hadLines) globe.setEffectLines(lines);
      this.hadLines = lines.length > 0;
      // The same two fronts, drawn into the terrain itself.
      const fade = Math.max(0, Math.min(1, 1 - (t - WAVE)));
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
        globe.setEffectDots([...before.map((q) => dot(q, [0.62, 0.66, 0.72])), ...after.slice(0, nAfter).map((q, i) => dot(q, [1, 0.62, 0.2], popped[i]))]);
      }
      this.now = now;
      this.count = nAfter;
      const labels = [
        ...levelLabels.filter((l) => t >= WAVE || l.km <= s),
        ...after.slice(0, nAfter).filter((q) => named.has(q)).map((q) => ({ lat: q.lat, lon: q.lon, text: `M ${q.mag.toFixed(1)}`, color: '#ffb066', within: closer })),
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
  const color = rgb('#b48cff');
  const zoneStyle = { Poly_Green: '#4ade80', Poly_Orange: '#ffa62b', Poly_Red: '#ff5a4f' };
  const zones = shapes.polygons.filter((p) => zoneStyle[p.kind]).map((p) => ({ ring: p.ring, color: rgba(zoneStyle[p.kind], 0.8), fill: rgba(zoneStyle[p.kind], 0.1), width: 1.4 }));
  const t0 = track[0].time;
  const t1 = track[track.length - 1].time;
  const centre = track[Math.floor(track.length / 2)];
  const peak = Math.max(...track.map((p) => p.value || 0));

  return {
    duration: 12,
    frameKm: Math.max(300, reach(centre, track) * 1.2),
    focus: centre,
    parts: [
      { kind: timing, text: timing === 'observed' ? `${track.length} dated position fixes${peak ? ` with wind speed (peak ${Math.round(peak)} kt)` : ''}` : 'Track line, with timing spread evenly along it', source: timing === 'observed' ? 'NASA EONET' : 'GDACS' },
      { kind: 'computed', text: 'Position between fixes is a straight blend' },
      { kind: 'computed', text: 'Cloud spiral: its radius (120 to 500 km) and spin follow the wind speed by a fixed rule. It is not a satellite image or the storm\'s measured extent.' },
      ...(zones.length ? [{ kind: 'analysis', text: 'Wind-speed zones (green, orange, red)', source: 'GDACS' }] : []),
    ],
    setup() {
      globe.setEffectZones(zones);
    },
    draw(t) {
      const at = along(track, t0 + (Math.min(t, 12) / 12) * (t1 - t0));
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
      globe.setLabels(at.value ? [{ lat: Math.min(89, at.lat + radiusKm / 111), lon: at.lon, text: `${Math.round(at.value * 1.852)} km/h · ${stormClass(at.value)}`, color: '#d9c6ff' }] : []);
    },
    caption() {
      const a = this.at;
      const wind = a?.value ? ` · ${Math.round(a.value)} kt (${Math.round(a.value * 1.852)} km/h) · ${stormClass(a.value)}` : '';
      return `${stamp(a?.time ?? t0)}${wind}`;
    },
  };
}

async function fire(inc, globe) {
  const centre = { lat: inc.lat, lon: inc.lon };
  const shapes = await gdacsShapes(inc).catch(() => ({ polygons: [], lines: [] }));
  const burnt = shapes.polygons.filter((p) => p.kind === 'Poly_area');
  const radius = Math.min(150, Math.max(60, burnt.length ? reach(centre, burnt.flatMap((b) => b.ring)) + 25 : 60));
  const dates = dateRange(Math.max(inc.time - DAY, Date.now() - 15 * DAY), Date.now() - DAY, 15);
  const days = await fireDetections(inc.lat, inc.lon, radius, dates);
  const total = days.reduce((n, d) => n + d.points.length, 0);
  const STEP = 1.1;

  return {
    duration: days.length * STEP,
    frameKm: radius * 1.1,
    parts: [
      total
        ? { kind: 'observed', text: `${total} active-fire detections over ${days.length} days within ${Math.round(radius)} km`, source: 'VIIRS on NOAA-20, NASA GIBS' }
        : { kind: 'note', text: `No satellite fire detections within ${Math.round(radius)} km in the last ${days.length} days.` },
      ...(burnt.length ? [{ kind: 'analysis', text: 'Burnt-area outline', source: 'GDACS / GWIS' }] : []),
      { kind: 'computed', text: 'Each detection glows at the sensor\'s 375 m pixel size, fades in during its day (the satellite gives the day, not the hour) and cools to dark red over about three days. Nothing is drawn between detections.' },
      { kind: 'computed', text: 'Closer in, each spot sits on the exact position of its detection at true size, reddest at its centre. The shape of the glow, its shimmer and the thin smoke are animation, not measurements; the smoke rises straight up because the feeds carry no wind.' },
    ],
    setup() {
      globe.setEffectZones(burnt.map((b) => ({ ring: b.ring, color: 'rgba(255,166,43,0.95)', fill: 'rgba(255,166,43,0.07)', width: 2 })));
      // Every detection is handed over once, with the moment it ignites on
      // the replay clock: spread through the first part of its day, in an
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
    draw(t) {
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
  const dates = dateRange(Math.max(inc.time - 4 * DAY, Date.now() - 22 * DAY), Date.now(), 22).filter((_, i, all) => (all.length - 1 - i) % 2 === 0);
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

  return {
    duration: dates.length * STEP,
    frameKm: Math.min(600, Math.max(120, area.length ? reach(centre, area.flatMap((a) => a.ring)) * 1.2 : 150)),
    parts: [
      { kind: 'observed', text: `Water the radar saw on land (blue), building up pass by pass from ${dates[0]}. Rivers and lakes that are always there show too.`, source: 'OPERA DSWx, Sentinel-1' },
      ...(area.length ? [{ kind: 'analysis', text: 'Affected-area outline', source: 'GDACS' }] : []),
      { kind: 'note', text: 'Radar passes come every few days, so water appears in strips as each pass arrives.' },
      { kind: 'computed', text: 'Each patch of water fades in at the first pass that saw it. The ripples and the waves along its edge are animation: the radar gives where water was on each pass, not how it moved.' },
    ],
    setup() {
      globe.setEffectZones(area.map((a) => ({ ring: a.ring, color: 'rgba(63,167,255,0.95)', fill: 'rgba(63,167,255,0.06)', width: 2 })));
      // Every pass is handed over once, marked with its step; the terrain
      // shader then lets the water arrive as the replay clock passes it.
      globe.setWater(0, dates.length);
      globe.setEffectLayers(dates.map((date, i) => ({ url: water.url.replace('{date}', date), maxLevel: water.maxLevel, bounds, keep: isWater, tint: [255, Math.round((255 * i) / dates.length), 0], mask: i })));
    },
    draw(t) {
      this.index = Math.min(dates.length - 1, Math.floor(t / STEP));
      globe.setWater(t / STEP, dates.length);
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
  if (inc.track && inc.track.length > 1) {
    const plan = await storm({ ...inc, reports: [] }, globe);
    plan.parts[0] = { kind: 'observed', text: `${inc.track.length} dated positions`, source: 'NASA EONET' };
    plan.parts.length = 2;
    const draw = plan.draw.bind(plan);
    plan.draw = (t) => {
      draw(t);
      globe.setVortex(null);
      globe.setLabels([]);
      globe.setEffectDots([{ lat: plan.at.lat, lon: plan.at.lon, color: [1, 1, 1], size: 9 }]);
    };
    return plan;
  }
  if (!zones.length) return null;
  return {
    duration: 3,
    frameKm: Math.max(100, reach({ lat: inc.lat, lon: inc.lon }, shapes.polygons.flatMap((p) => p.ring)) * 1.2),
    parts: [{ kind: 'analysis', text: 'Affected-area outline', source: 'GDACS' }],
    setup() {
      globe.setEffectZones(zones);
    },
    draw() {},
    caption() {
      return 'Published affected area';
    },
  };
}

const TEMPLATES = { earthquake: quake, storm, wildfire: fire, flood };

// ---------- player ----------

export class Replay {
  // onUpdate receives { state: 'loading' | 'playing' | 'paused' | 'none' | 'off', caption, progress, parts }
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
  }

  async start(incident) {
    this.stop();
    const token = ++this.token;
    this.onUpdate({ state: 'loading' });
    let plan = null;
    try {
      plan = await (TEMPLATES[incident.category] || generic)(incident, this.globe);
    } catch (err) {
      console.warn('Replay failed to load', err);
    }
    if (token !== this.token) return;
    if (!plan) return this.onUpdate({ state: 'none' });
    this.plan = plan;
    this.time = 0;
    this.playing = true;
    this.globe.animating = true;
    plan.setup?.();
    this.loop = ++this.loops;
    const focus = plan.focus || incident;
    this.globe.flyTo(focus.lat, focus.lon, Math.min(9_000_000, plan.frameKm * 1000 * 3.4), { pitch: plan.frameKm < 400 ? 40 : 15 });
    this.globe.setOrbit(ORBIT);
    this.globe.pushIn(PUSH_IN);
    this.globe.setFocus({ lat: focus.lat, lon: focus.lon, radiusKm: plan.frameKm * 1.15 });
    this.last = performance.now();
    requestAnimationFrame((now) => this.tick(now, this.loop));
  }

  // Plays a plan built elsewhere (the NISAR time-lapse uses this).
  run(plan) {
    this.stop();
    this.plan = plan;
    this.time = 0;
    this.playing = true;
    this.globe.animating = true;
    plan.setup?.();
    this.loop = ++this.loops;
    this.last = performance.now();
    requestAnimationFrame((now) => this.tick(now, this.loop));
  }

  toggle() {
    if (!this.plan) return;
    this.playing = !this.playing;
    this.last = performance.now();
    this.report();
  }

  // Jumps to a fraction (0..1) of the replay.
  seek(fraction) {
    if (!this.plan) return;
    this.time = Math.max(0, Math.min(1, fraction)) * this.plan.duration;
    this.plan.draw(this.time);
    this.report();
  }

  stop() {
    this.token++;
    if (this.plan) {
      this.plan.teardown?.();
      this.globe.clearEffects();
    }
    this.plan = null;
    this.playing = false;
    this.onUpdate({ state: 'off' });
  }

  tick(now, loop) {
    const plan = this.plan;
    // A newer replay has its own loop; this one ends.
    if (!plan || loop !== this.loop) return;
    requestAnimationFrame((next) => this.tick(next, loop));
    // The first frame's clock can read slightly before the start time.
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    if (!this.playing) return;
    this.time += dt;
    if (this.time > plan.duration + HOLD) this.time = 0;
    plan.draw(Math.min(this.time, plan.duration));
    this.globe.dirty = true;
    this.report();
  }

  report() {
    const plan = this.plan;
    const t = Math.min(this.time, plan.duration);
    this.onUpdate({ state: this.playing ? 'playing' : 'paused', caption: plan.caption(t), progress: t / plan.duration, parts: plan.parts, plan });
  }
}
