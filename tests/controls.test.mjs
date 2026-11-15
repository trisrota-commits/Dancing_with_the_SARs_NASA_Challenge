// The globe's drag: the point that is grabbed stays under the cursor, north
// stays at the top away from the poles, and a pole can be pulled across.
//
//   node --test tests/controls.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { GlobeControls } from '../js/engine/controls.js';

const W = 1280;
const H = 720;

// A camera and a stand-in for the page element: no browser is needed.
function rig({ lat = 20, lon = 30, alt = 3.8 } = {}) {
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
  const element = { style: {}, clientHeight: H, addEventListener() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) };
  const c = new GlobeControls(camera, element);
  c.stop();
  Object.assign(c, { lat, lon, alt });
  c.apply();
  return c;
}
const at = (x, y, more = {}) => ({ pointerId: 1, clientX: x, clientY: y, button: 0, ...more });
// How far (in degrees on the globe) the grabbed point is from the cursor.
const off = (c, x, y) => (c.under(x, y).angleTo(c.grab) * 180) / Math.PI;

test('the grabbed point stays under the cursor, and north at the top', () => {
  const c = rig();
  c.down(at(800, 300));
  assert.ok(c.grab, 'the globe was grabbed');
  for (const [x, y] of [[780, 320], [700, 380], [560, 300], [640, 200]]) {
    c.move(at(x, y));
    assert.ok(off(c, x, y) < 0.01, `under the cursor at ${x}, ${y}: ${off(c, x, y)}`);
    assert.ok(Math.abs(c.heading) < 1e-6, `north at the top: ${c.heading}`);
  }
  c.up(at(640, 200));
});

test('a point near the edge of the globe is held as well', () => {
  const c = rig({ lat: 0, lon: 0 });
  c.down(at(640, 200)); // far north of the middle of the view, near the edge
  assert.ok(c.grab, 'the globe was grabbed');
  for (const [x, y] of [[700, 230], [760, 260], [600, 330]]) {
    c.move(at(x, y));
    assert.ok(off(c, x, y) < 0.01, `under the cursor at ${x}, ${y}: ${off(c, x, y)}`);
  }
});

test('a pole can be pulled across the view, and north comes back afterwards', () => {
  const c = rig({ lat: 70, lon: 0, alt: 3.8 });
  c.down(at(640, 360));
  // Pull the middle of the view down the screen, a little at a time: the
  // view travels north, over the pole, and down the other side.
  const lats = [];
  let y = 360;
  for (let i = 0; i < 23; i++) {
    y += 8;
    c.move(at(640, y));
    lats.push(c.lat);
    assert.ok(off(c, 640, y) < 0.05, `held at step ${i} (lat ${c.lat}): ${off(c, 640, y)}`);
  }
  assert.ok(Math.max(...lats) > 85, `the view reached the pole: ${Math.max(...lats)}`);
  assert.ok(Math.abs(Math.abs(c.lon) - 180) < 5, `and went down the far side: lon ${c.lon}`);
  assert.ok(c.lat < 62, `out of the polar cap again: ${c.lat}`);
  // Like a ball in the hand, it comes out upside down ...
  assert.ok(Math.abs(Math.abs(c.heading) - 180) < 5, `upside down while held: ${c.heading}`);
  // ... and stays as it was left: nothing pulls it round once it is let go.
  c.up(at(640, y));
  const left = c.heading;
  for (let i = 0; i < 40; i++) c.update(0.05);
  assert.equal(c.heading, left);
  // Going anywhere turns it upright again.
  c.flyTo(43, 11, 3, 0.1);
  for (let i = 0; i < 10; i++) c.update(0.05);
  assert.ok(Math.abs(c.heading) < 1e-6, `north is back at the top: ${c.heading}`);
});

test('inside a polar cap the globe turns freely', () => {
  const c = rig({ lat: 88, lon: 0, alt: 0.6 });
  c.down(at(640, 360));
  for (const x of [660, 680, 700, 720]) {
    c.move(at(x, 360)); // sideways beside the pole
    assert.ok(off(c, x, 360) < 0.05, `held at ${x}: ${off(c, x, 360)}`);
  }
  assert.ok(Math.abs(c.lat) > 80, 'still in the cap');
  assert.ok(Math.abs(c.heading) > 1, `the view turned: ${c.heading}`);
  // A flight from there arrives with north where the reader had it.
  c.up(at(720, 360));
  c.flyTo(43, 11, 0.3, 0.1);
  for (let i = 0; i < 10; i++) c.update(0.05);
  assert.ok(Math.abs(c.heading) < 1e-6 && Math.abs(c.lat - 43) < 1e-6);
});

test('no drag tilts or turns the view, whatever button or key', () => {
  for (const alt of [3, 0.05]) {
    for (const how of [{ button: 2 }, { ctrlKey: true }, { shiftKey: true }]) {
      const c = rig({ alt });
      c.down(at(640, 300, how));
      assert.ok(c.grab, 'it holds the globe like any drag');
      c.move(at(640, 220, how));
      c.move(at(700, 180, how));
      assert.ok(off(c, 700, 180) < 0.01, 'the grabbed point is under the cursor');
      c.up(at(700, 180, how));
      assert.equal(c.pitch, 0);
      assert.equal(c.heading, 0);
    }
  }
});

test('two fingers zoom and do not tilt', () => {
  const c = rig({ alt: 0.05 });
  c.down(at(600, 360, { pointerId: 1 }));
  c.down(at(680, 360, { pointerId: 2 }));
  c.move(at(600, 300, { pointerId: 1 }));
  c.move(at(680, 300, { pointerId: 2 }));
  c.move(at(560, 300, { pointerId: 1 }));
  assert.equal(c.pitch, 0);
  assert.ok(c.alt < 0.05, 'spreading the fingers zooms in');
});

test('the 3D view lies flat again from far out', () => {
  const c = rig({ alt: 0.01 });
  c.pitch = 60; // as the 3D button sets it
  c.apply();
  assert.equal(c.pitch, 60);
  c.zoomBy(200);
  assert.equal(c.pitch, 0);
  // Nor does a tilt set from outside survive up there.
  c.pitch = 60;
  c.apply();
  assert.equal(c.pitch, 0);
});

test('a view turned away from north is kept through a drag', () => {
  const c = rig({ alt: 0.05 });
  c.heading = c.home = -18;
  c.apply();
  c.down(at(640, 360));
  c.move(at(600, 420));
  assert.ok(Math.abs(c.heading + 18) < 1e-6, 'the heading is held');
  assert.ok(off(c, 600, 420) < 0.01);
});

test('a drag that begins on the sky still pans', () => {
  const c = rig();
  c.down(at(20, 20));
  assert.equal(c.grab, null);
  const before = c.lat;
  c.move(at(20, 80));
  assert.notEqual(c.lat, before);
});
