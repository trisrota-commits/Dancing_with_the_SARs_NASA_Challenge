// Camera control for a globe, in the style of Google Earth: the camera
// orbits a point on the ground. Drag pans, wheel or pinch zooms. The view
// is tilted only by the 3D button (flyTo with a pitch), never by a drag:
// a right-drag, a Ctrl- or Shift-drag and a two-finger drag used to tilt
// and turn the view, and on a trackpad that happened by accident and left
// the globe hanging off the middle of the screen with no sign of why
// (the project lead, 15 November 2026). Every drag now holds the globe.
//
// A drag holds the globe by the point that was grabbed: that point stays
// under the cursor, wherever on the globe it is. Away from the poles the
// view does not turn while it is dragged: north stays where it is on the
// screen. Inside the polar caps that is given up, because it cannot be had
// there: with north fixed, the pole is a wall the view cannot be pulled
// across, and a small sideways drag beside it spins the whole planet. There
// the globe turns freely like a ball in the hand. A view pulled across a
// pole comes out upside down, as a ball would, and stays as the reader left
// it: the north button, or going to any place, turns it upright again. (It
// first swung back by itself on letting go; that pulled the globe out of
// the hand and was taken out.)
//
// A tilt needs the view to be close to the ground. From far out it shows
// nothing more: it only pushes the globe off the middle of the screen and
// makes it loom. So the whole globe always sits in the middle, upright.

import * as THREE from '../../vendor/three.module.min.js';
import { RAD, toVec, toLatLon, lonDelta } from './geo.js';

const MIN_RANGE = 1.2e-4; // about 750 m from the point being looked at
const MAX_RANGE = 9;
const MAX_PITCH = 80;
const CLEARANCE = 4e-5; // the camera stays about 250 m above the ground
// Latitudes between which north is let go of: held below the first, free
// above the second.
const CAP_FROM = 62;
const CAP_FREE = 80;
// Tilt by height above the ground, in Earth radii: all of it up to the
// first, none from the second on (the whole globe is in view from there).
const TILT_FULL = 0.2;
const TILT_NONE = 0.8;
const MAX_TURN = 0.35; // radians one pointer event may turn the globe (a grazing ray near the edge would ask for more)

