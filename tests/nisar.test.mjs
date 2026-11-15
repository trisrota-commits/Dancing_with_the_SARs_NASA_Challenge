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

test('the catalogue is searched without a name pattern, and the kind of product is sorted out here', async () => {
  const asked = [];
  const entry = (kind, minute) => ({
    id: `G${kind}${minute}`,
    title: `NISAR_L2_PR_${kind}_010_088_A_031_2005_DHDH_A_20261101T05${minute}00_20261101T05${minute}30_P05023_N_F_J_001`,
    time_start: `2026-11-01T05:${minute}:00.000Z`,
    polygons: [['10 10 10 12 12 12 12 10 10 10']],
    links: [],
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    // The urgent-response collection mixes two kinds of product.
    return { ok: true, json: async () => ({ feed: { entry: [entry('GCOV', '10'), entry('GSLC', '11'), entry('GCOV', '12'), entry('GSLC', '13')] } }) };
  };
  try {
    const fresh = await import(`../js/nisar.js?search-test=${Date.now()}`);
    const passes = await fresh.passesAt(11, 11, Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 14));
    assert.equal(asked.length, 1);
    // The slow option must never come back.
    assert.ok(!/readable_granule_name|pattern/.test(decodeURIComponent(asked[0])), asked[0]);
    assert.deepEqual([...new Set(passes.map((s) => s.product))], ['GCOV']);
    assert.equal(passes.length, 2);
    // Twice as many entries are asked for when the mixed collection is searched.
    assert.match(decodeURIComponent(asked[0]), /page_size=220/);
    // The same question again is answered from memory.
    await fresh.passesAt(11, 11, Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 14));
    assert.equal(asked.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the radar layers name NASA's map service for a single tile and for the whole world", async () => {
  const { NISAR_TILES, OVERLAYS } = await import('../js/config.js');
  for (const layer of [NISAR_TILES, OVERLAYS.s1]) {
    // The tile engine fills these in for one tile's area (see fetchTile).
    assert.ok(layer.map.includes('BBOX={bbox}') && layer.map.includes('WIDTH={px}') && layer.map.includes('HEIGHT={px}') && layer.map.includes('TIME={date}'));
    assert.ok(!/\{bbox\}|\{px\}/.test(layer.sheet) && layer.sheet.includes('WIDTH=1024') && layer.sheet.includes('TIME={date}'));
  }
});

test('a scene across the date line is read whole, and a point on either side of the line is inside it', async () => {
  const { pointInPolygon } = await import('../js/incidents.js');
  // A real scene over Fiji: the catalogue gives it as two polygons cut along 180°.
  const polygons = [['-18.04 -180 -17.94 -179.46 -15.85 -179.91 -15.87 -180 -18.04 -180'], ['-15.87 180 -16.29 177.8 -18.37 178.22 -18.04 180 -15.87 180']];
  const ring = nisar.sceneOutline(polygons);
  // Four corners (closed), none of them on the cut, in one run of longitudes.
  assert.equal(ring.length, 5);
  assert.ok(ring.every((p) => p.lon > 177 && p.lon < 181 && Math.abs(p.lon - 180) > 0.01));
  for (const [lat, lon] of [[-17, 179], [-17, -179.7], [-17, 179.99]]) {
    assert.ok(pointInPolygon(lat, lon, ring), `${lat}, ${lon} is inside`);
    assert.ok(nisar.edgeMarginKm(ring, lat, lon) > 0);
  }
  for (const [lat, lon] of [[-17, -179.0], [-17, 177], [-14, 179.5]]) {
    assert.ok(!pointInPolygon(lat, lon, ring), `${lat}, ${lon} is outside`);
    assert.ok(nisar.edgeMarginKm(ring, lat, lon) < 0);
  }
  // Two polygons that are not a date-line cut: the first, as before.
  assert.equal(nisar.sceneOutline([['1 2 3 4 5 6 1 2'], ['7 8 9 10 11 12 7 8']]).length, 4);
});
