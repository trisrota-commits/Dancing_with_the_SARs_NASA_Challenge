import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as config from '../js/config.js';
import { comparisonStatus } from '../js/nisar.js';

// Exercise the actual panel renderer without starting the globe or live feeds.
const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function radarHtml(');
const end = source.indexOf('async function selectIncident(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({
  ...config, comparisonStatus, DAY: 86400_000,
  day: String, esc: (s) => String(s).replaceAll('<', '&lt;'),
  nextPassHtml: () => '', sceneCard: () => '', SENTINEL_OFFER: '',
});
vm.runInContext(source.slice(start, end), context);
const scene = (time) => ({ time, product: 'GCOV', track: '001', frame: '002', direction: 'Ascending', image: 'https://example.org/preview.png' });
const render = (category, backscatter = [scene(10), scene(20)]) =>
  context.radarHtml({ category, time: 15 }, { backscatter, interferograms: [] });

test('wildfire comparison explains possible mechanisms without claiming a diagnosis', () => {
  const html = render('wildfire');
  assert.match(html, /Why might this have changed\?/);
  assert.match(html, /Fire can alter vegetation/);
  assert.match(html, /cannot confirm a burn scar/);
  assert.match(html, /preview brightness, not calibrated/);
  assert.match(html, /not a diagnosis/);
  assert.match(html, /id="compare"/);
});

test('all event categories have contextual explanations, with a safe unknown fallback', () => {
  for (const category of Object.keys(config.CATEGORIES)) {
    assert.ok(config.CHANGE_EXPLANATIONS?.[category]);
    assert.ok(render(category).includes(config.CHANGE_EXPLANATIONS[category]));
  }
  assert.match(render('flood'), /water around trees or buildings can/);
  for (const category of ['unknown', '__proto__', '<script>', undefined]) {
    assert.ok(render(category).includes(config.CHANGE_EXPLANATIONS.other));
    assert.doesNotMatch(render(category), /<script>|\[object Object\]/);
  }
});

test('no explanation implies a comparison exists when no usable pair is available', () => {
  for (const scenes of [[], [scene(10)], [scene(20)]]) {
    assert.doesNotMatch(render('wildfire', scenes), /Why might this have changed\?|id="compare"/);
  }
});
