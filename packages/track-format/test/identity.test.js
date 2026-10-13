// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, isClosedCircuit, placedCells, rotateCell, shapeOf, rectangularRing, stockL, capVertices, computeBarriers } from '../index.js';

// Rotate a whole build by `rot` degrees clockwise: every piece turns with it,
// and lands at the minimum of its rotated cells (rotatedDef's convention).
function rotated(pieces, rot) {
  return pieces.map((p) => {
    const cells = placedCells(p).map((c) => rotateCell(c, rot));
    return {
      type: p.type,
      x: Math.min(...cells.map((c) => c[0])),
      y: Math.min(...cells.map((c) => c[1])),
      rot: (p.rot + rot) % 360,
    };
  });
}

// Mirror a build left-to-right. A corner's ports N+E become N+W, which is the
// corner at the rotation in MIRROR_ROT. A straight's two ports are opposite,
// so its rotation is unchanged.
const MIRROR_ROT = { 0: 270, 90: 180, 180: 90, 270: 0 };
function mirrored(pieces) {
  return pieces.map((p) => {
    const xs = placedCells(p).map(([x]) => -x);
    return { type: p.type, x: Math.min(...xs), y: p.y, rot: p.type === 'straight' ? p.rot : MIRROR_ROT[p.rot] };
  });
}

const moved = (pieces, dx, dy) => pieces.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
const shape = (pieces) => shapeOf(createLayout({ pieces }));

test('the test helpers produce closed circuits', () => {
  for (const base of [rectangularRing(), stockL()]) {
    for (const rot of [90, 180, 270]) assert.ok(isClosedCircuit(createLayout({ pieces: rotated(base, rot) })));
    assert.ok(isClosedCircuit(createLayout({ pieces: mirrored(base) })));
  }
});

test('a shape carries the c30:1: prefix', () => {
  assert.match(shape(stockL()), /^c30:1:/);
});

test('the shape ignores where the layout sits', () => {
  for (const base of [rectangularRing(), stockL()]) {
    assert.equal(shape(moved(base, 5, -3)), shape(base));
  }
});

test('the shape ignores quarter-turn rotations of the whole layout', () => {
  for (const base of [rectangularRing(), stockL()]) {
    for (const rot of [90, 180, 270]) assert.equal(shape(rotated(base, rot)), shape(base), `rot ${rot}`);
  }
});

test('a mirrored layout is a different track', () => {
  assert.notEqual(shape(mirrored(stockL())), shape(stockL()));
});

test('a mirror-symmetric layout equals its mirror image, by nature', () => {
  assert.equal(shape(mirrored(rectangularRing())), shape(rectangularRing()));
});

test('different builds have different shapes', () => {
  assert.notEqual(shape(rectangularRing()), shape(stockL()));
});

test('straights at 0 and 180 degrees build the same thing', () => {
  const base = rectangularRing();
  const flipped = base.map((p) => (p.type === 'straight' ? { ...p, rot: (p.rot + 180) % 360 } : p));
  assert.notDeepEqual(flipped, base);
  assert.equal(shape(flipped), shape(base));
});

test('open and overlapping layouts have no shape', () => {
  assert.equal(shape(stockL().slice(1)), null);
  assert.equal(shape([]), null);
  const ring = rectangularRing();
  assert.equal(shape([...ring, ring[4]]), null);
});

test('cap vertices are exactly the caps computeBarriers counts', () => {
  for (const pieces of [stockL(), rectangularRing()]) {
    const layout = createLayout({ pieces });
    assert.equal(capVertices(layout).length, computeBarriers(layout).counts.cornerCap);
    assert.ok(capVertices(layout).length > 0);
  }
});
