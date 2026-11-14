// NISAR time-lapse: loads every pass of one repeat track over a place and
// prepares them for playback, single-polarisation views and a point history.
//
// In a dual-polarisation preview red and blue both carry the co-polarised
// echo (HH: sent and received horizontally) and green the cross-polarised
// one (HV: received vertically), so the two can be separated again here. A
// single-polarisation preview is one channel in grey. Each scene's mode
// comes from its name (see polMode in nisar.js). Values are the 0–255
// brightness of the preview, not calibrated radar units.

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
// 'co' or 'cross' (that channel alone, as greys).
export function view(frame, mode) {
  if (!frame.views[mode]) {
    const { width, height, data } = frame.pixels;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(width, height);
    const channel = mode === 'cross' ? 1 : 0;
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

// Co- and cross-polarised brightness around a point in every frame (null
// where that pass did not cover it, and no cross value for single-mode
// passes). Averaged over a 5×5 pixel window to steady the speckle.
export function history(frames, lat, lon) {
  return frames.map((frame) => {
    const b = frame.bounds;
    const { width, height, data } = frame.pixels;
    const cx = Math.round(((lon - b.west) / (b.east - b.west)) * width);
    const cy = Math.round(((b.north - lat) / (b.north - b.south)) * height);
    let co = 0;
    let cross = 0;
    let n = 0;
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        if (data[i + 3] === 0) continue;
        co += data[i];
        cross += data[i + 1];
        n++;
      }
    }
    return { time: frame.time, co: n ? co / n : null, cross: n && frame.scene.pol?.cross ? cross / n : null };
  });
}

// Plain statements about a point history, worked out from the numbers by
// fixed rules: the range of each channel with its dates, the latest value,
// and where the two channels sit furthest apart. Nothing here is typed in.
export function describeSeries(series, pol) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const lines = [];
  const stats = (key, name) => {
    const seen = series.filter((p) => p[key] != null);
    if (seen.length < 2) return null;
    const high = seen.reduce((a, b) => (b[key] > a[key] ? b : a));
    const low = seen.reduce((a, b) => (b[key] < a[key] ? b : a));
    const last = seen[seen.length - 1];
    lines.push(`${name}: highest ${Math.round(high[key])} on ${day(high.time)}, lowest ${Math.round(low[key])} on ${day(low.time)}, latest ${Math.round(last[key])} on ${day(last.time)}.`);
    return { seen, high, low };
  };
  const co = stats('co', pol.co);
  const cross = pol.cross ? stats('cross', pol.cross) : null;
  if (co) {
    const swing = Math.round(co.high.co - co.low.co);
    lines.push(`${pol.co} swings by ${swing} of the 255-step preview scale across ${co.seen.length} passes that cover this point.`);
  }
  if (co && cross) {
    const both = series.filter((p) => p.co != null && p.cross != null);
    const wide = both.reduce((a, b) => (Math.abs(b.co - b.cross) > Math.abs(a.co - a.cross) ? b : a));
    const narrow = both.reduce((a, b) => (Math.abs(b.co - b.cross) < Math.abs(a.co - a.cross) ? b : a));
    lines.push(`${pol.co} and ${pol.cross} are furthest apart on ${day(wide.time)} (${Math.round(Math.abs(wide.co - wide.cross))} steps) and closest on ${day(narrow.time)} (${Math.round(Math.abs(narrow.co - narrow.cross))}).`);
  }
  return lines;
}
