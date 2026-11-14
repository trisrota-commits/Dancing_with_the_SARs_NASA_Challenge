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
const PARALLEL_DOWNLOADS = 14;
const IMAGE_CACHE = 900;
const TILE_CACHE = 420;

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
      if (uFadeDur > 0.0) {
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
    float lit = smoothstep(-0.12, 0.18, dot(normalize(vNormal), uSun));
    color *= mix(1.0, mix(0.13, 1.0, lit), uNight);
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
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.9985, 96, 64), new THREE.MeshBasicMaterial({ color: 0x08121d })));

    this.layers = [];
    this.pictures = [];
    this.outlines = [];
    this.tiles = new Map();
    this.images = new Map();
    this.queue = [];
    this.downloading = 0;
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
    this.reader = document.createElement('canvas');
    this.reader.width = this.reader.height = SIZE;
    this.readerCtx = this.reader.getContext('2d', { willReadFrequently: true });
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
    for (const entry of this.queue) {
      entry.state = 'idle';
      entry.waiting.clear();
    }
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
    this.repaintAll();
  }

  // Single images laid over a lat/lon box:
  // [{ image, bounds: { west, south, east, north }, side: 'left' | 'right' | undefined, alpha }]
  setPictures(pictures) {
    this.pictures = pictures;
    this.repaintAll();
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

  update(camera, viewportHeight, moved) {
    this.frame++;
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

    // Repaint and reshape a bounded number of tiles per frame.
    let budget = 24;
    for (const tile of this.tiles.values()) {
      if (!tile.mesh.visible) continue;
      if (tile.shapeDirty) {
        this.shape(tile);
        this.changed = true;
      }
      if (tile.dirty) {
        this.paint(tile);
        this.changed = true;
        if (--budget === 0) break;
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
    // Relief is invisible on continent-sized tiles; spend fewer triangles there.
    const n = z <= 4 ? GRID / 2 : GRID;
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
    tile.dead = true;
    this.tiles.delete(key);
  }

  // ---------- painting ----------

  // Draws one tile layer for this tile onto a canvas, using a coarser cached
  // image as a stand-in when the exact tile has not arrived yet.
  drawLayer(target, tile, layer, alpha) {
    const { z, x, y } = tile;
    const top = Math.min(z, layer.maxLevel);
    const exact = this.image(layer, top, x >> (z - top), y >> (z - top), tile);
    // A tile the server would not give may be a gap in the data or a server
    // hiccup: ask for the tile one level coarser and use what is at hand.
    if (exact.state === 'missing' && !layer.base && top > 0) this.image(layer, top - 1, x >> (z - top + 1), y >> (z - top + 1), tile);
    // A much coarser stand-in is fine for a picture but would smear a water
    // mask over the whole tile, so masks only reach two levels down.
    const lowest = layer.mask != null ? Math.max(0, top - 2) : 0;
    for (let level = top; level >= lowest; level--) {
      const shift = z - level;
      const entry = level === top ? exact : this.images.get(this.key(layer, level, x >> shift, y >> shift));
      if (!entry || entry.state !== 'ready') continue;
      const scale = 2 ** shift;
      const span = SIZE / scale;
      target.globalAlpha = alpha;
      target.drawImage(entry.img, (x % scale) * span, (y % scale) * span, span, span, 0, 0, SIZE, SIZE);
      entry.lastUsed = this.frame;
      return;
    }
  }

  // Composites everything for this tile. Layers and pictures with a side
  // ('left' or 'right') only show on that side of the divider, which needs
  // a second canvas for what the left side should show.
  paint(tile) {
    const ctx = tile.ctx;
    tile.dirty = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a1826';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const sidedLayers = [];
    const maskLayers = [];
    for (const layer of this.layers) {
      const b = layer.bounds;
      if (b && !(b.east > tile.west && b.west < tile.east && b.north > tile.south && b.south < tile.north)) continue;
      if (layer.mask != null) maskLayers.push(layer);
      else if (layer.side) sidedLayers.push(layer);
      else this.drawLayer(ctx, tile, layer, layer.alpha ?? 1);
    }
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
    for (const layer of sidedLayers) this.drawLayer(layer.side === 'left' ? tile.ctxB : ctx, tile, layer, layer.alpha ?? 1);
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
    tile.texture.needsUpdate = true;
  }

  // The water mask for this tile: every mask layer gathered on one canvas,
  // the sea wiped out (the mask is about water on land), edges softened.
  paintMask(tile, layers) {
    const use = tile.mesh.material.uniforms.uUseW;
    // The sea can only be told from land once the heights are known.
    if (!layers.length || (this.terrain && tile.heightLevel < 0)) {
      use.value = 0;
      return;
    }
    const scratch = this.scratch.getContext('2d');
    scratch.globalAlpha = 1;
    scratch.clearRect(0, 0, SIZE, SIZE);
    // Latest step first, so the earliest sighting of each spot ends up on top.
    for (const layer of [...layers].sort((a, b) => b.mask - a.mask)) this.drawLayer(scratch, tile, layer, 1);
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

  // ---------- image loading ----------

  url(layer, z, x, y) {
    return layer.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  // Cache key: the same picture filtered differently is a different entry.
  key(layer, z, x, y) {
    return this.url(layer, z, x, y) + (layer.keep ? `#kept${layer.tint || ''}` : '');
  }

  image(layer, z, x, y, tile) {
    const key = this.key(layer, z, x, y);
    let entry = this.images.get(key);
    if (!entry) {
      entry = { key, url: this.url(layer, z, x, y), keep: layer.keep, tint: layer.tint, state: 'queued', img: null, waiting: new Set(), lastUsed: this.frame, first: !!layer.base };
      this.images.set(key, entry);
      this.queue.push(entry);
    } else if (entry.state === 'idle') {
      entry.state = 'queued';
      this.queue.push(entry);
    }
    if (tile && entry.state !== 'ready' && entry.state !== 'missing') entry.waiting.add(tile);
    entry.lastUsed = this.frame;
    return entry;
  }

  pump() {
    // Newest requests first: what the camera looks at now beats what it
    // left. The basemap goes ahead of overlays so the ground appears first.
    while (this.downloading < PARALLEL_DOWNLOADS && this.queue.length) {
      let at = this.queue.length - 1;
      for (let i = at; i >= 0 && i > at - 400; i--) {
        if (this.queue[i].first) {
          at = i;
          break;
        }
      }
      const entry = this.queue.splice(at, 1)[0];
      const alive = entry.pinned || [...entry.waiting].some((t) => !t.dead && t.mesh.visible);
      if (!alive) {
        entry.state = 'idle';
        entry.waiting.clear();
        continue;
      }
      this.downloading++;
      entry.state = 'loading';
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const done = (state) => {
        this.downloading--;
        entry.state = state;
        entry.img = state === 'ready' ? (entry.keep ? this.filtered(img, entry.keep, entry.tint) : img) : null;
        for (const t of entry.waiting) if (!t.dead) t.dirty = true;
        entry.waiting.clear();
        if (entry.pinned) for (const t of this.tiles.values()) t.dirty = true;
        this.changed = true;
        this.wake?.();
      };
      img.onload = () => done('ready');
      img.onerror = () => done('missing');
      img.src = entry.url;
    }
    if (this.images.size > IMAGE_CACHE) this.trim();
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
    // Overlay tiles go before basemap tiles, then the least recently used.
    const old = [...this.images.values()].filter((e) => !e.pinned && e.state !== 'loading' && e.state !== 'queued').sort((a, b) => a.first - b.first || a.lastUsed - b.lastUsed);
    for (const entry of old.slice(0, this.images.size - IMAGE_CACHE * 0.8)) this.images.delete(entry.key);
  }

  get busy() {
    return this.downloading > 0 || this.queue.length > 0 || this.elevationLoading > 0 || this.elevationQueue.length > 0;
  }
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const sphere = new THREE.Sphere();
