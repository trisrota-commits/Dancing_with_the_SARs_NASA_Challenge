// The globe the rest of the app talks to. It runs on our own small engine
// (js/engine) built on three.js: streamed tiles on a sphere, one draw call
// for all event dots, and a frame is only drawn when something changed.

import * as THREE from '../vendor/three.module.min.js';
import { CATEGORIES, BASEMAPS, OVERLAYS, NISAR_TILES } from './config.js';
import { pointInPolygon } from './incidents.js';
import { RAD, EARTH_RADIUS_M, toVec, toLatLon, greatCircle, sunDirection, rgb } from './engine/geo.js';
import { GlobeControls } from './engine/controls.js';
import { TileGlobe } from './engine/tiles.js';
import { Dots, Lines, SelectionRing, Patches, ringPath, atmosphere, stars } from './engine/marks.js';

const DAY = 86400_000;
const TEAL = rgb('#39e6c4');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export class Globe {
  constructor(containerId) {
    const el = document.getElementById(containerId);
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x05080d);
    el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    this.sky = new THREE.Scene();
    this.skyCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    this.stars = stars();
    this.sky.add(this.stars);

    this.shared = {
      uCam: { value: this.camera.position },
      uScale: { value: 1 },
      uRatio: { value: 1 },
      uTime: { value: 0 },
      uViewport: { value: new THREE.Vector2(1, 1) },
    };

    this.tiles = new TileGlobe(this.scene);
    this.tiles.wake = () => (this.dirty = true);
    this.glow = atmosphere(this.scene);
    this.patches = new Patches(this.scene, this.shared);
    this.footprintLines = new Lines(this.scene, this.shared, { width: 1.3 });
    this.trackLines = new Lines(this.scene, this.shared, { width: 2 });
    this.linkLines = new Lines(this.scene, this.shared, { width: 1.8, dash: 14 });
    this.highlightLines = new Lines(this.scene, this.shared, { width: 2.6, order: 21 });
    this.dots = new Dots(this.scene, this.shared);
    this.ring = new SelectionRing(this.scene, this.shared);

    this.controls = new GlobeControls(this.camera, this.renderer.domElement);
    this.controls.onTap = (e) => this.tap(e);

    this.state = { base: 'esri', overlays: {}, nisar: null };
    this.scenes = [];
    this.footprintsOn = false;
    this.born = new Map();
    this.pick = null;
    this.dirty = true;
    this.started = performance.now();

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip';
    this.tooltip.hidden = true;
    el.appendChild(this.tooltip);
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));
    this.renderer.domElement.addEventListener('pointerleave', () => (this.tooltip.hidden = true));

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    // On a tall, narrow screen start further out so the whole Earth fits.
    if (this.camera.aspect < 1) this.controls.zoomBy(0.85 / this.camera.aspect);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  get spinning() {
    return this.controls.spin;
  }

  set spinning(on) {
    this.controls.spin = on;
  }

  // ---------- frame loop ----------

  resize() {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.camera.aspect = this.skyCamera.aspect = w / h;
    this.skyCamera.updateProjectionMatrix();
    this.shared.uRatio.value = ratio;
    this.stars.material.uniforms.uRatio.value = ratio;
    this.shared.uViewport.value.set(w * ratio, h * ratio);
    this.controls.apply();
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const seconds = (now - this.started) / 1000;

    const moved = this.controls.update(dt);
    const tilesChanged = this.tiles.update(this.camera, this.el.clientHeight, moved);
    // Pulsing dots and the selection ring are the only things that animate
    // on their own; without them an idle globe costs nothing.
    const animating = this.ring.points.visible || seconds < this.pulseUntil;
    if (!(moved || tilesChanged || animating || this.dirty)) return;
    this.dirty = false;

    const alt = this.controls.alt;
    this.shared.uTime.value = seconds;
    this.shared.uScale.value = 0.75 + 0.75 * Math.max(0, Math.min(1, 1 - Math.log10(alt / 0.12) / 1.5));
    this.glow.uniforms.uStrength.value = Math.max(0, Math.min(1, (alt - 0.2) / 0.6));
    if (this.tiles.uniforms.uNight.value) this.tiles.uniforms.uSun.value.copy(sunDirection());

    this.skyCamera.quaternion.copy(this.camera.quaternion);
    this.renderer.clear();
    this.renderer.render(this.sky, this.skyCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- picking ----------

  onPick(callback) {
    this.pick = callback;
  }

  // Screen position of a point on the globe, or null when it is hidden.
  project(vec) {
    if (vec.dot(this.camera.position) < 1) return null;
    const p = scratch.copy(vec).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.el.clientWidth, y: (0.5 - p.y * 0.5) * this.el.clientHeight };
  }

  dotsAt(x, y, slack) {
    const hits = [];
    const scale = this.shared.uScale.value;
    for (const item of this.dots.items) {
      const p = this.project(item.vec);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= (item.size * scale) / 2 + slack) hits.push({ d, item });
    }
    return hits.sort((a, b) => a.d - b.d);
  }

  // Latitude and longitude under a screen position, or null off the globe.
  locate(x, y) {
    const ndc = new THREE.Vector2((x / this.el.clientWidth) * 2 - 1, 1 - (y / this.el.clientHeight) * 2);
    raycaster.setFromCamera(ndc, this.camera);
    const hit = raycaster.ray.intersectSphere(unitSphere, scratch);
    return hit ? toLatLon(hit) : null;
  }

  tap(e) {
    if (!this.pick) return;
    const box = this.el.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const found = this.dotsAt(x, y, 5)
      .slice(0, 12)
      .map((h) => ({ kind: 'incident', incident: h.item.incident }));
    const at = this.footprintsOn && this.locate(x, y);
    if (at) {
      for (const scene of this.scenes) {
        if (found.length >= 12) break;
        if (pointInPolygon(at.lat, at.lon, scene.ring)) found.push({ kind: 'scene', scene });
      }
    }
    this.pick(found);
  }

  hover(e) {
    if (e.buttons) return (this.tooltip.hidden = true);
    const box = this.el.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const hit = this.dotsAt(x, y, 3)[0];
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    this.tooltip.hidden = !hit;
    if (hit) {
      this.tooltip.textContent = hit.item.incident.title;
      this.tooltip.style.left = `${x + 14}px`;
      this.tooltip.style.top = `${y + 12}px`;
    }
  }

  // ---------- imagery ----------

  applyLayers() {
    const s = this.state;
    const base = BASEMAPS[s.base];
    const layers = [{ url: base.url.replace('{date}', iso(Date.now() - DAY)), maxLevel: base.maxLevel, base: true }];
    for (const [key, date] of Object.entries(s.overlays)) {
      layers.push({ url: OVERLAYS[key].url.replace('{date}', date), maxLevel: OVERLAYS[key].maxLevel, alpha: 0.85 });
    }
    if (s.nisar) {
      const end = Date.parse(s.nisar.date);
      for (let i = s.nisar.days - 1; i >= 0; i--) {
        const date = iso(end - i * DAY);
        if (date >= NISAR_TILES.firstDate) layers.push({ url: NISAR_TILES.url.replace('{date}', date), maxLevel: NISAR_TILES.maxLevel });
      }
    }
    this.tiles.setLayers(layers);
    this.dirty = true;
  }

  setBasemap(key) {
    this.state.base = key;
    this.applyLayers();
  }

  setLighting(on) {
    this.tiles.uniforms.uNight.value = on ? 1 : 0;
    this.tiles.uniforms.uSun.value.copy(sunDirection());
    this.dirty = true;
  }

  setOverlay(key, on, date) {
    const had = this.state.overlays[key];
    if (on && date) this.state.overlays[key] = date;
    else delete this.state.overlays[key];
    if (had !== this.state.overlays[key]) this.applyLayers();
  }

  // Daily radar swaths; stacking several days fills in a wider mosaic.
  setNisarTiles(on, endDate, days) {
    const next = on && endDate ? { date: endDate, days } : null;
    if (JSON.stringify(next) === JSON.stringify(this.state.nisar)) return;
    this.state.nisar = next;
    this.applyLayers();
  }

  clearScenes() {
    this.patches.clear();
    this.dirty = true;
  }

  async addScene(scene, bounds, side) {
    const mesh = await this.patches.add(scene.image, bounds, side);
    this.dirty = true;
    return mesh;
  }

  setSplit(fraction) {
    this.patches.split.value = fraction;
    this.dirty = true;
  }

  // ---------- camera ----------

  flyTo(lat, lon, height = 1_800_000) {
    this.controls.flyTo(lat, lon, height / EARTH_RADIUS_M);
  }

  flyToBounds(b) {
    const lat = (b.north + b.south) / 2;
    const tall = (b.north - b.south) * RAD;
    const wide = (b.east - b.west) * RAD * Math.cos(lat * RAD);
    const fit = Math.max(tall, wide / this.camera.aspect) * 1.5;
    this.controls.flyTo(lat, (b.west + b.east) / 2, fit / 2 / Math.tan((this.camera.fov * RAD) / 2));
  }

  // ---------- data ----------

  renderIncidents(list, freshIds) {
    const seconds = (performance.now() - this.started) / 1000;
    for (const id of freshIds) if (!this.born.has(id)) this.born.set(id, seconds);
    let pulseUntil = 0;
    const tracks = [];
    const items = list.map((inc) => {
      const color = rgb(CATEGORIES[inc.category].color);
      const born = this.born.get(inc.id);
      if (born != null) pulseUntil = Math.max(pulseUntil, born + 90);
      if (inc.track) {
        const points = [];
        for (let i = 0; i + 1 < inc.track.length; i++) points.push(...greatCircle(inc.track[i], inc.track[i + 1], 6, 1.00004).slice(i ? 1 : 0));
        if (points.length > 1) tracks.push({ points, color: [...color, 0.75] });
      }
      return {
        incident: inc,
        lat: inc.lat,
        lon: inc.lon,
        color,
        size: 8 + inc.severity * 11 + (inc.reports.length > 1 ? 2 : 0),
        ring: inc.nisarScenes.length > 0,
        born,
      };
    });
    this.pulseUntil = pulseUntil;
    this.dots.set(items);
    this.trackLines.set(tracks);
    this.dirty = true;
  }

  renderFootprints(scenes, on) {
    this.scenes = scenes;
    this.footprintsOn = on;
    const now = Date.now();
    this.footprintLines.set(
      on
        ? scenes.map((scene) => {
            const strength = Math.max(0.25, 1 - (now - scene.time) / DAY / 4);
            return { points: ringPath(scene.ring), color: [...TEAL, 0.8 * strength] };
          })
        : [],
    );
    this.dirty = true;
  }

  // Ring on the chosen incident, arcs to everything linked to it, and a
  // bright outline around the given radar scenes.
  select(incident, scenes = []) {
    this.ring.set(incident ? incident.lat : null, incident?.lon);
    this.linkLines.set(
      incident
        ? incident.related.slice(0, 25).map((link) => ({
            points: greatCircle(incident, link.incident, 32, 1.00004, 0.12),
            color: [...rgb(CATEGORIES[link.incident.category].color), 0.9],
          }))
        : [],
    );
    this.highlightLines.set(scenes.map((scene) => ({ points: ringPath(scene.ring, 1.00006), color: [...TEAL, 1] })));
    this.dirty = true;
  }
}

const scratch = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
