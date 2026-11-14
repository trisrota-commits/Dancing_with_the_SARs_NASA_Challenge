// Streams map tiles onto the sphere and shapes them into real terrain.
//
// A quadtree picks the tiles the camera needs. Each visible tile composites
// every active layer (tile layers, single images such as radar previews, and
// outlines) into one small canvas, so the GPU draws exactly one textured mesh
// per tile however much is switched on, and everything drapes over the relief.

import * as THREE from '../../vendor/three.module.min.js';
import { RAD, EARTH_RADIUS_M, toVec, tileLon, tileLat, lonDelta } from './geo.js';

const SIZE = 256;
const GRID = 32;
const MIN_ZOOM = 2;
const MAX_ZOOM = 17;
const MAX_LEAVES = 320;
const PARALLEL_DOWNLOADS = 28;
const AHEAD_DOWNLOADS = 8; // of which at most this many for pictures fetched ahead of need
// A layer marked `sparse` (radar passes: thin strips on an empty globe) is
// mostly tiles with nothing on them, and asking the server for each of them
// is what makes such a layer slow. So the engine never asks blindly:
//
// - Where the layer gives a `sheet` (one picture of the whole world, which
//   NASA's map service draws on request), that single picture is fetched
//   first. It is the layer as seen from far away, it stands in for any
//   tile that is still on its way, and it says where on the globe the
//   layer has anything at all, down to level 7.
// - Below that, and for a layer without a sheet, a tile that holds a
//   picture is cut into 8 × 8 cells, and a cell with nothing in it means
//   every tile beneath it, three levels down, is empty and is never asked
//   for.
// - A tile the server answers with its tiny see-through picture is empty
//   (known by the size of the answer, never decoded).
const EMPTY_BYTES = 300;
const SHEET_PX = 1024; // the world picture: the level-2 tiles in one piece
const SHEET_LEVEL = 2;
const SHEET_CELLS = 128; // its cells: one for each tile of level 7
const SHEET_REACH = 7;
const PROBES_UNDER_SHEET = [7, 10, 13];
const PROBE_LEVELS = [0, 3, 6, 9, 12]; // for a layer without a sheet
const CELLS = 8; // 8 × 8 cells: three levels of tiles beneath
const EMPTY_KEPT = 30000; // empty answers remembered; they cost nothing
// Seen from far away, a sparse layer is drawn from tiles one level coarser
// than the map beneath it: a quarter of the pictures, and thin strips on a
// whole continent lose nothing by it.
const COARSER_BELOW = 7;
// NASA's server tells browsers not to keep its tiles, so a second visit
// would fetch every radar tile again. The engine keeps them itself, in the
// browser's own store, and trusts them only as long as that day's picture
// of the whole world (always fetched fresh) is byte for byte what it was.
const STORE = 'radar-tiles-1';
const STORE_DAYS = 45; // days older than this are cleared out of the store
const RETRY_MS = 12_000; // a tile that was not delivered is asked for again after this,
const RETRY_LONGEST = 16; // then after twice as long each time, up to this many times as long
const RETRIES_PLAIN = 3; // a layer that cannot tell "no data here" from a failure stops after this many
const HALF_WORLD = 20037508.342789244; // Web Mercator, in metres
const RECHECK_MS = 5 * 60_000; // how often the whole-world pictures are fetched again
// Phones and tablets have far less memory to give a page than a laptop.
const SMALL = !!globalThis.matchMedia?.('(pointer: coarse)').matches;
const IMAGE_CACHE = SMALL ? 450 : 900;
const TILE_CACHE = SMALL ? 220 : 420;
// Time for painting tiles in one frame, so the globe keeps turning smoothly
// while a new layer fills in.
const PAINT_MS = 6;

// Open elevation tiles (Mapzen/AWS Terrain Tiles): height in metres packed
// into the red, green and blue of each pixel.
const ELEVATION_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const ELEVATION_MAX = 13;
// One elevation tile serves 8×8 map tiles: 256 samples spread over 32 cells.
const ELEVATION_SHIFT = 3;
const ELEVATION_CACHE = 260;

const VERTEX = /* glsl */ `
  attribute float aHeight;
  attribute float aDrop;
  attribute float aShade;
  uniform float uExaggeration;
  uniform vec3 uWaveC;
  uniform vec4 uWave;
  uniform vec2 uRipple;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vShade;
  void main() {
    vUv = uv;
    vNormal = normal;
    vShade = aShade;
    float h = aHeight * uExaggeration - aDrop;
    // A passing shock front lifts the ground in a ripple (see setShockwave).
    if (uWave.w > 0.0) {
      float d = 2.0 * asin(min(1.0, length(normal - uWaveC) * 0.5));
      float x = (d - uWave.x) / uRipple.x;
      h += uWave.w * uRipple.y * exp(-x * x) * cos(x * 2.5);
    }
    vec3 p = position + normal * (h / ${EARTH_RADIUS_M.toFixed(1)});
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D mapB;
  uniform sampler2D mapW;
  uniform float uUseB;
  uniform float uUseW;
  uniform float uSplit;
  uniform float uFadeDur;
  uniform float uFadeAt;
  uniform vec4 uSweep;
  uniform vec3 uFocusC;
  uniform vec2 uFocus;
  uniform float uTime;
  uniform vec3 uWater;
  uniform vec2 uViewport;
  uniform vec3 uSun;
  uniform float uNight;
  uniform float uRelief;
  uniform vec3 uWaveC;
  uniform vec4 uWave;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vShade;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // Two sheets of ripples sliding over each other, 0..1.
  float ripples(vec2 p) {
    return noise(p + vec2(uTime * 0.33, uTime * 0.21)) * 0.6 + noise(p * 1.9 - vec2(uTime * 0.29, -uTime * 0.26)) * 0.4;
  }
  void main() {
    vec3 color = texture2D(map, vUv).rgb;
    if (uUseB > 0.5) {
      vec3 other = texture2D(mapB, vUv).rgb;
      if (uFadeDur > 0.0 && uSweep.x > 0.5) {
        // The new picture is uncovered by a line travelling the way the
        // satellite flew, from one latitude to another.
        float t = clamp((uTime - uSweep.w) / uFadeDur, 0.0, 1.0);
        float along = (normalize(vNormal).y - uSweep.y) / (uSweep.z - uSweep.y);
        float edge = t * 1.1 - 0.05;
        float differs = step(0.02, length(color - other));
        vec3 next = color;
        color = mix(other, next, smoothstep(edge, edge - 0.03, along));
        float q = (along - edge) / 0.012;
        float line = exp(-q * q) * differs * step(t, 0.999);
        color += vec3(0.22, 0.9, 0.77) * line * 0.8;
      } else if (uFadeDur > 0.0) {
        // Cross-fade from the previous picture, timed from when this tile
        // was painted with the new one.
        float f = clamp((uTime - uFadeAt) / uFadeDur, 0.0, 1.0);
        color = mix(other, color, f * f * (3.0 - 2.0 * f));
      } else if (gl_FragCoord.x / uViewport.x < uSplit) {
        // Left of the divider shows the "before" picture.
        color = other;
      }
    }
    color *= mix(1.0, vShade, uRelief);
    // Flood water, from a mask painted for this tile: red is how much of the
    // spot is water, green is the replay step at which it was first seen.
    if (uUseW > 0.5) {
      vec4 mask = texture2D(mapW, vUv);
      vec3 n = normalize(vNormal);
      vec2 km = vec2(atan(n.x, n.z), asin(n.y)) * 6371.0;
      // Ripples keep about the same size on screen, so detail grows as the
      // camera comes closer: two neighbouring wave sizes, blended.
      float kmPerPixel = max(length(dFdx(km)), length(dFdy(km)));
      // Dry ground (most of every tile) skips the wave maths altogether.
      if (mask.r > 0.05) {
        float level = log2(max(kmPerPixel, 1e-6) * 26.0);
        float size = exp2(floor(level));
        float wave = mix(ripples(km / size), ripples(km / (size * 2.0)), fract(level));
        float cover = mask.r;
        float arrive = smoothstep(-0.15, 0.85, uWater.x - mask.g * uWater.y);
        float wet = smoothstep(0.1, 0.5, cover) * arrive;
        vec3 water = mix(vec3(0.24, 0.6, 0.84), vec3(0.05, 0.27, 0.5), smoothstep(0.35, 0.95, cover)) * (0.8 + 0.4 * wave);
        color = mix(color, water, wet * 0.8);
        color += vec3(0.85, 0.95, 1.0) * smoothstep(0.66, 0.9, wave) * wet * 0.3;
        // Waves lapping along the edge of the water.
        float shore = smoothstep(0.06, 0.28, cover) * (1.0 - smoothstep(0.3, 0.72, cover)) * arrive;
        float lap = 0.5 + 0.5 * sin(cover * 13.0 - uTime * 1.9 + wave * 5.0);
        color += vec3(0.8, 0.93, 1.0) * shore * smoothstep(0.5, 1.0, lap) * 0.55;
        // Water that is just arriving lights up for a moment.
        color += vec3(0.45, 0.75, 1.0) * arrive * (1.0 - arrive) * smoothstep(0.1, 0.5, cover) * 1.3;
      }
    }
    float lit = smoothstep(-0.12, 0.18, dot(normalize(vNormal), uSun));
    // Night is dim and cool, but the ground stays readable. uNight drops
    // while data is being shown: radar does not need daylight, and a
    // picture or a replay should look the same on either side of the Earth.
    color *= mix(vec3(1.0), mix(vec3(0.2, 0.24, 0.33), vec3(1.0), lit), uNight);
    // While a replay plays, the map around it steps back: dimmer and
    // greyer outside the scene, a touch dimmer inside, so the data glows.
    if (uFocus.y > 0.0) {
      float d = 2.0 * asin(min(1.0, length(normalize(vNormal) - uFocusC) * 0.5));
      float outside = smoothstep(uFocus.x, uFocus.x * 1.9, d);
      float grey = dot(color, vec3(0.3, 0.59, 0.11));
      color = mix(color, mix(color * 0.93, mix(color, vec3(grey), 0.55) * 0.62, outside), uFocus.y);
    }
    // Shock fronts glow on the ground: the slower, stronger wave in red
    // with a fading wake behind it, the faster one ahead of it in white.
    if (uWave.w > 0.0) {
      float d = 2.0 * asin(min(1.0, length(normalize(vNormal) - uWaveC) * 0.5));
      float s = (d - uWave.x) / uWave.z;
      float p = (d - uWave.y) / uWave.z;
      float wake = d < uWave.x ? exp((d - uWave.x) / (uWave.z * 7.0)) * 0.3 : 0.0;
      color += vec3(1.0, 0.34, 0.2) * (exp(-s * s) + wake) * uWave.w;
      color += vec3(0.8, 0.9, 1.0) * exp(-p * p * 3.0) * uWave.w * 0.4;
    }
    gl_FragColor = vec4(color, 1.0);
  }`;

