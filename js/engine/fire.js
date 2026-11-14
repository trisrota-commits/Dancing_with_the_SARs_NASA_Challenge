// A wildfire drawn from satellite fire detections, with detail that grows
// as the camera comes closer:
//
//   far    each detection is a glowing ember, never smaller than a few pixels
//   near   the ember becomes a patch of burning ground the true size of the
//          detection, with flame tongues and sparks standing on it and
//          smoke climbing above
//
// The fire is one instanced draw call and the smoke another, and all
// movement happens in the shaders. A detection has a "born" time on the replay
// clock; from there it fades in, burns, and cools to a coal, so scrubbing
// the replay needs no new buffers.
//
// Where and when a detection appears is data. The flames, sparks and smoke
// are animation: their size and movement are not measured.

import * as THREE from '../../vendor/three.module.min.js';
import { toVec } from './geo.js';

const EARTH_RADIUS_M = 6_371_000;
const FOOT = 187.5 / EARTH_RADIUS_M; // half of a 375 m detection pixel
const GROUND_CLEARANCE = 25 / EARTH_RADIUS_M;
const BUDGET = 14000; // most particles drawn for one fire

const VERTEX = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aBorn;
  attribute float aSeed;
  attribute float aKind;
  uniform vec3 uCentre;
  uniform vec3 uCam;
  uniform float uNow;
  uniform float uStep;
  uniform float uTime;
  uniform float uRatio;
  uniform vec2 uViewport;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vLod;
  const float FOOT = ${FOOT.toExponential(6)};
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vUv = position.xy;
    vKind = aKind;
    // Age in days of replay time since the satellite saw this pixel burn.
    float age = (uNow - aBorn) / uStep;
    vec3 world = uCentre + aOffset;
    if (age < 0.0 || dot(world, uCam) < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float appear = smoothstep(0.0, 0.4, age);
    float heat = 1.0 - smoothstep(0.7, 2.8, age);

    vec3 up = normalize(world);
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up));
    vec3 north = cross(up, east);
    vec4 base = modelViewMatrix * vec4(aOffset, 1.0);
    float pxPerUnit = projectionMatrix[1][1] * uViewport.y * 0.5 / max(1e-7, -base.z);
    // How large the detection pixel is on screen decides the level of detail.
    float footPx = 2.0 * FOOT * pxPerUnit;
    float lod = smoothstep(6.0, 26.0, footPx);
    vLod = lod;

    vec3 local = aOffset;
    vec3 color = vec3(1.0);
    vec2 size;
    float alpha;
    // Upright things are drawn along the ground's "up" as the camera sees it,
    // so they stand on the terrain; seen from straight above they are round.
    float upright = 0.0;
    if (aKind < 0.5) {
      // Ember bed: a few pixels from afar, the true footprint up close.
      float flicker = 1.0 + heat * 0.25 * sin(uTime * (5.0 + aSeed * 6.0) + aSeed * 40.0) * sin(uTime * 2.3 + aSeed * 11.0);
      size = vec2(max((5.0 + 5.0 * heat) * uRatio / pxPerUnit, FOOT * 2.4));
      color = mix(vec3(0.45, 0.07, 0.02), vec3(1.0, 0.62, 0.2), heat) * flicker;
      alpha = appear;
    } else {
      // Particles live in cycles; each cycle starts at a new spot in the pixel.
      float rate = aKind < 1.5 ? 0.3 + 0.25 * hash(aSeed * 3.1) : aKind < 2.5 ? 0.5 + 0.5 * hash(aSeed * 5.3) : 0.13 + 0.08 * hash(aSeed * 7.7);
      float cycle = uTime * rate + aSeed * 31.0;
      float life = fract(cycle);
      float id = floor(cycle) + aSeed * 113.0;
      vec2 spot = (vec2(hash(id * 1.7), hash(id * 2.9)) - 0.5) * 2.0 * FOOT * 0.9;
      local += east * spot.x + north * spot.y;
      if (aKind < 1.5) {
        // Flame: a tongue that flares up and dies back where it stands.
        float flare = sin(3.14159 * life);
        float height = FOOT * (0.9 + 1.1 * hash(id * 4.3)) * (0.35 + 0.65 * heat) * (0.55 + 0.45 * flare);
        size = vec2(FOOT * (0.26 + 0.16 * hash(id * 5.9)), height);
        upright = 1.0;
        alpha = appear * heat * lod * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.75, 1.0, life));
      } else if (aKind < 2.5) {
        // Spark: a bright speck thrown higher, seen only from close by.
        float height = FOOT * (1.4 + 1.8 * hash(id * 6.1));
        local += up * (life * height) + east * sin(life * 9.0 + id) * FOOT * 0.1;
        size = vec2(max(FOOT * 0.03, 1.4 * uRatio / pxPerUnit));
        color = vec3(1.0, 0.75, 0.35);
        alpha = appear * heat * smoothstep(20.0, 70.0, footPx) * (1.0 - life);
      } else {
        // Smoke: keeps rising for a while after the flames have gone. The
        // feeds carry no wind, so it climbs straight up and spreads.
        float smoulder = 1.0 - smoothstep(1.5, 4.5, age);
        float height = FOOT * (2.6 + 3.0 * hash(id * 8.9));
        local += up * (life * height) + (east * sin(id) + north * cos(id)) * life * life * FOOT * 0.9;
        size = vec2(FOOT * (0.6 + 1.9 * life));
        color = mix(vec3(0.3, 0.16, 0.08), vec3(mix(0.24, 0.5, life)), smoothstep(0.0, 0.2, life));
        alpha = appear * smoulder * lod * 0.75 * sin(3.14159 * pow(life, 0.7));
      }
    }
    vColor = color;
    vAlpha = alpha;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    vec2 corner = position.xy * size.x;
    if (upright > 0.5) {
      vec2 axis = (modelViewMatrix * vec4(up, 0.0)).xy;
      float lean = length(axis);
      vec2 dir = lean > 1e-3 ? axis / lean : vec2(0.0, 1.0);
      corner = vec2(dir.y, -dir.x) * position.x * size.x + dir * mix(position.y * size.x, (position.y + 1.0) * 0.5 * size.y, lean);
    }
    mv.xy += corner;
    gl_Position = projectionMatrix * mv;
  }`;

// Colours are written premultiplied: alpha says how much of the ground a
// particle hides, so fire can both glow and cover, and smoke only covers.
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vLod;
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    if (vAlpha < 0.004) discard;
    float r = length(vUv);
    if (vKind < 0.5) {
      // Ember bed: a glow from afar; up close a patch of burning ground.
      if (r > 1.0) discard;
      float core = exp(-r * r * 18.0);
      float halo = exp(-r * r * 3.0) * 0.38 * (1.0 - r);
      vec3 glow = vColor * (core * 1.6 + halo) + vec3(0.6) * core * core;
      // Scorched ground with a ragged edge, scattered with glowing embers
      // that thin out as the pixel cools (vColor carries the heat).
      float ragged = noise(vUv * 3.0 + vSeed * 20.0);
      float bed = smoothstep(0.7, 0.3, r + (ragged - 0.5) * 0.35);
      float specks = noise(vUv * 15.0 + vSeed * 50.0);
      float pulse = 0.75 + 0.25 * sin(uTime * 3.0 + specks * 30.0);
      float hotness = vColor.g / 0.62;
      float embers = smoothstep(0.78 - 0.3 * hotness, 0.9, specks) * pulse;
      vec3 burning = (vec3(0.05, 0.03, 0.025) * 0.6 + vColor * (embers * 1.5 + 0.28 * hotness)) * bed;
      gl_FragColor = vec4(mix(glow, burning, vLod) * vAlpha, bed * 0.6 * vLod * vAlpha);
    } else if (vKind < 1.5) {
      // Flame tongue: wide at the foot, licking to a point, with noise
      // scrolling upward through it.
      float v = vUv.y * 0.5 + 0.5;
      float n = noise(vec2(vUv.x * 2.2 + vSeed * 13.0, v * 3.0 - uTime * 2.6 + vSeed * 7.0));
      float sway = (n - 0.5) * 0.9 * v;
      float width = (1.0 - v) * (0.55 + 0.6 * n) + 0.04;
      float d = abs(vUv.x + sway) / width;
      float body = (1.0 - smoothstep(0.35, 1.0, d)) * smoothstep(0.0, 0.07, v);
      if (body < 0.01) discard;
      vec3 hot = mix(vec3(1.0, 0.93, 0.62), vec3(1.0, 0.5, 0.08), smoothstep(0.0, 0.7, d + v * 0.55));
      hot = mix(hot, vec3(0.85, 0.14, 0.02), smoothstep(0.55, 1.0, v));
      float a = body * vAlpha;
      gl_FragColor = vec4(hot * a * 1.25, a * 0.7);
    } else if (vKind < 2.5) {
      if (r > 1.0) discard;
      float a = exp(-r * r * 3.5) * (1.0 - r) * vAlpha;
      gl_FragColor = vec4(vColor * a * 1.4, 0.0);
    } else {
      // Smoke: a soft puff broken up by noise.
      if (r > 1.0) discard;
      float billow = noise(vUv * 2.4 + vSeed * 30.0 + vec2(0.0, -uTime * 0.2));
      float a = exp(-r * r * 2.2) * (1.0 - r) * (0.55 + 0.75 * billow) * vAlpha;
      gl_FragColor = vec4(vColor * (0.8 + 0.4 * billow) * a, a);
    }
  }`;

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);

