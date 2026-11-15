// Rules for the events themselves: which reports are one event, whose
// numbers lead, and what the text may say about "after".
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncidents } from '../js/incidents.js';
import { nisarLine } from '../js/narrative.js';
import { tilePoints } from '../js/replay/mvt.js';

const MIN = 60_000;
const DAY = 86400_000;
const T = Date.UTC(2026, 10, 1, 12);
const quake = (source, id, mag, minutes = 0, lat = -17.0, severity = mag / 10) => ({
  id: `${source}:${id}`, source, category: 'earthquake', title: `${source} M ${mag}`, lat, lon: 168.0,
  time: T + minutes * MIN, endTime: T + minutes * MIN, severity, magnitude: { value: mag }, reports: undefined,
});

test('a merged earthquake takes its magnitude and place from the USGS, whatever the other feed\'s alert level', () => {
  // GDACS's "severity" is an alert level; here it is higher than the USGS's.
  const [inc] = buildIncidents([quake('gdacs', 'a', 7.5, 0, -17.0, 0.9), quake('usgs', 'b', 7.2, 0, -17.05, 0.72)]);
  assert.equal(inc.reports.length, 2);
  assert.equal(inc.magnitude.value, 7.2);
  assert.equal(inc.lat, -17.05);
  // The dot keeps the strongest signal any feed gave.
  assert.equal(inc.severity, 0.9);
});

test('a mainshock and its aftershock stay two events when a second feed reports both', () => {
  const events = [quake('usgs', 'main', 6.8, 0), quake('usgs', 'after', 6.1, 5, -17.1), quake('gdacs', 'main', 6.8, 0), quake('gdacs', 'after', 6.1, 5, -17.1)];
  const incidents = buildIncidents(events);
  assert.equal(incidents.length, 2);
  for (const inc of incidents) assert.deepEqual(inc.reports.map((r) => r.source).sort(), ['gdacs', 'usgs']);
});

test('for an event that lasts, a pass is "after it began", not "after" it', () => {
  const pass = (days) => ({ time: T + days * DAY });
  const flood = { time: T, endTime: T + 40 * DAY };
  const line = nisarLine(flood, { backscatter: [pass(-14), pass(3)] });
  assert.match(line, /before it began and .* after it began\.$/);
  // An earthquake is one moment: plain before and after.
  const moment = nisarLine({ time: T, endTime: T }, { backscatter: [pass(-14), pass(3)] });
  assert.match(moment, /before and .* after\.$/);
});

test('a fire tile that was cut short is read to its end and no further', () => {
  // A field that announces more bytes than there are, then a number that never ends.
  assert.deepEqual(tilePoints(new Uint8Array([0x1a, 0x7f, 0x12, 0x80]).buffer), []);
  assert.deepEqual(tilePoints(new Uint8Array([0x1a, 0x80]).buffer), []);
});
