import test from 'node:test';
import assert from 'node:assert/strict';
import { MAT_MM, PIECES, rotateCell, rotateVertex, rotateDir, rotateCorner, rotatedDef } from '../js/geometry.js';

test('a mat is 300 mm', () => {
  assert.equal(MAT_MM, 300);
});

test('a vertex rotates as a point', () => {
  assert.deepEqual(rotateVertex([1, 0], 90), [0, 1]);
  assert.deepEqual(rotateVertex([1, 0], 180), [-1, 0]);
  assert.deepEqual(rotateVertex([1, 0], 270), [0, -1]);
  assert.deepEqual(rotateVertex([2, 3], 0), [2, 3]);
});

test('a cell rotates as a unit square, not as its origin corner', () => {
  assert.deepEqual(rotateCell([0, 0], 90), [-1, 0]);
  assert.deepEqual(rotateCell([1, 0], 90), [-1, 1]);
  assert.deepEqual(rotateCell([0, 0], 180), [-1, -1]);
  assert.deepEqual(rotateCell([2, 3], 0), [2, 3]);
});

test('directions and corners rotate clockwise', () => {
  assert.equal(rotateDir('N', 90), 'E');
  assert.equal(rotateDir('W', 90), 'N');
  assert.equal(rotateDir('N', 270), 'W');
  assert.equal(rotateCorner('NE', 90), 'SE');
  assert.equal(rotateCorner('SW', 180), 'NE');
});

test('an unrotated definition is returned as-is', () => {
  const d = rotatedDef('straight', 0);
  assert.deepEqual(d.cells, [[0, 0], [1, 0]]);
  assert.deepEqual(d.ports.map((p) => p.dir), ['N', 'S']);
});

test('a rotated straight is normalised back to the origin and turns 1x2', () => {
  const d = rotatedDef('straight', 90);
  assert.deepEqual(d.cells, [[0, 0], [0, 1]]);
  assert.deepEqual(d.ports.map((p) => p.dir), ['E', 'W']);
  assert.deepEqual(d.ports[0].cells, [[0, 0], [0, 1]]);
});

test('every rotation of every piece keeps its footprint at the origin', () => {
  for (const type of Object.keys(PIECES)) {
    for (const rot of [0, 90, 180, 270]) {
      const { cells } = rotatedDef(type, rot);
      assert.equal(Math.min(...cells.map((c) => c[0])), 0, `${type}@${rot} min x`);
      assert.equal(Math.min(...cells.map((c) => c[1])), 0, `${type}@${rot} min y`);
      assert.equal(cells.length, PIECES[type].cells.length, `${type}@${rot} cell count`);
    }
  }
});

test('rotating a corner carries its walls around with it', () => {
  const d = rotatedDef('cornerR30', 90);
  assert.deepEqual(d.walls.find((w) => w.kind === 'cap').vertex, [2, 2]);
  const arc = d.walls.find((w) => w.kind === 'arc');
  assert.equal(arc.corner, 'NW');
});

test('the three piece types have the footprints the spec fixes', () => {
  assert.equal(PIECES.straight.cells.length, 2);
  assert.equal(PIECES.cornerR30.cells.length, 4);
  assert.equal(PIECES.cornerR60.cells.length, 8);
  assert.deepEqual(PIECES.cornerR30.mats, { square: 3, quarterRound: 1 });
  assert.deepEqual(PIECES.cornerR60.mats, { square: 6, arcLarge: 2 });
});
