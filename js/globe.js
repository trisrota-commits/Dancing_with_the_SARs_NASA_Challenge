// The globe the rest of the app talks to. It runs on our own small engine
// (js/engine) built on three.js: streamed tiles shaped into real terrain,
// one draw call for all event dots, and a frame is only drawn when
// something changed.

import * as THREE from '../vendor/three.module.min.js';
import { CATEGORIES, BASEMAPS, OVERLAYS, NISAR_TILES, NISAR_MOSAIC, PALETTE } from './config.js';
import { pointInPolygon } from './incidents.js';
import { RAD, EARTH_RADIUS_M, toVec, toLatLon, greatCircle, sunDirection, rgb } from './engine/geo.js';
import { GlobeControls } from './engine/controls.js';
import { TileGlobe } from './engine/tiles.js';
import { Dots, Lines, SelectionRing, RING_SECONDS, PING_EVERY, PING_LASTS, PING_SPREAD, Vortex, Glow, Beams, LIFT, atmosphere } from './engine/marks.js';
import { Fire } from './engine/fire.js';
import { Labels } from './engine/labels.js';
import { Sky } from './sky.js';

const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// A small number from a text, the same every time.
const hash = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
};

// NISAR's teal as "r,g,b" for canvas colours.
const NISAR_RGB = rgb(PALETTE.nisar).map((v) => Math.round(v * 255)).join(',');

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
    // The real sky: catalogue stars turning with the Earth, and the Sun.
    this.skyView = new Sky(this.sky);
    this.skyBusy = false;

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
    // The basemap's server cannot be reached: whoever listens may pick another.
    this.tiles.onBaseFailed = () => this.onBasemapFailed?.(this.state.base);
    this.glow = atmosphere(this.scene);
    this.trackLines = new Lines(this.scene, this.shared, { width: 2 });
    this.linkLines = new Lines(this.scene, this.shared, { width: 1.8, dash: 14 });
    // Drawn by event replays.
    this.fxLines = new Lines(this.scene, this.shared, { width: 2.4, order: 26, depthTest: false });
    this.fxDots = new Dots(this.scene, this.shared);
    this.fxDots.points.renderOrder = 27;
    this.fxGlow = new Glow(this.scene, this.shared);
    this.fire = new Fire(this.scene, this.shared);
    this.labels = new Labels(el);
    this.focus = 0; // how far the map has stepped back, 0..1
    this.focusTarget = 0;
    this.night = 0; // how much of the day and night shading is applied
    this.nightOn = false;
    this.vortex = new Vortex(this.scene, this.shared);
    // Light beams on the event dots: taller for stronger events.
    this.beams = new Beams(this.scene, this.shared);
    this.beamItems = [];
    this.fxZones = [];
    // Until when (on the shader clock) an entrance or the ring is moving.
    this.ringUntil = 0;
    this.popUntil = 0;
    this.glowFlickers = false;
    this.dots = new Dots(this.scene, this.shared, { halo: true });
    // Changing places (glaciers, sinking cities…), drawn as diamonds.
    this.placeDots = new Dots(this.scene, this.shared, { halo: true });
    this.placeDots.points.renderOrder = 29;
    // Wildlife sightings and points of interest.
    this.animalDots = new Dots(this.scene, this.shared);
    this.animalDots.points.renderOrder = 28;
    this.animalPulseUntil = 0;
    this.poiDots = new Dots(this.scene, this.shared);
    this.poiDots.points.renderOrder = 28;
    // NISAR itself: the satellite, its orbit and its radar swath.
    this.satDots = new Dots(this.scene, this.shared);
    this.satDots.points.renderOrder = 32;
    this.orbitPast = new Lines(this.scene, this.shared, { width: 2, order: 24 });
    this.orbitAhead = new Lines(this.scene, this.shared, { width: 1.4, dash: 10, order: 24 });
    this.swathLines = new Lines(this.scene, this.shared, { width: 1.5, order: 23 });
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
    // Sharp enough on a phone at 1.5, and far fewer pixels to shade.
    const ratio = Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.camera.aspect = this.skyCamera.aspect = w / h;
    this.skyCamera.updateProjectionMatrix();
    this.shared.uRatio.value = ratio;
    this.skyView.setRatio(ratio);
    this.width = w;
    this.height = h;
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
    // What the camera looks at, for the tile engine's priorities.
    if (moved || !this.focusVec) this.focusVec = toVec(this.controls.lat, this.controls.lon, 1, this.focusVec || new THREE.Vector3());
    if (moved) this.lookAhead(now);
    const tilesChanged = this.tiles.update(this.camera, this.height, moved, this.focusVec);
    // New terrain arrived: settle the dots back onto the ground.
    if (this.tiles.elevationVersion !== this.liftedAt && this.tiles.frame % 30 === 0) {
      this.liftedAt = this.tiles.elevationVersion;
      this.dots.relift();
      this.placeDots.relift();
      this.animalDots.relift();
      this.poiDots.relift();
      this.fxDots.relift();
      this.beams.set(this.beamItems, this.lift);
      if (this.fxGlow.items.length) this.fxGlow.set(this.fxGlow.items, this.lift);
      this.fire.relift();
      if (this.selected) this.ring.set(this.selected.lat, this.selected.lon, this.lift(this.selected.lat, this.selected.lon));
      this.dirty = true;
    }
    // An idle globe costs nothing: a frame is drawn only while something
    // on it moves by itself. That is a new arrival's pulse, the ring just
    // after a selection, fire, a storm's clouds, flood water, a flickering
    // glow or a mark popping in. A timeline that is playing asks for its
    // own frames. The sky turns slowly; a shooting star needs every frame.
    const date = new Date();
    const sun = sunDirection(date);
    const skyBusy = this.skyView.update(date, seconds, this.camera.quaternion, sun);
    const water = this.tiles.uniforms.uWater.value;
    const alive = this.fire.hot.visible || this.vortex.mesh.visible || this.glowFlickers || seconds < this.popUntil || seconds < this.ringUntil || (water.y > 0 && water.x > -0.15 && this.tiles.masked);
    // Recent events send out a soft ring every few seconds; frames are
    // drawn while one is spreading, and one more to clear it.
    const pinging = this.pinging && seconds % PING_EVERY < PING_LASTS + PING_SPREAD + 0.1;
    const animating = alive || pinging || seconds < this.pulseUntil || seconds < this.animalPulseUntil || skyBusy || this.skyBusy || this.fadeEnd > 0 || this.focus !== this.focusTarget;
    this.skyBusy = skyBusy;
    // A finished cross-fade is tidied up: one picture, no second canvas.
    if (this.fadeEnd && seconds > this.fadeEnd) this.settle();
    // Day and night shading eases back while data is on the ground.
    // (Also while the whole planet is shown as the radar sees it: the
    // radar works at night, and the picture is the point.)
    const night = !this.nightOn ? 0 : this.pictures.length || this.focusTarget || this.state.nisar?.days > 12 ? 0.25 : 1;
    if (Math.abs(this.night - night) > 0.002) {
      this.night = Math.abs(this.night - night) < 0.01 ? night : this.night + (night - this.night) * Math.min(1, dt * 2.5);
      this.tiles.uniforms.uNight.value = this.night;
      this.dirty = true;
    }
    // The focus eases in and out.
    if (this.focus !== this.focusTarget) {
      // The last step lands exactly, so the easing ends and frames stop.
      this.focus = Math.abs(this.focus - this.focusTarget) < 0.004 ? this.focusTarget : this.focus + (this.focusTarget - this.focus) * Math.min(1, dt * 2.5);
      this.tiles.uniforms.uFocus.value.y = this.focus;
      this.dirty = true;
    }
    if (!(moved || tilesChanged || animating || this.dirty)) return;
    this.dirty = false;

    const alt = this.controls.alt;
    this.shared.uScale.value = 0.75 + 0.75 * Math.max(0, Math.min(1, 1 - Math.log10(alt / 0.12) / 1.5));
    this.glow.uniforms.uStrength.value = Math.max(0, Math.min(1, (alt - 0.2) / 0.6));
    // Beams stand up as the view tilts, or far out where the Earth's edge
    // shows them from the side. Seen straight down they would only smear.
    const ease = (x) => Math.max(0, Math.min(1, x)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, x)));
    this.shared.uBeam.value = Math.min(0.17 * alt, 0.075) * Math.max(ease((this.controls.pitch - 4) / 26), ease((alt - 1.5) / 1.5));
    if (this.tiles.uniforms.uNight.value) this.tiles.uniforms.uSun.value.copy(sun);

    this.skyCamera.quaternion.copy(this.camera.quaternion);
    this.renderer.clear();
    this.renderer.render(this.sky, this.skyCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    if (this.labels.items.length) this.labels.update((lat, lon) => this.project(this.ground(lat, lon)), alt);
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
    return { x: (p.x * 0.5 + 0.5) * this.width, y: (0.5 - p.y * 0.5) * this.height };
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
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2);
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
    if (this.dotsAt(x, y, 6, this.satDots).length) found.unshift({ kind: 'satellite' });
    for (const h of this.dotsAt(x, y, 4, this.animalDots).slice(0, 4)) found.push({ kind: 'animal', animal: h.item.animal });
    for (const h of this.dotsAt(x, y, 4, this.poiDots).slice(0, 2)) found.push({ kind: 'poi', poi: h.item.poi });
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
    const hit =
      this.dotsAt(x, y, 4, this.satDots)[0] ||
      this.dotsAt(x, y, 3)[0] ||
      this.dotsAt(x, y, 3, this.placeDots)[0] ||
      this.dotsAt(x, y, 3, this.animalDots)[0] ||
      this.dotsAt(x, y, 3, this.poiDots)[0];
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    // An event under the pointer may well be clicked next: tell the app.
    const resting = hit?.item.incident || null;
    if (resting !== this.resting) {
      this.resting = resting;
      this.onRest?.(resting);
    }
    this.tooltip.hidden = !hit;
    if (hit) {
      const place = hit.item.place;
      const it = hit.item;
      this.tooltip.textContent = it.sat
        ? 'NISAR · live position'
        : it.animal
          ? `${it.animal.common} · seen ${it.animal.date || 'date unknown'}`
          : it.poi
            ? `${it.poi.name} · point of interest`
            : place
              ? `${place.name} · ${place.region}`
              : // The kind of event in words: its colour alone must never have to say it.
                `${CATEGORIES[it.incident.category].label} · ${it.incident.title}`;
      this.tooltip.style.left = `${x + 14}px`;
      this.tooltip.style.top = `${y + 12}px`;
    }
  }

  // ---------- imagery ----------

  applyLayers() {
    const s = this.state;
    const base = BASEMAPS[s.base];
    const layers = [{ url: base.url.replace('{date}', iso(Date.now() - DAY)), maxLevel: base.maxLevel, base: true }];
    // A layer that fills the land goes underneath, the partial ones on top,
    // each group in the order of the menu, whatever was switched on first.
    const order = Object.keys(OVERLAYS);
    const rank = (key) => (OVERLAYS[key].fills ? 0 : 100) + order.indexOf(key);
    for (const [key, date] of Object.entries(s.overlays).sort((a, b) => rank(a[0]) - rank(b[0]))) {
      layers.push({ url: OVERLAYS[key].url.replace('{date}', OVERLAYS[key].date || date), maxLevel: OVERLAYS[key].maxLevel, alpha: 0.85, sparse: !!OVERLAYS[key].sparse, sheet: OVERLAYS[key].sheet?.replace('{date}', OVERLAYS[key].date || date), map: OVERLAYS[key].map?.replace('{date}', OVERLAYS[key].date || date) });
    }
    // Two radar wavelengths side by side: NISAR (L-band) left of the
    // divider, Sentinel-1 (C-band) right of it, for the same days.
    if (s.bands) {
      const end = Date.parse(s.bands.date);
      for (let i = s.bands.days - 1; i >= 0; i--) {
        const date = iso(end - i * DAY);
        if (date >= NISAR_TILES.firstDate) layers.push({ url: NISAR_TILES.url.replace('{date}', date), sheet: NISAR_TILES.sheet.replace('{date}', date), map: NISAR_TILES.map.replace('{date}', date), colour: true, stack: 'nisar', age: i, maxLevel: NISAR_TILES.maxLevel, side: 'left', sparse: true });
        layers.push({ url: OVERLAYS.s1.url.replace('{date}', date), sheet: OVERLAYS.s1.sheet.replace('{date}', date), map: OVERLAYS.s1.map.replace('{date}', date), stack: 's1', age: i, maxLevel: OVERLAYS.s1.maxLevel, side: 'right', sparse: true });
      }
    }
    // (Not while the two wavelengths are compared: the stack has no side,
    // so NISAR's strips would show on Sentinel-1's side of the divider too.)
    if (s.nisar && !s.bands) {
      const end = Date.parse(s.nisar.date);
      // The whole planet with the ready-made mosaic: that one picture
      // serves the far and the continent view, and the daily layers it
      // was made from only come in close up, where they are sharper.
      // Days after the mosaic's last are drawn at every distance, on top.
      const mosaic = this.mosaicFor(s.nisar);
      if (mosaic) layers.push({ url: NISAR_MOSAIC.url, maxLevel: mosaic.levels, has: mosaic.has });
      for (let i = s.nisar.days - 1; i >= 0; i--) {
        const date = iso(end - i * DAY);
        const under = mosaic && date <= mosaic.settled ? { minLevel: mosaic.levels + 2, backed: true } : null;
        // Radar passes are thin strips on an empty globe: see `sparse` in the tile engine.
        if (date >= NISAR_TILES.firstDate) layers.push({ url: NISAR_TILES.url.replace('{date}', date), sheet: NISAR_TILES.sheet.replace('{date}', date), map: NISAR_TILES.map.replace('{date}', date), colour: true, stack: 'nisar', age: i, maxLevel: NISAR_TILES.maxLevel, sparse: true, ...under });
      }
    }
    // An event's own filled layer (flood water) steps aside while a change
    // map is up: two blue fills with two meanings must not share the ground.
    if (!this.fillsHidden) for (const layer of s.fx) layers.push(layer);
    this.tiles.setLayers(layers);
    this.dirty = true;
  }

  setBasemap(key) {
    this.state.base = key;
    this.applyLayers();
  }

  setLighting(on) {
    // The shading itself eases in and out in the frame loop.
    this.nightOn = on;
    this.tiles.uniforms.uSun.value.copy(sunDirection());
    this.dirty = true;
  }

  // The ready-made whole-planet picture, from its `about.json`:
  // { from, to, levels, tiles: { level: ['x/y', …] } }, or null for none.
  // `settled` is the last day it can still stand for: NASA goes on adding
  // passes to a day for up to two weeks, and from the first day that has
  // changed since the mosaic was built, every day is drawn live again, on
  // top of it. (Every day from there on, not only the changed ones: the
  // newest pass has to end on top.)
  setMosaic(about, settled = about?.to) {
    this.mosaic = null;
    if (about?.tiles && about.to && Number.isInteger(about.levels)) {
      const held = Object.fromEntries(Object.entries(about.tiles).map(([z, list]) => [z, new Set(list)]));
      this.mosaic = { from: about.from, to: about.to, settled, levels: about.levels, has: (z, x, y) => !!held[z]?.has(`${x}/${y}`) };
    }
    this.applyLayers();
  }

  // The mosaic, if it serves what is asked for: the whole planet, up to a
  // day the mosaic reaches. (For an earlier day it would show passes that
  // had not been flown yet.)
  mosaicFor(nisar) {
    return this.mosaic && nisar.days > 12 && nisar.date >= this.mosaic.to ? this.mosaic : null;
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
    this.tiles.uniforms.uSweep.value.x = 0;
    if (!this.pictures.length) return;
    this.pictures = [];
    this.tiles.setPictures([]);
    this.tiles.uniforms.uSplit.value = 0.5;
    this.dirty = true;
  }

  // Shows a picture by cross-fading from whatever picture (or bare ground)
  // is there now. Used for the time-lapse and for single radar scenes.
  fadeTo(image, bounds, seconds = 0.5) {
    return this.fadeToAll([{ image, bounds, alpha: 1 }], seconds)[0];
  }

  // The same for a stack of pictures: [{ image, bounds, alpha }].
  fadeToAll(list, seconds = 0.5) {
    const shown = this.pictures.filter((p) => p.side !== 'left');
    const next = list.map((p) => ({ ...p, side: 'right' }));
    this.pictures = [...shown.map((p) => ({ ...p, side: 'left' })), ...next];
    this.tiles.fadeGen++;
    this.tiles.uniforms.uFadeDur.value = seconds;
    this.tiles.uniforms.uSweep.value.x = 0;
    this.tiles.setPictures(this.pictures);
    // Tiles repaint over a few frames, each starting its own fade.
    this.fadeEnd = (performance.now() - this.started) / 1000 + seconds + 0.8;
    this.dirty = true;
    return next;
  }

  // Uncovers a picture with a line that travels the way the satellite
  // flew: south to north on an ascending pass, north to south otherwise.
  sweepTo(image, bounds, ascending, seconds = 1.8) {
    const next = this.fadeToAll([{ image, bounds, alpha: 1 }], seconds)[0];
    const south = Math.sin(bounds.south * RAD);
    const north = Math.sin(bounds.north * RAD);
    // A short head start lets the tiles repaint before the line sets off.
    const start = (performance.now() - this.started) / 1000 + 0.4;
    this.tiles.uniforms.uSweep.value.set(1, ascending ? south : north, ascending ? north : south, start);
    this.fadeEnd = start + seconds + 0.6;
    return next;
  }

  settle() {
    this.fadeEnd = 0;
    this.tiles.uniforms.uFadeDur.value = 0;
    this.tiles.uniforms.uSweep.value.x = 0;
    const shown = this.pictures.filter((p) => p.side === 'right');
    if (!shown.length) return;
    this.pictures = shown.map((p) => ({ ...p, side: undefined }));
    this.tiles.setPictures(this.pictures);
    this.dirty = true;
  }

  // Drapes a radar preview over the terrain. side: 'left', 'right' or
  // undefined for the whole screen.
  async addScene(scene, bounds, side) {
    const image = await loadPicture(scene.image);
    return side ? this.addPicture(image, bounds, side) : this.sweepTo(image, bounds, scene.direction !== 'Descending');
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
    this.loadAhead(lat, lon, height / EARTH_RADIUS_M);
  }

  // While the globe is being turned, the map a second further on in that
  // direction starts loading before it comes into view.
  lookAhead(now) {
    const c = this.controls;
    // A camera that was sent somewhere already had its destination loaded
    // ahead; guessing along the way would only queue what it flies past.
    if (c.flight) return (this.turning = null);
    const was = this.turning;
    if (!was || now - was.at > 120) {
      if (was && now - was.at < 600) {
        const dt = (now - was.at) / 1000;
        const dLat = (c.lat - was.lat) / dt;
        const dLon = ((((c.lon - was.lon + 540) % 360) - 180) / dt);
        const speed = Math.hypot(dLat, dLon * Math.cos(c.lat * RAD)); // degrees a second
        if (speed > 1.5 && now - (this.aheadAt || 0) > 300) {
          this.aheadAt = now;
          this.tiles.prefetch(Math.max(-84, Math.min(84, c.lat + dLat * 0.9)), c.lon + dLon * 0.9, c.alt);
        }
      }
      this.turning = { at: now, lat: c.lat, lon: c.lon };
    }
  }

  // The map for where the camera is going starts loading as it sets off.
  // Asked three times on the way, because a radar layer finds its tiles
  // level by level.
  loadAhead(lat, lon, alt) {
    clearTimeout(this.aheadTimer1);
    clearTimeout(this.aheadTimer2);
    this.tiles.prefetch(lat, lon, alt, true);
    this.aheadTimer1 = setTimeout(() => this.tiles.prefetch(lat, lon, alt, true), 450);
    this.aheadTimer2 = setTimeout(() => this.tiles.prefetch(lat, lon, alt, true), 1000);
  }

  flyToBounds(b) {
    const lat = (b.north + b.south) / 2;
    const tall = (b.north - b.south) * RAD;
    const wide = (b.east - b.west) * RAD * Math.cos(lat * RAD);
    const fit = Math.max(tall, wide / this.camera.aspect) * 1.5;
    const alt = fit / 2 / Math.tan((this.camera.fov * RAD) / 2);
    this.controls.flyTo(lat, (b.west + b.east) / 2, alt, 1.6, { pitch: 0, heading: 0 });
    this.loadAhead(lat, (b.west + b.east) / 2, alt);
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

  // freshIds: events that arrived while the page was open (a quick pulse
  // for a minute and a half). recentIds: events of the last day (one soft
  // ring every few seconds).
  renderIncidents(list, freshIds, recentIds = new Set()) {
    const seconds = (performance.now() - this.started) / 1000;
    for (const id of freshIds) if (!this.born.has(id)) this.born.set(id, seconds);
    let pulseUntil = 0;
    this.pinging = false;
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
        // Each dot starts a little apart from the others, always the same
        // for the same event, so the globe does not blink as one.
        ping: recentIds.has(inc.id) ? ((this.pinging = true), ((hash(String(inc.id)) % 100) / 100) * PING_SPREAD) : undefined,
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

  // ---------- live layers ----------

  // NISAR's live position, orbit and radar swath; null hides them.
  // sat: { now: {lat, lon, altKm}, track: [{lat, lon, altKm, minutes}], swath: {near, far} }
  setSatellite(sat) {
    if (!sat) {
      this.satDots.set([], null);
      this.orbitPast.set([]);
      this.orbitAhead.set([]);
      this.swathLines.set([]);
      this.dirty = true;
      return;
    }
    const teal = rgb(PALETTE.nisar);
    const up = (p) => toVec(p.lat, p.lon, 1 + p.altKm / (EARTH_RADIUS_M / 1000));
    const ground = (p) => toVec(p.lat, p.lon, 1.0004);
    const alt = sat.now.altKm / (EARTH_RADIUS_M / 1000);
    // The satellite is NISAR, so it is teal like its orbit and its passes.
    this.satDots.set([{ sat: true, lat: sat.now.lat, lon: sat.now.lon, color: teal, size: 11 }], () => alt);
    // Both halves of the orbit meet exactly at the satellite.
    this.orbitPast.set([{ points: [...sat.track.filter((p) => p.minutes < 0).map(up), up(sat.now)], color: [...teal, 0.85] }]);
    this.orbitAhead.set([{ points: [up(sat.now), ...sat.track.filter((p) => p.minutes > 0).map(up)], color: [...teal, 0.45] }]);
    // The swath it swept over the last 25 minutes, plus two beams from the
    // satellite down to the near and far edge of the swath right now.
    const recent = sat.track.map((p, i) => ({ p, i })).filter(({ p }) => p.minutes >= -25 && p.minutes <= 0);
    const near = recent.map(({ i }) => ground(sat.swath.near[i]));
    const far = recent.map(({ i }) => ground(sat.swath.far[i]));
    const at = recent.length ? recent[recent.length - 1].i : -1;
    const beams =
      at >= 0
        ? [
            { points: [up(sat.now), ground(sat.swath.near[at])], color: [...teal, 0.4] },
            { points: [up(sat.now), ground(sat.swath.far[at])], color: [...teal, 0.4] },
          ]
        : [];
    this.swathLines.set([
      { points: near, color: [...teal, 0.7] },
      { points: far, color: [...teal, 0.7] },
      ...beams,
    ]);
    this.dirty = true;
  }

  // Wildlife sightings: [{ animal, lat, lon, color, size, splash }].
  // Sightings with splash get one expanding ring when they appear.
  setAnimals(list) {
    const seconds = (performance.now() - this.started) / 1000;
    let splash = false;
    this.animalDots.set(
      list.map((a) => {
        if (a.splash) splash = true;
        return { animal: a.animal, lat: a.lat, lon: a.lon, color: rgb(a.color), size: a.size || 6, born: a.splash ? seconds : undefined };
      }),
      this.lift,
    );
    if (splash) this.animalPulseUntil = seconds + 1.8;
    this.dirty = true;
  }

  // Points of interest: [{ poi, lat, lon }].
  setPois(list) {
    this.poiDots.set(
      list.map((p) => ({ poi: p.poi, lat: p.lat, lon: p.lon, color: rgb('#f4e3b2'), size: 7 })),
      this.lift,
    );
    this.dirty = true;
  }

  setShootingStars(on) {
    this.skyView.shooting.enabled = on;
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
        outlines.push({ ring: scene.ring, color: `rgba(${NISAR_RGB},${(0.8 * strength).toFixed(2)})`, fill: `rgba(${NISAR_RGB},${(0.07 * strength).toFixed(3)})`, width: 1.4 });
      }
    }
    for (const scene of this.highlighted) outlines.push({ ring: scene.ring, color: `rgba(${NISAR_RGB},1)`, width: 2.6 });
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
    // A mark that pops in needs frames until it has settled.
    for (const it of items) if (it.pop != null) this.popUntil = Math.max(this.popUntil, it.pop + 1.3);
    this.dirty = true;
  }

  // Filled or outlined areas painted into the ground:
  // [{ ring, color, fill, width, open }]
  setEffectZones(zones) {
    this.fxZones = zones;
    this.drawOutlines();
  }

  // Hides or brings back the event's filled layers (see applyLayers).
  setEffectFillsShown(on) {
    if (this.fillsHidden === !on) return;
    this.fillsHidden = !on;
    if (this.state.fx.length) this.applyLayers();
  }

  // Extra dated tile layers shown on top of everything else.
  setEffectLayers(layers) {
    this.state.fx = layers;
    this.applyLayers();
  }

  // Glowing points: [{ lat, lon, color: [r, g, b], size, km, flicker }]
  setEffectGlow(items) {
    this.fxGlow.set(items, this.lift);
    this.glowFlickers = items.some((it) => it.flicker);
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

  // Lets the map around a place step back while its replay plays, or
  // brings it forward again with null: { lat, lon, radiusKm }.
  setFocus(at) {
    this.focusTarget = at ? 1 : 0;
    if (at) {
      toVec(at.lat, at.lon, 1, this.tiles.uniforms.uFocusC.value);
      this.tiles.uniforms.uFocus.value.x = (at.radiusKm * 1000) / EARTH_RADIUS_M;
    }
    this.dirty = true;
  }

  // Data labels pinned to the globe: [{ lat, lon, text, color, within }].
  setLabels(items) {
    this.labels.set(items);
    this.dirty = true;
  }

  clearEffects() {
    this.glowFlickers = false;
    this.fxLines.set([]);
    this.fxDots.set([], this.lift);
    this.fxGlow.set([], this.lift);
    this.fire.set([]);
    this.vortex.set(null);
    this.setShockwave(null);
    this.setFocus(null);
    this.setLabels([]);
    if (this.fxZones.length) this.setEffectZones([]);
    if (this.state.fx.length) this.setEffectLayers([]);
    this.dirty = true;
  }

  // Ring on the chosen incident, arcs to everything linked to it, and a
  // bright outline around the given radar scenes.
  select(incident, scenes = []) {
    // The ring breathes for a moment on a new selection, then rests.
    const fresh = incident && incident.id !== this.selected?.id;
    if (fresh) this.ringUntil = this.clock + RING_SECONDS;
    this.selected = incident;
    this.ring.set(incident ? incident.lat : null, incident?.lon, incident ? this.lift(incident.lat, incident.lon) : 0, fresh ? this.clock : null);
    this.linkLines.set(
      incident
        ? incident.related.slice(0, 25).map((link) => ({
            points: greatCircle(incident, link.incident, 32, 1.0002, 0.12),
            // A link is context, not a kind of event: one neutral colour.
            color: [...rgb(PALETTE.context), 0.85],
          }))
        : [],
    );
    this.highlighted = scenes;
    this.drawOutlines();
  }
}

