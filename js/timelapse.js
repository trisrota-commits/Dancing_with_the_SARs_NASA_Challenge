// NISAR time-lapse: loads every pass of one repeat track over a place and
// prepares them for playback, single-polarisation views and a point history.
//
// In NASA's preview images red and blue both carry the HH echo (sent and
// received horizontally) and green carries HV (sent horizontally, received
// vertically), so the two channels can be separated again here. Values are
// the 0–255 brightness of the preview, not calibrated radar units.

import { imageBounds } from './nisar.js';

const MAX_SIDE = 900;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Preview image failed to load'));
    img.src = url;
  });
}

// At most `max` items, evenly spread, always keeping the first and last.
export function spread(items, max) {
  if (items.length <= max) return items;
  const out = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

async function loadFrame(scene) {
  const [img, bounds] = await Promise.all([loadImage(scene.image), imageBounds(scene)]);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  // Black padding around the swath becomes see-through.
  for (let i = 0; i < px.length; i += 4) if (px[i] < 4 && px[i + 1] < 4 && px[i + 2] < 4) px[i + 3] = 0;
  ctx.putImageData(data, 0, 0);
  return { scene, bounds, time: scene.time, views: { colour: canvas }, pixels: data };
}

// Loads frames a few at a time; onProgress(done, total) after each.
export async function loadFrames(scenes, onProgress) {
  const frames = [];
  let done = 0;
  for (let i = 0; i < scenes.length; i += 3) {
    const batch = await Promise.all(
      scenes.slice(i, i + 3).map((scene) =>
        loadFrame(scene)
          .catch(() => null)
          .finally(() => onProgress?.(++done, scenes.length)),
      ),
    );
    frames.push(...batch.filter(Boolean));
  }
  return frames.sort((a, b) => a.time - b.time);
}

// The frame as a picture in the requested view: 'colour' (as published),
// 'hh' or 'hv' (that channel alone, as greys).
export function view(frame, mode) {
  if (!frame.views[mode]) {
    const { width, height, data } = frame.pixels;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(width, height);
    const channel = mode === 'hv' ? 1 : 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i + channel];
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = data[i + 3];
    }
    ctx.putImageData(out, 0, 0);
    frame.views[mode] = canvas;
  }
  return frame.views[mode];
}

// HH and HV brightness around a point in every frame (null where that pass
// did not cover it). Averaged over a 5×5 pixel window to steady the speckle.
export function history(frames, lat, lon) {
  return frames.map((frame) => {
    const b = frame.bounds;
    const { width, height, data } = frame.pixels;
    const cx = Math.round(((lon - b.west) / (b.east - b.west)) * width);
    const cy = Math.round(((b.north - lat) / (b.north - b.south)) * height);
    let hh = 0;
    let hv = 0;
    let n = 0;
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        if (data[i + 3] === 0) continue;
        hh += data[i];
        hv += data[i + 1];
        n++;
      }
    }
    return { time: frame.time, hh: n ? hh / n : null, hv: n ? hv / n : null };
  });
}
