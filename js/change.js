// Turns two NISAR passes of the same place into a plain-language picture of
// what changed between them.
//
// It works on NASA's preview images, which are 8-bit and reduced in
// resolution, so it is a guide to where to look and not a measurement. In
// those previews red and blue both carry the HH (same-polarisation) echo and
// green carries HV (cross-polarisation); this compares their combined
// brightness, pixel by pixel, after a light blur to calm radar speckle. The
// two previews can sit a pixel or two apart, which would light up every
// coastline and ridge, so a difference only counts if it survives nudging
// one image by up to two pixels in any direction.

export const CHANGE_THRESHOLD = 28; // out of 255, about 11 % of full brightness
const MAX_SIDE = 1100;
const WEAKER = [64, 170, 255];
const STRONGER = [255, 170, 60];

// Pixels of `picture` (a canvas with known lat/lon bounds) resampled onto a
// w×h grid covering `box`.
function resample(picture, bounds, box, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const sx = ((box.west - bounds.west) / (bounds.east - bounds.west)) * picture.width;
  const sy = ((bounds.north - box.north) / (bounds.north - bounds.south)) * picture.height;
  const sw = ((box.east - box.west) / (bounds.east - bounds.west)) * picture.width;
  const sh = ((box.north - box.south) / (bounds.north - bounds.south)) * picture.height;
  ctx.drawImage(picture, sx, sy, sw, sh, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

// Mean of the values within `r` pixels, done as two sliding-window passes.
function blur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (from, to, len, step, lines, lineStep) => {
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += from[base + Math.max(0, Math.min(len - 1, i)) * step];
      for (let i = 0; i < len; i++) {
        to[base + i * step] = sum / (2 * r + 1);
        sum += from[base + Math.min(len - 1, i + r + 1) * step] - from[base + Math.max(0, i - r) * step];
      }
    }
  };
  pass(src, tmp, w, 1, h, w);
  pass(tmp, out, h, w, w, 1);
  return out;
}

export function changeMap(before, beforeBounds, after, afterBounds) {
  const box = {
    west: Math.max(beforeBounds.west, afterBounds.west),
    east: Math.min(beforeBounds.east, afterBounds.east),
    south: Math.max(beforeBounds.south, afterBounds.south),
    north: Math.min(beforeBounds.north, afterBounds.north),
  };
  if (box.east <= box.west || box.north <= box.south) return null;

  const scale = Math.min(1, MAX_SIDE / Math.max(after.width, after.height));
  const w = Math.max(8, Math.round(((box.east - box.west) / (afterBounds.east - afterBounds.west)) * after.width * scale));
  const h = Math.max(8, Math.round(((box.north - box.south) / (afterBounds.north - afterBounds.south)) * after.height * scale));
  const a = resample(before, beforeBounds, box, w, h);
  const b = resample(after, afterBounds, box, w, h);

  const n = w * h;
  const beforeLevel = new Float32Array(n);
  const afterLevel = new Float32Array(n);
  const valid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if (a[k + 3] < 200 || b[k + 3] < 200) continue;
    valid[i] = 1;
    // (HH + HV) / 2 in each pass.
    beforeLevel[i] = (a[k] + a[k + 1]) / 2;
    afterLevel[i] = (b[k] + b[k + 1]) / 2;
  }
  const was = blur(beforeLevel, w, h, 2);
  const is = blur(afterLevel, w, h, 2);
  const cover = blur(valid, w, h, 2);
  // Smallest difference over every nudge of up to two pixels.
  const smooth = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = Infinity;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.max(0, Math.min(h - 1, y + dy));
        for (let dx = -2; dx <= 2; dx++) {
          const d = is[i] - was[yy * w + Math.max(0, Math.min(w - 1, x + dx))];
          if (Math.abs(d) < Math.abs(best)) best = d;
        }
      }
      smooth[i] = best;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  let seen = 0;
  let weaker = 0;
  let stronger = 0;
  for (let i = 0; i < n; i++) {
    // Skip the ragged edge of the swath, where the blur mixes in nothing.
    if (!valid[i] || cover[i] < 0.98) continue;
    seen++;
    const d = smooth[i];
    if (Math.abs(d) < CHANGE_THRESHOLD) continue;
    if (d < 0) weaker++;
    else stronger++;
    const c = d < 0 ? WEAKER : STRONGER;
    const k = i * 4;
    out.data[k] = c[0];
    out.data[k + 1] = c[1];
    out.data[k + 2] = c[2];
    out.data[k + 3] = Math.round(255 * Math.min(0.92, 0.45 + (Math.abs(d) - CHANGE_THRESHOLD) / 90));
  }
  ctx.putImageData(out, 0, 0);

  const midLat = ((box.north + box.south) / 2) * (Math.PI / 180);
  const pixelKm2 = (((box.east - box.west) * 111.32 * Math.cos(midLat)) / w) * (((box.north - box.south) * 110.57) / h);
  return {
    canvas,
    bounds: box,
    comparedKm2: seen * pixelKm2,
    weakerKm2: weaker * pixelKm2,
    strongerKm2: stronger * pixelKm2,
    weakerShare: seen ? weaker / seen : 0,
    strongerShare: seen ? stronger / seen : 0,
  };
}
