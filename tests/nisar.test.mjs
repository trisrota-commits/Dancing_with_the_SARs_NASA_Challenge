import test from 'node:test';
import assert from 'node:assert/strict';
import * as nisar from '../js/nisar.js';

const scene = (time, extra = {}) => ({
  time, product: 'GCOV', track: '001', frame: '002', direction: 'Ascending',
  stack: '001-A-002', image: 'https://example.org/preview.png', ...extra,
});

test('comparison feasibility explains missing earlier coverage', () => {
  assert.equal(typeof nisar.comparisonStatus, 'function');
  const result = nisar.comparisonStatus([scene(20)], 15);
  assert.equal(result.pair, null);
  assert.match(result.reason, /No earlier pass/);
});

test('unavailable reasons distinguish later coverage, mismatched tracks and missing previews', () => {
  assert.match(nisar.comparisonStatus([], 15).reason, /No backscatter/);
  assert.match(nisar.comparisonStatus([scene(10)], 15).reason, /No pass at or after/);
  assert.match(nisar.comparisonStatus([scene(10), scene(20, { track: '003', stack: '003-A-002' })], 15).reason, /same track, direction and frame/);
  assert.match(nisar.comparisonStatus([scene(10, { image: null }), scene(20)], 15).reason, /preview/);
});

test('matching requires known track, direction and frame, not a shared missing stack', () => {
  for (const extra of [
    { track: undefined, stack: undefined },
    { frame: undefined },
    { direction: undefined },
  ]) {
    assert.equal(nisar.bestPair([scene(10, extra), scene(20, extra)], 15), null);
  }
  assert.equal(nisar.bestPair([scene(10), scene(20, { direction: 'Descending' })], 15), null);
});

test('available comparison uses the nearest matching passes bracketing the event', () => {
  const before = scene(12);
  const after = scene(15);
  const result = nisar.comparisonStatus([scene(1), scene(30), after, before], 15);
  assert.deepEqual(result, { pair: { before, after, span: 3 }, reason: '' });
  assert.equal(nisar.bestPair([scene(15), scene(15)], 15), null);
});
