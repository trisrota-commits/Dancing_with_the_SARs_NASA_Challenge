// The map engine's judgement of a file by what kind of PNG it says it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pngKind } from '../js/engine/tiles.js';

// The first 26 bytes of a PNG: signature, then the IHDR chunk, whose tenth
// data byte is the colour type.
const header = (colourType) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 1, 0, 8, colourType]);

test('a sound NISAR tile says it is a colour picture', () => {
  assert.equal(pngKind(header(2)), 2);
});

test('the damaged kinds are told apart from it', () => {
  // 0: the dark grey square over north-east China (tile 9/425/182 of 22 October 2026).
  for (const kind of [0, 3, 4, 6]) assert.equal(pngKind(header(kind)), kind);
});

test('what is no PNG, or is cut short, is no kind at all', () => {
  assert.equal(pngKind(new TextEncoder().encode('<html><body>Service unavailable</body></html>')), -1);
  assert.equal(pngKind(header(2).slice(0, 20)), -1);
  assert.equal(pngKind(new Uint8Array(0)), -1);
});
