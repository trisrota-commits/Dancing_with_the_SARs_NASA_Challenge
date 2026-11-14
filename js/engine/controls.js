// Camera control for a globe, in the style of Google Earth: the camera
// orbits a point on the ground. Drag pans, wheel or pinch zooms, and
// right-drag (or Ctrl/Shift-drag, or a two-finger vertical drag) tilts and
// turns the view.

import * as THREE from '../../vendor/three.module.min.js';
import { RAD, toVec, lonDelta } from './geo.js';

const MIN_RANGE = 1.2e-4; // about 750 m from the point being looked at
const MAX_RANGE = 9;
const MAX_PITCH = 80;
const CLEARANCE = 4e-5; // the camera stays about 250 m above the ground

export class GlobeControls {
  constructor(camera, element) {
    this.camera = camera;
    this.element = element;
    this.lat = 15;
    this.lon = 20;
    this.alt = 3.8; // distance from the target point, in Earth radii
    this.pitch = 0; // 0 looks straight down
    this.heading = 0; // 0 has north at the top
    this.ground = 0;
    this.groundAt = null; // (lat, lon) => height in Earth radii
    this.velocity = { lat: 0, lon: 0 };
    this.flight = null;
    this.spin = true;
    this.moved = true;
    this.onTap = null;
    this.pointers = new Map();
    this.pinch = 0;
    this.travel = 0;
    this.tilting = false;

    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', (e) => this.down(e));
    element.addEventListener('pointermove', (e) => this.move(e));
    element.addEventListener('pointerup', (e) => this.up(e));
    element.addEventListener('pointercancel', (e) => this.up(e));
    element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    element.addEventListener('dblclick', () => this.zoomBy(0.45));
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    this.apply();
  }

  // Degrees of latitude that one screen pixel covers at the target.
  degreesPerPixel() {
    const view = 2 * this.alt * Math.tan((this.camera.fov * RAD) / 2);
    return Math.min(view / this.element.clientHeight / RAD, 0.35);
  }

  stop() {
    this.spin = false;
    this.flight = null;
    this.velocity.lat = this.velocity.lon = 0;
  }

  down(e) {
    this.element.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.stop();
    this.travel = 0;
    this.tilting = e.button === 2 || e.ctrlKey || e.shiftKey;
    if (this.pointers.size === 2) this.pinch = this.spread();
  }

  spread() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.travel += Math.abs(dx) + Math.abs(dy);