// Triangles for a rows×cols grid plus a skirt hanging from its rim, which
// hides hairline gaps between neighbouring tiles of different height detail.
const layoutCache = new Map();
function layout(rows, cols) {
  const key = `${rows}x${cols}`;
  if (!layoutCache.has(key)) {
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + cols;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const rim = [];
    for (let c = 0; c < cols; c++) rim.push(c);
    for (let r = 1; r < rows; r++) rim.push(r * cols + cols - 1);
    for (let c = cols - 2; c >= 0; c--) rim.push((rows - 1) * cols + c);
    for (let r = rows - 2; r >= 1; r--) rim.push(r * cols);
    const base = rows * cols;
    for (let k = 0; k < rim.length; k++) {
      const n = (k + 1) % rim.length;
      idx.push(rim[k], base + k, rim[n], rim[n], base + k, base + n);
    }
    layoutCache.set(key, { index: new THREE.BufferAttribute(new Uint16Array(idx), 1), rim });
  }
  return layoutCache.get(key);
}

const mercatorX = (lon) => (lon + 180) / 360;
const mercatorY = (lat) => (1 - Math.asinh(Math.tan(Math.max(-85.05, Math.min(85.05, lat)) * RAD)) / Math.PI) / 2;

// Height in metres at fractional pixel (px, py) of a decoded elevation tile.
function sample(h, px, py) {
  const x = Math.max(0, Math.min(SIZE - 1.001, px));
  const y = Math.max(0, Math.min(SIZE - 1.001, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * SIZE + x0;
  const top = h[i] * (1 - fx) + h[i + 1] * fx;
  const bottom = h[i + SIZE] * (1 - fx) + h[i + SIZE + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

export class TileGlobe {
  constructor(scene, shared) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // Dark sphere just under the tiles, so nothing ever shows space through.
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.997, 96, 64), new THREE.MeshBasicMaterial({ color: 0x08121d })));

    this.layers = [];
    this.pictures = [];
    this.outlines = [];
    this.tiles = new Map();
    this.images = new Map();
    this.queue = [];
    this.downloading = 0;
    this.faulty = 0; // answers from the tile service that were not sound
    this.mended = 0; // tiles taken from the map service instead
    this.elevation = new Map();
    this.elevationQueue = [];
    this.elevationLoading = 0;
    this.elevationVersion = 0;
    this.terrain = true;
    this.frame = 0;
    this.leaves = [];
    this.changed = true;
    this.uniforms = {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uNight: { value: 0 },
      uExaggeration: { value: 2 },
      uRelief: { value: 1 },
      uSplit: { value: 0.5 },
      // Above zero, a tile with two pictures cross-fades between them over
      // this many seconds instead of splitting at the divider.
      uFadeDur: { value: 0 },
      // Sweep reveal: on or off, the sine of the latitude it starts and
      // ends at, and the time it starts.
      uSweep: { value: new THREE.Vector4(0, 0, 1, 0) },
      // Focus: centre, then radius (radians) and strength 0..1.
      uFocusC: { value: new THREE.Vector3(0, 1, 0) },
      uFocus: { value: new THREE.Vector2(1, 0) },
      uTime: shared.uTime,
      // Flood water: the replay step now, and the number of steps.
      uWater: { value: new THREE.Vector3(0, 1, 0) },
      // Shock front: centre, then S radius, P radius, glow width (radians)
      // and strength; ripple width (radians) and height (metres).
      uWaveC: { value: new THREE.Vector3(0, 1, 0) },
      uWave: { value: new THREE.Vector4(0, 0, 1, 0) },
      uRipple: { value: new THREE.Vector2(1, 0) },
      uViewport: shared.uViewport,
    };
    this.frustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
    this.scratch = document.createElement('canvas');
    this.scratch.width = this.scratch.height = SIZE;
    // A quarter-size canvas used to soften the edges of the water mask.
    this.soft = document.createElement('canvas');
    this.soft.width = this.soft.height = SIZE / 4;
    this.softCtx = this.soft.getContext('2d');
    this.fadeGen = 0;
    this.focus = new THREE.Vector3(0, 0, 1);
    this.checkedAt = performance.now();
    // The browser's store for radar tiles; null where there is none.
    this.store = typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(STORE).catch(() => null);
    this.store.then((store) => store && this.sweepStore(store));
    this.reader = document.createElement('canvas');
    this.reader.width = this.reader.height = SIZE;
    this.readerCtx = this.reader.getContext('2d', { willReadFrequently: true });
  }

  // True while a water mask layer is on the globe.
  get masked() {
    return this.layers.some((l) => l.mask != null);
  }

  repaintAll() {
    for (const tile of this.tiles.values()) tile.dirty = true;
    this.changed = true;
  }

  // Tile layers: [{ url: 'https://…/{z}/{y}/{x}.png', maxLevel, alpha, base, bounds }]
  // A layer with bounds is only fetched and drawn for tiles inside that box.
  // A layer with keep(r, g, b) has every other pixel made see-through, and
  // tint recolours what is kept. A layer with a mask step (0, 1, 2…) is not
  // drawn as a picture: it marks water first seen at that step, which the
  // shader animates. Its tint must be [255, step code, 0].
  setLayers(layers) {
    this.layers = layers;
    for (const entry of this.queue) this.putDown(entry);
    this.queue.length = 0;
    // Keep the whole world at low detail on hand as a stand-in, so a tile
    // that is still downloading shows a soft picture instead of a blank.
    const base = layers.find((l) => l.base);
    for (const entry of this.images.values()) entry.pinned = false;
    if (base) {
      for (let z = 0; z <= 2; z++) {
        for (let i = 0; i < 4 ** z; i++) this.image(base, z, i % 2 ** z, Math.floor(i / 2 ** z), null).pinned = true;
      }
    }
    // For a sparse layer, ask for its picture of the whole world straight
    // away: one small answer says where on the globe it has anything.
    // Where that picture is already here, the level beneath it is asked for
    // again: the queue was just emptied.
    // World pictures of layers no longer on the globe may be let go like
    // any other picture; those in use are held on to.
    const inUse = new Set(layers.map((l) => l.sheet).filter(Boolean));
    for (const entry of this.images.values()) {
      if (!entry.sheet) continue;
      entry.probe = inUse.has(entry.key);
      entry.warmed = 0;
    }
    for (const layer of layers) {
      if (!layer.sparse) continue;
      if (layer.sheet) this.sheetOf(layer, null);
      else this.image(layer, 0, 0, 0, null);
    }
    this.warmAt = 0;
    this.repaintAll();
  }

  // Single images laid over a lat/lon box:
  // [{ image, bounds: { west, south, east, north }, side: 'left' | 'right' | undefined, alpha }]
  setPictures(pictures) {
    // Only the tiles under the old or the new pictures need painting again.
    const touched = [...this.pictures, ...pictures].map((p) => p.bounds);
    this.pictures = pictures;
    for (const tile of this.tiles.values()) {
      if (touched.some((b) => b.east > tile.west && b.west < tile.east && b.north > tile.south && b.south < tile.north)) tile.dirty = true;
    }
    this.changed = true;
  }

  // Outlines drawn on the ground: [{ ring: [{ lat, lon }…], color: 'rgba(…)', width }]
  setOutlines(outlines) {
    for (const o of outlines) {
      const lon0 = o.ring[0].lon;
      // Unwrap around the first corner so shapes crossing 180° stay whole.
      o.points = o.ring.map((p) => ({ x: mercatorX(lon0 + lonDelta(p.lon, lon0)), y: mercatorY(p.lat) }));
      o.minX = Math.min(...o.points.map((p) => p.x));
      o.maxX = Math.max(...o.points.map((p) => p.x));
      o.minY = Math.min(...o.points.map((p) => p.y));
      o.maxY = Math.max(...o.points.map((p) => p.y));
    }
    this.outlines = outlines;
    this.repaintAll();
  }

  setTerrain(on) {
    this.terrain = on;
    for (const tile of this.tiles.values()) tile.shapeDirty = true;
    this.changed = true;
  }

  // ---------- tile selection ----------

  select(camera, viewportHeight) {
    const cam = camera.position;
    const dist = cam.length();
    this.cam = cam;
    this.alt = Math.max(1e-6, dist - 1);
    this.camLat = Math.asin(cam.y / dist) / RAD;
    this.camLon = Math.atan2(cam.x, cam.z) / RAD;
    // Angle one screen pixel covers, per unit of distance from the camera.
    this.pixel = (2 * Math.tan((camera.fov * RAD) / 2)) / viewportHeight;
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);

    const leaves = [];
    this.visit(0, 0, 0, leaves);
    this.leaves = leaves;
  }

  visit(z, x, y, leaves) {
    const west = tileLon(x, z);
    const east = tileLon(x + 1, z);
    const north = tileLat(y, z);
    const south = tileLat(y + 1, z);

    // Closest point of the tile to the spot under the camera.
    const lat = Math.max(south, Math.min(north, this.camLat));
    const midLon = (west + east) / 2;
    const half = (east - west) / 2;
    const lon = midLon + Math.max(-half, Math.min(half, lonDelta(this.camLon, midLon)));
    const near = toVec(lat, lon, 1, scratchA);

    if (z >= MIN_ZOOM) {
      if (near.dot(this.cam) < 0.996) return; // over the horizon
      if (z > 3) {
        // Bounding ball around the tile, raised to the ground height there.
        const midLat = (north + south) / 2;
        const centre = toVec(midLat, midLon, 1, scratchB);
        const corner = toVec(Math.abs(north) < Math.abs(south) ? north : south, west, 1, scratchC);
        const radius = centre.distanceTo(corner);
        const lift = z > 6 ? (this.heightAt(midLat, midLon) * this.uniforms.uExaggeration.value) / EARTH_RADIUS_M : 0.003;
        sphere.center.copy(centre).multiplyScalar(1 + (z > 6 ? lift : 0));
        sphere.radius = radius * 1.25 + (z > 6 ? 0.00008 : lift);
        if (!this.frustum.intersectsSphere(sphere)) return;
      }
    }

    let split = z < MIN_ZOOM;
    if (!split && z < MAX_ZOOM && leaves.length < MAX_LEAVES) {
      const range = Math.max(this.alt * 0.6, near.distanceTo(this.cam));
      // Ground width of one texel, foreshortened when seen at a slant.
      const facing = Math.max(0.14, (near.dot(this.cam) - 1) / range);
      const texel = ((2 * Math.PI * Math.cos(lat * RAD)) / 2 ** z / SIZE) * facing;
      split = texel > this.pixel * range * 0.95;
    }
    if (split) {
      for (let i = 0; i < 4; i++) this.visit(z + 1, x * 2 + (i & 1), y * 2 + (i >> 1), leaves);
    } else {
      leaves.push({ z, x, y, west, east, north, south });
    }
  }

  // ---------- per-frame work ----------

  // `focus` is the point on the globe the camera looks at (a unit vector):
  // what is nearest to it is painted and downloaded first.
  update(camera, viewportHeight, moved, focus) {
    this.frame++;
    if (focus) this.focus.copy(focus);
    this.recheck();
    this.warm();
    if (moved) {
      this.select(camera, viewportHeight);
      const wanted = new Set();
      for (const leaf of this.leaves) {
        const key = `${leaf.z}/${leaf.x}/${leaf.y}`;
        wanted.add(key);
        let tile = this.tiles.get(key);
        if (!tile) {
          tile = this.build(leaf, key);
          this.tiles.set(key, tile);
        }
        tile.lastUsed = this.frame;
        tile.mesh.visible = true;
        // While it was off screen a request it was waiting for was put
        // down: it has to ask again, or it would stay as it was painted.
        if (tile.stale) {
          tile.stale = false;
          tile.dirty = true;
        }
      }
      const hidden = [];
      for (const tile of this.tiles.values()) {
        if (wanted.has(tile.key)) continue;
        tile.mesh.visible = false;
        hidden.push(tile);
      }
      // Hidden tiles stay cached for quick returns; the oldest go first.
      if (this.tiles.size > TILE_CACHE) {
        hidden.sort((a, b) => a.lastUsed - b.lastUsed);
        for (const tile of hidden.slice(0, this.tiles.size - TILE_CACHE)) this.drop(tile.key, tile);
      }
      this.changed = true;
    }

    // Reshape, then repaint a bounded number of tiles per frame: those in
    // the middle of the view first, the edges last.
    const stale = [];
    for (const tile of this.tiles.values()) {
      if (!tile.mesh.visible) continue;
      if (tile.shapeDirty) {
        this.shape(tile);
        this.changed = true;
      }
      if (tile.dirty) stale.push(tile);
    }
    if (stale.length) {
      if (stale.length > 1) {
        for (const tile of stale) tile.far = 1 - tile.mesh.position.dot(this.focus) / tile.mesh.position.length();
        stale.sort((a, b) => a.far - b.far);
      }
      let budget = 24;
      const deadline = performance.now() + PAINT_MS;
      for (const tile of stale) {
        this.paint(tile);
        this.changed = true;
        if (--budget === 0 || performance.now() > deadline) break;
      }
    }
    this.pump();
    this.pumpElevation();
    const changed = this.changed;
    this.changed = false;
    return changed;
  }

  build(leaf, key) {
    const { z, x, y } = leaf;
    // Relief is invisible on continent-sized tiles; spend fewer triangles
    // there. Not on the very largest, though: a quarter-of-the-globe tile
    // with few cells is flat enough between its corners to dip under the
    // dark sphere behind the map, which then shows through as a dark patch
    // in every cell.
    const n = z <= 2 || z > 4 ? GRID : GRID / 2;
    const edge = 2 ** z - 1;
    // Rows from north to south; the outermost tiles reach on to the pole.
    const rows = [];
    if (y === 0) rows.push({ lat: 90, v: 1, t: 0 });
    for (let j = 0; j <= n; j++) rows.push({ lat: tileLat(y + j / n, z), v: 1 - j / n, t: j / n });
    if (y === edge) rows.push({ lat: -90, v: 0, t: 1 });

    const cols = n + 1;
    const { index, rim } = layout(rows.length, cols);
    const count = rows.length * cols + rim.length;
    const centre = toVec((leaf.north + leaf.south) / 2, (leaf.west + leaf.east) / 2);
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const drop = new Float32Array(count);
    const p = new THREE.Vector3();
    let k = 0;
    for (const row of rows) {
      for (let i = 0; i <= n; i++, k++) {
        toVec(row.lat, leaf.west + ((leaf.east - leaf.west) * i) / n, 1, p);
        normal.set([p.x, p.y, p.z], k * 3);
        // Stored relative to the tile centre to keep full precision up close.
        position.set([p.x - centre.x, p.y - centre.y, p.z - centre.z], k * 3);
        uv.set([i / n, row.v], k * 2);
      }
    }
    const midLat = (leaf.north + leaf.south) / 2;
    const width = (2 * Math.PI * EARTH_RADIUS_M * Math.cos(midLat * RAD)) / 2 ** z;
    rim.forEach((from, s) => {
      const to = rows.length * cols + s;
      position.copyWithin(to * 3, from * 3, from * 3 + 3);
      normal.copyWithin(to * 3, from * 3, from * 3 + 3);
      uv.copyWithin(to * 2, from * 2, from * 2 + 2);
      drop[to] = Math.max(300, width * 0.04);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('aDrop', new THREE.BufferAttribute(drop, 1));
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
    geometry.setIndex(index);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const texture = this.texture(canvas);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, map: { value: texture }, mapB: { value: texture }, mapW: { value: texture }, uUseB: { value: 0 }, uUseW: { value: 0 }, uFadeAt: { value: -1e6 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(centre);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return {
      ...leaf,
      key,
      mesh,
      rows,
      cols,
      rim,
      width,
      canvas,
      ctx: canvas.getContext('2d'),
      texture,
      dirty: true,
      shapeDirty: true,
      heightLevel: -1,
      lastUsed: this.frame,
    };
  }

  texture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  drop(key, tile) {
    this.group.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.mesh.material.dispose();
    tile.texture.dispose();
    tile.textureB?.dispose();
    tile.textureW?.dispose();
    // A canvas keeps its memory until it is collected; emptying it gives
    // the memory back at once, which matters on phones.
    for (const c of [tile.canvas, tile.canvasB, tile.canvasW]) if (c) c.width = c.height = 0;
    tile.dead = true;
    this.tiles.delete(key);
  }

  // ---------- painting ----------

  // Draws one tile layer for this tile onto a canvas, using a coarser cached
  // image as a stand-in when the exact tile has not arrived yet. With `only`
  // it draws just one of the two: 'soft' the stand-in, 'sharp' the real tile
  // (see `paint` for why the days of a stack are drawn in two rounds).
  drawLayer(target, tile, layer, alpha, only) {
    const { z, x, y } = tile;
    const sheet = layer.sparse && layer.sheet ? this.sheetOf(layer, tile) : null;
    const world = sheet?.state === 'ready' ? sheet : null;
    // From far away the world picture is the layer: nothing else is fetched.
    if (world && z <= SHEET_LEVEL + 1) return only !== 'soft' && this.sheetHolds(world, z, x, y) && this.drawSheet(target, tile, world, alpha);
    const top = Math.min(layer.sparse && z > 2 && z < COARSER_BELOW ? z - 1 : z, layer.maxLevel);
    const exact = this.image(layer, top, x >> (z - top), y >> (z - top), tile);
    // Known to hold nothing: no picture, and no stand-in from above either.
    if (exact.state === 'empty') return false;
    // A tile that was not delivered will be asked for again: the map tile
    // is marked so that it is painted again when that is due.
    if (exact.state === 'missing' && this.dueAgain(exact) < Infinity) {
      tile.patchy = true;
      this.wakeFor(exact);
    }
    // A tile the server would not give may be a gap in the data or a server
    // hiccup: ask for the tile one level coarser and use what is at hand.
    if (exact.state === 'missing' && !layer.base && top > 0) this.image(layer, top - 1, x >> (z - top + 1), y >> (z - top + 1), tile);
    // A much coarser stand-in is fine for a picture but would smear a water
    // mask over the whole tile, so masks only reach two levels down.
    const lowest = layer.mask != null ? Math.max(0, top - 2) : 0;
    for (let level = top; level >= lowest; level--) {
      const shift = z - level;
      const entry = level === top ? exact : this.images.get(this.key(layer, level, x >> shift, y >> shift));
      // Nothing here at a coarser level means nothing here at all.
      if (entry && entry.state === 'empty') return false;
      if (!entry || entry.state !== 'ready') continue;
      if (only && (only === 'sharp') !== (level === top)) return false;
      const scale = 2 ** shift;
      const span = SIZE / scale;
      target.globalAlpha = alpha;
      target.drawImage(entry.img, (x % scale) * span, (y % scale) * span, span, span, 0, 0, SIZE, SIZE);
      entry.lastUsed = this.frame;
      return true;
    }
    // Nothing sharper is here yet: the world picture stands in.
    return world && only !== 'sharp' ? this.drawSheet(target, tile, world, alpha) : false;
  }

  // Draws layers in their order, each onto the canvas `targetOf` names.
  //
  // Layers of one stack (the days of a radar layer) lie on top of each
  // other, later over earlier. A day whose real tile is not here yet only
  // has a blurred stand-in to show, and that must never cover the sharp
  // picture of another day. So a stack is drawn in two rounds, at the place
  // of its first day: all stand-ins, then all real tiles.
  drawLayers(tile, layers, targetOf) {
    const groups = [];
    const stacks = new Map();
    for (const layer of layers) {
      if (!layer.stack) groups.push([layer]);
      else if (stacks.has(layer.stack)) stacks.get(layer.stack).push(layer);
      else {
        stacks.set(layer.stack, [layer]);
        groups.push(stacks.get(layer.stack));
      }
    }
    for (const group of groups) {
      if (!group[0].stack) this.drawLayer(targetOf(group[0]), tile, group[0], group[0].alpha ?? 1);
      else for (const only of ['soft', 'sharp']) for (const layer of group) this.drawLayer(targetOf(layer), tile, layer, layer.alpha ?? 1, only);
    }
  }

  // Composites everything for this tile. Layers and pictures with a side
  // ('left' or 'right') only show on that side of the divider, which needs
  // a second canvas for what the left side should show.
  paint(tile) {
    const ctx = tile.ctx;
    tile.dirty = false;
    tile.patchy = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a1826';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const sidedLayers = [];
    const maskLayers = [];
    const plain = [];
    for (const layer of this.layers) {
      const b = layer.bounds;
      if (b && !(b.east > tile.west && b.west < tile.east && b.north > tile.south && b.south < tile.north)) continue;
      if (layer.mask != null) maskLayers.push(layer);
      else if (layer.side) sidedLayers.push(layer);
      else plain.push(layer);
    }
    this.drawLayers(tile, plain, () => ctx);
    this.paintMask(tile, maskLayers);
    ctx.globalAlpha = 1;

    const here = this.pictures.filter((p) => p.bounds.east > tile.west && p.bounds.west < tile.east && p.bounds.north > tile.south && p.bounds.south < tile.north);
    const sided = sidedLayers.length > 0 || here.some((p) => p.side);
    if (sided) {
      if (!tile.canvasB) {
        tile.canvasB = document.createElement('canvas');
        tile.canvasB.width = tile.canvasB.height = SIZE;
        tile.ctxB = tile.canvasB.getContext('2d');
        tile.textureB = this.texture(tile.canvasB);
        tile.mesh.material.uniforms.mapB.value = tile.textureB;
      }
      tile.ctxB.globalAlpha = 1;
      tile.ctxB.drawImage(tile.canvas, 0, 0);
    }
    // A new cross-fade starts on this tile once it holds both pictures.
    if (sided && this.uniforms.uFadeDur.value > 0 && tile.fadeGen !== this.fadeGen) {
      tile.fadeGen = this.fadeGen;
      tile.mesh.material.uniforms.uFadeAt.value = this.uniforms.uTime.value;
    }
    this.drawLayers(tile, sidedLayers, (layer) => (layer.side === 'left' ? tile.ctxB : ctx));
    ctx.globalAlpha = 1;
    if (sided) tile.ctxB.globalAlpha = 1;
    for (const picture of here) {
      if (picture.side !== 'left') this.drape(ctx, tile, picture);
      if (sided && picture.side !== 'right') this.drape(tile.ctxB, tile, picture);
    }
    this.stroke(ctx, tile);
    if (sided) {
      this.stroke(tile.ctxB, tile);
      tile.textureB.needsUpdate = true;
    }
    tile.mesh.material.uniforms.uUseB.value = sided ? 1 : 0;
    if (!sided) this.release(tile, 'B');
    tile.texture.needsUpdate = true;
  }

  // Gives back a tile's second ('B') or water ('W') canvas once nothing
  // uses it any more.
  release(tile, which) {
    const canvas = tile[`canvas${which}`];
    if (!canvas) return;
    tile[`texture${which}`].dispose();
    tile.mesh.material.uniforms[`map${which}`].value = tile.texture;
    canvas.width = canvas.height = 0;
    tile[`canvas${which}`] = tile[`ctx${which}`] = tile[`texture${which}`] = null;
  }

  // The water mask for this tile: every mask layer gathered on one canvas,
  // the sea wiped out (the mask is about water on land), edges softened.
  paintMask(tile, layers) {
    const use = tile.mesh.material.uniforms.uUseW;
    // The sea can only be told from land once the heights are known.
    if (!layers.length || (this.terrain && tile.heightLevel < 0)) {
      use.value = 0;
      if (!layers.length) this.release(tile, 'W');
      return;
    }
    const scratch = this.scratch.getContext('2d');
    scratch.globalAlpha = 1;
    scratch.clearRect(0, 0, SIZE, SIZE);
    // Latest step first, so the earliest sighting of each spot ends up on top.
    let drew = false;
    for (const layer of [...layers].sort((a, b) => b.mask - a.mask)) drew = this.drawLayer(scratch, tile, layer, 1) || drew;
    // Nothing has arrived for this tile yet: no water to shade.
    if (!drew) {
      use.value = 0;
      return;
    }
    if (this.terrain) this.wipeSea(scratch, tile);
    if (!tile.canvasW) {
      tile.canvasW = document.createElement('canvas');
      tile.canvasW.width = tile.canvasW.height = SIZE;
      tile.ctxW = tile.canvasW.getContext('2d');
      tile.textureW = this.texture(tile.canvasW);
      tile.mesh.material.uniforms.mapW.value = tile.textureW;
    }
    // Shrinking and stretching blurs the mask, which gives the shader a soft
    // edge to run waves along. Dry ground reads "no water, latest step".
    const s = SIZE / 4;
    this.softCtx.fillStyle = 'rgb(0,255,0)';
    this.softCtx.fillRect(0, 0, s, s);
    this.softCtx.drawImage(this.scratch, 0, 0, s, s);
    tile.ctxW.drawImage(this.soft, 0, 0, s, s, 0, 0, SIZE, SIZE);
    tile.textureW.needsUpdate = true;
    use.value = 1;
  }

  // Clears every grid cell that touches sea level, which also removes the
  // ragged strip of sea along the coast.
  wipeSea(ctx, tile) {
    const h = tile.mesh.geometry.attributes.aHeight.array;
    const cols = tile.cols;
    const n = cols - 1;
    const first = tile.y === 0 ? 1 : 0;
    const cell = SIZE / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = (first + j) * cols + i;
        if (h[a] < 0.5 || h[a + 1] < 0.5 || h[a + cols] < 0.5 || h[a + cols + 1] < 0.5) ctx.clearRect(i * cell, j * cell, cell, cell);
      }
    }
  }

  // Lays a plain lat/lon image into this Mercator tile, in thin horizontal
  // strips so latitude lands where it should.
  drape(ctx, tile, picture) {
    const b = picture.bounds;
    const img = picture.image;
    const strips = 32;
    const west = Math.max(b.west, tile.west);
    const east = Math.min(b.east, tile.east);
    const dx = ((west - tile.west) / (tile.east - tile.west)) * SIZE;
    const dw = ((east - west) / (tile.east - tile.west)) * SIZE;
    const sx = ((west - b.west) / (b.east - b.west)) * img.width;
    const sw = ((east - west) / (b.east - b.west)) * img.width;
    ctx.globalAlpha = picture.alpha ?? 1;
    for (let k = 0; k < strips; k++) {
      const top = tileLat(tile.y + k / strips, tile.z);
      const bottom = tileLat(tile.y + (k + 1) / strips, tile.z);
      const north = Math.min(top, b.north);
      const south = Math.max(bottom, b.south);
      if (north <= south) continue;
      const stripY = (k / strips) * SIZE;
      const stripH = SIZE / strips;
      const dy = stripY + ((top - north) / (top - bottom)) * stripH;
      const dh = ((north - south) / (top - bottom)) * stripH;
      const sy = ((b.north - north) / (b.north - b.south)) * img.height;
      const sh = ((north - south) / (b.north - b.south)) * img.height;
      // Half a pixel of overlap keeps the strips from showing seams.
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy - 0.25, dw, dh + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  stroke(ctx, tile) {
    if (!this.outlines.length) return;
    const n = 2 ** tile.z;
    const x0 = tile.x / n;
    const y0 = tile.y / n;
    const pad = 4 / SIZE / n;
    for (const o of this.outlines) {
      // The shape may sit one world-width away after unwrapping.
      for (const shift of [-1, 0, 1]) {
        if (o.maxX + shift < x0 - pad || o.minX + shift > x0 + 1 / n + pad || o.maxY < y0 - pad || o.minY > y0 + 1 / n + pad) continue;
        ctx.beginPath();
        o.points.forEach((p, i) => {
          const px = (p.x + shift - x0) * n * SIZE;
          const py = (p.y - y0) * n * SIZE;
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        if (!o.open) ctx.closePath();
        if (o.fill && !o.open) {
          ctx.fillStyle = o.fill;
          ctx.fill();
        }
        ctx.lineWidth = o.width ?? 1.5;
        ctx.strokeStyle = o.color;
        ctx.stroke();
      }
    }
  }

  // ---------- terrain ----------

  // Lifts the tile's vertices to real heights and bakes a gentle hillshade.
  shape(tile) {
    tile.shapeDirty = false;
    const g = tile.mesh.geometry;
    const height = g.attributes.aHeight;
    const shade = g.attributes.aShade;
    if (!this.terrain) {
      if (tile.heightLevel !== -1) {
        height.array.fill(0);
        shade.array.fill(1);
        height.needsUpdate = shade.needsUpdate = true;
        tile.heightLevel = -1;
      }
      return;
    }
    const { z, x, y, cols } = tile;
    const top = Math.min(ELEVATION_MAX, Math.max(0, z - ELEVATION_SHIFT));
    const exact = this.heights(top, x >> (z - top), y >> (z - top), tile);
    let level = top;
    let data = null;
    for (; level >= 0; level--) {
      const entry = level === top ? exact : this.elevation.get(`${level}/${x >> (z - level)}/${y >> (z - level)}`);
      if (entry?.state === 'ready') {
        data = entry;
        break;
      }
    }
    if (!data || level === tile.heightLevel) return;
    tile.heightLevel = level;
    data.lastUsed = this.frame;

    const scale = 2 ** (z - level);
    const u0 = (x % scale) / scale;
    const v0 = (y % scale) / scale;
    const n = cols - 1;
    const rows = tile.rows.length;
    const h = height.array;
    for (let r = 0; r < rows; r++) {
      const py = (v0 + tile.rows[r].t / scale) * SIZE - 0.5;
      for (let c = 0; c < cols; c++) h[r * cols + c] = sample(data.h, (u0 + c / n / scale) * SIZE - 0.5, py);
    }
    // Light from the north-west, the mapmaker's convention.
    const cell = tile.width / n;
    const s = shade.array;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const dx = (h[r * cols + Math.min(n, c + 1)] - h[r * cols + Math.max(0, c - 1)]) / (2 * cell);
        const dy = (h[Math.max(0, r - 1) * cols + c] - h[Math.min(rows - 1, r + 1) * cols + c]) / (2 * cell);
        s[i] = Math.max(0.6, Math.min(1.35, 1 + 1.2 * (dx - dy)));
      }
    }
    tile.rim.forEach((from, k) => {
      h[rows * cols + k] = h[from];
      s[rows * cols + k] = s[from];
    });
    height.needsUpdate = shade.needsUpdate = true;
    // The water mask was waiting to learn where the sea is.
    if (this.layers.some((l) => l.mask != null)) tile.dirty = true;
  }

  heights(z, x, y, tile) {
    const key = `${z}/${x}/${y}`;
    let entry = this.elevation.get(key);
    if (!entry) {
      entry = { key, z, x, y, state: 'queued', h: null, waiting: new Set(), lastUsed: this.frame };
      this.elevation.set(key, entry);
      this.elevationQueue.push(entry);
    }
    if (entry.state === 'queued' || entry.state === 'loading') entry.waiting.add(tile);
    entry.lastUsed = this.frame;
    return entry;
  }

  pumpElevation() {
    while (this.elevationLoading < 6 && this.elevationQueue.length) {
      const entry = this.elevationQueue.pop();
      if (![...entry.waiting].some((t) => !t.dead && t.mesh.visible)) {
        this.elevation.delete(entry.key);
        continue;
      }
      this.elevationLoading++;
      entry.state = 'loading';
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const done = (ok) => {
        this.elevationLoading--;
        entry.state = ok ? 'ready' : 'missing';
        if (ok) {
          this.readerCtx.drawImage(img, 0, 0, SIZE, SIZE);
          const px = this.readerCtx.getImageData(0, 0, SIZE, SIZE).data;
          const h = new Float32Array(SIZE * SIZE);
          // Sea floor is flattened to sea level: the imagery shows the surface.
          for (let i = 0; i < h.length; i++) h[i] = Math.max(0, px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768);
          entry.h = h;
          this.elevationVersion++;
        }
        for (const t of entry.waiting) if (!t.dead) t.shapeDirty = true;
        entry.waiting.clear();
        this.changed = true;
        this.wake?.();
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = ELEVATION_URL.replace('{z}', entry.z).replace('{x}', entry.x).replace('{y}', entry.y);
    }
    if (this.elevation.size > ELEVATION_CACHE) {
      const old = [...this.elevation.values()].filter((e) => e.state === 'ready').sort((a, b) => a.lastUsed - b.lastUsed);
      for (const entry of old.slice(0, this.elevation.size - ELEVATION_CACHE * 0.8)) this.elevation.delete(entry.key);
    }
  }

  // Ground height in metres from the best elevation data loaded so far.
  heightAt(lat, lon) {
    if (!this.terrain) return 0;
    const X = mercatorX(lon);
    const Y = mercatorY(lat);
    for (let z = ELEVATION_MAX; z >= 0; z--) {
      const n = 2 ** z;
      const x = Math.min(n - 1, Math.floor(X * n));
      const y = Math.min(n - 1, Math.floor(Y * n));
      const entry = this.elevation.get(`${z}/${x}/${y}`);
      if (entry?.state === 'ready') return sample(entry.h, (X * n - x) * SIZE - 0.5, (Y * n - y) * SIZE - 0.5);
    }
    return 0;
  }

  // Whether a point is on land, from the terrain: true, false, or null when
  // the heights there have not arrived (or terrain is off). Land that lies
  // at or below sea level reads as sea.
  landAt(lat, lon) {
    if (!this.terrain) return null;
    const X = mercatorX(lon);
    const Y = mercatorY(lat);
    for (let z = ELEVATION_MAX; z >= 0; z--) {
      const n = 2 ** z;
      const x = Math.min(n - 1, Math.floor(X * n));
      const y = Math.min(n - 1, Math.floor(Y * n));
      const entry = this.elevation.get(`${z}/${x}/${y}`);
      if (entry?.state === 'ready') return sample(entry.h, (X * n - x) * SIZE - 0.5, (Y * n - y) * SIZE - 0.5) > 0.5;
    }
    return null;
  }

  // ---------- image loading ----------

  url(layer, z, x, y) {
    return layer.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  // Cache key: the same picture filtered differently is a different entry.
  key(layer, z, x, y) {
    return this.url(layer, z, x, y) + (layer.keep ? `#kept${layer.tint || ''}` : '');
  }

  // The picture of the whole world for a sparse layer (see the top of this
  // file). It is kept for as long as the layer is on.
  sheetOf(layer, tile) {
    let entry = this.images.get(layer.sheet);
    if (!entry) {
      entry = { key: layer.sheet, url: layer.sheet, state: 'queued', img: null, waiting: new Set(), lastUsed: this.frame, first: true, sparse: true, sheet: true, probe: true, layer };
      this.images.set(entry.key, entry);
      this.queue.push(entry);
    } else if (entry.state === 'idle' || (entry.state === 'missing' && performance.now() >= this.dueAgain(entry))) {
      entry.state = 'queued';
      this.queue.push(entry);
    }
    if (tile && (entry.state === 'queued' || entry.state === 'loading')) entry.waiting.add(tile);
    entry.lastUsed = this.frame;
    entry.probe = true;
    entry.layer = layer;
    return entry;
  }

  // Whether the world picture shows anything inside a tile of level 7 or
  // coarser.
  sheetHolds(sheet, z, x, y) {
    const side = SHEET_CELLS >> z;
    for (let j = y * side; j < (y + 1) * side; j++) for (let i = x * side; i < (x + 1) * side; i++) if (sheet.grid[j * SHEET_CELLS + i]) return true;
    return false;
  }

  // Draws a tile's part of the world picture: all of the layer from far
  // away, and a soft stand-in closer up while the real tiles arrive.
  drawSheet(target, tile, sheet, alpha) {
    const span = SHEET_PX / 2 ** tile.z;
    target.globalAlpha = alpha;
    target.drawImage(sheet.img, tile.x * span, tile.y * span, span, span, 0, 0, SIZE, SIZE);
    sheet.lastUsed = this.frame;
    return true;
  }

  // When a tile that was not delivered is asked for again: soon the first
  // time, then at growing intervals. No failure is final for a radar layer,
  // whose empty tiles are known as such. An overlay tile the server says
  // does not exist (`gone`) is never asked for again, and any other layer
  // stops after a few tries.
  dueAgain(entry) {
    if (entry.gone || (!entry.sparse && (entry.fails || 0) >= RETRIES_PLAIN)) return Infinity;
    return (entry.failedAt || 0) + RETRY_MS * Math.min(2 ** Math.max(0, (entry.fails || 1) - 1), RETRY_LONGEST);
  }

  // The map is drawn on demand, so a clock has to bring it back when a tile
  // is due again. One clock serves them all: it rings for the earliest.
  wakeFor(entry) {
    const due = this.dueAgain(entry) + 30;
    if (this.ringAt && this.ringAt <= due) return;
    clearTimeout(this.ringer);
    this.ringAt = due;
    this.ringer = setTimeout(() => {
      this.ringAt = 0;
      for (const tile of this.tiles.values()) {
        if (!tile.patchy) continue;
        if (tile.mesh.visible) tile.dirty = true;
        else tile.stale = true;
      }
      this.changed = true;
      this.wake?.();
    }, Math.max(0, due - performance.now()));
  }

  image(layer, z, x, y, tile) {
    const key = this.key(layer, z, x, y);
    let entry = this.images.get(key);
    // A radar tile that was not delivered is asked for again after a while.
    if (entry?.state === 'missing' && !entry.sheet && performance.now() >= this.dueAgain(entry)) entry.state = 'idle';
    if (entry && (entry.state === 'ready' || entry.state === 'empty' || entry.state === 'missing')) {
      entry.lastUsed = this.frame;
      return entry;
    }
    if (layer.sparse) {
      const empty = () => {
        const none = { key, state: 'empty', img: null, waiting: new Set(), lastUsed: this.frame, sparse: true };
        this.images.set(key, none);
        return none;
      };
      let probes = PROBE_LEVELS;
      const sheet = layer.sheet ? this.sheetOf(layer, tile) : null;
      if (sheet) {
        if (sheet.state === 'empty') return empty();
        // Not here yet: the tile waits on it and is painted again when it is.
        if (sheet.state !== 'ready' && sheet.state !== 'missing') return sheet;
        if (sheet.state === 'ready') {
          const up = Math.max(0, z - SHEET_REACH);
          if (!this.sheetHolds(sheet, z - up, x >> up, y >> up)) return empty();
          probes = z <= SHEET_REACH ? [] : PROBES_UNDER_SHEET;
        }
      }
      // Is there anything at all up here? The level above knows.
      const probe = probes.filter((level) => level < z).pop();
      if (probe != null) {
        const down = z - probe;
        const above = this.image(layer, probe, x >> down, y >> down, tile);
        let nothing = above.state === 'empty';
        if (above.state === 'ready' && above.cells) {
          // The cells of the picture above that this tile lies in.
          const side = CELLS >> down;
          const cx = (x - ((x >> down) << down)) * side;
          const cy = (y - ((y >> down) << down)) * side;
          nothing = true;
          for (let j = cy; j < cy + side && nothing; j++) for (let i = cx; i < cx + side; i++) if (above.cells[j * CELLS + i]) nothing = false;
        }
        if (nothing) return empty();
        // Not known yet: the tile waits on the level above (it was added to
        // its waiting list) and is painted again when that arrives.
        if (above.state !== 'ready' && above.state !== 'missing') return above;
      }
    }
    if (!entry) {
      // The coarse levels of a sparse layer go first: they unblock the rest.
      entry = { key, url: this.url(layer, z, x, y), keep: layer.keep, tint: layer.tint, state: 'queued', img: null, waiting: new Set(), lastUsed: this.frame, first: !!layer.base || (!!layer.sparse && z <= 3), sparse: !!layer.sparse, overlay: !layer.base && !layer.sparse, probe: !!layer.sparse && !layer.sheet && z === 0, layer: layer.sparse ? layer : null, z, x, y };
      this.images.set(key, entry);
      this.queue.push(entry);
    } else if (entry.state === 'idle') {
      entry.state = 'queued';
      this.queue.push(entry);
    }
    if (tile) entry.waiting.add(tile);
    entry.lastUsed = this.frame;
    return entry;
  }

  // How soon an entry in the queue is wanted: lower goes first. The ground
  // goes before overlays; within each, what is nearest the middle of the
  // view; then what the camera is flying towards; last, pictures fetched
  // ahead of need.
  urgency(entry, now) {
    let near = 2;
    for (const t of entry.waiting) {
      if (t.dead || !t.mesh.visible) continue;
      const far = 1 - t.mesh.position.dot(this.focus) / t.mesh.position.length();
      if (far < near) near = far;
    }
    if (near < 2) {
      entry.orphaned = 0;
      return (entry.first ? 0 : 3) + near;
    }
    if (entry.pinned || entry.probe) return 0.5;
    // Where the camera is flying to comes before overlays still on screen
    // (it is about to leave them); what a slowly turning globe will reach
    // next waits until the view itself is complete.
    if (entry.ahead > now) return (entry.eager ? 2.5 : 5) + (entry.first ? 0 : 0.2);
    if (entry.warm) return 9;
    // Nobody on screen is waiting for it. Tiles blink in and out while the
    // camera moves, so it is kept a moment longer before it is put down.
    if (!entry.orphaned) entry.orphaned = now;
    return now - entry.orphaned < 1500 ? 8 : Infinity;
  }

  // Takes a request out of the queue because nothing on screen needs it.
  // The rule that keeps the map whole: a tile that is on screen and not
  // waiting to be painted has asked for everything it shows, and every one
  // of those requests is either answered or still alive. So the tiles that
  // were waiting for this one are marked, and ask again when they return.
  putDown(entry) {
    entry.state = 'idle';
    for (const tile of entry.waiting) {
      if (tile.dead) continue;
      if (tile.mesh.visible) tile.dirty = true;
      else tile.stale = true;
    }
    entry.waiting.clear();
    entry.orphaned = 0;
  }

  pump() {
    let free = PARALLEL_DOWNLOADS - this.downloading;
    if (free > 0 && this.queue.length) {
      const now = performance.now();
      for (const entry of this.queue) entry.urgent = this.urgency(entry, now);
      // What nobody waits for any more is put down, to be asked for again
      // if it is ever wanted.
      this.queue = this.queue.filter((entry) => {
        if (entry.urgent < Infinity) return true;
        this.putDown(entry);
        return false;
      });
      this.queue.sort((a, b) => b.urgent - a.urgent);
      while (free-- > 0 && this.queue.length) {
        // Pictures fetched ahead of need use only a few connections, so
        // that what is suddenly wanted never waits behind them.
        if (this.queue[this.queue.length - 1].urgent >= 5 && this.downloading >= AHEAD_DOWNLOADS) break;
        this.download(this.queue.pop());
      }
    }
    // Looked at now and then, not every frame: it sorts the whole cache.
    if (this.images.size > IMAGE_CACHE && this.frame - (this.trimmedAt || 0) > 120) {
      this.trimmedAt = this.frame;
      this.trim();
    }
  }

  download(entry) {
    this.downloading++;
    entry.state = 'loading';
    const done = (state, picture) => {
      this.downloading--;
      entry.state = state;
      // What was not delivered is tried again later (see `dueAgain`).
      if (state === 'missing') {
        entry.failedAt = performance.now();
        entry.fails = (entry.fails || 0) + 1;
      } else entry.fails = 0;
      entry.img = state === 'ready' ? (entry.keep ? this.filtered(picture, entry.keep, entry.tint) : picture) : null;
      for (const t of entry.waiting) if (!t.dead) t.dirty = true;
      entry.waiting.clear();
      if (entry.pinned) for (const t of this.tiles.values()) t.dirty = true;
      // The world picture of a sparse layer has arrived: fetch the level
      // beneath it wherever it shows anything, ahead of need. From then on
      // any view of the globe has a picture to stand in at once, and
      // knows what is empty three levels further down.
      // A world picture has arrived: every tile may now show it.
      if (entry.sheet) this.repaintAll();
      this.changed = true;
      this.wake?.();
    };
    if (entry.sparse) {
      this.fetchSparse(entry).then(
        (bitmap) => done(bitmap ? 'ready' : 'empty', bitmap),
        () => done('missing'),
      );
      return;
    }
    if (entry.overlay) {
      // An overlay is fetched with its answer's status, because "there is
      // nothing here" (the server says so) and "the server failed" need
      // different handling: the first is final, the second is tried again.
      fetch(entry.url)
        .then(async (res) => {
          if (res.status === 404 || res.status === 400 || res.status === 403) entry.gone = true;
          if (!res.ok) throw new Error(res.status);
          return createImageBitmap(await res.blob());
        })
        .then(
          (bitmap) => done('ready', bitmap),
          () => done('missing'),
        );
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    // Decoded before it is used, off the page's own thread, so painting it
    // into a tile never stalls a frame.
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => done('ready', img));
    img.onerror = () => done('missing');
    img.src = entry.url;
  }

  // Once nothing on screen is waiting any more, the level-3 tiles of every
  // sparse layer are fetched wherever its world picture shows anything, a
  // few at a time. After that the whole globe is sharp at the opening
  // distance however it is turned, with nothing left to fetch.
  warm() {
    if (this.frame < (this.warmAt || 0) || this.awaited > 0 || this.queue.length > 4) return;
    this.warmAt = this.frame + 20;
    let asked = 0;
    for (const layer of this.layers) {
      const sheet = layer.sparse && layer.sheet ? this.images.get(layer.sheet) : null;
      if (sheet?.state !== 'ready') continue;
      for (let k = sheet.warmed || 0; k < 64; k++) {
        sheet.warmed = k + 1;
        if (!this.sheetHolds(sheet, 3, k % 8, Math.floor(k / 8))) continue;
        const entry = this.image(layer, 3, k % 8, Math.floor(k / 8), null);
        if (entry.state !== 'queued') continue;
        entry.warm = true;
        if (++asked >= 10) return;
      }
    }
  }

  // One tile of a sparse layer: its picture, or null when it holds nothing.
  // Fetched as bytes, so an empty tile is known by its size and is never
  // decoded, painted or looked beneath.
  async fetchSparse(entry) {
    const store = await this.store;
    let blob = null;
    if (entry.sheet) return this.fetchSheet(entry, store);
    if (entry.probe) {
      // The picture of the whole world is always fetched fresh: it is the
      // fingerprint everything kept for that day is checked against.
      const res = await fetch(entry.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      blob = await res.blob();
      const print = `${blob.size}:${fingerprint(await blob.arrayBuffer())}`;
      entry.print = print;
      if (store) {
        const key = `${entry.url}?print=1`;
        const kept = await store.match(key).then((r) => r?.text()).catch(() => null);
        if (kept !== print) {
          // New or changed data for this day: nothing kept for it holds.
          await this.forget(store, entry.layer);
          await store.put(key, new Response(print)).catch(() => {});
        }
      }
    } else {
      return this.fetchTile(entry, store);
    }
    // The smallest tile of a layer without a world picture.
    if (blob.size <= EMPTY_BYTES) return null;
    const bitmap = await createImageBitmap(blob);
    const seen = this.inspect(bitmap);
    if (seen.faulty) {
      bitmap.close?.();
      throw new Error(seen.faulty);
    }
    entry.cells = seen.cells;
    return seen.picture;
  }

  // One radar tile, checked before it is used (see `inspect`).
  //
  // It is taken from the first of these that gives a sound answer: what the
  // browser kept from an earlier visit, NASA's tile service, NASA's map
  // service. The tile service is the fast one, but for some days and places
  // it sends damaged pictures; the map service draws the same data on
  // request and has always been sound and the same on every request. A
  // sound answer from either is kept, so a damaged spot is mended once.
  async fetchTile(entry, store) {
    const kept = store ? await store.match(entry.url).catch(() => null) : null;
    const sources = [];
    if (kept) sources.push('kept');
    sources.push('tiles');
    if (entry.layer?.map) sources.push('map');
    let why = '';
    for (const source of sources) {
      let blob;
      try {
        if (source === 'kept') blob = await kept.blob();
        else {
          const res = await fetch(source === 'map' ? this.mapUrl(entry) : entry.url, { cache: 'no-store' });
          if (!res.ok) throw new Error(`the server answered ${res.status}`);
          blob = await res.blob();
        }
      } catch (err) {
        why = err.message;
        if (source === 'tiles') this.faulty++;
        continue;
      }
      let seen = null;
      if (blob.size > EMPTY_BYTES) {
        const bitmap = await createImageBitmap(blob).catch(() => null);
        // The map service's picture is not held to the colour rule: where a
        // real picture is grey (ice, bare ground), it is the one that says so.
        seen = bitmap ? this.inspect(bitmap, source !== 'map' && !!entry.layer?.colour) : { faulty: 'it is not a picture' };
        if (seen.faulty) bitmap?.close?.();
      }
      // Nothing here. The map service is believed; the tile service only
      // where the level above shows nothing either.
      if (!seen || seen.blank) {
        // (A single byte in the store is this engine's own note that the
        // map service said so on an earlier visit.)
        const believed = source === 'map' || (source === 'kept' && blob.size === 1) || (!seen && !this.shownAbove(entry));
        if (believed) {
          if (store && source !== 'kept') store.put(entry.url, new Response(source === 'map' ? new Blob([new Uint8Array(1)]) : blob)).catch(() => {});
          return null;
        }
        why = seen ? seen.faulty : 'it is empty where the level above has a picture';
      } else if (!seen.faulty) {
        if (store && source !== 'kept') store.put(entry.url, new Response(blob)).catch(() => {});
        if (source === 'map') this.mended++;
        entry.cells = seen.cells;
        return seen.picture;
      } else why = seen.faulty;
      if (source === 'tiles') this.faulty++;
    }
    // No source was sound: whatever was kept is thrown out too, and the
    // tile is asked for again later (see `dueAgain`).
    if (store) store.delete(entry.url).catch(() => {});
    throw new Error(`no sound tile: ${why}`);
  }

  // The address of one tile's area at NASA's map service.
  mapUrl(entry) {
    const span = (2 * HALF_WORLD) / 2 ** entry.z;
    const west = -HALF_WORLD + entry.x * span;
    const north = HALF_WORLD - entry.y * span;
    return entry.layer.map.replace('{bbox}', `${west},${north - span},${west + span},${north}`).replaceAll('{px}', SIZE);
  }

  // The world picture of a sparse layer, with the grid of where it shows
  // anything. Alongside it the layer's smallest tile is fetched: a few
  // hundred bytes that change whenever NASA adds to that day, and so the
  // fingerprint everything kept for the day is checked against.
  async fetchSheet(entry, store) {
    const layer = entry.layer;
    const smallest = fetch(this.url(layer, 0, 0, 0), { cache: 'no-store' })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((bytes) => (bytes ? `${bytes.byteLength}:${fingerprint(bytes)}` : null))
      .catch(() => null);
    const res = await fetch(entry.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const bitmap = await createImageBitmap(await res.blob());
    entry.print = await smallest;
    if (store && entry.print) {
      const key = `${this.url(layer, 0, 0, 0)}?print=1`;
      const kept = await store.match(key).then((r) => r?.text()).catch(() => null);
      if (kept !== entry.print) {
        // New or changed data for this day: nothing kept for it holds.
        await this.forget(store, layer);
        await store.put(key, new Response(entry.print)).catch(() => {});
      }
    }
    // Which cells of the picture hold anything: `seen` exactly, and `grid`
    // with the cells next to them as well, because the edge of a strip can
    // be thinner than a pixel here and still be a real picture closer up.
    // Only solid pixels count, and half see-through ones are cleared, as
    // in every radar tile (see `inspect`).
    const ctx = this.sheetReader();
    ctx.clearRect(0, 0, SHEET_PX, SHEET_PX);
    ctx.drawImage(bitmap, 0, 0, SHEET_PX, SHEET_PX);
    const data = ctx.getImageData(0, 0, SHEET_PX, SHEET_PX);
    const px = data.data;
    let soft = false;
    const seen = new Uint8Array(SHEET_CELLS * SHEET_CELLS);
    const span = SHEET_PX / SHEET_CELLS;
    let any = false;
    for (let y = 0; y < SHEET_PX; y++) {
      const row = Math.floor(y / span) * SHEET_CELLS;
      for (let x = 0; x < SHEET_PX; x++) {
        const at = (y * SHEET_PX + x) * 4 + 3;
        if (px[at] === 255) {
          seen[row + Math.floor(x / span)] = 1;
          any = true;
        } else if (px[at]) {
          px[at] = 0;
          soft = true;
        }
      }
    }
    if (!any) {
      bitmap.close?.();
      return null;
    }
    const grid = new Uint8Array(seen);
    for (let j = 0; j < SHEET_CELLS; j++) {
      for (let i = 0; i < SHEET_CELLS; i++) {
        if (!seen[j * SHEET_CELLS + i]) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= SHEET_CELLS) continue;
          for (let di = -1; di <= 1; di++) grid[jj * SHEET_CELLS + ((i + di + SHEET_CELLS) % SHEET_CELLS)] = 1;
        }
      }
    }
    entry.seen = seen;
    entry.grid = grid;
    if (!soft) return bitmap;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SHEET_PX;
    canvas.getContext('2d').putImageData(data, 0, 0);
    bitmap.close?.();
    return canvas;
  }

  sheetReader() {
    if (!this.sheetCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SHEET_PX;
      this.sheetCtx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return this.sheetCtx;
  }

  // Whether the picture one step up (the world picture, or the tile three
  // levels above) shows anything inside this tile. Unlike the grid used to
  // skip requests, this counts only what is really there, not neighbours.
  shownAbove(entry) {
    const { layer, z, x, y } = entry;
    if (!layer || z == null) return false;
    const sheet = layer.sheet ? this.images.get(layer.sheet) : null;
    if (sheet?.state === 'ready' && z <= SHEET_REACH) {
      const side = SHEET_CELLS >> z;
      for (let j = y * side; j < (y + 1) * side; j++) for (let i = x * side; i < (x + 1) * side; i++) if (sheet.seen[j * SHEET_CELLS + i]) return true;
      return false;
    }
    const levels = sheet?.state === 'ready' ? PROBES_UNDER_SHEET : PROBE_LEVELS;
    const probe = levels.filter((level) => level < z).pop();
    if (probe == null) return false;
    const down = z - probe;
    const above = this.images.get(this.key(layer, probe, x >> down, y >> down));
    if (above?.state !== 'ready' || !above.cells) return false;
    const side = CELLS >> down;
    const cx = (x - ((x >> down) << down)) * side;
    const cy = (y - ((y >> down) << down)) * side;
    for (let j = cy; j < cy + side; j++) for (let i = cx; i < cx + side; i++) if (above.cells[j * CELLS + i]) return true;
    return false;
  }

  // Removes everything kept in the browser's store for one layer.
  async forget(store, layer) {
    const prefix = layer.url.split('{z}')[0];
    const keys = await store.keys().catch(() => []);
    await Promise.all(keys.filter((req) => req.url.startsWith(prefix)).map((req) => store.delete(req)));
  }

  // Clears days out of the store that are too old to be looked at again.
  async sweepStore(store) {
    const oldest = new Date(Date.now() - STORE_DAYS * 86400_000).toISOString().slice(0, 10);
    const keys = await store.keys().catch(() => []);
    for (const req of keys) {
      const day = /\/(\d{4}-\d{2}-\d{2})\//.exec(req.url)?.[1];
      if (day && day < oldest) store.delete(req).catch(() => {});
    }
  }

  // Every few minutes the whole-world picture of each sparse layer on the
  // globe is fetched again. If NASA has added to that day, its fingerprint
  // differs, and everything worked out from the old one (pictures, and what
  // was taken to be empty) is dropped and built up again from the new one.
  recheck() {
    const now = performance.now();
    if (now - this.checkedAt < RECHECK_MS) return;
    this.checkedAt = now;
    for (const layer of this.layers) {
      if (!layer.sparse) continue;
      const root = this.images.get(layer.sheet || this.key(layer, 0, 0, 0));
      if (!root || root.state === 'queued' || root.state === 'loading') continue;
      fetch(this.url(layer, 0, 0, 0), { cache: 'no-store' })
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.status))))
        .then((bytes) => {
          const print = `${bytes.byteLength}:${fingerprint(bytes)}`;
          if (print === root.print || !this.layers.includes(layer)) return;
          // NASA has added to this day: start it again from nothing.
          const prefix = layer.url.split('{z}')[0];
          for (const [key, entry] of this.images) {
            if (!key.startsWith(prefix) && key !== layer.sheet) continue;
            entry.img?.close?.();
            this.images.delete(key);
          }
          this.queue = this.queue.filter((entry) => !entry.key.startsWith(prefix) && entry.key !== layer.sheet);
          if (layer.sheet) this.sheetOf(layer, null);
          else this.image(layer, 0, 0, 0, null);
          this.repaintAll();
          this.wake?.();
        })
        .catch(() => {
          /* the server did not answer: what is here stays */
        });
    }
  }

  // Starts loading the map for a place the camera is about to fly to, so
  // that it is there on arrival. `alt` is the camera's height above the
  // ground in Earth radii.
  // `eager` is for a place the camera has been sent to; without it, this is
  // a guess at where a turning globe will be, and waits its turn.
  prefetch(lat, lon, alt, eager = false) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(Math.log2(55 / Math.max(alt, 1e-4)))));
    const until = performance.now() + 8000;
    const X = mercatorX(lon);
    const Y = mercatorY(lat);
    // A block of tiles at the level the view will use, and a smaller one
    // two levels coarser to stand in while those arrive.
    for (const [level, reach] of [[Math.max(MIN_ZOOM, z - 2), 1], [z, 2]]) {
      const n = 2 ** level;
      const cx = Math.floor(X * n);
      const cy = Math.floor(Y * n);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const y = cy + dy;
          if (y < 0 || y >= n) continue;
          const x = (((cx + dx) % n) + n) % n;
          for (const layer of this.layers) {
            if (layer.mask != null || layer.keep) continue;
            const top = Math.min(layer.sparse && level > 2 && level < COARSER_BELOW ? level - 1 : level, layer.maxLevel);
            const entry = this.image(layer, top, x >> (level - top), y >> (level - top), null);
            if (entry.state === 'queued' || entry.state === 'idle') {
              entry.ahead = until;
              entry.eager = eager || entry.eager;
            }
          }
        }
      }
    }
    this.wake?.();
  }

  // Looks at a radar tile before it is used.
  //
  // NASA's tile service does not always send the tile it has. For some days
  // and places it answers the same address differently each time (seen on
  // 6 and 7 November 2026 over Colorado, at close zoom: about one answer in
  // ten was sound). It labels the picture as the wrong kind of PNG, so what
  // arrives is:
  // - a picture whose transparency is noise: most of it half see-through;
  // - a solid black tile, or (for a layer whose pictures are in colour) a
  //   grey one;
  // - a tile with nothing in it that is nevertheless tens of kilobytes;
  // - the ordinary empty tile, where the level above shows a picture;
  // - or no picture at all, only a server error.
  // In a sound tile every pixel is fully see-through or fully solid, and
  // what is solid is a picture. A faulty answer is never shown and never
  // kept; `fetchTile` then takes the tile from NASA's map service.
  //
  // Returns { cells, picture } with the 8 × 8 cells that hold anything, or
  // { faulty: why } (with `blank` when it holds nothing). Half see-through
  // pixels in a sound tile (a soft edge) are made fully see-through.
  inspect(bitmap, colour = false) {
    const ctx = this.readerCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE);
    const px = data.data;
    const cells = new Uint8Array(CELLS * CELLS);
    const span = SIZE / CELLS;
    let solid = 0;
    let half = 0;
    let black = 0;
    let grey = 0;
    for (let y = 0; y < SIZE; y++) {
      const row = Math.floor(y / span) * CELLS;
      for (let x = 0; x < SIZE; x++) {
        const at = (y * SIZE + x) * 4;
        const a = px[at + 3];
        if (a === 255) {
          solid++;
          if (px[at] <= 1 && px[at + 1] <= 1 && px[at + 2] <= 1) black++;
          else if (Math.abs(px[at] - px[at + 1]) <= 10 && Math.abs(px[at + 1] - px[at + 2]) <= 10 && px[at + 1] >= 40) grey++;
          cells[row + Math.floor(x / span)] = 1;
        } else if (a) {
          half++;
          px[at + 3] = 0;
        }
      }
    }
    if (half > 0.2 * (half + solid)) return { faulty: 'its transparency is noise' };
    if (solid > 600 && black > 0.9 * solid) return { faulty: 'it is solid black' };
    if (colour && solid > 600 && grey > 0.6 * solid) return { faulty: 'it is grey, and this layer is in colour' };
    if (!solid) return { faulty: 'it holds nothing, yet is not the empty tile', blank: true };
    if (!half) return { cells, picture: bitmap };
    // Cleaned: the tile is kept as its own small canvas.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    canvas.getContext('2d').putImageData(data, 0, 0);
    bitmap.close?.();
    return { cells, picture: canvas };
  }

  // A copy of the image with only the pixels `keep` accepts.
  filtered(img, keep, tint) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!keep(px[i], px[i + 1], px[i + 2])) px[i + 3] = 0;
      else if (tint) [px[i], px[i + 1], px[i + 2]] = tint;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  trim() {
    // Empty answers hold no picture: they are kept far longer than pictures,
    // because forgetting one means asking the server again.
    const all = [...this.images.values()];
    const empties = all.filter((e) => e.state === 'empty');
    if (empties.length > EMPTY_KEPT) for (const entry of empties.sort((a, b) => a.lastUsed - b.lastUsed).slice(0, empties.length - EMPTY_KEPT * 0.8)) this.images.delete(entry.key);
    // Requests that were put down hold nothing; they are simply forgotten
    // once there are many. They must never push a picture out.
    const idle = all.filter((e) => e.state === 'idle' || e.state === 'missing');
    if (idle.length > 600) for (const entry of idle.sort((a, b) => a.lastUsed - b.lastUsed).slice(0, idle.length - 300)) this.images.delete(entry.key);
    // Pictures: overlay tiles go before basemap tiles, then the least
    // recently used. The whole-world pictures and the pinned basemap stay.
    const held = all.filter((e) => e.state === 'ready' && !e.pinned && !e.probe);
    if (held.length <= IMAGE_CACHE) return;
    held.sort((a, b) => a.first - b.first || a.lastUsed - b.lastUsed);
    for (const entry of held.slice(0, Math.ceil(held.length - IMAGE_CACHE * 0.8))) {
      entry.img?.close?.(); // a decoded bitmap gives its memory back at once
      this.images.delete(entry.key);
    }
  }

  // How many pictures the tiles on screen are still waiting for.
  get awaited() {
    let n = 0;
    for (const entry of this.images.values()) {
      if (entry.state !== 'queued' && entry.state !== 'loading') continue;
      for (const t of entry.waiting) {
        if (!t.dead && t.mesh.visible) {
          n++;
          break;
        }
      }
    }
    return n;
  }

  get busy() {
    return this.downloading > 0 || this.queue.length > 0 || this.elevationLoading > 0 || this.elevationQueue.length > 0;
  }
}

// A short fingerprint of some bytes (FNV-1a), to tell whether a picture
// fetched again is the one fetched before.
function fingerprint(buffer) {
  const bytes = new Uint8Array(buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16);
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const sphere = new THREE.Sphere();