// Loads a radar preview and makes its black padding see-through, so only
// the imaged swath covers the ground.
//
// A full preview is about 2,000 pixels a side and 5 MB. Decoding it and
// going through its four million pixels used to freeze the globe for a
// moment each time, so both now happen on a second thread (a worker); the
// page only copies the finished picture onto a canvas. Where a browser
// cannot do that, the old way is used.
//
// A pass's picture never changes once published, so its bytes are also kept
// in the browser's own store: opening the same event again, today or next
// week, reads 5 MB from disk and not from NASA. The store holds the last
// eighty pictures and thumbnails.
const WORKER_SOURCE = `
  const KEPT = 80;
  const store = typeof caches === 'undefined' ? Promise.resolve(null) : caches.open('radar-pictures-1').catch(() => null);
  async function bytes(url) {
    const kept = await store;
    const hit = kept ? await kept.match(url).catch(() => null) : null;
    if (hit) return hit.blob();
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (kept) {
      kept.put(url, res.clone()).then(async () => {
        const keys = await kept.keys();
        for (const key of keys.slice(0, Math.max(0, keys.length - KEPT))) kept.delete(key);
      }).catch(() => {});
    }
    return res.blob();
  }
  self.onmessage = async (e) => {
    const { id, url } = e.data;
    try {
      const bitmap = await createImageBitmap(await bytes(url));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) if (px[i] < 4 && px[i + 1] < 4 && px[i + 2] < 4) px[i + 3] = 0;
      ctx.putImageData(data, 0, 0);
      const out = canvas.transferToImageBitmap();
      self.postMessage({ id, bitmap: out }, [out]);
    } catch (err) {
      self.postMessage({ id, error: String(err && err.message || err) });
    }
  };`;