export class Fire {
  constructor(scene, shared) {
    this.uniforms = {
      uCentre: { value: new THREE.Vector3(0, 1, 0) },
      uCam: shared.uCam,
      uNow: { value: 0 },
      uStep: { value: 1 },
      uTime: shared.uTime,
      uRatio: shared.uRatio,
      uViewport: shared.uViewport,
    };
    const material = () =>
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false });
    // Smoke is drawn first so the fire glows through it.
    this.smoke = this.layer(scene, material(), 26);
    this.hot = this.layer(scene, material(), 27);
    this.items = [];
  }

  layer(scene, material, order) {
    const mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }

  // items: [{ lat, lon, born }] with born on the replay clock; centre is
  // where the fire is, lift(lat, lon) the ground height in Earth radii.
  set(items, centre, lift) {
    this.items = items;
    this.centre = centre;
    this.lift = lift;
    const on = items.length > 0;
    this.hot.visible = this.smoke.visible = on;
    if (!on) return;
    const origin = toVec(centre.lat, centre.lon);
    this.uniforms.uCentre.value.copy(origin);
    // A large fire gets fewer particles for each detection.
    const share = Math.max(0, Math.min(1, (BUDGET / items.length - 1) / 13));
    const flames = Math.round(3 + 6 * share);
    const sparks = Math.round(2 * share);
    const puffs = Math.round(1 + 3 * share);
    const hot = { offset: [], born: [], seed: [], kind: [] };
    const smoke = { offset: [], born: [], seed: [], kind: [] };
    const v = new THREE.Vector3();
    const add = (to, born, seed, kind) => {
      to.offset.push(v.x, v.y, v.z);
      to.born.push(born);
      to.seed.push(seed);
      to.kind.push(kind);
    };
    for (const it of items) {
      toVec(it.lat, it.lon, 1 + GROUND_CLEARANCE + (lift ? lift(it.lat, it.lon) : 0), v).sub(origin);
      // The same detection always burns the same way.
      const h = Math.sin(it.lat * 127.1 + it.lon * 311.7) * 43758.5453;
      const seed = h - Math.floor(h);
      add(hot, it.born, seed, 0);
      for (let k = 0; k < flames; k++) add(hot, it.born, (seed + k * 0.137) % 1, 1);
      for (let k = 0; k < sparks; k++) add(hot, it.born, (seed + 0.5 + k * 0.211) % 1, 2);
      for (let k = 0; k < puffs; k++) add(smoke, it.born, (seed + 0.3 + k * 0.173) % 1, 3);
    }
    this.fill(this.hot, hot, origin);
    this.fill(this.smoke, smoke, origin);
  }

  fill(mesh, data, origin) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(data.offset), 3));
    g.setAttribute('aBorn', new THREE.InstancedBufferAttribute(new Float32Array(data.born), 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(data.seed), 1));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(data.kind), 1));
    g.instanceCount = data.born.length;
    mesh.geometry.dispose();
    mesh.geometry = g;
    // Offsets are stored from the fire's centre to keep full precision up close.
    mesh.position.copy(origin);
    mesh.updateMatrix();
    mesh.matrixWorldNeedsUpdate = true;
    mesh.visible = data.born.length > 0;
  }

  // Sets the replay clock: now, and how many of its seconds make one day.
  time(now, step) {
    this.uniforms.uNow.value = now;
    this.uniforms.uStep.value = step;
  }

  // Back onto the ground after new terrain has loaded.
  relift() {
    if (this.items.length) this.set(this.items, this.centre, this.lift);
  }
}
