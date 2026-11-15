// Animal sightings drawn as small figurines standing on the globe, like
// painted toy pieces on a board, instead of plain dots. Each species has
// its own figure, drawn here in code (no image files), in its key colour.
// All figurines are one draw call: points that read their picture from a
// shared sheet.

import * as THREE from '../../vendor/three.module.min.js';
import { toVec } from './geo.js';
import { LIFT } from './marks.js';

const CELL = 128; // pixels per figure on the sheet
const COLS = 4;

// ---------- the figures ----------
// Each draws one silhouette in a 128 × 128 box, facing left, standing on
// (or swimming just above) a ground line at y = 108.

const FIGURES = {
  humpback(p) {
    // Long body, knobbly head, very long pectoral fin, raised flukes.
    p.moveTo(10, 74);
    p.bezierCurveTo(12, 60, 34, 52, 58, 54);
    p.bezierCurveTo(78, 56, 92, 62, 100, 66);
    p.bezierCurveTo(106, 58, 112, 48, 120, 42);
    p.bezierCurveTo(118, 54, 114, 62, 108, 70);
    p.bezierCurveTo(116, 74, 122, 82, 124, 92);
    p.bezierCurveTo(114, 86, 106, 80, 98, 76);
    p.bezierCurveTo(84, 82, 66, 86, 54, 86);
    p.bezierCurveTo(50, 92, 50, 102, 56, 110);
    p.bezierCurveTo(44, 106, 38, 96, 38, 86);
    p.bezierCurveTo(24, 86, 12, 82, 10, 74);
    p.closePath();
  },
  'blue-whale'(p) {
    // Very long and slender, small dorsal fin far back, small flukes.
    p.moveTo(6, 76);
    p.bezierCurveTo(8, 66, 28, 60, 56, 60);
    p.bezierCurveTo(74, 60, 84, 60, 92, 62);
    p.lineTo(96, 56);
    p.lineTo(99, 64);
    p.bezierCurveTo(104, 66, 108, 68, 110, 70);
    p.bezierCurveTo(114, 64, 118, 60, 124, 58);
    p.bezierCurveTo(122, 66, 118, 72, 114, 74);
    p.bezierCurveTo(118, 78, 122, 84, 124, 90);
    p.bezierCurveTo(118, 88, 112, 82, 108, 78);
    p.bezierCurveTo(90, 84, 60, 88, 40, 86);
    p.bezierCurveTo(38, 92, 40, 96, 44, 100);
    p.bezierCurveTo(36, 98, 32, 92, 32, 86);
    p.bezierCurveTo(18, 85, 8, 82, 6, 76);
    p.closePath();
  },
  'whale-shark'(p) {
    // Broad flat head, tall dorsal fin, upright crescent tail.
    p.moveTo(8, 72);
    p.bezierCurveTo(10, 62, 26, 58, 44, 58);
    p.lineTo(56, 36);
    p.bezierCurveTo(62, 42, 66, 52, 68, 58);
    p.bezierCurveTo(80, 60, 92, 64, 100, 68);
    p.bezierCurveTo(106, 54, 112, 42, 122, 32);
    p.bezierCurveTo(122, 50, 118, 64, 112, 74);
    p.bezierCurveTo(118, 82, 120, 90, 120, 98);
    p.bezierCurveTo(112, 92, 104, 84, 98, 80);
    p.bezierCurveTo(84, 86, 66, 88, 52, 88);
    p.bezierCurveTo(48, 96, 42, 102, 34, 106);
    p.bezierCurveTo(36, 98, 38, 92, 38, 88);
    p.bezierCurveTo(22, 88, 8, 82, 8, 72);
    p.closePath();
  },
  manta(p) {
    // Wide diamond wings seen from above at a tilt, horn-like head fins,
    // thin tail.
    p.moveTo(64, 46);
    p.bezierCurveTo(70, 46, 74, 50, 76, 54);
    p.bezierCurveTo(92, 52, 110, 56, 124, 70);
    p.bezierCurveTo(104, 76, 86, 84, 72, 94);
    p.lineTo(66, 116);
    p.lineTo(62, 94);
    p.bezierCurveTo(46, 84, 26, 76, 4, 70);
    p.bezierCurveTo(18, 56, 36, 52, 52, 54);
    p.bezierCurveTo(54, 50, 58, 46, 64, 46);
    p.closePath();
    // Cephalic fins.
    p.moveTo(54, 52);
    p.bezierCurveTo(50, 42, 52, 36, 56, 34);
    p.bezierCurveTo(58, 40, 60, 46, 60, 50);
    p.closePath();
    p.moveTo(74, 52);
    p.bezierCurveTo(78, 42, 76, 36, 72, 34);
    p.bezierCurveTo(70, 40, 68, 46, 68, 50);
    p.closePath();
  },
  stingray(p) {
    // Rounded disc and a long whip tail.
    p.moveTo(64, 44);
    p.bezierCurveTo(90, 44, 108, 60, 106, 76);
    p.bezierCurveTo(104, 88, 86, 94, 70, 92);
    p.bezierCurveTo(78, 100, 94, 108, 120, 110);
    p.bezierCurveTo(94, 114, 74, 104, 64, 94);
    p.bezierCurveTo(40, 96, 22, 88, 22, 74);
    p.bezierCurveTo(22, 58, 40, 44, 64, 44);
    p.closePath();
  },
  leatherback(p) {
    // Long ridged shell, big front flipper, small head.
    p.moveTo(14, 66);
    p.bezierCurveTo(14, 58, 22, 56, 30, 58);
    p.bezierCurveTo(44, 46, 80, 44, 104, 58);
    p.bezierCurveTo(114, 64, 120, 72, 122, 80);
    p.bezierCurveTo(110, 82, 98, 84, 86, 84);
    p.bezierCurveTo(90, 90, 96, 96, 104, 100);
    p.bezierCurveTo(92, 102, 82, 96, 74, 86);
    p.bezierCurveTo(60, 88, 48, 86, 40, 82);
    p.bezierCurveTo(36, 92, 24, 104, 8, 108);
    p.bezierCurveTo(18, 96, 26, 86, 30, 76);
    p.bezierCurveTo(22, 76, 14, 72, 14, 66);
    p.closePath();
  },
  'arctic-tern'(p) {
    // Wings raised in a V, forked tail streamers, black-capped head.
    p.moveTo(26, 70);
    p.bezierCurveTo(30, 64, 38, 62, 46, 64);
    p.bezierCurveTo(52, 46, 60, 28, 78, 14);
    p.bezierCurveTo(76, 32, 70, 50, 66, 64);
    p.bezierCurveTo(78, 52, 96, 40, 118, 34);
    p.bezierCurveTo(104, 48, 90, 62, 78, 72);
    p.bezierCurveTo(90, 76, 104, 82, 120, 96);
    p.bezierCurveTo(106, 92, 96, 88, 88, 86);
    p.bezierCurveTo(98, 94, 106, 102, 112, 110);
    p.bezierCurveTo(96, 102, 80, 90, 66, 82);
    p.bezierCurveTo(54, 84, 42, 80, 36, 76);
    p.lineTo(10, 80);
    p.lineTo(28, 72);
    p.closePath();
  },
  kob(p) {
    // Slim antelope on four legs, lyre-shaped horns.
    p.moveTo(30, 34);
    p.bezierCurveTo(26, 24, 30, 14, 36, 10);
    p.bezierCurveTo(34, 18, 34, 26, 36, 34);
    p.bezierCurveTo(40, 26, 46, 18, 50, 16);
    p.bezierCurveTo(46, 24, 42, 32, 40, 38);
    p.bezierCurveTo(44, 42, 46, 48, 48, 56);
    p.bezierCurveTo(64, 52, 88, 52, 102, 56);
    p.bezierCurveTo(110, 58, 114, 64, 112, 74);
    p.lineTo(110, 108);
    p.lineTo(104, 108);
    p.lineTo(102, 80);
    p.lineTo(94, 80);
    p.lineTo(92, 108);
    p.lineTo(86, 108);
    p.lineTo(84, 80);
    p.bezierCurveTo(74, 82, 64, 82, 58, 80);
    p.lineTo(56, 108);
    p.lineTo(50, 108);
    p.lineTo(48, 82);
    p.lineTo(44, 82);
    p.lineTo(42, 108);
    p.lineTo(36, 108);
    p.lineTo(38, 70);
    p.bezierCurveTo(34, 62, 32, 54, 30, 50);
    p.bezierCurveTo(24, 52, 16, 52, 14, 48);
    p.bezierCurveTo(16, 42, 24, 36, 30, 34);
    p.closePath();
  },
  wildebeest(p) {
    // Shoulders higher than the rump, a long face held low, horns curving
    // out and up, a beard under the throat.
    p.moveTo(16, 80);
    p.lineTo(10, 72);
    p.bezierCurveTo(12, 62, 16, 54, 22, 48);
    p.bezierCurveTo(14, 42, 16, 30, 26, 26);
    p.bezierCurveTo(24, 32, 26, 38, 31, 42);
    p.bezierCurveTo(38, 34, 48, 30, 58, 34);
    p.bezierCurveTo(76, 42, 92, 48, 104, 54);
    p.bezierCurveTo(112, 58, 114, 66, 112, 74);
    p.lineTo(110, 108);
    p.lineTo(103, 108);
    p.lineTo(101, 82);
    p.lineTo(94, 82);
    p.lineTo(92, 108);
    p.lineTo(85, 108);
    p.lineTo(84, 82);
    p.bezierCurveTo(74, 84, 64, 84, 58, 82);
    p.lineTo(57, 108);
    p.lineTo(50, 108);
    p.lineTo(48, 84);
    p.lineTo(44, 84);
    p.lineTo(43, 108);
    p.lineTo(36, 108);
    p.lineTo(36, 80);
    p.bezierCurveTo(32, 76, 30, 72, 29, 68);
    p.lineTo(27, 82);
    p.lineTo(23, 70);
    p.bezierCurveTo(21, 74, 18, 78, 16, 80);
    p.closePath();
  },
};

