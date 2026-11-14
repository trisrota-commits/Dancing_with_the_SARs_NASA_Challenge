// A wildfire drawn from satellite fire detections. The look is light, not
// drawn shapes: glowing ground, small soft glows, sparks and thin smoke.
// Coming closer never enlarges anything; it adds finer detail:
//
//   far    each detection is a glowing ember, never smaller than a few pixels
//   near   the ember becomes scorched ground the true size of the detection,
//          veined with glowing embers, with more and more small glows and
//          sparks rising from it and smoke above
//
// The fire is one instanced draw call and the smoke another, and all
// movement happens in the shaders. A detection has a "born" time on the
// replay clock; from there it fades in, burns, and cools to a coal, so
// scrubbing the replay needs no new buffers.
//
// Where and when a detection appears is data. The glows, sparks and smoke
// are animation: their size and movement are not measured.

import * as THREE from '../../vendor/three.module.min.js';
import { toVec } from './geo.js';

const EARTH_RADIUS_M = 6_371_000;
const FOOT = 187.5 / EARTH_RADIUS_M; // half of a 375 m detection pixel
const GROUND_CLEARANCE = 25 / EARTH_RADIUS_M;
const BUDGET = 42000; // most particles drawn for one fire

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
  varying float vFoot;
  varying float vHeat;
  const float FOOT = ${FOOT.toExponential(6)};
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vUv = position.xy;
    // aKind holds the kind of particle and, after the point, how close the
    // camera has to be before this one joins in (0 shows first).
    float kind = floor(aKind + 0.001);
    float rank = fract(aKind);
    vKind = kind;
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
    float px = uRatio / pxPerUnit; // one screen pixel, as a length on the ground
    // How large the detection pixel is on screen decides the level of detail.
    float footPx = 2.0 * FOOT * pxPerUnit;
    float lod = smoothstep(6.0, 26.0, footPx);
    // 0 where the pixel is 8 px wide, 1 where it is about 500: particles
    // join in one by one along the way.
    float detail = log2(max(footPx, 1.0) / 8.0) / 6.0;
    float joined = smoothstep(rank - 0.05, rank + 0.05, detail);
    vLod = lod;
    vFoot = footPx;
    vHeat = heat;

    vec3 local = aOffset;
    vec3 color = vec3(1.0);
    float size;
    float alpha;
    if (kind < 0.5) {
      // Ember bed: a few pixels from afar, the true footprint up close.
      float flicker = 1.0 + heat * 0.25 * sin(uTime * (5.0 + aSeed * 6.0) + aSeed * 40.0) * sin(uTime * 2.3 + aSeed * 11.0);
      size = max((5.0 + 5.0 * heat) * px, FOOT * 2.4);
      color = mix(vec3(0.45, 0.07, 0.02), vec3(1.0, 0.62, 0.2), heat) * flicker;
      alpha = appear;
    } else {
      // Particles live in cycles; each cycle starts at a new spot in the pixel.
      float rate = kind < 1.5 ? 0.3 + 0.3 * hash(aSeed * 3.1) : kind < 2.5 ? 0.25 + 0.3 * hash(aSeed * 5.3) : 0.1 + 0.07 * hash(aSeed * 7.7);
      float cycle = uTime * rate + aSeed * 31.0;
      float life = fract(cycle);
      float id = floor(cycle) + aSeed * 113.0;
      vec2 spot = (vec2(hash(id * 1.7), hash(id * 2.9)) - 0.5) * 2.0 * FOOT * 0.95;
      local += east * spot.x + north * spot.y;
      if (kind < 1.5) {
        // A small soft glow that swells and fades close to the ground. It
        // stays small on screen however close the camera comes.
        float swell = sin(3.14159 * life);
        local += up * (life * min(FOOT * 0.3, 14.0 * px));
        size = min(FOOT * (0.2 + 0.16 * hash(id * 5.9)), (7.0 + 6.0 * hash(id * 4.3)) * px) * (0.6 + 0.4 * swell);
        color = mix(vec3(1.0, 0.8, 0.4), vec3(1.0, 0.36, 0.06), life);
        alpha = appear * heat * joined * swell;
      } else if (kind < 2.5) {
        // Spark: a speck drifting up and swaying.
        float climb = min(FOOT * (1.0 + 1.6 * hash(id * 6.1)), (40.0 + 70.0 * hash(id * 6.1)) * px);
        local += up * (life * climb) + (east * sin(life * 7.0 + id) + north * cos(life * 5.0 + id * 1.3)) * min(FOOT * 0.1, 6.0 * px) * life;
        size = (1.1 + 0.9 * hash(id * 2.3)) * px;
        color = mix(vec3(1.0, 0.85, 0.5), vec3(1.0, 0.4, 0.1), life);
        alpha = appear * heat * joined * (1.0 - life) * smoothstep(0.0, 0.1, life);
      } else {
        // Smoke: thin and slow, lit by the fire at its foot. It keeps
        // rising for a while after the heat has gone. The feeds carry no
        // wind, so it climbs straight up and spreads.
        float smoulder = 1.0 - smoothstep(1.5, 4.5, age);
        float climb = min(FOOT * (2.2 + 2.4 * hash(id * 8.9)), (90.0 + 110.0 * hash(id * 8.9)) * px);
        local += up * (life * climb) + (east * sin(id) + north * cos(id)) * life * life * min(FOOT * 0.8, 40.0 * px);
        size = min(FOOT * (0.6 + 1.7 * life), (26.0 + 60.0 * life) * px);
        color = mix(vec3(0.5, 0.24, 0.1) * (0.5 + 0.5 * heat) + vec3(0.12), vec3(mix(0.26, 0.48, life)), smoothstep(0.0, 0.35, life));
        alpha = appear * smoulder * lod * joined * 0.5 * sin(3.14159 * pow(life, 0.7));
      }
    }
    vColor = color;
    vAlpha = alpha;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    mv.xy += position.xy * size;
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
  varying float vFoot;
  varying float vHeat;
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // Thin bright lines where the noise crosses its middle: ember veins.
  float veins(vec2 p) {
    // Two turned and bent layers, so the lines wander instead of following
    // the grid the noise is built on.
    p += (vec2(noise(p * 0.8 + 7.0), noise(p * 0.8 + 19.0)) - 0.5) * 1.1;
    vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * p * 1.6 + 5.0;
    float n = 0.6 * noise(p) + 0.4 * noise(q);
    return 1.0 - smoothstep(0.0, 0.055, abs(n - 0.5));
  }
  void main() {
    if (vAlpha < 0.004) discard;
    float r = length(vUv);
    if (r > 1.0) discard;
    if (vKind < 0.5) {
      // From afar: a glowing ember.
      float core = exp(-r * r * 18.0);
      float halo = exp(-r * r * 3.0) * 0.38 * (1.0 - r);
      vec3 glow = vColor * (core * 1.6 + halo) + vec3(0.6) * core * core;
      // Up close: scorched ground with a ragged edge, veined with embers.
      // The veins keep about the same size on screen, so closer means finer.
      vec2 at = vUv + vSeed * 20.0;
      float ragged = noise(at * 3.0);
      float bed = smoothstep(0.72, 0.3, r + (ragged - 0.5) * 0.35);
      float level = log2(max(vFoot, 12.0) / 34.0);
      float scale = exp2(floor(level)) * 3.0;
      float vein = mix(veins(at * scale), veins(at * scale * 2.0), fract(level));
      // Fewer veins stay lit as the ground cools, and they breathe slowly.
      float lit = noise(at * 2.2 + vec2(uTime * 0.06, 0.0)) + 0.12 * sin(uTime * 1.3 + vSeed * 30.0);
      float embers = vein * smoothstep(0.72 - 0.5 * vHeat, 0.98 - 0.5 * vHeat, lit);
      vec3 scorch = (vec3(0.035, 0.022, 0.018) + vColor * (embers * 1.5 + 0.1 * vHeat)) * bed;
      // Heat lighting the ground around the burning pixel.
      vec3 warmth = vColor * exp(-r * r * 2.6) * 0.2 * vHeat;
      gl_FragColor = vec4(mix(glow, scorch + warmth, vLod) * vAlpha, bed * 0.55 * vLod * vAlpha);
    } else if (vKind < 1.5) {
      // Soft glow: light, not a shape.
      float a = exp(-r * r * 3.2) * (1.0 - r) * vAlpha;
      gl_FragColor = vec4(vColor * a * 1.15, a * 0.2);
    } else if (vKind < 2.5) {
      float a = exp(-r * r * 3.0) * (1.0 - r) * vAlpha;
      gl_FragColor = vec4(vColor * a * 1.5, 0.0);
    } else {
      // Smoke: a soft puff broken up by noise.
      float billow = noise(vUv * 2.2 + vSeed * 30.0 + vec2(0.0, -uTime * 0.15));
      float a = exp(-r * r * 2.4) * (1.0 - r) * (0.5 + 0.7 * billow) * vAlpha;
      gl_FragColor = vec4(vColor * (0.85 + 0.3 * billow) * a, a);
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
    const share = Math.max(0, Math.min(1, (BUDGET / items.length - 10) / 35));
    const glows = Math.round(5 + 19 * share);
    const sparks = Math.round(3 + 11 * share);
    const puffs = Math.round(2 + 4 * share);
    const hot = { offset: [], born: [], seed: [], kind: [] };
    const smoke = { offset: [], born: [], seed: [], kind: [] };
    const v = new THREE.Vector3();
    const add = (to, born, seed, kind, rank) => {
      to.offset.push(v.x, v.y, v.z);
      to.born.push(born);
      to.seed.push(seed);
      to.kind.push(kind + Math.min(0.98, rank));
    };
    for (const it of items) {
      toVec(it.lat, it.lon, 1 + GROUND_CLEARANCE + (lift ? lift(it.lat, it.lon) : 0), v).sub(origin);
      // The same detection always burns the same way.
      const h = Math.sin(it.lat * 127.1 + it.lon * 311.7) * 43758.5453;
      const seed = h - Math.floor(h);
      add(hot, it.born, seed, 0, 0);
      // Each particle carries the closeness at which it joins in, so the
      // fire fills with detail as the camera approaches.
      for (let k = 0; k < glows; k++) add(hot, it.born, (seed + k * 0.137) % 1, 1, 0.12 + (0.86 * k) / glows);
      for (let k = 0; k < sparks; k++) add(hot, it.born, (seed + 0.5 + k * 0.211) % 1, 2, 0.3 + (0.68 * k) / sparks);
      for (let k = 0; k < puffs; k++) add(smoke, it.born, (seed + 0.3 + k * 0.173) % 1, 3, 0.15 + (0.8 * k) / puffs);
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
