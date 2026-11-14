// Where NISAR is right now, from its public orbit elements (a "TLE", the
// two-line element set published for every tracked satellite), propagated
// with the standard SGP4 model (satellite.js). Accurate to a few kilometres
// for elements a few days old: fine for a globe, not for navigation.

import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from '../vendor/satellite.es.js';

// NISAR facts for the panel (NASA/JPL and ASF mission pages).
export const NISAR_ORBIT = {
  altitudeKm: 747,
  inclinationDeg: 98.4,
  periodMin: 100,
  repeatDays: 12,
  swathKm: 242,
  // The radar looks to the left of the flight direction. Near and far edges
  // of the swath on the ground, from the 747 km altitude and the ~30–42°
  // look angles that give a 242 km swath. Approximate.
  swathNearKm: 430,
  swathFarKm: 672,
};

const SOURCES = [
  {
    label: 'CelesTrak',
    url: 'https://celestrak.org/NORAD/elements/gp.php?NAME=NISAR&FORMAT=TLE',
    parse: (text) => {
      const lines = text.trim().split(/\r?\n/).map((l) => l.trim());
      const i = lines.findIndex((l) => l.startsWith('1 '));
      return i >= 0 && lines[i + 1]?.startsWith('2 ') ? { name: lines[i - 1] || 'NISAR', line1: lines[i], line2: lines[i + 1] } : null;
    },
  },
  {
    label: 'TLE API',
    url: 'https://tle.ivanstanojevic.me/api/tle/?search=NISAR',
    parse: (text) => {
      const m = JSON.parse(text).member?.find((s) => /NISAR/i.test(s.name));
      return m ? { name: m.name, line1: m.line1, line2: m.line2 } : null;
    },
  },
];

// The newest public elements for NISAR, or null when no source answers.
export async function fetchElements() {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url);
      if (!res.ok) continue;
      const tle = source.parse(await res.text());
      if (tle) return { ...tle, source: source.label, satrec: twoline2satrec(tle.line1, tle.line2) };
    } catch {
      /* try the next source */
    }
  }
  return null;
}

// Epoch of the elements, as a Date.
export function elementsEpoch(satrec) {
  const year = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr;
  return new Date(Date.UTC(year, 0, 1) + (satrec.epochdays - 1) * 86400_000);
}

// { lat, lon, altKm, speedKms } at a moment, or null if propagation fails.
export function positionAt(satrec, date = new Date()) {
  const pv = propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const geo = eciToGeodetic(pv.position, gstime(date));
  const v = pv.velocity;
  return {
    lat: degreesLat(geo.latitude),
    lon: degreesLong(geo.longitude),
    altKm: geo.height,
    speedKms: Math.hypot(v.x, v.y, v.z),
  };
}

// Ground track from `back` minutes ago to `ahead` minutes ahead.
export function groundTrack(satrec, date = new Date(), back = 50, ahead = 50, stepMin = 1) {
  const out = [];
  for (let m = -back; m <= ahead; m += stepMin) {
    const p = positionAt(satrec, new Date(date.getTime() + m * 60_000));
    if (p) out.push({ ...p, minutes: m });
  }
  return out;
}

const RAD = Math.PI / 180;
const EARTH_KM = 6371;

function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return Math.atan2(y, x);
}

// The point `km` away from p along a compass bearing (radians).
export function destination(p, brg, km) {
  const d = km / EARTH_KM;
  const lat1 = p.lat * RAD;
  const lon1 = p.lon * RAD;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / RAD, lon: ((((lon2 / RAD) + 540) % 360) - 180) };
}

// Near and far edges of the radar swath, to the left of the flight direction.
export function swathEdges(track) {
  const near = [];
  const far = [];
  for (let i = 0; i < track.length; i++) {
    const a = track[Math.max(0, i - 1)];
    const b = track[Math.min(track.length - 1, i + 1)];
    const left = bearing(a, b) - Math.PI / 2;
    near.push(destination(track[i], left, NISAR_ORBIT.swathNearKm));
    far.push(destination(track[i], left, NISAR_ORBIT.swathFarKm));
  }
  return { near, far };
}