// Small details drawn over the silhouette in a darker or lighter tone.
const DETAILS = {
  humpback(c, dark, light) {
    c.strokeStyle = light;
    c.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(16 + i * 2, 76 + i * 2.2);
      c.lineTo(40 + i * 3, 80 + i * 1.2);
      c.stroke();
    }
    knobs(c, light, [[20, 64], [27, 61], [34, 59]]);
    eye(c, 26, 70);
  },
  'blue-whale'(c, dark, light) {
    mottle(c, light, [[30, 70], [52, 68], [70, 72], [84, 68], [62, 76]]);
    eye(c, 20, 72);
  },
  'whale-shark'(c, dark, light) {
    mottle(c, '#ffffff', [[24, 66], [34, 64], [46, 66], [58, 64], [70, 66], [82, 68], [30, 74], [44, 76], [58, 76], [72, 76], [88, 74], [50, 70], [64, 70], [78, 72]]);
    c.strokeStyle = dark;
    c.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(30 + i * 4, 64);
      c.lineTo(30 + i * 4, 80);
      c.stroke();
    }
    eye(c, 16, 70);
  },
  manta(c, dark, light) {
    c.fillStyle = light;
    c.beginPath();
    c.ellipse(64, 66, 9, 12, 0, 0, Math.PI * 2);
    c.fill();
    eye(c, 57, 54);
    eye(c, 71, 54);
  },
  stingray(c, dark, light) {
    mottle(c, dark, [[50, 62], [70, 58], [80, 70], [56, 76], [42, 70], [66, 82]]);
    eye(c, 56, 56);
    eye(c, 72, 56);
  },
  leatherback(c, dark, light) {
    c.strokeStyle = light;
    c.lineWidth = 2;
    for (const y of [58, 66, 74]) {
      c.beginPath();
      c.moveTo(36, y + 2);
      c.bezierCurveTo(60, y - 6, 86, y - 4, 112, y + 10);
      c.stroke();
    }
    eye(c, 22, 62);
  },
  'arctic-tern'(c, dark, light) {
    c.fillStyle = '#16181d';
    c.beginPath();
    c.moveTo(28, 68);
    c.bezierCurveTo(32, 62, 42, 61, 48, 66);
    c.lineTo(36, 70);
    c.closePath();
    c.fill();
    c.fillStyle = '#ff5a3c';
    c.beginPath();
    c.moveTo(28, 71);
    c.lineTo(10, 80);
    c.lineTo(28, 74);
    c.closePath();
    c.fill();
  },
  kob(c, dark, light) {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(32, 42, 3, 5, -0.4, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = light;
    c.beginPath();
    c.ellipse(76, 72, 22, 6, 0, 0, Math.PI * 2);
    c.fill();
    eye(c, 26, 42);
  },
  wildebeest(c, dark, light) {
    c.strokeStyle = dark;
    c.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.moveTo(42 + i * 7, 42 + i * 2.4);
      c.lineTo(40 + i * 7, 62 + i * 1.6);
      c.stroke();
    }
    c.fillStyle = dark;
    c.beginPath();
    c.moveTo(30, 42);
    c.bezierCurveTo(40, 33, 50, 31, 60, 35);
    c.lineTo(58, 40);
    c.bezierCurveTo(48, 37, 40, 40, 33, 46);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(10, 72);
    c.lineTo(16, 80);
    c.lineTo(19, 70);
    c.closePath();
    c.fill();
    eye(c, 23, 56);
  },
};

