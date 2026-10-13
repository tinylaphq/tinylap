import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout } from '../js/model.js';
import { arcPath, layoutGeometry, layoutToSvgString } from '../js/render.js';
import { rectangularRing } from './fixtures.js';

test('an R30 arc runs corner to corner of its mat', () => {
  const d = arcPath({ kind: 'arc', r: 1, cell: [0, 1], corner: 'SW' });
  // endpoints (1,2) along the S edge and (0,1) along the W edge, centre (1,1)
  assert.equal(d, 'M 1 2 A 1 1 0 0 1 0 1');
});

test('an R60 arc spans two mats each way', () => {
  const d = arcPath({ kind: 'arcLarge', r: 2, cell: [0, 2], corner: 'SW' });
  assert.equal(d, 'M 2 3 A 2 2 0 0 1 0 1');
});

test('sweep flag is derived per corner, not hard-coded', () => {
  assert.equal(arcPath({ kind: 'arc', r: 1, cell: [0, 0], corner: 'NE' }), 'M 0 0 A 1 1 0 0 1 1 1');
  assert.equal(arcPath({ kind: 'arc', r: 1, cell: [0, 0], corner: 'SE' }), 'M 0 1 A 1 1 0 0 0 1 0');
  assert.equal(arcPath({ kind: 'arc', r: 1, cell: [0, 0], corner: 'SW' }), 'M 1 1 A 1 1 0 0 1 0 0');
  assert.equal(arcPath({ kind: 'arc', r: 1, cell: [0, 0], corner: 'NW' }), 'M 1 0 A 1 1 0 0 0 0 1');
});

test('geometry lists one rect per mat and one line per straight barrier', () => {
  const g = layoutGeometry(createLayout({ pieces: rectangularRing() }));
  assert.equal(g.mats.length, 48);
  assert.equal(g.lines.length, 40);
  assert.equal(g.arcs.length, 4);
  assert.deepEqual(g.bbox, { x: 0, y: 0, w: 7, h: 9 });
});

test('the standalone svg string carries a viewBox and no external references', () => {
  const svg = layoutToSvgString(createLayout({ pieces: rectangularRing() }));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="/);
  assert.ok(!svg.includes('class='), 'no stylesheet dependency');
  assert.ok(!svg.includes('http://localhost'));
});

test('an empty layout still produces valid svg', () => {
  const svg = layoutToSvgString(createLayout());
  assert.match(svg, /<svg /);
  assert.match(svg, /<\/svg>$/);
});

test('layoutToSvgString rejects a piece with a non-numeric coordinate', () => {
  const layout = createLayout({ pieces: [{ type: 'straight', x: 'nope', y: 0, rot: 0 }] });
  assert.throws(() => layoutToSvgString(layout), /Invalid viewBox [xywidtheight]+: NaN/);
});