    if (this.pointers.size === 2) {
      // Two fingers: spreading zooms, sliding together up or down tilts.
      const spread = this.spread();
      if (this.pinch > 0 && spread > 0) this.alt = Math.max(MIN_RANGE, Math.min(MAX_RANGE, (this.alt * this.pinch) / spread));
      this.pinch = spread;
      this.pitch -= dy * 0.15;
      this.apply();
      return;
    }
    if (this.tilting) {
      this.heading -= dx * 0.3;
      this.pitch -= dy * 0.3;
      this.apply();
      return;
    }
    // Pan along the ground, following the way the view is turned.
    const k = this.degreesPerPixel();
    const h = this.heading * RAD;
    const forward = (dy * k) / Math.max(0.3, Math.cos(this.pitch * RAD));
    const right = -dx * k;
    const dLat = forward * Math.cos(h) - right * Math.sin(h);
    const dLon = (forward * Math.sin(h) + right * Math.cos(h)) / Math.max(0.2, Math.cos(this.lat * RAD));
    this.lat += dLat;
    this.lon += dLon;
    this.velocity.lat = dLat;
    this.velocity.lon = dLon;
    this.apply();
  }

  up(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    this.pinch = 0;
    if (this.tilting) this.velocity.lat = this.velocity.lon = 0;
    if (this.travel < 6 && this.pointers.size === 0 && this.onTap && e.button !== 2) {
      this.velocity.lat = this.velocity.lon = 0;
      this.onTap(e);
    }
  }

  wheel(e) {
    e.preventDefault();
    this.stop();
    const step = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoomBy(Math.exp(Math.max(-150, Math.min(150, step)) * 0.0022));
  }

  zoomBy(factor) {
    this.alt = Math.max(MIN_RANGE, Math.min(MAX_RANGE, this.alt * factor));
    this.apply();
  }

  // Glides to a new view. pitch and heading are optional.
  flyTo(lat, lon, alt, seconds = 1.6, { pitch = this.pitch, heading = this.heading } = {}) {
    this.stop();
    const turn = Math.hypot(lat - this.lat, lonDelta(lon, this.lon)) * RAD;
    const to = Math.max(MIN_RANGE, Math.min(MAX_RANGE, alt));
    this.flight = {
      from: { lat: this.lat, lon: this.lon, alt: this.alt, pitch: this.pitch, heading: this.heading },
      to: { lat, lon: this.lon + lonDelta(lon, this.lon), alt: to, pitch, heading: this.heading + lonDelta(heading, this.heading) },
      // Rise on long hops so the trip reads as a flight, not a teleport.
      rise: Math.max(0, turn * 0.6 - Math.max(this.alt, to)),
      t: 0,
      seconds,
    };
  }

  // Advances inertia, spin and flights. Returns true when the view changed.
  update(dt) {
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.seconds);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      const mix = (a, b) => a + (b - a) * e;
      this.lat = mix(f.from.lat, f.to.lat);
      this.lon = mix(f.from.lon, f.to.lon);
      this.pitch = mix(f.from.pitch, f.to.pitch);
      this.heading = mix(f.from.heading, f.to.heading);
      this.alt = Math.exp(mix(Math.log(f.from.alt), Math.log(f.to.alt))) + Math.sin(Math.PI * e) * f.rise;
      if (f.t >= 1) this.flight = null;
      this.apply();
    } else if (this.spin) {
      this.lon += dt * 2.2;
      this.apply();
    } else if (this.pointers.size === 0 && (Math.abs(this.velocity.lat) > 1e-5 || Math.abs(this.velocity.lon) > 1e-5)) {
      this.lat += this.velocity.lat;
      this.lon += this.velocity.lon;
      const drag = Math.pow(0.002, dt);
      this.velocity.lat *= drag;
      this.velocity.lon *= drag;
      this.apply();
    }
    // Follow the ground under the target as terrain data streams in.
    if (this.groundAt) {
      const ground = this.groundAt(this.lat, this.lon);
      if (Math.abs(ground - this.ground) > 1e-7) {
        this.ground += (ground - this.ground) * Math.min(1, dt * 6);
        this.apply();
      }
    }
    const moved = this.moved;
    this.moved = false;
    return moved;
  }

  apply() {
    this.lat = Math.max(-89.5, Math.min(89.5, this.lat));
    this.lon = ((((this.lon + 180) % 360) + 360) % 360) - 180;
    this.pitch = Math.max(0, Math.min(MAX_PITCH, this.pitch));
    this.heading = ((((this.heading + 180) % 360) + 360) % 360) - 180;

    const cam = this.camera;
    toVec(this.lat, this.lon, 1, up);
    north.set(0, 1, 0).addScaledVector(up, -up.y).normalize();
    east.crossVectors(north, up);
    const h = this.heading * RAD;
    const p = this.pitch * RAD;
    forward.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    target.copy(up).multiplyScalar(1 + this.ground);
    cam.position.copy(target).addScaledVector(up, this.alt * Math.cos(p)).addScaledVector(forward, -this.alt * Math.sin(p));

    // Keep the camera out of the mountains.
    let height = cam.position.length() - 1;
    if (this.groundAt && this.pitch > 0) {
      const dist = cam.position.length();
      const floor = this.groundAt(Math.asin(cam.position.y / dist) / RAD, Math.atan2(cam.position.x, cam.position.z) / RAD) + CLEARANCE;
      if (height < floor) {
        cam.position.setLength(1 + floor);
        height = floor;
      }
    }
    cam.up.copy(forward);
    cam.lookAt(target);

    // Depth range from just in front of the ground to the horizon.
    const reach = Math.max(1e-6, Math.min(height - this.ground, this.alt));
    cam.near = Math.max(1e-7, reach * 0.05);
    cam.far = Math.sqrt((1 + height) ** 2 - 1) * 1.05 + Math.min(0.5, height + 0.01);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.moved = true;
  }
}

const up = new THREE.Vector3();
const north = new THREE.Vector3();
const east = new THREE.Vector3();
const forward = new THREE.Vector3();
const target = new THREE.Vector3();