function eye(c, x, y) {
  c.fillStyle = '#0b0d12';
  c.beginPath();
  c.arc(x, y, 2.4, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.beginPath();
  c.arc(x - 0.7, y - 0.8, 0.8, 0, Math.PI * 2);
  c.fill();
}

function mottle(c, color, spots) {
  c.fillStyle = color;
  c.globalAlpha = 0.55;
  for (const [x, y] of spots) {
    c.beginPath();
    c.arc(x, y, 1.9, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

function knobs(c, color, at) {
  c.fillStyle = color;
  for (const [x, y] of at) {
    c.beginPath();
    c.arc(x, y, 1.5, 0, Math.PI * 2);
    c.fill();
  }
}

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return `rgb(${ch.join(',')})`;
};

// Draws one figure into a 2D context at (x, y), CELL pixels square.
function drawFigure(c, id, color, x = 0, y = 0) {
  const shape = FIGURES[id];
  if (!shape) return;
  c.save();
  c.translate(x, y);
  // Shadow where the piece stands.
  const sh = c.createRadialGradient(64, 112, 2, 64, 112, 46);
  sh.addColorStop(0, 'rgba(0,0,0,0.45)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sh;
  c.beginPath();
  c.ellipse(64, 112, 46, 9, 0, 0, Math.PI * 2);
  c.fill();
  const path = new Path2D();
  shape(path);
  // A painted toy: light from above, a dark rim, a white outline so it
  // reads on any ground.
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.lineWidth = 7;
  c.stroke(path);
  const body = c.createLinearGradient(0, 14, 0, 110);
  body.addColorStop(0, shade(color, 0.35));
  body.addColorStop(0.55, color);
  body.addColorStop(1, shade(color, -0.45));
  c.fillStyle = body;
  c.fill(path);
  c.save();
  c.clip(path);
  DETAILS[id]?.(c, shade(color, -0.5), shade(color, 0.6));
  // A soft highlight along the top.
  c.globalCompositeOperation = 'screen';
  const gloss = c.createLinearGradient(0, 20, 0, 70);
  gloss.addColorStop(0, 'rgba(255,255,255,0.35)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gloss;
  c.fillRect(0, 0, CELL, 72);
  c.restore();
  c.strokeStyle = shade(color, -0.65);
  c.lineWidth = 2.2;
  c.stroke(path);
  c.restore();
}

// A small picture of one figure, for keys and lists (a data URL).
const iconCache = new Map();
export function figurineIcon(id, color, size = 40) {
  const key = `${id}|${color}|${size}`;
  if (!iconCache.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * 2;
    const c = canvas.getContext('2d');
    c.scale((size * 2) / CELL, (size * 2) / CELL);
    drawFigure(c, id, color);
    iconCache.set(key, canvas.toDataURL());
  }
  return iconCache.get(key);
}

// ---------- on the globe ----------

const VERTEX = /* glsl */ `
  attribute float aIcon;
  attribute float aSize;
  attribute float aBorn;
  uniform vec3 uCam;
  uniform float uScale;
  uniform float uRatio;
  uniform float uTime;
  uniform vec2 uViewport;
  varying float vIcon;
  void main() {
    vIcon = aIcon;
    // A figure that has just arrived drops onto the board and bounces once.
    float age = uTime - aBorn;
    float drop = 0.0;
    if (age < 1.2) {
      float t = clamp(age / 1.2, 0.0, 1.0);
      drop = abs(sin(t * 6.2832)) * (1.0 - t) * 18.0;
    }
    float px = aSize * uScale * uRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // The picture's foot, not its middle, stands on the spot.
    gl_Position.y += (px * 0.42 + drop * uRatio) / uViewport.y * 2.0 * gl_Position.w;
    if (dot(position, uCam) < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = px;
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uSheet;
  varying float vIcon;
  void main() {
    float col = mod(vIcon, ${COLS.toFixed(1)});
    float row = floor(vIcon / ${COLS.toFixed(1)});
    vec2 uv = (vec2(col, row) + gl_PointCoord) / vec2(${COLS.toFixed(1)}, uRows);
    vec4 c = texture2D(uSheet, vec2(uv.x, 1.0 - uv.y));
    if (c.a < 0.02) discard;
    gl_FragColor = c;
  }`;

export class Figurines {
  // species: [{ id, color }] in the order their pictures go on the sheet.
  constructor(scene, shared, species) {
    this.index = new Map(species.map((sp, i) => [sp.id, i]));
    const rows = Math.ceil(species.length / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = CELL * COLS;
    canvas.height = CELL * rows;
    const c = canvas.getContext('2d');
    species.forEach((sp, i) => drawFigure(c, sp.id, sp.color, (i % COLS) * CELL, Math.floor(i / COLS) * CELL));
    const sheet = new THREE.CanvasTexture(canvas);
    sheet.flipY = true;
    sheet.colorSpace = THREE.SRGBColorSpace;
    sheet.generateMipmaps = true;
    sheet.minFilter = THREE.LinearMipmapLinearFilter;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uSheet: { value: sheet } },
      vertexShader: VERTEX,
      fragmentShader: `uniform float uRows;\n${FRAGMENT}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.material.uniforms.uRows = { value: rows };
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 28;
    scene.add(this.points);
    this.items = [];
  }

  // items: [{ species, lat, lon, size, born }]. Figures further north are
  // drawn first, so those nearer the viewer's bottom edge stand in front.
  set(items, lift) {
    this.items = [...items].sort((a, b) => b.lat - a.lat);
    this.lift = lift;
    const n = this.items.length;
    const position = new Float32Array(n * 3);
    const icon = new Float32Array(n);
    const size = new Float32Array(n);
    const born = new Float32Array(n);
    const v = new THREE.Vector3();
    this.items.forEach((it, i) => {
      toVec(it.lat, it.lon, 1 + LIFT + (lift ? lift(it.lat, it.lon) : 0), v);
      position.set([v.x, v.y, v.z], i * 3);
      icon[i] = this.index.get(it.species) ?? 0;
      size[i] = it.size;
      born[i] = it.born ?? -1e6;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aIcon', new THREE.BufferAttribute(icon, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    this.points.geometry.dispose();
    this.points.geometry = g;
  }

  relift() {
    const position = this.points.geometry.attributes.position;
    if (!position || !this.lift) return;
    const v = new THREE.Vector3();
    this.items.forEach((it, i) => {
      toVec(it.lat, it.lon, 1 + LIFT + this.lift(it.lat, it.lon), v);
      position.setXYZ(i, v.x, v.y, v.z);
    });
    position.needsUpdate = true;
  }
}

// For checking the drawings on their own (tests and previews).
export const _drawFigure = drawFigure;
