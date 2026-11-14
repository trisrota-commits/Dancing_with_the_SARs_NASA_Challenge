// Streams map tiles onto the sphere. A quadtree picks the tiles the camera
// needs, and each visible tile composites every active layer into one small
// canvas, so the GPU draws exactly one textured mesh per tile however many
// layers are switched on.

import * as THREE from '../../vendor/three.module.min.js';
import { RAD, toVec, tileLon, tileLat, lonDelta } from './geo.js';

const SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 17;
const MAX_LEAVES = 320;
const PARALLEL_DOWNLOADS = 14;
const IMAGE_CACHE = 900;
const TILE_CACHE = 420;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uSun;
  uniform float uNight;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vec3 color = texture2D(map, vUv).rgb;
    float lit = smoothstep(-0.12, 0.18, dot(normalize(vNormal), uSun));
    color *= mix(1.0, mix(0.13, 1.0, lit), uNight);
    gl_FragColor = vec4(color, 1.0);
  }`;

const indexCache = new Map();
function gridIndex(rows, cols) {
  const key = `${rows}x${cols}`;
  if (!indexCache.has(key)) {
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + cols;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    indexCache.set(key, new THREE.BufferAttribute(new Uint16Array(idx), 1));
  }
  return indexCache.get(key);
}

export class TileGlobe {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // Dark sphere just under the tiles, so hairline gaps between tiles of
    // different detail never show space through them.
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.9994, 96, 64), new THREE.MeshBasicMaterial({ color: 0x08121d })));

    this.layers = [];
    this.tiles = new Map();
    this.images = new Map();
    this.queue = [];
    this.downloading = 0;
    this.frame = 0;
    this.leaves = [];
    this.stale = [];
    this.changed = true;
    this.uniforms = { uSun: { value: new THREE.Vector3(1, 0, 0) }, uNight: { value: 0 } };
    this.frustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
  }

  // layers: [{ url: 'https://…/{z}/{y}/{x}.png', maxLevel, alpha, base }]
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
    for (const tile of this.tiles.values()) tile.dirty = true;
    this.changed = true;
  }

  // ---------- tile selection ----------

  select(camera, viewportHeight) {
    const cam = camera.position;
    const dist = cam.length();
    this.cam = cam;
    this.alt = dist - 1;
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
      if (near.dot(this.cam) < 0.998) return; // over the horizon
      const centre = toVec((north + south) / 2, midLon, 1, scratchB);
      const corner = toVec(Math.abs(north) < Math.abs(south) ? north : south, west, 1, scratchC);
      sphere.center.copy(centre);
      sphere.radius = centre.distanceTo(corner) * 1.05;
      if (z > 3 && !this.frustum.intersectsSphere(sphere)) return;
    }

    let split = z < MIN_ZOOM;
    if (!split && z < MAX_ZOOM && leaves.length < MAX_LEAVES) {
      const range = Math.max(this.alt, near.distanceTo(this.cam));
      // Ground width of one texel, foreshortened when seen at a slant.
      const facing = Math.max(0.35, (near.dot(this.cam) - 1) / range);
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

    // Repaint a bounded number of tiles per frame to keep frames short.
    let budget = 24;
    for (const tile of this.tiles.values()) {
      if (!tile.dirty || !tile.mesh.visible) continue;
      this.paint(tile);
      this.changed = true;
      if (--budget === 0) break;
    }
    this.pump();
    const changed = this.changed;
    this.changed = false;
    return changed;
  }

  build(leaf, key) {
    const { z, x, y } = leaf;
    const n = z <= 2 ? 24 : z <= 5 ? 12 : 6;
    const edge = 2 ** z - 1;
    // Rows from north to south; the outermost tiles reach on to the pole.
    const rows = [];
    if (y === 0) rows.push({ lat: 90, v: 1 });
    for (let j = 0; j <= n; j++) rows.push({ lat: tileLat(y + j / n, z), v: 1 - j / n });
    if (y === edge) rows.push({ lat: -90, v: 0 });

    const cols = n + 1;
    const centre = toVec((leaf.north + leaf.south) / 2, (leaf.west + leaf.east) / 2);
    const position = new Float32Array(rows.length * cols * 3);
    const normal = new Float32Array(rows.length * cols * 3);
    const uv = new Float32Array(rows.length * cols * 2);
    const p = new THREE.Vector3();
    let k = 0;
    let u = 0;
    for (const row of rows) {
      for (let i = 0; i <= n; i++) {
        toVec(row.lat, leaf.west + ((leaf.east - leaf.west) * i) / n, 1, p);
        normal.set([p.x, p.y, p.z], k);
        // Stored relative to the tile centre to keep full precision up close.
        position.set([p.x - centre.x, p.y - centre.y, p.z - centre.z], k);
        k += 3;
        uv[u++] = i / n;
        uv[u++] = row.v;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(gridIndex(rows.length, cols));

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;

    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, uSun: this.uniforms.uSun, uNight: this.uniforms.uNight },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(centre);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return { z, x, y, key, mesh, canvas, ctx: canvas.getContext('2d'), texture, dirty: true, lastUsed: this.frame };
  }

  drop(key, tile) {
    this.group.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.mesh.material.dispose();
    tile.texture.dispose();
    tile.dead = true;
    this.tiles.delete(key);
  }

  // Draws every layer into the tile's canvas, using a coarser cached image
  // as a stand-in wherever the exact tile has not arrived yet.
  paint(tile) {
    const { ctx, z, x, y } = tile;
    tile.dirty = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a1826';
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (const layer of this.layers) {
      const top = Math.min(z, layer.maxLevel);
      const exact = this.image(layer, top, x >> (z - top), y >> (z - top), tile);
      if (exact.state === 'missing' && !layer.base) continue;
      for (let level = top; level >= 0; level--) {
        const shift = z - level;
        const entry = level === top ? exact : this.images.get(this.url(layer, level, x >> shift, y >> shift));
        if (!entry || entry.state !== 'ready') continue;
        const scale = 2 ** shift;
        const span = SIZE / scale;
        ctx.globalAlpha = layer.alpha ?? 1;
        ctx.drawImage(entry.img, (x % scale) * span, (y % scale) * span, span, span, 0, 0, SIZE, SIZE);
        entry.lastUsed = this.frame;
        break;
      }
    }
    tile.texture.needsUpdate = true;
  }

  // ---------- image loading ----------

  url(layer, z, x, y) {
    return layer.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  image(layer, z, x, y, tile) {
    const url = this.url(layer, z, x, y);
    let entry = this.images.get(url);
    if (!entry) {
      entry = { url, state: 'queued', img: null, waiting: new Set(), lastUsed: this.frame, first: !!layer.base };
      this.images.set(url, entry);
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
        entry.img = state === 'ready' ? img : null;
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

  trim() {
    const old = [...this.images.values()].filter((e) => !e.pinned && e.state !== 'loading' && e.state !== 'queued').sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of old.slice(0, this.images.size - IMAGE_CACHE * 0.8)) this.images.delete(entry.url);
  }

  get busy() {
    return this.downloading > 0 || this.queue.length > 0;
  }
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const sphere = new THREE.Sphere();
