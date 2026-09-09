import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, cellKey, parseCellKey, occupancy, findOverlaps, occupiedSet, edgeId, portKey, matchPorts, openEdgeIds, isClosedCircuit } from '../js/model.js';
import { fourCornerLoop } from './fixtures.js';

test('a new layout is empty and versioned', () => {
  const l = createLayout();
  assert.equal(l.version, 1);
  assert.equal(l.unit, 'mat');
  assert.equal(l.room, null);
  assert.deepEqual(l.pieces, []);
});

test('cell keys round-trip', () => {
  assert.equal(cellKey([3, -4]), '3,-4');
  assert.deepEqual(parseCellKey('3,-4'), [3, -4]);
});

test('occupancy maps every cell to the pieces claiming it', () => {
  const l = createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
  const occ = occupancy(l);
  assert.deepEqual([...occ.keys()].sort(), ['0,0', '1,0']);
  assert.deepEqual(occ.get('0,0'), [0]);
});

test('non-overlapping pieces report no overlaps', () => {
  const l = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 0, y: 1, rot: 0 },
  ] });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(occupiedSet(l).size, 4);
});

test('overlapping pieces report the contested cells', () => {
  const l = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 1, y: 0, rot: 0 },
  ] });
  assert.deepEqual(findOverlaps(l), ['1,0']);
  assert.equal(occupancy(l).get('1,0').length, 2);
});

test('an edge has one name whichever cell you approach it from', () => {
  assert.equal(edgeId([3, 4], 'N'), 'H:3:4');
  assert.equal(edgeId([3, 3], 'S'), 'H:3:4');
  assert.equal(edgeId([3, 4], 'W'), 'V:3:4');
  assert.equal(edgeId([2, 4], 'E'), 'V:3:4');
});

test('abutting ports share a key', () => {
  const [a] = matchPortsFixtureA();
  const [b] = matchPortsFixtureB();
  assert.equal(portKey(a), portKey(b));
});

function matchPortsFixtureA() {
  // south port of a straight at (0,0)
  return [{ cells: [[0, 0], [1, 0]], dir: 'S' }];
}
function matchPortsFixtureB() {
  // north port of a straight at (0,1)
  return [{ cells: [[0, 1], [1, 1]], dir: 'N' }];
}

test('a lone straight has two open ends', () => {
  const l = createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
  const { matched, open } = matchPorts(l);
  assert.equal(matched.size, 0);
  assert.equal(open.length, 2);
  assert.equal(isClosedCircuit(l), false);
});

test('two stacked straights match one pair and leave two open', () => {
  const l = createLayout({ pieces: [
    { type: 'straight', x: 0, y: 0, rot: 0 },
    { type: 'straight', x: 0, y: 1, rot: 0 },
  ] });
  const { matched, open } = matchPorts(l);
  assert.equal(matched.size, 1);
  assert.equal(open.length, 2);
});

test('open port edges are reported for the boundary walk to skip', () => {
  const l = createLayout({ pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] });
  assert.deepEqual([...openEdgeIds(l)].sort(), ['H:0:0', 'H:0:1', 'H:1:0', 'H:1:1']);
});

test('a 2x2 loop of four R30 corners is a closed circuit', () => {
  const l = createLayout({ pieces: fourCornerLoop() });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(matchPorts(l).open.length, 0);
  assert.equal(isClosedCircuit(l), true);
});
