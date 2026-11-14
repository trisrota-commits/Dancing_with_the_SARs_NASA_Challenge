// Camera control for a globe: drag to turn, wheel or pinch to zoom, with a
// little inertia. The camera always looks at the centre of the Earth.

import { RAD, toVec, lonDelta } from './geo.js';

const MIN_ALT = 1.5e-4; // about 1 km above the surface, in Earth radii
const MAX_ALT = 9;

export class GlobeControls {
  constructor(camera, element) {
    this.camera = camera;
    this.element = element;
    this.lat = 15;
    this.lon = 20;
    this.alt = 3.8;
    this.velocity = { lat: 0, lon: 0 };
    this.flight = null;
    this.spin = true;
    this.moved = true;
    this.onTap = null;
    this.pointers = new Map();
    this.pinch = 0;
    this.travel = 0;

    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', (e) => this.down(e));
    element.addEventListener('pointermove', (e) => this.move(e));
    element.addEventListener('pointerup', (e) => this.up(e));
    element.addEventListener('pointercancel', (e) => this.up(e));
    element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    element.addEventListener('dblclick', () => this.zoomBy(0.45));
    this.apply();
  }

  // Degrees of latitude that one screen pixel covers under the cursor.
  degreesPerPixel() {
    const view = 2 * this.alt * Math.tan((this.camera.fov * RAD) / 2);
    return Math.min(view / this.element.clientHeight / RAD, 0.35);
  }

  down(e) {
    this.element.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.spin = false;
    this.flight = null;
    this.velocity.lat = this.velocity.lon = 0;
    this.travel = 0;
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
      const spread = this.spread();
      if (this.pinch > 0 && spread > 0) this.zoomBy(this.pinch / spread);
      this.pinch = spread;
      return;
    }
    const k = this.degreesPerPixel();
    const dLat = dy * k;
    const dLon = (-dx * k) / Math.max(0.2, Math.cos(this.lat * RAD));
    this.lat += dLat;
    this.lon += dLon;
    this.velocity.lat = dLat;
    this.velocity.lon = dLon;
    this.apply();
  }

  up(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    this.pinch = 0;
    if (this.travel < 6 && this.pointers.size === 0 && this.onTap) {
      this.velocity.lat = this.velocity.lon = 0;
      this.onTap(e);
    }
  }

  wheel(e) {
    e.preventDefault();
    this.spin = false;
    this.flight = null;
    const step = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoomBy(Math.exp(Math.max(-150, Math.min(150, step)) * 0.0022));
  }

  zoomBy(factor) {
    this.alt = Math.max(MIN_ALT, Math.min(MAX_ALT, this.alt * factor));
    this.apply();
  }

  flyTo(lat, lon, alt, seconds = 1.6) {
    this.spin = false;
    this.velocity.lat = this.velocity.lon = 0;
    const turn = Math.hypot(lat - this.lat, lonDelta(lon, this.lon)) * RAD;
    this.flight = {
      from: { lat: this.lat, lon: this.lon, alt: this.alt },
      to: { lat, lon: this.lon + lonDelta(lon, this.lon), alt: Math.max(MIN_ALT, Math.min(MAX_ALT, alt)) },
      // Rise on long hops so the trip reads as a flight, not a teleport.
      rise: Math.max(0, turn * 0.6 - Math.max(this.alt, alt)),
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
      this.lat = f.from.lat + (f.to.lat - f.from.lat) * e;
      this.lon = f.from.lon + (f.to.lon - f.from.lon) * e;
      this.alt = Math.exp(Math.log(f.from.alt) + (Math.log(f.to.alt) - Math.log(f.from.alt)) * e) + Math.sin(Math.PI * e) * f.rise;
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
    const moved = this.moved;
    this.moved = false;
    return moved;
  }

  apply() {
    this.lat = Math.max(-89.5, Math.min(89.5, this.lat));
    this.lon = ((((this.lon + 180) % 360) + 360) % 360) - 180;
    const cam = this.camera;
    toVec(this.lat, this.lon, 1 + this.alt, cam.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    // Tight depth range: from just in front of the surface to the horizon.
    const d = 1 + this.alt;
    cam.near = Math.max(1e-6, this.alt * 0.2);
    cam.far = Math.sqrt(d * d - 1) + 1.5;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.moved = true;
  }
}