let pictureWorker;
let pictureJobs = 0;
const picturePending = new Map();
function viaWorker(url) {
  if (pictureWorker === undefined) {
    try {
      if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('no off-screen canvas');
      pictureWorker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
      pictureWorker.onmessage = (e) => {
        const job = picturePending.get(e.data.id);
        picturePending.delete(e.data.id);
        if (!job) return;
        if (e.data.error) return job.reject(new Error(e.data.error));
        const canvas = document.createElement('canvas');
        canvas.width = e.data.bitmap.width;
        canvas.height = e.data.bitmap.height;
        canvas.getContext('2d', { willReadFrequently: true }).drawImage(e.data.bitmap, 0, 0);
        e.data.bitmap.close();
        job.resolve(canvas);
      };
      pictureWorker.onerror = () => {
        // The worker itself failed: everything waiting falls back.
        for (const job of picturePending.values()) job.reject(new Error('worker failed'));
        picturePending.clear();
        pictureWorker = null;
      };
    } catch {
      pictureWorker = null;
    }
  }
  if (!pictureWorker) return Promise.reject(new Error('no worker'));
  return new Promise((resolve, reject) => {
    const id = ++pictureJobs;
    picturePending.set(id, { resolve, reject });
    pictureWorker.postMessage({ id, url });
  });
}