export class GlobeControls {
  constructor(camera, element) {
    this.camera = camera;
    this.element = element;
    this.lat = 15;
    this.lon = 20;
    this.alt = 3.8; // distance from the target point, in Earth radii
    this.pitch = 0; // 0 looks straight down
    this.heading = 0; // 0 has north at the top
    this.home = 0; // the heading flights go to; a drag across a pole may leave the view turned away from it
    this.grab = null; // the point of the globe held by a drag, as a unit vector
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

    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', (e) => this.down(e));
    element.addEventListener('pointermove', (e) => this.move(e));
    element.addEventListener('pointerup', (e) => this.up(e));
    element.addEventListener('pointercancel', (e) => this.up(e));
    element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    element.addEventListener('dblclick', () => this.zoomBy(0.45));
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari reports a pinch on a trackpad as its own "gesture" events and
    // would otherwise enlarge the whole page: the pinch zooms the globe.
    element.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      this.stop();
      this.pinchFrom = this.alt;
    });
    element.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (this.pinchFrom && e.scale > 0) {
        this.alt = Math.max(MIN_RANGE, Math.min(MAX_RANGE, this.pinchFrom / e.scale));
        this.apply();
      }
    });
    element.addEventListener('gestureend', (e) => e.preventDefault());
    this.apply();
  }

  // The steepest tilt the view may have at its present height.
  mostTilt() {
    const t = Math.max(0, Math.min(1, (TILT_NONE - this.alt) / (TILT_NONE - TILT_FULL)));
    return MAX_PITCH * t * t * (3 - 2 * t);
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
    if (this.pointers.size === 2) this.pinch = this.spread();
    // Whatever button or key: one pointer holds the globe.
    this.grab = this.pointers.size === 1 ? this.under(e.clientX, e.clientY) : null;
  }

  // The point of the globe under a place on the screen, as a unit vector;
  // null where the screen shows the sky.
  under(x, y) {
    const box = this.element.getBoundingClientRect();
    ndc.set(((x - box.left) / box.width) * 2 - 1, 1 - ((y - box.top) / box.height) * 2);
    caster.setFromCamera(ndc, this.camera);
    ball.radius = 1 + this.ground;
    return caster.ray.intersectSphere(ball, hit) ? hit.clone().normalize() : null;
  }

  // Turns the globe so that the grabbed point comes under the cursor.
  // False if the cursor is over the sky and nothing could be done.
  hold(x, y) {
    let held = false;
    // A few rounds: letting north back to its place moves the point a
    // little, and the next round takes that up again.
    for (let round = 0; round < 8; round++) {
      const now = this.under(x, y);
      if (!now) break;
      held = true;
      const angle = now.angleTo(this.grab);
      if (angle < 2e-6) break; // a dozen metres on the ground
      const was = this.heading;
      turn.setFromUnitVectors(now, this.grab);
      if (angle > MAX_TURN) turn.slerp(still, 1 - MAX_TURN / angle);
      // The camera's whole rig turns: the point it looks down on, and the
      // way that is up on the screen.
      toVec(this.lat, this.lon, 1, up);
      north.set(0, 1, 0).addScaledVector(up, -up.y).normalize();
      east.crossVectors(north, up);
      const h = this.heading * RAD;
      forward.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
      up.applyQuaternion(turn);
      forward.applyQuaternion(turn);
      const at = toLatLon(up);
      this.lat = at.lat;
      this.lon = at.lon;
      north.set(0, 1, 0).addScaledVector(up, -up.y).normalize();
      east.crossVectors(north, up);
      const free = Math.atan2(forward.dot(east), forward.dot(north)) / RAD;
      // How firmly the view is kept from turning here: fully outside the
      // polar caps, not at all near a pole.
      const t = Math.max(0, Math.min(1, (CAP_FREE - Math.abs(this.lat)) / (CAP_FREE - CAP_FROM)));
      this.heading = free + lonDelta(was, free) * t * t * (3 - 2 * t);
      this.apply();
    }
    if (held && Math.abs(this.lat) < CAP_FROM - 1) this.settle(x, y);
    return held;
  }

  // Where north is held, the rounds above come close but slowly for a
  // point far from the middle of the view. This finishes the job: the
  // view's latitude and longitude are solved for directly (Newton's
  // method on the point's place on the screen). It is undone if it does
  // not bring the point nearer.
  settle(x, y) {
    const start = { lat: this.lat, lon: this.lon, miss: this.under(x, y)?.angleTo(this.grab) ?? Infinity };
    if (start.miss < 2e-6) return;
    const box = this.element.getBoundingClientRect();
    const want = { x: ((x - box.left) / box.width) * 2 - 1, y: 1 - ((y - box.top) / box.height) * 2 };
    const seen = (lat, lon) => {
      this.lat = lat;
      this.lon = lon;
      this.apply();
      hit.copy(this.grab).multiplyScalar(1 + this.ground).project(this.camera);
      return { x: hit.x - want.x, y: hit.y - want.y };
    };
    let lat = this.lat;
    let lon = this.lon;
    const d = Math.max(1e-5, this.degreesPerPixel() * 0.5);
    for (let round = 0; round < 4; round++) {
      const r = seen(lat, lon);
      if (Math.hypot(r.x, r.y) < 1e-6) break;
      const a = seen(lat + d, lon);
      const b = seen(lat, lon + d);
      const j = [(a.x - r.x) / d, (b.x - r.x) / d, (a.y - r.y) / d, (b.y - r.y) / d];
      const det = j[0] * j[3] - j[1] * j[2];
      if (Math.abs(det) < 1e-12) break;
      const limit = (v) => Math.max(-10, Math.min(10, v));
      lat += limit((-r.x * j[3] + r.y * j[1]) / det);
      lon += limit((-r.y * j[0] + r.x * j[2]) / det);
      if (Math.abs(lat) >= CAP_FROM) break;
    }
    seen(lat, lon);
    const miss = this.under(x, y)?.angleTo(this.grab) ?? Infinity;
    if (!(miss < start.miss)) seen(start.lat, start.lon);
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
      // Two fingers: spreading zooms.
      const spread = this.spread();
      if (this.pinch > 0 && spread > 0) this.alt = Math.max(MIN_RANGE, Math.min(MAX_RANGE, (this.alt * this.pinch) / spread));
      this.pinch = spread;
      this.apply();
      return;
    }
    if (this.grab) {
      const from = { lat: this.lat, lon: this.lon };
      if (this.hold(e.clientX, e.clientY)) {
        // The glide after letting go, only where north is held: over a
        // pole a step in latitude and longitude is not a direction.
        const glide = Math.abs(this.lat) < CAP_FROM;
        this.velocity.lat = glide ? this.lat - from.lat : 0;
        this.velocity.lon = glide ? lonDelta(this.lon, from.lon) : 0;
      }
      return;
    }
    // The drag began on the sky: pan along the ground, following the way the view is turned.
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
  flyTo(lat, lon, alt, seconds = 1.6, { pitch = this.pitch, heading = this.home } = {}) {
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
      if (f.t >= 1) {
        this.flight = null;
        this.home = this.heading;
      }
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
    this.pitch = Math.max(0, Math.min(this.mostTilt(), this.pitch));
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
const ndc = new THREE.Vector2();
const caster = new THREE.Raycaster();
const ball = new THREE.Sphere(new THREE.Vector3(), 1);
const hit = new THREE.Vector3();
const turn = new THREE.Quaternion();
const still = new THREE.Quaternion();
