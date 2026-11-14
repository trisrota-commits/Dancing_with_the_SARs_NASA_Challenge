// Everything drawn on top of the tiles: event dots, lines, radar image
// patches, the atmosphere and the stars. Each kind is a single draw call.

import * as THREE from '../../vendor/three.module.min.js';
import { toVec } from './geo.js';

export const LIFT = 2e-5; // marks sit about 130 m above the ground

// ---------- event dots ----------

const DOT_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aRing;
  attribute float aBorn;
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
    vDisc = aSize * uScale * uRatio;
    vSprite = vDisc + (vPulse >= 0.0 ? 52.0 : 10.0) * uRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Hide dots on the far side of the Earth.
    if (dot(position, uCam) < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = vSprite;
  }`;

const DOT_FRAGMENT = /* glsl */ `
  uniform float uRatio;
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
  constructor(scene, shared) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uCam: shared.uCam, uScale: shared.uScale, uRatio: shared.uRatio, uTime: shared.uTime },
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

  // items: [{ lat, lon, color: [r,g,b], size, ring, born }]; ring is true for
  // a white ring, or 2 for a diamond. lift(lat, lon)
  // gives the ground height there, in Earth radii.
  set(items, lift) {
    this.items = items;
    this.lift = lift;
    const n = items.length;
    const position = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const ring = new Float32Array(n);
    const born = new Float32Array(n);
    const v = new THREE.Vector3();
    items.forEach((it, i) => {
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

// ---------- spinning storm marker ----------

const VORTEX_VERTEX = /* glsl */ `
  uniform vec3 uCam;
  uniform float uRatio;
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    if (dot(position, uCam) < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = uSize * uRatio;
  }`;

const VORTEX_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uTurn;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float angle = atan(p.y, p.x) * uTurn;
    // Two spiral arms winding into a clear eye.
    float arms = 0.5 + 0.5 * sin(angle * 2.0 + log(r + 0.04) * 5.0 + uTime * 2.6);
    float body = smoothstep(1.0, 0.25, r) * smoothstep(0.07, 0.16, r);
    float alpha = body * (0.25 + 0.75 * arms);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), arms * 0.45), alpha);
  }`;

export class Vortex {
  constructor(scene, shared) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.uniforms = { uCam: shared.uCam, uRatio: shared.uRatio, uTime: shared.uTime, uSize: { value: 60 }, uColor: { value: new THREE.Vector3(1, 1, 1) }, uTurn: { value: 1 } };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VORTEX_VERTEX, fragmentShader: VORTEX_FRAGMENT, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 28;
    this.points.visible = false;
    scene.add(this.points);
  }

  // vec: position; size in pixels; south: storms turn clockwise south of the equator.
  set(vec, size, color, south) {
    this.points.visible = !!vec;
    if (!vec) return;
    this.points.geometry.attributes.position.setXYZ(0, vec.x, vec.y, vec.z);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.uniforms.uSize.value = size;
    this.uniforms.uColor.value.set(...color);
    this.uniforms.uTurn.value = south ? -1 : 1;
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
