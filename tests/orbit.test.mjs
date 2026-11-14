// Orbit maths, checked with the ISS sample elements from the satellite.js
// documentation (NISAR's own elements are fetched live by the app).
import test from 'node:test';
import assert from 'node:assert/strict';
import { twoline2satrec } from '../vendor/satellite.es.js';
import { positionAt, groundTrack, swathEdges, elementsEpoch, destination, NISAR_ORBIT } from '../js/orbit.js';

const satrec = twoline2satrec(
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
);
const epoch = elementsEpoch(satrec);

test('epoch is read from the elements', () => {
  assert.equal(epoch.toISOString().slice(0, 10), '2019-06-05');
});

test('position is physically plausible for the ISS', () => {
  const p = positionAt(satrec, epoch);
  assert.ok(Math.abs(p.lat) <= 51.7, p.lat);
  assert.ok(p.altKm > 380 && p.altKm < 440, p.altKm);
  assert.ok(p.speedKms > 7.5 && p.speedKms < 7.8, p.speedKms);
});

test('a ground track covers one orbit without jumps in latitude', () => {
  const track = groundTrack(satrec, epoch, 46, 46, 1);
  assert.equal(track.length, 93);
  for (let i = 1; i < track.length; i++) assert.ok(Math.abs(track[i].lat - track[i - 1].lat) < 4.5);
  assert.ok(Math.max(...track.map((p) => p.lat)) > 50);
  assert.ok(Math.min(...track.map((p) => p.lat)) < -50);
});

test('the swath lies to the left of the flight direction, at the stated distances', () => {
  // Flying due north from the equator, "left" is west.
  const track = [
    { lat: -1, lon: 10 },
    { lat: 0, lon: 10 },
    { lat: 1, lon: 10 },
  ];
  const { near, far } = swathEdges(track);
  assert.ok(near[1].lon < 10 && far[1].lon < near[1].lon);
  const kmPerDeg = (Math.PI / 180) * 6371;
  assert.ok(Math.abs((10 - near[1].lon) * kmPerDeg - NISAR_ORBIT.swathNearKm) < 2);
  assert.ok(Math.abs((10 - far[1].lon) * kmPerDeg - NISAR_ORBIT.swathFarKm) < 2);
});

test('destination wraps longitude across the date line', () => {
  const p = destination({ lat: 0, lon: 179.5 }, Math.PI / 2, 200);
  assert.ok(p.lon < -178 && p.lon > -180, p.lon);
});
