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

test('a point well inside a frame is preferred over one that grazes its edge', () => {
  const box = (west, east) => [{ lat: 0, lon: west }, { lat: 2, lon: west }, { lat: 2, lon: east }, { lat: 0, lon: east }];
  assert.ok(nisar.edgeMarginKm(box(0, 2), 1, 1) > 100);
  assert.ok(nisar.edgeMarginKm(box(0, 2), 1, 1.99) < 2);
  assert.ok(nisar.edgeMarginKm(box(0, 2), 1, 2.5) < 0);
  // The grazing pair is closer in time, but the pair that covers the place wins.
  const at = { lat: 1, lon: 1.98 };
  const grazing = [scene(14, { ring: box(0, 2) }), scene(16, { ring: box(0, 2) })];
  const covering = [scene(5, { track: '009', ring: box(1, 3) }), scene(30, { track: '009', ring: box(1, 3) })];
  assert.equal(nisar.bestPair([...grazing, ...covering], 15, true, at).before.track, '009');
  assert.equal(nisar.bestPair([...grazing, ...covering], 15).before.track, '001');
});

test('the two-channel reading is a labelled hypothesis and ignores small differences', async () => {
  const { channelReading } = await import('../js/narrative.js');
  const pol = { co: 'HH', cross: 'HV' };
  const at = (co, cross) => ({ time: 0, co, cross });
  assert.match(channelReading(at(180, 170), at(90, 85), pol), /Hypothesis.*Both channels fell.*cannot tell these apart/s);
  assert.match(channelReading(at(120, 150), at(118, 90), pol), /twisted echo \(HV\) fell.*burning, clearing or harvest/s);
  assert.match(channelReading(at(100, 80), at(160, 85), pol), /straight echo \(HH\) rose.*bounces twice/s);
  assert.match(channelReading(at(100, 80), at(110, 70), pol), /too little to read anything into/);
  assert.doesNotMatch(channelReading(at(100, 80), at(110, 70), pol), /Hypothesis/);
  // One channel only: nothing to compare.
  assert.equal(channelReading(at(100, null), at(50, null), { co: 'HH', cross: null }), null);
});

test('every kind of event says who could use NISAR there', async () => {
  const config = await import('../js/config.js');
  for (const category of Object.keys(config.CATEGORIES)) assert.ok(config.WHO_USES[category]?.length > 30, category);
});

test('a calibrated measurement is stated as a step in decibels, and only called "across the event" when it is', async () => {
  const { measuredStep, measuredLine } = await import('../js/measured.js');
  const DAYMS = 86400_000;
  const t0 = Date.UTC(2026, 9, 29);
  const d = {
    pols: ['HH', 'HV'],
    series: [
      { time: t0 - 12 * DAYMS, hh: -8.1, hv: -14.9 },
      { time: t0, hh: -8.0, hv: -15.0 },
      { time: t0 + 12 * DAYMS, hh: -12.2, hv: -19.5 },
    ],
    change: { before: t0, after: t0 + 12 * DAYMS },
  };
  const during = measuredStep(d, t0 + 7 * DAYMS);
  assert.ok(Math.abs(during.db + 4.2) < 1e-9 && Math.abs(during.crossDb + 4.5) < 1e-9);
  assert.equal(during.acrossEvent, true);
  // An event before both passes, or after both, is not "across".
  assert.equal(measuredStep(d, t0 - DAYMS).acrossEvent, false);
  assert.equal(measuredStep(d, t0 + 20 * DAYMS).acrossEvent, false);
  assert.equal(measuredStep(d).acrossEvent, false);
  assert.match(measuredLine(d, t0 + 7 * DAYMS), /HH echo fell by 4\.2 dB between 2026-10-29 and 2026-11-10, the passes on either side of the event\./);
  assert.doesNotMatch(measuredLine(d), /either side/);
  // A pass missing from the series gives no statement at all, never a guess.
  assert.equal(measuredStep({ ...d, change: { before: 1, after: 2 } }), null);
  assert.equal(measuredLine({ ...d, change: { before: 1, after: 2 } }), '');
});

test('a headline only counts as news about an event when it names that kind of event', async () => {
  const { dedupe, ON_TOPIC } = await import('../js/news.js');
  const a = (title) => ({ title, url: 'https://example.org/' + encodeURIComponent(title), time: 1 });
  const kept = (titles, cat) => dedupe(titles.map(a), ON_TOPIC[cat]).map((x) => x.title);
  // The headline that showed up under a forest fire in India.
  assert.deepEqual(kept(['Jwala , KL spot for a fiery yet refined Indian feast', 'Forest fires spread in central India', 'Firefighters battle blaze in Madhya Pradesh hills'], 'wildfire'), [
    'Forest fires spread in central India',
    'Firefighters battle blaze in Madhya Pradesh hills',
  ]);
  assert.deepEqual(kept(['Train delays in Tonga', 'Heavy rain floods Tonga capital', 'Brain drain worries Tonga'], 'flood'), ['Heavy rain floods Tonga capital']);
  assert.deepEqual(kept(['Winds of change in Fiji politics?', 'Cyclone nears Fiji', 'Window makers of Fiji'], 'storm'), ['Winds of change in Fiji politics?', 'Cyclone nears Fiji']);
  assert.deepEqual(kept(['M 6.1 quake hits off Japan', 'Japan stocks rise'], 'earthquake'), ['M 6.1 quake hits off Japan']);
});
