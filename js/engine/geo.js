// Coordinate helpers. The globe is a unit sphere: north is +y, longitude 0
// faces +z and longitude 90°E faces +x.

import * as THREE from '../../vendor/three.module.min.js';

export const RAD = Math.PI / 180;
export const EARTH_RADIUS_M = 6_371_000;

export function toVec(lat, lon, radius = 1, out = new THREE.Vector3()) {
  const phi = lat * RAD;
  const lam = lon * RAD;
  const c = Math.cos(phi) * radius;
  return out.set(c * Math.sin(lam), Math.sin(phi) * radius, c * Math.cos(lam));
}

export function toLatLon(v) {
  const r = v.length();
  return { lat: Math.asin(v.y / r) / RAD, lon: Math.atan2(v.x, v.z) / RAD };
}

// Web Mercator tile edges.
export const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
export const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / RAD;

// Shortest signed difference between two longitudes, in degrees.
export const lonDelta = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

// Points along the great circle from a to b, optionally lifted off the surface.
export function greatCircle(a, b, steps, radius = 1, lift = 0) {
  const va = toVec(a.lat, a.lon);
  const vb = toVec(b.lat, b.lon);
  const angle = va.angleTo(vb);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = new THREE.Vector3();
    if (angle < 1e-6) v.copy(va);
    else {
      const s = Math.sin(angle);
      v.copy(va).multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(vb, Math.sin(t * angle) / s);
    }
    out.push(v.multiplyScalar(radius + Math.sin(Math.PI * t) * lift * angle));
  }
  return out;
}

// Where the sun is overhead right now (good to about a degree).
// Direction to the Sun in Earth-fixed coordinates, from the NOAA solar
// position equations (declination and equation of time, good to a few
// arc-minutes), so the day/night line sits where it really is.
export function sunDirection(date = new Date()) {
  const jd = date.getTime() / 86400_000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime =
    (4 / RAD) *
    (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const lon = -(minutes + eqTime - 720) / 4;
  return toVec(decl, ((lon + 540) % 360) - 180);
}

// CSS hex colour to 0..1 components, left in sRGB because the shaders pass
// colours straight through.
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
