// The visual rules of docs/VISUAL_RULES.md, as far as a computer can check
// them. A failure here means a colour was typed in somewhere, or two things
// that must stay apart have drifted together.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALETTE, CATEGORIES, FAMILIES } from '../js/config.js';
import { PLACE_KINDS } from '../js/places.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Colour difference as people see it (OKLab, times 100).
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const apart = (a, b) => {
  const [x, y] = [oklab(a), oklab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

test('every kind of event and place takes its colour from a family', () => {
  for (const [key, c] of Object.entries({ ...CATEGORIES, ...PLACE_KINDS })) {
    assert.ok(Object.hasOwn(PALETTE.family, c.family), `${key} has no family`);
    assert.equal(c.color, PALETTE.family[c.family], `${key} does not use its family's colour`);
  }
  for (const family of Object.keys(PALETTE.family)) assert.ok(FAMILIES[family], `family ${family} has no words for the key`);
});

test('there are few enough families to tell apart (NASA: "about 12, practically speaking, probably fewer")', () => {
  const hues = Object.entries(PALETTE.family);
  assert.ok(hues.length <= 8, `${hues.length} families`);
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      const d = apart(hues[i][1], hues[j][1]);
      assert.ok(d >= 15, `${hues[i][0]} and ${hues[j][0]} are only ${d.toFixed(1)} apart`);
    }
  }
});

test('the pairs that are read against each other are far apart', () => {
  assert.ok(apart(PALETTE.weaker, PALETTE.stronger) >= 30, 'weaker and stronger');
  assert.ok(apart(PALETTE.co, PALETTE.cross) >= 30, 'the two radar channels');
  // NISAR's teal must not pass for a kind of event.
  for (const [family, hex] of Object.entries(PALETTE.family)) assert.ok(apart(PALETTE.nisar, hex) >= 15, `teal and ${family}`);
});

test('the change colours are the same in the app and in the measuring script', () => {
  const py = read('tools/measure.py');
  const triple = (name) => py.match(new RegExp(`${name} = np\\.array\\(\\[(\\d+), (\\d+), (\\d+)\\]\\)`)).slice(1).map(Number);
  const bytes = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.deepEqual(triple('WEAKER'), bytes(PALETTE.weaker));
  assert.deepEqual(triple('STRONGER'), bytes(PALETTE.stronger));
});

test('meaningful colours are not typed in where they are used', () => {
  // Outside the palette, these colours may only appear in comments.
  const owned = [PALETTE.nisar, PALETTE.co, PALETTE.cross, PALETTE.weaker, PALETTE.stronger, ...Object.values(PALETTE.family)];
  for (const file of ['js/main.js', 'js/globe.js', 'js/chart.js', 'js/measured.js', 'js/change.js', 'js/narrative.js', 'js/places.js', 'js/replay/replay.js']) {
    const code = read(file)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .toLowerCase();
    for (const hex of owned) assert.ok(!code.includes(hex.toLowerCase()), `${file} spells out ${hex}; use PALETTE`);
  }
});

test('every event type that draws on the globe says what its marks are', () => {
  const src = read('js/replay/replay.js');
  for (const name of ['quake', 'storm', 'fire', 'flood', 'generic']) {
    const start = src.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, name);
    const end = src.indexOf('\nasync function ', start + 10);
    const body = src.slice(start, end < 0 ? src.length : end);
    assert.ok(/\bkey: \[|\.key = \[/.test(body), `${name} draws on the globe without a key`);
  }
});

test('context layers that cover the whole map are marked, so only one shows at a time', async () => {
  const { OVERLAYS } = await import('../js/config.js');
  // Measured on NASA's tiles: these draw 77 to 100 % of a tile over land.
  const fills = Object.keys(OVERLAYS).filter((k) => OVERLAYS[k].fills).sort();
  assert.deepEqual(fills, ['built', 'crops', 'landcover', 'lights', 'population', 'soil']);
  // A radar layer is strips on an empty globe and never fills.
  for (const k of fills) assert.ok(!OVERLAYS[k].sparse, k);
});
