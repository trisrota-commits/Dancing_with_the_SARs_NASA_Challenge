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
export function sunDirection(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date - start) / 86400_000;
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return toVec(lat, (12 - hours) * 15);
}

// CSS hex colour to 0..1 components, left in sRGB because the shaders pass
// colours straight through.
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
