// The globe the rest of the app talks to. It runs on our own small engine
// (js/engine) built on three.js: streamed tiles shaped into real terrain,
// one draw call for all event dots, and a frame is only drawn when
// something changed.

import * as THREE from '../vendor/three.module.min.js';
import { CATEGORIES, BASEMAPS, OVERLAYS, NISAR_TILES } from './config.js';
import { pointInPolygon } from './incidents.js';
import { RAD, EARTH_RADIUS_M, toVec, toLatLon, greatCircle, sunDirection, rgb } from './engine/geo.js';
import { GlobeControls } from './engine/controls.js';
import { TileGlobe } from './engine/tiles.js';
import { Dots, Lines, SelectionRing, Vortex, Glow, Beams, LIFT, atmosphere, stars } from './engine/marks.js';
import { Fire } from './engine/fire.js';

const DAY = 86400_000;
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
      uBeam: { value: 0 },
    };

    this.tiles = new TileGlobe(this.scene, this.shared);
    this.tiles.wake = () => (this.dirty = true);
    this.glow = atmosphere(this.scene);
    this.trackLines = new Lines(this.scene, this.shared, { width: 2 });
    this.linkLines = new Lines(this.scene, this.shared, { width: 1.8, dash: 14 });
    // Drawn by event replays.
    this.fxLines = new Lines(this.scene, this.shared, { width: 2.4, order: 26, depthTest: false });
    this.fxDots = new Dots(this.scene, this.shared);
    this.fxDots.points.renderOrder = 27;
    this.fxGlow = new Glow(this.scene, this.shared);
    this.fire = new Fire(this.scene, this.shared);
    this.vortex = new Vortex(this.scene, this.shared);
    // Light beams on the event dots: taller for stronger events.
    this.beams = new Beams(this.scene, this.shared);
    this.beamItems = [];
    this.fxZones = [];
    this.animating = false;
    this.dots = new Dots(this.scene, this.shared, { halo: true });
    // Changing places (glaciers, sinking cities…), drawn as diamonds.
    this.placeDots = new Dots(this.scene, this.shared, { halo: true });
    this.placeDots.points.renderOrder = 29;
    this.ring = new SelectionRing(this.scene, this.shared);

    // Ground height in Earth radii, as drawn (so including exaggeration).
    this.lift = (lat, lon) => (this.tiles.heightAt(lat, lon) * this.tiles.uniforms.uExaggeration.value) / EARTH_RADIUS_M;
    this.controls = new GlobeControls(this.camera, this.renderer.domElement);
    this.controls.groundAt = this.lift;
    this.controls.onTap = (e) => this.tap(e);

    this.state = { base: 'esri', overlays: {}, nisar: null, fx: [] };
    this.scenes = [];
    this.footprintsOn = false;
    this.highlighted = [];
    this.pictures = [];
    this.selected = null;
    this.born = new Map();
    this.pick = null;
    this.fadeEnd = 0;
    this.dirty = true;
    this.liftedAt = 0;
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

    // Tiles stamp the start of a cross-fade with this clock while painting.
    this.shared.uTime.value = seconds;
    const moved = this.controls.update(dt);
    const tilesChanged = this.tiles.update(this.camera, this.el.clientHeight, moved);
    // New terrain arrived: settle the dots back onto the ground.
    if (this.tiles.elevationVersion !== this.liftedAt && this.tiles.frame % 30 === 0) {
      this.liftedAt = this.tiles.elevationVersion;
      this.dots.relift();
      this.placeDots.relift();
      this.fxDots.relift();
      this.beams.set(this.beamItems, this.lift);
      if (this.fxGlow.items.length) this.fxGlow.set(this.fxGlow.items, this.lift);
      this.fire.relift();
      if (this.selected) this.ring.set(this.selected.lat, this.selected.lon, this.lift(this.selected.lat, this.selected.lon));
      this.dirty = true;
    }
    // Pulsing dots and the selection ring are the only things that animate
    // on their own; without them an idle globe costs nothing.
    const animating = this.animating || this.ring.points.visible || seconds < this.pulseUntil || this.fadeEnd > 0;
    // A finished cross-fade is tidied up: one picture, no second canvas.
    if (this.fadeEnd && seconds > this.fadeEnd) this.settle();
    if (!(moved || tilesChanged || animating || this.dirty)) return;
    this.dirty = false;

    const alt = this.controls.alt;
    this.shared.uScale.value = 0.75 + 0.75 * Math.max(0, Math.min(1, 1 - Math.log10(alt / 0.12) / 1.5));
    this.glow.uniforms.uStrength.value = Math.max(0, Math.min(1, (alt - 0.2) / 0.6));
    // Beams stand up as the view tilts, or far out where the Earth's edge
    // shows them from the side. Seen straight down they would only smear.
    const ease = (x) => Math.max(0, Math.min(1, x)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, x)));
    this.shared.uBeam.value = Math.min(0.17 * alt, 0.075) * Math.max(ease((this.controls.pitch - 4) / 26), ease((alt - 1.5) / 1.5));
    if (this.tiles.uniforms.uNight.value) this.tiles.uniforms.uSun.value.copy(sunDirection());

    this.skyCamera.quaternion.copy(this.camera.quaternion);
    this.renderer.clear();
    this.renderer.render(this.sky, this.skyCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.onView?.(this.controls);
  }

  // ---------- picking ----------

  onPick(callback) {
    this.pick = callback;
  }

  // Screen position of a point on the globe, or null when it is hidden.
  project(vec) {
    if (vec.dot(this.camera.position) < 1) return null;
    const p = scratch.copy(vec).project(this.camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * this.el.clientWidth, y: (0.5 - p.y * 0.5) * this.el.clientHeight };
  }

  dotsAt(x, y, slack, dots = this.dots) {
    const hits = [];
    const scale = this.shared.uScale.value;
    for (const item of dots.items) {
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
    let at = null;
    // Two passes: the second meets the ground at the height found by the first.
    for (let pass = 0, radius = 1; pass < 2; pass++) {
      ball.radius = radius;
      const hit = raycaster.ray.intersectSphere(ball, scratch);
      if (!hit) return at;
      at = toLatLon(hit);
      radius = 1 + this.lift(at.lat, at.lon);
    }
    return at;
  }

  tap(e) {
    if (!this.pick) return;
    const box = this.el.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const found = this.dotsAt(x, y, 5)
      .slice(0, 12)
      .map((h) => ({ kind: 'incident', incident: h.item.incident }));
    for (const h of this.dotsAt(x, y, 5, this.placeDots).slice(0, 6)) found.push({ kind: 'place', place: h.item.place });
    const at = this.locate(x, y);
    if (at && this.footprintsOn) {
      for (const scene of this.scenes) {
        if (found.length >= 12) break;
        if (pointInPolygon(at.lat, at.lon, scene.ring)) found.push({ kind: 'scene', scene });
      }
    }
    this.pick(found, at, { x, y });
  }

  hover(e) {
    if (e.buttons) return (this.tooltip.hidden = true);
    const box = this.el.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const hit = this.dotsAt(x, y, 3)[0] || this.dotsAt(x, y, 3, this.placeDots)[0];
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    this.tooltip.hidden = !hit;
    if (hit) {
      const place = hit.item.place;
      this.tooltip.textContent = place ? `${place.name} · ${place.region}` : hit.item.incident.title;
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
      layers.push({ url: OVERLAYS[key].url.replace('{date}', OVERLAYS[key].date || date), maxLevel: OVERLAYS[key].maxLevel, alpha: 0.85 });
    }
    // Two radar wavelengths side by side: NISAR (L-band) left of the
    // divider, Sentinel-1 (C-band) right of it, for the same days.
    if (s.bands) {
      const end = Date.parse(s.bands.date);
      for (let i = s.bands.days - 1; i >= 0; i--) {
        const date = iso(end - i * DAY);
        if (date >= NISAR_TILES.firstDate) layers.push({ url: NISAR_TILES.url.replace('{date}', date), maxLevel: NISAR_TILES.maxLevel, side: 'left' });
        layers.push({ url: OVERLAYS.s1.url.replace('{date}', date), maxLevel: OVERLAYS.s1.maxLevel, side: 'right' });
      }
    }
    if (s.nisar) {
      const end = Date.parse(s.nisar.date);
      for (let i = s.nisar.days - 1; i >= 0; i--) {
        const date = iso(end - i * DAY);
        if (date >= NISAR_TILES.firstDate) layers.push({ url: NISAR_TILES.url.replace('{date}', date), maxLevel: NISAR_TILES.maxLevel });
      }
    }
    for (const layer of s.fx) layers.push(layer);
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

  setBandCompare(on, endDate, days) {
    const next = on && endDate ? { date: endDate, days } : null;
    if (JSON.stringify(next) === JSON.stringify(this.state.bands ?? null)) return;
    this.state.bands = next;
    this.applyLayers();
  }

  // ---------- terrain ----------

  setTerrain(on) {
    this.tiles.setTerrain(on);
    this.tiles.uniforms.uRelief.value = on ? 1 : 0;
    this.dots.relift();
    this.placeDots.relift();
    this.controls.apply();
    this.dirty = true;
  }

  // 1 is true scale; larger values stretch mountains so they read from afar.
  setExaggeration(factor) {
    this.tiles.uniforms.uExaggeration.value = factor;
    this.dots.relift();
    this.placeDots.relift();
    this.controls.apply();
    this.dirty = true;
  }

  // ---------- radar pictures ----------

  clearScenes() {
    this.fadeEnd = 0;
    this.tiles.uniforms.uFadeDur.value = 0;
    if (!this.pictures.length) return;
    this.pictures = [];
    this.tiles.setPictures([]);
    this.tiles.uniforms.uSplit.value = 0.5;
    this.dirty = true;
  }

  // Shows a picture by cross-fading from whatever picture (or bare ground)
  // is there now. Used for the time-lapse and for single radar scenes.
  fadeTo(image, bounds, seconds = 0.5) {
    const shown = this.pictures.filter((p) => p.side !== 'left').pop();
    const next = { image, bounds, side: 'right', alpha: 1 };
    this.pictures = shown ? [{ ...shown, side: 'left' }, next] : [next];
    this.tiles.fadeGen++;
    this.tiles.uniforms.uFadeDur.value = seconds;
    this.tiles.setPictures(this.pictures);
    // Tiles repaint over a few frames, each starting its own fade.
    this.fadeEnd = (performance.now() - this.started) / 1000 + seconds + 0.8;
    this.dirty = true;
    return next;
  }

  settle() {
    this.fadeEnd = 0;
    this.tiles.uniforms.uFadeDur.value = 0;
    const shown = this.pictures.filter((p) => p.side === 'right').pop();
    if (!shown) return;
    this.pictures = [{ ...shown, side: undefined }];
    this.tiles.setPictures(this.pictures);
    this.dirty = true;
  }

  // Drapes a radar preview over the terrain. side: 'left', 'right' or
  // undefined for the whole screen.
  async addScene(scene, bounds, side) {
    const image = await loadPicture(scene.image);
    return side ? this.addPicture(image, bounds, side) : this.fadeTo(image, bounds, 0.9);
  }

  // Drapes any image or canvas over a lat/lon box.
  addPicture(image, bounds, side, alpha = 1) {
    if (this.fadeEnd) this.settle();
    const picture = { image, bounds, side, alpha };
    this.pictures = [...this.pictures, picture];
    this.tiles.setPictures(this.pictures);
    this.dirty = true;
    return picture;
  }

  setSplit(fraction) {
    this.tiles.uniforms.uSplit.value = fraction;
    this.dirty = true;
  }

  // ---------- camera ----------

  flyTo(lat, lon, height = 1_800_000, view) {
    this.controls.flyTo(lat, lon, height / EARTH_RADIUS_M, 1.6, view);
  }

  flyToBounds(b) {
    const lat = (b.north + b.south) / 2;
    const tall = (b.north - b.south) * RAD;
    const wide = (b.east - b.west) * RAD * Math.cos(lat * RAD);
    const fit = Math.max(tall, wide / this.camera.aspect) * 1.5;
    this.controls.flyTo(lat, (b.west + b.east) / 2, fit / 2 / Math.tan((this.camera.fov * RAD) / 2), 1.6, { pitch: 0, heading: 0 });
  }

  zoom(factor) {
    this.controls.stop();
    this.controls.flyTo(this.controls.lat, this.controls.lon, this.controls.alt * factor, 0.35);
  }

  // Switches between looking straight down and a tilted 3D view.
  toggleTilt() {
    const c = this.controls;
    const tilted = c.pitch > 5;
    // From orbit, come down to where relief is visible.
    c.flyTo(c.lat, c.lon, tilted ? c.alt : Math.min(c.alt, 0.12), 0.9, { pitch: tilted ? 0 : 62 });
    return !tilted;
  }

  faceNorth() {
    const c = this.controls;
    c.flyTo(c.lat, c.lon, c.alt, 0.6, { heading: 0 });
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
    this.dots.set(items, this.lift);
    this.beamItems = list.map((inc) => ({ lat: inc.lat, lon: inc.lon, color: rgb(CATEGORIES[inc.category].color), height: 0.25 + 0.75 * inc.severity }));
    this.beams.set(this.beamItems, this.lift);
    this.trackLines.set(tracks);
    this.dirty = true;
  }

  // places: [{ place, color }], drawn as diamonds.
  renderPlaces(places) {
    this.placeDots.set(
      places.map(({ place, color }) => ({ place, lat: place.lat, lon: place.lon, color: rgb(color), size: 13, ring: 2 })),
      this.lift,
    );
    this.dirty = true;
  }

  renderFootprints(scenes, on) {
    this.scenes = scenes;
    this.footprintsOn = on;
    this.drawOutlines();
  }

  // Footprints are painted into the ground itself, so they follow the relief.
  drawOutlines() {
    const now = Date.now();
    const outlines = [];
    if (this.footprintsOn) {
      for (const scene of this.scenes) {
        const strength = Math.max(0.25, 1 - (now - scene.time) / DAY / 4);
        outlines.push({ ring: scene.ring, color: `rgba(57,230,196,${(0.8 * strength).toFixed(2)})`, fill: `rgba(57,230,196,${(0.07 * strength).toFixed(3)})`, width: 1.4 });
      }
    }
    for (const scene of this.highlighted) outlines.push({ ring: scene.ring, color: 'rgba(57,230,196,1)', width: 2.6 });
    outlines.push(...this.fxZones);
    this.tiles.setOutlines(outlines);
    this.dirty = true;
  }

  // ---------- replay effects ----------

  // A point on the drawn ground (terrain included), as a vector.
  ground(lat, lon, extra = LIFT) {
    return toVec(lat, lon, 1 + extra + this.lift(lat, lon));
  }

  // paths: [{ points: [{ lat, lon }…], color: [r, g, b, a], closed }]
  setEffectLines(paths) {
    this.fxLines.set(
      paths.map((p) => {
        const points = p.points.map((q) => this.ground(q.lat, q.lon, p.lift ?? LIFT));
        if (p.closed && points.length) points.push(points[0].clone());
        return { points, color: p.color };
      }),
    );
    this.dirty = true;
  }

  // Seconds on the clock the shaders run on, for timing entrances.
  get clock() {
    return this.shared.uTime.value;
  }

  // items: [{ lat, lon, color: [r, g, b], size, pop }]
  setEffectDots(items) {
    this.fxDots.set(items, this.lift);
    this.dirty = true;
  }

  // Filled or outlined areas painted into the ground:
  // [{ ring, color, fill, width, open }]
  setEffectZones(zones) {
    this.fxZones = zones;
    this.drawOutlines();
  }

  // Extra dated tile layers shown on top of everything else.
  setEffectLayers(layers) {
    this.state.fx = layers;
    this.applyLayers();
  }

  // Glowing points: [{ lat, lon, color: [r, g, b], size, km, flicker }]
  setEffectGlow(items) {
    this.fxGlow.set(items, this.lift);
    this.dirty = true;
  }

  // A fire built from detections [{ lat, lon, born }] around a centre, or
  // null to put it out. born is on the replay clock (see setFireTime).
  setFire(items, centre) {
    this.fire.set(items || [], centre, this.lift);
    this.dirty = true;
  }

  // The replay clock for the fire: now, and how many seconds make one day.
  setFireTime(now, step) {
    this.fire.time(now, step);
    this.dirty = true;
  }

  // A cloud spiral: { lat, lon, radiusKm, color: [r, g, b], power: 0..1 }.
  // It floats at cloud-top height, stretched like the terrain is.
  setVortex(at) {
    if (!at) this.vortex.set(null);
    else {
      const lift = this.lift(at.lat, at.lon) + (14_000 * this.tiles.uniforms.uExaggeration.value) / EARTH_RADIUS_M;
      this.vortex.set({ lat: at.lat, lon: at.lon, radius: (at.radiusKm * 1000) / EARTH_RADIUS_M, lift, color: at.color, power: at.power });
    }
    this.dirty = true;
  }

  // A shock front crossing the terrain, or null to end it:
  // { lat, lon, sKm, pKm, widthKm, strength, rippleKm, heightM }.
  // sKm and pKm are the radii of the two fronts; the ground glows there and
  // rises in a ripple rippleKm wide and heightM tall at the slower front.
  setShockwave(wave) {
    const u = this.tiles.uniforms;
    if (!wave) {
      if (u.uWave.value.w === 0) return;
      u.uWave.value.w = 0;
    } else {
      const km = 1000 / EARTH_RADIUS_M;
      toVec(wave.lat, wave.lon, 1, u.uWaveC.value);
      u.uWave.value.set(wave.sKm * km, wave.pKm * km, wave.widthKm * km, wave.strength);
      u.uRipple.value.set(wave.rippleKm * km, wave.heightM);
    }
    this.dirty = true;
  }

  // Flood water: `now` is the replay step (it may be between steps) and
  // `steps` how many there are. The water itself comes from mask layers.
  setWater(now, steps) {
    this.tiles.uniforms.uWater.value.set(now, steps, 0);
    this.dirty = true;
  }

  // Turns the view slowly around its target until the next touch.
  setOrbit(degreesPerSecond) {
    this.controls.orbit = reducedMotion.matches ? 0 : degreesPerSecond;
  }

  clearEffects() {
    this.animating = false;
    this.fxLines.set([]);
    this.fxDots.set([], this.lift);
    this.fxGlow.set([], this.lift);
    this.fire.set([]);
    this.vortex.set(null);
    this.setShockwave(null);
    this.controls.orbit = 0;
    if (this.fxZones.length) this.setEffectZones([]);
    if (this.state.fx.length) this.setEffectLayers([]);
    this.dirty = true;
  }

  // Ring on the chosen incident, arcs to everything linked to it, and a
  // bright outline around the given radar scenes.
  select(incident, scenes = []) {
    this.selected = incident;
    this.ring.set(incident ? incident.lat : null, incident?.lon, incident ? this.lift(incident.lat, incident.lon) : 0);
    this.linkLines.set(
      incident
        ? incident.related.slice(0, 25).map((link) => ({
            points: greatCircle(incident, link.incident, 32, 1.0002, 0.12),
            color: [...rgb(CATEGORIES[link.incident.category].color), 0.9],
          }))
        : [],
    );
    this.highlighted = scenes;
    this.drawOutlines();
  }
}

// Loads a radar preview and makes its black padding see-through, so only
// the imaged swath covers the ground.
const pictureCache = new Map();
export function loadPicture(url) {
  if (!pictureCache.has(url)) {
    pictureCache.set(
      url,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onerror = () => {
          pictureCache.delete(url);
          reject(new Error('Preview image failed to load'));
        };
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const px = data.data;
          for (let i = 0; i < px.length; i += 4) if (px[i] < 4 && px[i + 1] < 4 && px[i + 2] < 4) px[i + 3] = 0;
          ctx.putImageData(data, 0, 0);
          resolve(canvas);
        };
        img.src = url;
      }),
    );
    if (pictureCache.size > 12) pictureCache.delete(pictureCache.keys().next().value);
  }
  return pictureCache.get(url);
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const scratch = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ball = new THREE.Sphere(new THREE.Vector3(), 1);
