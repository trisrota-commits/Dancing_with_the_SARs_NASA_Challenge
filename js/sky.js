// The sky behind the globe, as it really is right now: the bright stars of
// the Yale catalogue at their true positions, turning with the Earth's
// rotation, and the Sun where it actually is. Shooting stars are the one
// decorative touch, and they can be switched off.

import * as THREE from '../vendor/three.module.min.js';
import { gstime } from '../vendor/satellite.es.js';
import { toVec } from './engine/geo.js';
import { STARS } from './stars-data.js';

const SKY_RADIUS = 5;

// Approximate colour of a star from its temperature (K).
function starColor(k) {
  const t = Math.max(2500, Math.min(12000, k));
  if (t < 4000) return [1.0, 0.72, 0.5];
  if (t < 5200) return [1.0, 0.86, 0.7];
  if (t < 6000) return [1.0, 0.95, 0.88];
  if (t < 7500) return [0.97, 0.97, 1.0];
  return [0.78, 0.86, 1.0];
}

function realStars() {
  const n = STARS.length;
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const v = new THREE.Vector3();
  STARS.forEach(([ra, dec, mag, k], i) => {
    // Celestial coordinates; the group is turned by sidereal time each frame.
    toVec(dec, ra, SKY_RADIUS, v);
    position.set([v.x, v.y, v.z], i * 3);
    const bright = Math.max(0.12, Math.min(1, (6.2 - mag) / 6.5));
    color.set(starColor(k).map((c) => c * (0.35 + 0.65 * bright)), i * 3);
    size[i] = 0.7 + bright * 2.8;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const points = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      uniforms: { uRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uRatio;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uRatio;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          if (r > 0.5) discard;
          gl_FragColor = vec4(vColor, 1.0 - smoothstep(0.25, 0.5, r));
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;
  return points;
}

// A soft glow for the Sun, drawn as one large point.
function sunGlow() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  const points = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      uniforms: { uRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uRatio;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 90.0 * uRatio;
        }`,
      fragmentShader: /* glsl */ `
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.08, 0.13, r);
          float halo = pow(max(0.0, 1.0 - r), 3.0) * 0.55;
          gl_FragColor = vec4(vec3(1.0, 0.96, 0.85), max(core, halo));
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  return points;
}

// Decorative shooting stars: a short streak every few seconds.
class ShootingStars {
  constructor(scene) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(this.geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
    this.enabled = true;
    this.next = 4 + Math.random() * 6;
    this.active = null;
  }

  // Returns true while a streak is on screen, so the globe keeps drawing.
  update(seconds, cameraQuaternion) {
    if (!this.enabled) {
      this.line.visible = false;
      this.active = null;
      return false;
    }
    if (!this.active && seconds > this.next) {
      // Start somewhere in front of the viewer, offset from the globe.
      const dir = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.35 + Math.random() * 0.5, -1).normalize().applyQuaternion(cameraQuaternion);
      const drift = new THREE.Vector3(Math.random() - 0.5, -0.6 - Math.random() * 0.4, 0).normalize().applyQuaternion(cameraQuaternion);
      this.active = { start: seconds, dir, drift, length: 0.5 + Math.random() * 0.5, life: 0.7 + Math.random() * 0.5 };
    }
    if (!this.active) return false;
    const a = this.active;
    const t = (seconds - a.start) / a.life;
    if (t >= 1) {
      this.active = null;
      this.line.visible = false;
      this.next = seconds + 6 + Math.random() * 12;
      return false;
    }
    const head = a.dir.clone().multiplyScalar(SKY_RADIUS).addScaledVector(a.drift, t * a.length * 3);
    const tail = head.clone().addScaledVector(a.drift, -a.length);
    const fade = Math.sin(Math.PI * t);
    this.geometry.attributes.position.array.set([head.x, head.y, head.z, tail.x, tail.y, tail.z]);
    this.geometry.attributes.color.array.set([fade, fade, fade * 0.95, 0, 0, 0]);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.line.visible = true;
    return true;
  }
}

export class Sky {
  constructor(scene) {
    this.stars = realStars();
    this.sun = sunGlow();
    this.group = new THREE.Group();
    this.group.add(this.stars);
    scene.add(this.group, this.sun);
    this.shooting = new ShootingStars(scene);
  }

  setRatio(ratio) {
    this.stars.material.uniforms.uRatio.value = ratio;
    this.sun.material.uniforms.uRatio.value = ratio;
  }

  // Turns the stars by Greenwich sidereal time and places the Sun.
  // Returns true while something animates on its own.
  update(date, seconds, cameraQuaternion, sun) {
    this.group.rotation.y = -gstime(date);
    this.sun.position.copy(sun).multiplyScalar(SKY_RADIUS);
    return this.shooting.update(seconds, cameraQuaternion);
  }
}