function onThisThread(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error('Preview image failed to load'));
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
  });
}

// Decoded pictures kept ready in memory. A full preview is about 16 MB once
// decoded, so they are counted by size, and the one used longest ago goes
// first. Whatever is dropped here is still in the store on disk.
const PICTURE_MEMORY = 180e6;
const pictureCache = new Map();
const pictureSizes = new Map();
export function loadPicture(url) {
  const held = pictureCache.get(url);
  if (held) {
    // Used again: move it to the fresh end.
    pictureCache.delete(url);
    pictureCache.set(url, held);
    return held;
  }
  const picture = viaWorker(url).catch(() => onThisThread(url));
  pictureCache.set(url, picture);
  picture.then(
    (canvas) => {
      // Dropped from the cache while it was loading: it is not counted.
      if (pictureCache.get(url) !== picture) return;
      pictureSizes.set(url, canvas.width * canvas.height * 4);
      let total = 0;
      for (const size of pictureSizes.values()) total += size;
      for (const key of [...pictureCache.keys()]) {
        if (total <= PICTURE_MEMORY) break;
        // Pictures still loading have no size yet and free nothing.
        if (key === url || !pictureSizes.has(key)) continue;
        total -= pictureSizes.get(key);
        pictureSizes.delete(key);
        pictureCache.delete(key);
      }
    },
    () => {
      if (pictureCache.get(url) === picture) pictureCache.delete(url);
    },
  );
  return picture;
}

const scratch = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ball = new THREE.Sphere(new THREE.Vector3(), 1);
