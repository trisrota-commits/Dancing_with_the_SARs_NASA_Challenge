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

// ---- how much of a tile a day should fill, going by its picture of the world ----
import { expectedCover } from '../js/engine/tiles.js';

const CELLS = 128;
const world = (fill) => {
  const share = new Uint8Array(CELLS * CELLS);
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) share[j * CELLS + i] = fill(i, j);
  return share;
};

test('down to level 7 the cells under the tile are averaged', () => {
  // The western half of the world solid, the eastern half empty.
  const share = world((i) => (i < 64 ? 64 : 0));
  assert.equal(expectedCover(share, 0, 0, 0), 0.5);
  assert.equal(expectedCover(share, 1, 0, 0), 1);
  assert.equal(expectedCover(share, 1, 1, 0), 0);
  assert.equal(expectedCover(share, 7, 10, 10), 1);
  // A cell with a quarter of its pixels solid.
  assert.equal(expectedCover(world(() => 16), 7, 5, 5), 0.25);
});

test('further in, only a place that is solid all around is known to be full', () => {
  const share = world((i, j) => (i >= 20 && i <= 30 && j >= 20 && j <= 30 ? 64 : 0));
  // Inside the block: the cell and its eight neighbours are solid.
  assert.equal(expectedCover(share, 9, 25 * 4 + 1, 25 * 4 + 2), 1);
  // On its rim a neighbour is empty: nothing can be said.
  assert.equal(expectedCover(share, 9, 20 * 4, 25 * 4), null);
  // A cell that is nearly solid says nothing about a small part of it.
  assert.equal(expectedCover(world(() => 63), 11, 400, 400), null);
});

test('the map closes on itself in longitude, and ends at the poles', () => {
  const solid = world(() => 64);
  assert.equal(expectedCover(solid, 8, 0, 100), 1);
  assert.equal(expectedCover(solid, 8, 255, 100), 1);
  assert.equal(expectedCover(solid, 8, 100, 0), null);
});

test('without a picture of the world nothing is expected', () => {
  assert.equal(expectedCover(undefined, 7, 1, 1), null);
  assert.equal(expectedCover(world(() => 64), undefined, 1, 1), null);
});
