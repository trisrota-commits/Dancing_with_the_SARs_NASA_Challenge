// Runs in a worker: compresses finished map tiles (see `keep` in tiles.js)
// off the page's own thread. In some browsers a canvas can only compress
// itself on the thread that owns it, which held the page up for a moment
// for every tile that left the screen. Here the tile arrives as a bitmap,
// is drawn once and comes back as a PNG, without loss.

let canvas = null;

self.onmessage = async (event) => {
  const { id, bitmap } = event.data;
  try {
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    self.postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/png' }) });
  } catch (err) {
    self.postMessage({ id, blob: null });
  }
};
