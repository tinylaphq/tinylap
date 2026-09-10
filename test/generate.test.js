import test from 'node:test';
import assert from 'node:assert/strict';
import { turnSignatures, outlineName, buildLoop } from '../js/generate.js';
import { createLayout, isClosedCircuit, findOverlaps, occupiedSet } from '../js/model.js';

test('four corners give exactly one outline: the rectangle', () => {
  assert.deepEqual(turnSignatures(4), ['RRRR']);
});

test('six corners give exactly one outline: the L', () => {
  const sigs = turnSignatures(6);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].length, 6);
  assert.equal([...sigs[0]].filter((c) => c === 'R').length, 5);
  assert.equal([...sigs[0]].filter((c) => c === 'L').length, 1);
});

test('eight corners give several distinct outlines', () => {
  const sigs = turnSignatures(8);
  // Confirmed independently by Burnside's lemma, not just by running this
  // module: n=8 has exactly 4 classes, n=10 has exactly 8.
  assert.equal(sigs.length, 4);
  for (const s of sigs) {
    assert.equal(s.length, 8);
    assert.equal([...s].filter((c) => c === 'R').length, 6);
  }
  assert.equal(new Set(sigs).size, sigs.length, 'no duplicates');
  assert.equal(turnSignatures(10).length, 8);
});

test('odd or too-small corner counts yield nothing', () => {
  assert.deepEqual(turnSignatures(3), []);
  assert.deepEqual(turnSignatures(5), []);
  assert.deepEqual(turnSignatures(2), []);
});

test('the two small outlines have friendly names', () => {
  assert.equal(outlineName('RRRR'), 'Rectangle');
  assert.equal(outlineName(turnSignatures(6)[0]), 'L-shape');
});

test('larger outlines fall back to an honest generic name', () => {
  // We do not claim to know which 8-corner class is "the T" and which is
  // "the U" — naming them would be inventing knowledge we have not verified.
  assert.match(outlineName(turnSignatures(8)[0]), /8-corner shape/);
});

test('a rectangle outline with equal sides closes', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  assert.ok(pieces, 'expected a closed loop');
  const l = createLayout({ pieces });
  assert.deepEqual(findOverlaps(l), []);
  assert.equal(isClosedCircuit(l), true);
});

test('the built rectangle is the 7x9 ring the rest of the suite already trusts', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [3, 5, 3, 5], cornerType: 'cornerR30' });
  assert.equal(occupiedSet(createLayout({ pieces })).size, 48);
});

test('a rectangle outline with mismatched sides does not close', () => {
  assert.equal(buildLoop({ signature: 'RRRR', sides: [3, 5, 4, 5], cornerType: 'cornerR30' }), null);
});

test('zero-length sides are allowed: four corners butted together close', () => {
  const pieces = buildLoop({ signature: 'RRRR', sides: [0, 0, 0, 0], cornerType: 'cornerR30' });
  assert.ok(pieces);
  assert.equal(occupiedSet(createLayout({ pieces })).size, 16);
});
