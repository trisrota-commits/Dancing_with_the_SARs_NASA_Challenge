// Everything drawn on top of the tiles: event dots and their light beams,
// lines, glowing points, the storm spiral, the atmosphere and the stars.
// Each kind is a single draw call.

import * as THREE from '../../vendor/three.module.min.js';
import { toVec } from './geo.js';

export const LIFT = 2e-5; // marks sit about 130 m above the ground

// ---------- event dots ----------

const DOT_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aRing;
  attribute float aBorn;
  attribute float aPop;
  uniform vec3 uCam;
  uniform float uScale;
  uniform float uRatio;
  uniform float uTime;
  varying vec3 vColor;
  varying float vDisc;
  varying float vSprite;
  varying float vRing;
  varying float vPulse;
  void main() {
    vColor = aColor;
    vRing = aRing;
    float age = uTime - aBorn;
    vPulse = age < 90.0 ? fract(age / 1.8) : -1.0;
    // A mark with a pop time swells into place and sends out one ring.
    float popped = uTime - aPop;
    float grow = clamp(popped / 0.4, 0.0, 1.0);
    grow = 1.0 - pow(1.0 - grow, 3.0);
    if (popped < 1.1) vPulse = max(0.0, popped / 1.1);
    vDisc = aSize * uScale * uRatio * mix(0.2, 1.0, grow);
    vSprite = vDisc + (vPulse >= 0.0 ? 52.0 : 26.0) * uRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Hide dots on the far side of the Earth.
    if (dot(position, uCam) < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = vSprite;
  }`;

const DOT_FRAGMENT = /* glsl */ `
  uniform float uRatio;
  uniform float uHalo;
  varying vec3 vColor;
  varying float vDisc;
  varying float vSprite;
  varying float vRing;
  varying float vPulse;
  void main() {
    // vRing 2 draws a diamond (a changing place) instead of a disc.
    vec2 d = gl_PointCoord - 0.5;
    float r = vRing > 1.5 ? (abs(d.x) + abs(d.y)) * 0.8 * vSprite : length(d) * vSprite;
    float edge = vDisc * 0.5;
    float px = uRatio;
    vec4 color = vec4(0.0);
    // Filled disc with a thin dark rim.
    float disc = 1.0 - smoothstep(edge - px, edge, r);
    vec3 fill = mix(vColor, vec3(0.02, 0.03, 0.05), smoothstep(edge - 2.0 * px, edge - px, r) * 0.7);
    color = vec4(fill, disc * 0.95);
    // Soft glow around the mark, so it reads against any ground.
    float halo = exp(-max(0.0, r - edge) / (4.5 * px)) * 0.42 * (1.0 - disc) * uHalo;
    color = mix(color, vec4(vColor, 1.0), halo);
    // White ring: NISAR has imaged this spot recently.
    if (vRing > 0.5 && vRing < 1.5) {
      float ring = smoothstep(edge, edge + px, r) * (1.0 - smoothstep(edge + 2.2 * px, edge + 3.2 * px, r));
      color = mix(color, vec4(1.0), ring);
    }
    // Expanding ring on events that just arrived.
    if (vPulse >= 0.0) {
      float at = edge + vPulse * 23.0 * px;
      float wave = (1.0 - smoothstep(0.0, 1.6 * px, abs(r - at))) * (1.0 - vPulse);
      color = mix(color, vec4(vColor, 1.0), wave);
    }
    if (color.a < 0.01) discard;
    gl_FragColor = color;
  }`;

export class Dots {
  // halo: a soft glow around each mark (for the event dots).
  constructor(scene, shared, { halo = false } = {}) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uCam: shared.uCam, uScale: shared.uScale, uRatio: shared.uRatio, uTime: shared.uTime, uHalo: { value: halo ? 1 : 0 } },
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    scene.add(this.points);
    this.items = [];
  }

  // items: [{ lat, lon, color: [r,g,b], size, ring, born, pop }]; ring is
  // true for a white ring, or 2 for a diamond. born starts a long pulse
  // (new arrivals), pop a short entrance. lift(lat, lon) gives the ground
  // height there, in Earth radii.
  set(items, lift) {
    this.items = items;
    this.lift = lift;
    const n = items.length;
    const position = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const ring = new Float32Array(n);
    const born = new Float32Array(n);
    const pop = new Float32Array(n);
    const v = new THREE.Vector3();
    items.forEach((it, i) => {
      pop[i] = it.pop ?? -1e6;
      toVec(it.lat, it.lon, 1 + LIFT + (lift ? lift(it.lat, it.lon) : 0), v);
      it.vec = v.clone();
      position.set([v.x, v.y, v.z], i * 3);
      color.set(it.color, i * 3);
      size[i] = it.size;
      ring[i] = typeof it.ring === 'number' ? it.ring : it.ring ? 1 : 0;
      born[i] = it.born ?? -1e6;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aRing', new THREE.BufferAttribute(ring, 1));
    g.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    g.setAttribute('aPop', new THREE.BufferAttribute(pop, 1));
    this.points.geometry.dispose();
    this.points.geometry = g;
  }

  // Moves the dots back onto the ground after new terrain has loaded.
  relift() {
    const position = this.points.geometry.attributes.position;
    if (!position || !this.lift) return;
    this.items.forEach((it, i) => {
      toVec(it.lat, it.lon, 1 + LIFT + this.lift(it.lat, it.lon), it.vec);
      position.setXYZ(i, it.vec.x, it.vec.y, it.vec.z);
    });
    position.needsUpdate = true;
  }
}

// ---------- lines with a real pixel width ----------

const LINE_VERTEX = /* glsl */ `
  attribute vec3 aOther;
  attribute float aSide;
  attribute vec4 aColor;
  attribute float aAlong;
  uniform vec2 uViewport;
  uniform float uWidth;
  uniform float uRatio;
  varying vec4 vColor;
  varying float vAlong;
  void main() {
    vColor = aColor;
    vAlong = aAlong;
    vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
    if (a.w <= 0.0 || b.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 dir = (b.xy / b.w - a.xy / a.w) * uViewport;
    float len = length(dir);
    dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x);
    a.xy += normal * aSide * uWidth * uRatio / uViewport * a.w;
    gl_Position = a;
  }`;

const LINE_FRAGMENT = /* glsl */ `
  uniform float uDash;
  varying vec4 vColor;
  varying float vAlong;
  void main() {
    if (uDash > 0.0 && fract(vAlong * uDash) > 0.55) discard;
    gl_FragColor = vColor;
  }`;

export class Lines {
  constructor(scene, shared, { width = 1.5, dash = 0, order = 20, depthTest = true } = {}) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uViewport: shared.uViewport, uRatio: shared.uRatio, uWidth: { value: width }, uDash: { value: dash } },
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      transparent: true,
      depthTest,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    scene.add(this.mesh);
  }

  // paths: [{ points: [Vector3…], color: [r,g,b,a] }]; each path is drawn as
  // screen-facing quads, one per segment.
  set(paths) {
    let segments = 0;
    for (const p of paths) segments += Math.max(0, p.points.length - 1);
    const position = new Float32Array(segments * 12);
    const other = new Float32Array(segments * 12);
    const side = new Float32Array(segments * 4);
    const color = new Float32Array(segments * 16);
    const along = new Float32Array(segments * 4);
    const index = new Uint32Array(segments * 6);
    let s = 0;
    for (const path of paths) {
      const total = path.points.length - 1;
      for (let i = 0; i < total; i++, s++) {
        const a = path.points[i];
        const b = path.points[i + 1];
        // Two vertices at each end; the sign flips so both ends agree on "left".
        const ends = [a, a, b, b];
        const others = [b, b, a, a];
        const sides = [1, -1, -1, 1];
        for (let k = 0; k < 4; k++) {
          position.set([ends[k].x, ends[k].y, ends[k].z], s * 12 + k * 3);
          other.set([others[k].x, others[k].y, others[k].z], s * 12 + k * 3);
          side[s * 4 + k] = sides[k];
          color.set(path.color, s * 16 + k * 4);
          along[s * 4 + k] = (i + (k > 1 ? 1 : 0)) / total;
        }
        index.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aOther', new THREE.BufferAttribute(other, 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 4));
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}

// ---------- pulsing ring on the selected event ----------

const RING_VERTEX = /* glsl */ `
  uniform vec3 uCam;
  uniform float uRatio;
  uniform float uTime;
  varying float vSize;
  void main() {
    vSize = (30.0 + 8.0 * (0.5 + 0.5 * sin(uTime * 3.8))) * uRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    if (dot(position, uCam) < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = vSize + 4.0 * uRatio;
  }`;

const RING_FRAGMENT = /* glsl */ `
  uniform float uRatio;
  varying float vSize;
  void main() {
    float r = length(gl_PointCoord - 0.5) * (vSize + 4.0 * uRatio);
    float ring = 1.0 - smoothstep(0.0, 1.5 * uRatio, abs(r - vSize * 0.5));
    if (ring < 0.01) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, ring);
  }`;

export class SelectionRing {
  constructor(scene, shared) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uCam: shared.uCam, uRatio: shared.uRatio, uTime: shared.uTime },
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 31;
    this.points.visible = false;
    scene.add(this.points);
  }

  set(lat, lon, lift = 0) {
    this.points.visible = lat != null;
    if (lat == null) return;
    const v = toVec(lat, lon, 1 + LIFT + lift);
    this.points.geometry.attributes.position.setXYZ(0, v.x, v.y, v.z);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- storm: a cloud spiral floating above the ground ----------

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + 17.0;
      a *= 0.5;
    }
    return v;
  }`;

const VORTEX_VERTEX = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const VORTEX_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uTurn;
  uniform float uPower;
  varying vec2 vP;
  ${NOISE}
  void main() {
    // x runs east and y north; mirrored south of the equator.
    vec2 p = vec2(vP.x * uTurn, vP.y);
    float r = length(p);
    if (r >= 1.0) discard;
    float angle = atan(p.y, p.x);
    float twist = 3.0 * log(r + 0.05);
    float spin = uTime * (0.22 + 0.75 * uPower);
    // Two cloud decks, the inner one turning faster than the outer.
    float a1 = angle + twist - spin;
    float a2 = angle + twist - spin * 0.6;
    float inner = fbm(r * vec2(cos(a1), sin(a1)) * 4.5 + 3.0);
    float outer = fbm(r * vec2(cos(a2), sin(a2)) * 3.4 + 11.0);
    float cloud = mix(inner, outer, smoothstep(0.25, 0.7, r));
    // Two rain bands winding into the centre.
    float arms = 0.5 + 0.5 * sin(2.0 * (angle - spin * 0.8) + 2.0 * twist);
    float body = smoothstep(1.0, 0.4, r);
    float density = (cloud * 0.8 + arms * 0.42) * body + 0.6 * smoothstep(0.5, 0.0, r);
    // Only strong storms have a clear eye.
    float eye = mix(1.0, smoothstep(0.03, 0.1, r), smoothstep(0.4, 0.62, uPower));
    float alpha = smoothstep(0.36, 0.8, density) * eye;
    vec3 color = mix(uColor, vec3(1.0), 0.72) * (0.72 + 0.4 * cloud);
    gl_FragColor = vec4(color, alpha * 0.93);
  }`;

export class Vortex {
  constructor(scene, shared) {
    this.uniforms = { uTime: shared.uTime, uColor: { value: new THREE.Vector3(1, 1, 1) }, uTurn: { value: 1 }, uPower: { value: 0.5 } };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VORTEX_VERTEX, fragmentShader: VORTEX_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 28;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // at: { lat, lon, radius, lift, color: [r, g, b], power: 0..1 }, with radius
  // and lift in Earth radii. Storms turn clockwise south of the equator.
  set(at) {
    this.mesh.visible = !!at;
    if (!at) return;
    const up = toVec(at.lat, at.lon);
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const east = new THREE.Vector3().crossVectors(north, up);
    this.mesh.matrix.makeBasis(east.multiplyScalar(at.radius), north.multiplyScalar(at.radius), up.clone().multiplyScalar(at.radius));
    this.mesh.matrix.setPosition(up.multiplyScalar(1 + at.lift));
    this.mesh.matrixWorldNeedsUpdate = true;
    this.uniforms.uColor.value.set(...at.color);
    this.uniforms.uTurn.value = at.lat < 0 ? -1 : 1;
    this.uniforms.uPower.value = at.power;
  }
}

// ---------- glowing points: fire detections, flashes ----------

const GLOW_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aWorld;
  attribute float aSeed;
  uniform vec3 uCam;
  uniform float uRatio;
  uniform float uTime;
  uniform vec2 uViewport;
  varying vec3 vColor;
  void main() {
    // aSeed below zero means a steady glow; otherwise it sets the flicker.
    float flicker = aSeed < 0.0 ? 1.0 : 0.82 + 0.3 * sin(uTime * (5.0 + aSeed * 6.0) + aSeed * 40.0) * sin(uTime * 2.3 + aSeed * 11.0);
    vColor = aColor * flicker;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    if (dot(position, uCam) < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    // The bright core is a quarter of the sprite; the rest is its halo. The
    // core never gets smaller than aSize pixels, nor than aWorld on the ground.
    float ground = aWorld * projectionMatrix[1][1] * uViewport.y / max(1e-6, gl_Position.w);
    gl_PointSize = 4.0 * max(aSize * uRatio, ground);
  }`;

const GLOW_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = exp(-r * r * 18.0);
    float halo = exp(-r * r * 3.0) * 0.38 * (1.0 - r);
    gl_FragColor = vec4(vColor * (core * 1.6 + halo) + vec3(0.6) * core * core, 1.0);
  }`;

export class Glow {
  constructor(scene, shared) {
    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        uniforms: { uCam: shared.uCam, uRatio: shared.uRatio, uTime: shared.uTime, uViewport: shared.uViewport },
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 27;
    scene.add(this.points);
    this.items = [];
  }

  // items: [{ lat, lon, color: [r, g, b], size, km, flicker }]. size is the
  // smallest core diameter in pixels, km its true diameter on the ground.
  set(items, lift) {
    this.items = items;
    this.lift = lift;
    const n = items.length;
    const position = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const world = new Float32Array(n);
    const seed = new Float32Array(n);
    const v = new THREE.Vector3();
    items.forEach((it, i) => {
      toVec(it.lat, it.lon, 1 + LIFT + (lift ? lift(it.lat, it.lon) : 0), v);
      position.set([v.x, v.y, v.z], i * 3);
      color.set(it.color, i * 3);
      size[i] = it.size;
      world[i] = (it.km || 0) / 2 / 6371;
      // The same detection always flickers the same way.
      const h = Math.sin(it.lat * 127.1 + it.lon * 311.7) * 43758.5453;
      seed[i] = it.flicker ? h - Math.floor(h) : -1;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aWorld', new THREE.BufferAttribute(world, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.points.geometry.dispose();
    this.points.geometry = g;
  }
}

// ---------- light beams standing on the event dots ----------

const BEAM_VERTEX = /* glsl */ `
  attribute float aTop;
  attribute float aSide;
  attribute vec3 aColor;
  attribute float aHeight;
  uniform float uBeam;
  uniform vec2 uViewport;
  uniform float uRatio;
  varying vec3 vColor;
  varying float vTop;
  varying float vSide;
  void main() {
    vColor = aColor;
    vTop = aTop;
    vSide = aSide;
    vec3 top = position * (1.0 + aHeight * uBeam);
    vec4 a = projectionMatrix * modelViewMatrix * vec4(aTop > 0.5 ? top : position, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(aTop > 0.5 ? position : top, 1.0);
    if (uBeam <= 0.0 || a.w <= 0.0 || b.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 dir = (b.xy / b.w - a.xy / a.w) * uViewport;
    float len = length(dir);
    dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x) * (aTop > 0.5 ? -1.0 : 1.0);
    a.xy += normal * aSide * 9.0 * uRatio / uViewport * a.w;
    gl_Position = a;
  }`;

const BEAM_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vTop;
  varying float vSide;
  void main() {
    // Brightest at the foot and along the middle, fading upward.
    float across = 1.0 - abs(vSide);
    float rise = pow(1.0 - vTop, 1.15);
    gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.55 * pow(across, 3.0)), across * rise * 0.95);
  }`;

export class Beams {
  // shared.uBeam scales every beam: the globe sets it from the camera, so
  // beams rise as the view tilts and stay a steady size on screen.
  constructor(scene, shared) {
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        uniforms: { uBeam: shared.uBeam, uViewport: shared.uViewport, uRatio: shared.uRatio },
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    scene.add(this.mesh);
  }

  // items: [{ lat, lon, color: [r, g, b], height: 0..1 }]
  set(items, lift) {
    const n = items.length;
    const position = new Float32Array(n * 12);
    const top = new Float32Array(n * 4);
    const side = new Float32Array(n * 4);
    const color = new Float32Array(n * 12);
    const height = new Float32Array(n * 4);
    const index = new Uint32Array(n * 6);
    const v = new THREE.Vector3();
    items.forEach((it, i) => {
      toVec(it.lat, it.lon, 1 + LIFT + (lift ? lift(it.lat, it.lon) : 0), v);
      for (let k = 0; k < 4; k++) {
        position.set([v.x, v.y, v.z], i * 12 + k * 3);
        color.set(it.color, i * 12 + k * 3);
        top[i * 4 + k] = k > 1 ? 1 : 0;
        side[i * 4 + k] = k % 2 ? -1 : 1;
        height[i * 4 + k] = it.height;
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}

// ---------- atmosphere and stars ----------

export function atmosphere(scene) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Brightest where the shell meets the Earth's edge, fading outward.
        float glow = pow(clamp(-dot(vNormal, vView) / 0.5, 0.0, 1.0), 2.6);
        gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * glow * uStrength;
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.16, 96, 64), material);
  mesh.renderOrder = 1;
  scene.add(mesh);
  return material;
}

export function stars() {
  const n = 2600;
  const position = new Float32Array(n * 3);
  const shade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    position.set([r * Math.cos(a) * 5, z * 5, r * Math.sin(a) * 5], i * 3);
    shade[i] = 0.25 + Math.random() ** 3 * 0.75;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
  const points = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      uniforms: { uRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aShade;
        uniform float uRatio;
        varying float vShade;
        void main() {
          vShade = aShade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (0.8 + aShade * 1.4) * uRatio;
        }`,
      fragmentShader: /* glsl */ `
        varying float vShade;
        void main() { gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vShade, 1.0); }`,
      depthTest: false,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;
  return points;
}
