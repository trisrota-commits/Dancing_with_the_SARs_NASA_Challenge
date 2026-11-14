// Minimal reader for Mapbox Vector Tiles: returns the point features of every
// layer as { x, y } fractions (0..1) of the tile. Enough for NASA's daily
// fire-detection tiles, which are plain points.

function reader(bytes) {
  let pos = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[pos++];
      value += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return value;
      shift += 7;
    }
  };
  // Walks the fields of one message, handing length-delimited ones to `on`.
  const fields = (end, on) => {
    while (pos < end) {
      const tag = varint();
      const field = tag >> 3;
      const wire = tag & 7;
      if (wire === 0) on(field, varint(), null);
      else if (wire === 2) {
        const len = varint();
        const start = pos;
        on(field, null, [start, start + len]);
        pos = start + len;
      } else if (wire === 5) pos += 4;
      else if (wire === 1) pos += 8;
      else return;
    }
  };
  return { varint, fields, seek: (p) => (pos = p), at: () => pos };
}

export function tilePoints(buffer) {
  const bytes = new Uint8Array(buffer);
  const r = reader(bytes);
  const points = [];
  r.fields(bytes.length, (field, _v, span) => {
    if (field !== 3 || !span) return; // Tile.layers
    let extent = 4096;
    const features = [];
    r.seek(span[0]);
    r.fields(span[1], (f, v, s) => {
      if (f === 5) extent = v;
      if (f === 2 && s) features.push(s);
    });
    for (const feature of features) {
      let type = 0;
      let geometry = null;
      r.seek(feature[0]);
      r.fields(feature[1], (f, v, s) => {
        if (f === 3) type = v;
        if (f === 4 && s) geometry = s;
      });
      if (type !== 1 || !geometry) continue; // points only
      r.seek(geometry[0]);
      let x = 0;
      let y = 0;
      while (r.at() < geometry[1]) {
        const command = r.varint();
        if ((command & 7) !== 1) break; // MoveTo
        for (let n = command >> 3; n > 0; n--) {
          const dx = r.varint();
          const dy = r.varint();
          x += (dx >> 1) ^ -(dx & 1);
          y += (dy >> 1) ^ -(dy & 1);
          points.push({ x: x / extent, y: y / extent });
        }
      }
    }
    r.seek(span[1]);
  });
  return points;
}
