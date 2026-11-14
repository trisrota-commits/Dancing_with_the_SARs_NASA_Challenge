// A wildfire drawn from satellite fire detections, as soft glowing spots.
// One spot for each detection, nothing drawn between them:
//
//   far    a small bright ember, never smaller than a few pixels
//   near   a soft glow the true size of the 375 m detection pixel, centred
//          exactly on its coordinates: reddest in the middle, amber
//          towards the rim, with a fine shimmer, a pin of light at the
//          exact position and a little thin smoke
//
// The spots are one instanced draw call and the smoke another, and all
// movement happens in the shaders. A detection has a "born" time on the
// replay clock; from there it fades in, glows, and cools to a dull red, so
// scrubbing the replay needs no new buffers.
//
// Where and when a detection appears is data. The shape of the glow, its
// shimmer and the smoke are animation: they are not measured.

import * as THREE from '../../vendor/three.module.min.js';
import { toVec } from './geo.js';

const EARTH_RADIUS_M = 6_371_000;
const FOOT = 187.5 / EARTH_RADIUS_M; // half of a 375 m detection pixel
const GROUND_CLEARANCE = 25 / EARTH_RADIUS_M;
const SPOT = 2.6; // sprite half-size up close, in half-pixels of the sensor

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
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vLod;
  varying float vFoot;
  varying float vHeat;
  varying float vLife;
  const float FOOT = ${FOOT.toExponential(6)};
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vUv = position.xy;
    vKind = aKind;
    vSeed = aSeed;
    // Age in days of replay time since the satellite saw this pixel burn.
    float age = (uNow - aBorn) / uStep;
    vec3 world = uCentre + aOffset;
    if (age < 0.0 || dot(world, uCam) < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float appear = smoothstep(0.0, 0.4, age);
    float heat = 1.0 - smoothstep(0.7, 2.8, age);

    vec4 base = modelViewMatrix * vec4(aOffset, 1.0);
    float pxPerUnit = projectionMatrix[1][1] * uViewport.y * 0.5 / max(1e-7, -base.z);
    float px = uRatio / pxPerUnit; // one screen pixel, as a length on the ground
    // How large the detection pixel is on screen decides the level of detail.
    float footPx = 2.0 * FOOT * pxPerUnit;
    float lod = smoothstep(6.0, 26.0, footPx);
    vLod = lod;
    vFoot = footPx;
    vHeat = heat;
    vLife = 0.0;

    vec3 local = aOffset;
    float size;
    float alpha;
    if (aKind < 0.5) {
      // The spot: a few pixels from afar, the true footprint up close.
      size = max((5.0 + 5.0 * heat) * px, FOOT * ${SPOT.toFixed(1)});
      alpha = appear;
    } else {
      // Smoke: a little, thin and slow, only from close by. It keeps rising
      // for a while after the heat has gone. The feeds carry no wind, so
      // it climbs straight up and spreads.
      vec3 up = normalize(world);
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up));
      vec3 north = cross(up, east);
      float cycle = uTime * (0.1 + 0.07 * hash(aSeed * 7.7)) + aSeed * 31.0;
      float life = fract(cycle);
      float id = floor(cycle) + aSeed * 113.0;
      vec2 spot = (vec2(hash(id * 1.7), hash(id * 2.9)) - 0.5) * FOOT;
      float climb = min(FOOT * (2.2 + 2.4 * hash(id * 8.9)), (90.0 + 110.0 * hash(id * 8.9)) * px);
      local += east * spot.x + north * spot.y + up * (life * climb) + (east * sin(id) + north * cos(id)) * life * life * min(FOOT * 0.8, 40.0 * px);
      size = min(FOOT * (0.6 + 1.7 * life), (26.0 + 60.0 * life) * px);
      float smoulder = 1.0 - smoothstep(1.5, 4.5, age);
      alpha = appear * smoulder * smoothstep(20.0, 60.0, footPx) * 0.22 * sin(3.14159 * pow(life, 0.7));
      vLife = life;
    }
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
  }`;

// Colours are written premultiplied: alpha says how much of the ground a
// spot hides, so it can glow and still keep its red on bright ground.
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vLod;
  varying float vFoot;
  varying float vHeat;
  varying float vLife;
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
    if (r > 1.0) discard;
    if (vKind > 0.5) {
      // Smoke: a soft pale puff broken up by noise.
      float billow = noise(vUv * 2.2 + vSeed * 30.0 + vec2(0.0, -uTime * 0.15));
      float a = exp(-r * r * 2.4) * (1.0 - r) * (0.5 + 0.7 * billow) * vAlpha;
      gl_FragColor = vec4(vec3(mix(0.45, 0.62, vLife)) * a, a);
      return;
    }
    float flicker = 1.0 + vHeat * 0.2 * sin(uTime * (5.0 + vSeed * 6.0) + vSeed * 40.0) * sin(uTime * 2.3 + vSeed * 11.0);
    // From afar: a small bright ember, hot ones yellow, cooled ones dull red.
    vec3 ember = mix(vec3(0.45, 0.07, 0.02), vec3(1.0, 0.62, 0.2), vHeat);
    float core = exp(-r * r * 18.0);
    float halo = exp(-r * r * 3.0) * 0.38 * (1.0 - r);
    vec3 far = ember * (core * 1.6 + halo) + vec3(0.6) * core * core;
    // Up close: a soft spot, deep red at its centre, through orange to
    // amber at the rim. A cooled spot keeps only its dull red middle.
    vec3 ramp = mix(vec3(0.92, 0.09, 0.03), vec3(1.0, 0.4, 0.06), smoothstep(0.0, 0.3, r));
    ramp = mix(ramp, vec3(1.0, 0.76, 0.34), smoothstep(0.26, 0.6, r));
    ramp = mix(vec3(0.55, 0.07, 0.03), ramp, vHeat);
    float body = exp(-r * r * mix(9.0, 5.0, vHeat));
    // A fine shimmer that keeps its size on screen: more detail, closer in.
    float grain = noise(vUv * vFoot / 14.0 + vSeed * 40.0 + vec2(0.0, -uTime * 0.5));
    float shimmer = 1.0 + 0.3 * (grain - 0.5) * smoothstep(40.0, 160.0, vFoot);
    // A pin of light on the exact position of the detection.
    float away = r * ${SPOT.toFixed(1)} * 0.5 * vFoot;
    float pin = exp(-away * away / 5.0) * smoothstep(30.0, 90.0, vFoot);
    float a = body * shimmer * (0.55 + 0.45 * vHeat);
    vec3 near = ramp * a * 1.15 + vec3(1.0, 0.92, 0.75) * pin * 0.85;
    float cover = a * 0.5 * (1.0 - r);
    gl_FragColor = vec4(mix(far, near, vLod) * flicker * vAlpha, cover * vLod * vAlpha);
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
    // Smoke is drawn first so the spots glow through it.
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
    const hot = { offset: [], born: [], seed: [], kind: [] };
    const smoke = { offset: [], born: [], seed: [], kind: [] };
    const v = new THREE.Vector3();
    const add = (to, born, seed, kind) => {
      to.offset.push(v.x, v.y, v.z);
      to.born.push(born);
      to.seed.push(seed);
      to.kind.push(kind);
    };
    // Two puffs of smoke for a detection, one where a fire has thousands.
    const puffs = items.length > 4000 ? 1 : 2;
    for (const it of items) {
      toVec(it.lat, it.lon, 1 + GROUND_CLEARANCE + (lift ? lift(it.lat, it.lon) : 0), v).sub(origin);
      // The same detection always glows the same way.
      const h = Math.sin(it.lat * 127.1 + it.lon * 311.7) * 43758.5453;
      const seed = h - Math.floor(h);
      add(hot, it.born, seed, 0);
      for (let k = 0; k < puffs; k++) add(smoke, it.born, (seed + 0.3 + k * 0.41) % 1, 1);
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
